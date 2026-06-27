#!/usr/bin/env bash
# Self-test for bin/lib/app-test.sh — validates the per-app test CONTROL FLOW with
# everything stubbed, so it runs in milliseconds with no VM, no Docker, no network.
# It locks in the properties that are easy to regress in bash:
#   * one app's failure/skip never aborts the sweep (the errexit-leak class of bug:
#     a library function must not leak `set -e` state back to the caller's loop);
#   * required SECRET env vars are auto-filled with generated tokens and the install
#     retried (so apps like gitea install unattended);
#   * an app needing NON-secret manual config is reported SKIP, not FAIL;
#   * a genuinely broken install is reported FAIL at the install stage.
# Run: bash bin/lib/app-test.selftest.sh   (exit 0 = pass)
set -euo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "$HERE/../.." && pwd); BIN_DIR="$ROOT_DIR/bin"
DASHBOARD_URL=https://apps.test; API_KEY=k; DOMAIN_BASE=test; HTTP_TIMEOUT=5
INSTALL_ATTEMPTS=3; INSTALL_BACKOFF=0
# shellcheck source=/dev/null
source "$BIN_DIR/lib/app-test.sh"

# --- stubs: override the leaf functions that touch the VM/CLI ----------------
# Raw installer: stdout=JSON; errors go to $errf (mirrors `bun … 2>errf`).
_at_install_exec() {
  local app=$1 errf=$2; shift 2
  : > "$errf"
  case "$app" in
    gitea)  # requires a secret; succeeds once it's supplied via --set
      if printf '%s\0' "$@" | grep -qz '^GITEA_RUNNER_REGISTRATION_TOKEN='; then
        echo '{"status":"completed","deploymentId":"gitea-abc"}'; return 0; fi
      echo "  error: Secret environment variable 'GITEA_RUNNER_REGISTRATION_TOKEN' is required but empty" >> "$errf"
      return 1 ;;
    uptime-kuma) echo '{"status":"completed","deploymentId":"uptime-kuma-def"}'; return 0 ;;
    vaultwarden) echo '{"status":"completed","deploymentId":"vaultwarden-ghi"}'; return 0 ;;
    cfgapp)  # needs NON-secret config we won't fabricate -> SKIP
      echo "  error: Environment variable 'SOME_DOMAIN' is required but empty" >> "$errf"; return 1 ;;
    badapp)  echo "  error: boom" >> "$errf"; return 1 ;;
  esac
}
at_cli() {  # only `deployments --json` and `uninstall …` are exercised here
  if [[ "$1 $2" == "deployments --json" ]]; then
    echo '{"items":[{"id":"gitea-abc","status":"running","url":"https://gitea.test"},
                    {"id":"uptime-kuma-def","status":"running","url":"https://uptime-kuma.test"},
                    {"id":"vaultwarden-ghi","status":"running","url":"https://vaultwarden.test"}]}'
  fi
}
at_ssh() {  # uninstall check greps for a leftover container (gone -> 1); verify lists one healthy
  [[ "$*" == *"grep -q 'hola-"* ]] && return 1
  echo "hola-${AT_DEPLOY_ID}-app-1	Up 2 minutes (healthy)"
}
at_http_code() { echo 200; }

# --- drive the same loop vm-catalog-test uses -------------------------------
LOG=$(mktemp -d); trap 'rm -rf "$LOG"' EXIT
declare -a OUTCOME=()
for app in gitea uptime-kuma vaultwarden cfgapp badapp; do
  rc=0
  at_run_app "$app" "$LOG/$app" 2>"$LOG/$app.log" || rc=$?
  case "$rc" in
    0) OUTCOME+=("PASS:$app") ;;
    2) OUTCOME+=("SKIP:$app") ;;
    *) OUTCOME+=("FAIL:$app:$AT_LAST_STAGE") ;;
  esac
done

# --- assertions -------------------------------------------------------------
expected=(PASS:gitea PASS:uptime-kuma PASS:vaultwarden SKIP:cfgapp FAIL:badapp:install)
ok=1
[[ "${#OUTCOME[@]}" == 5 ]] || { echo "FAIL: visited ${#OUTCOME[@]}/5 apps (errexit leak?)"; ok=0; }
for i in "${!expected[@]}"; do
  [[ "${OUTCOME[$i]:-}" == "${expected[$i]}" ]] || { echo "FAIL: app $i expected '${expected[$i]}' got '${OUTCOME[$i]:-<none>}'"; ok=0; }
done
if [[ "$ok" == 1 ]]; then echo "app-test.selftest: PASS (${OUTCOME[*]})"; else echo "app-test.selftest: FAILED"; exit 1; fi
