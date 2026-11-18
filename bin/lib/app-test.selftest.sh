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
DASHBOARD_URL=https://apps.test; API_KEY=k; DOMAIN_BASE=test; HTTP_TIMEOUT=5; VMID=999
INSTALL_ATTEMPTS=3; INSTALL_BACKOFF=0
# Hermetic: never pick up a real test CA from .devcontainer/.test-ca. The first sweep below
# runs with trusted mode OFF (the pre-009 control flow); the sso-trust section stubs the probe.
VM_TEST_CA_DIR=$(mktemp -d); export VM_TEST_CA_DIR
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
    oidc-ok|oidc-bad|oidc-skip|plain) echo "{\"status\":\"completed\",\"deploymentId\":\"$app-id\"}"; return 0 ;;
  esac
}
at_cli() {  # `deployments --json`, `restart <id> --json` and `uninstall …` are exercised here
  if [[ "$1" == "restart" ]]; then echo '{"status":"completed"}'; return 0; fi
  if [[ "$1 $2" == "deployments --json" ]]; then
    echo '{"items":[{"id":"oidc-ok-id","status":"running","url":"https://oidc-ok.test"},
                    {"id":"oidc-bad-id","status":"running","url":"https://oidc-bad.test"},
                    {"id":"oidc-skip-id","status":"running","url":"https://oidc-skip.test"},
                    {"id":"plain-id","status":"running","url":"https://plain.test"},
                    {"id":"gitea-abc","status":"running","url":"https://gitea.test"},
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
LOG=$(mktemp -d); trap 'rm -rf "$LOG" "$VM_TEST_CA_DIR"' EXIT
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

# --- sso-trust stage (spec 009, FR-014/FR-015/SC-005) -------------------------
# tt_oidc_probe is stubbed: ok / covered-but-failing / SKIP / not-run (rc 0/1/2/3).
declare -a PROBE_CALLS=()
tt_oidc_probe() {
  PROBE_CALLS+=("$2"); TT_PROBE_URL="https://auth.test/-/health/live/"
  case "$2" in
    oidc-bad)  TT_PROBE_REASON="could not fetch discovery"; return 1 ;;
    oidc-skip) TT_PROBE_REASON="trust not covered"; return 2 ;;
    oidc-ok)   return 0 ;;
    *)         TT_PROBE_REASON="not a native-oidc app"; return 3 ;;
  esac
}
declare -A SSO_OUT=() SSO_NOTE=()
run_sso_sweep() {   # run_sso_sweep <label> — same loop shape as vm-catalog-test
  PROBE_CALLS=(); SSO_OUT=(); SSO_NOTE=()
  for app in oidc-bad oidc-ok oidc-skip plain; do
    rc=0; at_run_app "$app" "$LOG/$1-$app" 2>"$LOG/$1-$app.log" || rc=$?
    SSO_OUT[$app]="$rc:$AT_LAST_STAGE"; SSO_NOTE[$app]="$AT_NOTE"
  done
}
sso_fail() { echo "FAIL: $1"; ok=0; }

AT_TEST_RESTART=0; run_sso_sweep plain
[[ "${SSO_OUT[oidc-bad]}" == "1:sso-trust" ]] || sso_fail "covered+failing probe should FAIL at sso-trust, got '${SSO_OUT[oidc-bad]}'"
[[ "${SSO_OUT[oidc-ok]}" == "0:" && -z "${SSO_NOTE[oidc-ok]}" ]] || sso_fail "ok probe should PASS with no note, got '${SSO_OUT[oidc-ok]}' note='${SSO_NOTE[oidc-ok]}'"
[[ "${SSO_OUT[oidc-skip]}" == "0:" && "${SSO_NOTE[oidc-skip]}" == "sso-trust: SKIP (trust not covered)" ]] || sso_fail "SKIP should PASS carrying a note, got '${SSO_OUT[oidc-skip]}' note='${SSO_NOTE[oidc-skip]}'"
[[ "${SSO_OUT[plain]}" == "0:" && -z "${SSO_NOTE[plain]}" ]] || sso_fail "not-run should PASS with no note, got '${SSO_OUT[plain]}' note='${SSO_NOTE[plain]}'"
[[ "${#SSO_OUT[@]}" == 4 ]] || sso_fail "a failing sso-trust must not abort the sweep (${#SSO_OUT[@]}/4 apps ran)"
[[ "${PROBE_CALLS[*]}" == "oidc-bad oidc-ok oidc-skip plain" ]] || sso_fail "probe once per app without restart, got '${PROBE_CALLS[*]}'"

AT_TEST_RESTART=1; run_sso_sweep restart
[[ "${PROBE_CALLS[*]}" == "oidc-bad oidc-ok oidc-ok oidc-skip oidc-skip plain plain" ]] \
  || sso_fail "probe must re-run after restart for apps that got past the first probe (SC-005), got '${PROBE_CALLS[*]}'"
[[ "${SSO_OUT[oidc-bad]}" == "1:sso-trust" && "${SSO_OUT[oidc-ok]}" == "0:" ]] || sso_fail "restart sweep outcomes changed: bad='${SSO_OUT[oidc-bad]}' ok='${SSO_OUT[oidc-ok]}'"
AT_TEST_RESTART=0

if [[ "$ok" == 1 ]]; then echo "app-test.selftest: PASS (${OUTCOME[*]}; sso-trust: fail/ok/skip/not-run + restart re-probe)"; else echo "app-test.selftest: FAILED"; exit 1; fi
