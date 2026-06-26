#!/usr/bin/env bash
# bin/lib/app-test.sh — the deterministic PER-APP test, as sourceable functions.
#
# This is the single source of truth for "install one catalog app against an
# already-bootstrapped Hola server, verify it comes up, optionally exercise its
# lifecycle, then uninstall it." Both the single-app suite (bin/vm-e2e-suite) and
# the catalog sweep (bin/vm-catalog-test) source this so they run the EXACT same
# per-app checks — the catalog sweep is just this test in a loop over the catalog.
#
# It is auth-mode-agnostic: the front-door check accepts the healthy response of
# any mode — 200 (auth.mode:none / native-oidc apps serve directly) OR a 30x/401
# redirect to Authentik (forward-auth apps are gated at the Traefik edge). The hard
# "came up correctly" gate is the deployment converging to `running` with its
# container(s) actually running on the host; the HTTP front door adds ingress
# confidence on top.
#
# SOURCE it (do not execute). The caller MUST set these globals first:
#   ROOT_DIR        repo root (from bin/_common.sh)
#   BIN_DIR         repo bin/ (from bin/_common.sh)
#   VMID            target VM id (for host-side docker/ssh assertions)
#   DASHBOARD_URL   https://apps.<base>            (server API + dashboard front door)
#   API_KEY         the server admin API key       (HOLA_TOKEN for the CLI)
#   DOMAIN_BASE     <base> e.g. 192.168.1.15.sslip.io
# Optional tunables (seconds unless noted):
#   INSTALL_TIMEOUT(600) ACTION_TIMEOUT(240) HTTP_TIMEOUT(180) READY_TIMEOUT(180)
#   INSTALL_ATTEMPTS(3)  INSTALL_BACKOFF(20)
# Logging helpers log()/warn()/err() come from bin/_common.sh (already sourced).

# Guard against double-sourcing.
[[ -n "${__APP_TEST_SH_LOADED:-}" ]] && return 0
__APP_TEST_SH_LOADED=1

# --- per-app timeouts (overridable via env) ---------------------------------
: "${INSTALL_TIMEOUT:=600}"
: "${ACTION_TIMEOUT:=240}"
: "${HTTP_TIMEOUT:=180}"
: "${READY_TIMEOUT:=180}"
: "${INSTALL_ATTEMPTS:=3}"
: "${INSTALL_BACKOFF:=20}"

# Result of the most recent at_install: the deployment id and the app URL the
# server reports. Read by the other at_* steps and by callers for summaries.
AT_DEPLOY_ID=""
AT_APP_URL=""

# --- low-level helpers ------------------------------------------------------
# Run the working-tree CLI against the VM's server, with the self-signed-TLS
# bypass and the deterministic admin token. Stdout is the command's stdout.
at_cli() {
  NODE_TLS_REJECT_UNAUTHORIZED=0 HOLA_NO_UPDATE_NOTICE=1 \
    HOLA_API_URL="$DASHBOARD_URL" HOLA_TOKEN="$API_KEY" \
    bun --cwd "$ROOT_DIR/packages/cli" src/index.ts "$@"
}

# Run a command on the VM over SSH (quietly). Returns the command's exit code.
at_ssh() { "$BIN_DIR/vm-ssh" --vmid "$VMID" -- "$@" 2>/dev/null; }

at_http_code() { curl -k -s -o /dev/null -w '%{http_code}' --max-time 10 "$1" 2>/dev/null || echo 000; }

# at_wait_http <url> <code-regex> <timeout> — poll until the front door answers
# with an acceptable code, or time out. Logs the final code either way.
at_wait_http() {
  local url=$1 want=$2 timeout=$3 code deadline; deadline=$(( $(date +%s) + timeout ))
  while :; do
    code=$(at_http_code "$url")
    if [[ "$code" =~ $want ]]; then log "    $url -> HTTP $code"; return 0; fi
    if [[ $(date +%s) -ge $deadline ]]; then err "    $url -> HTTP $code (timeout after ${timeout}s)"; return 1; fi
    sleep 5
  done
}

# The set of HTTP codes that mean "the ingress route is live and the app answered"
# regardless of auth mode: 200/201 (served directly), 30x (forward-auth redirect to
# Authentik, or app's own redirect), 401/403 (gated but routed). 000/5xx = not up.
AT_HEALTHY_HTTP='^(200|201|30[0-9]|401|403)$'

# Status of a deployment id from the server's deployments list ("" if absent).
at_deploy_status() {
  at_cli deployments --json 2>/dev/null \
    | jq -r --arg id "$1" '.items[]? | select(.id == $id) | .status // empty' 2>/dev/null || true
}

# Capture server + per-app diagnostics for a failed step (best-effort).
at_capture_diag() {
  local logdir=$1 tag=$2
  at_cli logs "${AT_DEPLOY_ID:-}" > "$logdir/deploy-logs-$tag.txt" 2>/dev/null || true
  at_ssh 'cd /opt/hola && docker compose logs --since 5m --no-color server' \
    > "$logdir/server-logs-$tag.txt" 2>/dev/null || true
  # The app's own containers (compose project is hola-<deploymentId>).
  [[ -n "${AT_DEPLOY_ID:-}" ]] && at_ssh "docker ps -a --filter 'name=hola-${AT_DEPLOY_ID}' --format '{{.Names}}\t{{.Status}}'" \
    > "$logdir/app-containers-$tag.txt" 2>/dev/null || true
}

# --- the deterministic per-app steps ----------------------------------------
# Each writes detailed output under <logdir> and returns 0 (pass) / non-zero (fail).
# They are deliberately terse on stdout (one or two log lines) — the detail lives
# in the files so a sweep over many apps stays scannable.

# Run `hola install <app> [--set …] --json`, stdout = the JSON result, stderr →
# $errf. Split out as its own function so the harness self-test can override it.
_at_install_exec() {
  local app=$1 errf=$2; shift 2   # remaining args are the --set pairs
  timeout "$INSTALL_TIMEOUT" \
    env NODE_TLS_REJECT_UNAUTHORIZED=0 HOLA_NO_UPDATE_NOTICE=1 \
      HOLA_API_URL="$DASHBOARD_URL" HOLA_TOKEN="$API_KEY" \
      bun --cwd "$ROOT_DIR/packages/cli" src/index.ts install "$app" "$@" --json 2>"$errf"
}

# at_install <app> <logdir> — install the app, retrying the first deploy on the
# known docker-spawn ENOENT race. Sets AT_DEPLOY_ID + AT_APP_URL on success.
# Return codes: 0 = installed, 1 = real failure, 2 = needs manual (non-secret)
# config so the sweep should SKIP it (sets AT_SKIP_REASON).
AT_SKIP_REASON=""
at_install() {
  local app=$1 logdir=$2
  AT_DEPLOY_ID=""; AT_APP_URL=""; AT_SKIP_REASON=""
  # `--set KEY=VALUE` args we accumulate to satisfy required SECRET env vars the
  # app's manifest demands (generated tokens — safe for secrets; we never invent
  # values for non-secret required config, which would need real meaning).
  local -a set_args=()
  local attempt=0 cfg_tries=0 logn=0 rc out status backoff="$INSTALL_BACKOFF"
  # Budget: INSTALL_ATTEMPTS race-retries PLUS up to 5 config-fills (each fill is a
  # separate immediate retry, not a race-retry, so a multi-secret app converges).
  while (( attempt < INSTALL_ATTEMPTS )); do
    attempt=$(( attempt + 1 ))
    # `logn` is a monotonic per-exec counter so config-fill retries (which reuse the
    # `attempt` number) don't clobber the previous exec's install-N.err/.json.
    logn=$(( logn + 1 ))
    local errf="$logdir/install-$logn.err"
    # errexit-safe capture: NEVER toggle global `set -e` here — this is a sourced
    # library and a leaked errexit state would abort the caller's loop.
    if out=$(_at_install_exec "$app" "$errf" "${set_args[@]}"); then rc=0; else rc=$?; fi
    echo "$out" > "$logdir/install-$logn.json"
    status=$(echo "$out" | jq -r '.status // empty' 2>/dev/null || true)
    AT_DEPLOY_ID=$(echo "$out" | jq -r '.deploymentId // empty' 2>/dev/null || true)
    log "    install try $logn (attempt $attempt/$INSTALL_ATTEMPTS): exit=$rc status=${status:-<none>} deployment=${AT_DEPLOY_ID:-<none>} set=${#set_args[@]}"
    if [[ "$rc" == 0 && "$status" == "completed" ]]; then
      AT_APP_URL=$(at_cli deployments --json 2>/dev/null | jq -r --arg id "$AT_DEPLOY_ID" \
        '.items[]? | select(.id == $id) | .url // empty' || true)
      [[ -z "$AT_APP_URL" ]] && AT_APP_URL="https://${app}.${DOMAIN_BASE}"
      return 0
    fi

    # Auto-fill any required SECRET env vars the validator named, then retry without
    # consuming a race-retry (so a 3-secret app doesn't exhaust the budget).
    local newsecret=0 var
    while IFS= read -r var; do
      [[ -z "$var" ]] && continue
      # already supplying this one? (set_args holds "--set" and "VAR=val" elements)
      if ! printf '%s\0' "${set_args[@]}" 2>/dev/null | grep -qz "^${var}="; then
        set_args+=(--set "${var}=$(openssl rand -hex 24 2>/dev/null || echo deadbeefcafe$RANDOM)")
        newsecret=1
      fi
    done < <(grep -iE "secret environment variable '[^']+' is required but empty" "$errf" 2>/dev/null \
             | sed -E "s/.*'([^']+)'.*/\1/")
    if (( newsecret )) && (( cfg_tries < 5 )); then
      cfg_tries=$(( cfg_tries + 1 )); attempt=$(( attempt - 1 ))   # this was a config fill, not a race-retry
      log "    supplied generated secret(s); retrying install (config fill $cfg_tries)"
      [[ -n "$AT_DEPLOY_ID" ]] && at_cli uninstall "$AT_DEPLOY_ID" --yes >/dev/null 2>&1 || true
      AT_DEPLOY_ID=""
      continue
    fi

    # Non-secret required var → we won't fabricate config; mark for SKIP.
    local needcfg; needcfg=$(grep -iE "environment variable '[^']+' is required but empty" "$errf" 2>/dev/null \
             | grep -vi "secret environment variable" | sed -E "s/.*'([^']+)'.*/\1/" | paste -sd, - || true)
    if [[ -n "$needcfg" ]]; then
      AT_SKIP_REASON="requires manual config: $needcfg"
      warn "    $app needs non-secret config ($needcfg) — skipping (not a failure)"
      [[ -n "$AT_DEPLOY_ID" ]] && at_cli uninstall "$AT_DEPLOY_ID" --yes >/dev/null 2>&1 || true
      AT_DEPLOY_ID=""
      return 2
    fi

    at_capture_diag "$logdir" "install-$logn"
    # A failed attempt may have left a record — remove it so a retry starts clean.
    [[ -n "$AT_DEPLOY_ID" ]] && at_cli uninstall "$AT_DEPLOY_ID" --yes >/dev/null 2>&1 || true
    AT_DEPLOY_ID=""
    if (( attempt < INSTALL_ATTEMPTS )); then
      warn "    install failed — settling ${backoff}s then retrying (known first-deploy ENOENT race)."
      sleep "$backoff"; backoff=$(( backoff * 2 ))
    fi
  done
  err "    install did not complete after $attempt attempt(s) (see $logdir/install-*.err, server-logs-*.txt)"
  return 1
}

# at_verify_up <app> <logdir> — assert the app actually came up: deployment status
# is `running`, its container(s) are running on the host, and the front door answers
# with a healthy code for its auth mode.
at_verify_up() {
  local app=$1 logdir=$2 ok=1
  # 1) Deployment converged to running.
  local st; st=$(at_deploy_status "$AT_DEPLOY_ID")
  if [[ "$st" == "running" ]]; then log "    deployment $AT_DEPLOY_ID: running"; else err "    deployment $AT_DEPLOY_ID: ${st:-<missing>} (expected running)"; ok=0; fi
  # 2) Host containers for this deployment are healthy. "Healthy" = Up/running, or
  # Exited(0) for legitimate one-shot init/migration containers. BAD = Restarting,
  # Dead, Created (stuck), Exited with a non-zero code, or an (unhealthy) healthcheck.
  local ps; ps=$(at_ssh "docker ps -a --filter 'name=hola-${AT_DEPLOY_ID}' --format '{{.Names}}\t{{.Status}}'" || true)
  echo "$ps" > "$logdir/containers.txt"
  local bad; bad=$(grep -iE 'Restarting|Dead|^[^[:space:]]+[[:space:]]+Created|Exited \([1-9]|\(unhealthy\)' <<<"$ps" || true)
  if [[ -z "${ps//[[:space:]]/}" ]]; then
    err "    no host containers found for hola-${AT_DEPLOY_ID}"; ok=0
  elif [[ -n "$bad" ]]; then
    err "    unhealthy container(s):"; while read -r l; do [[ -n "$l" ]] && err "      $l"; done <<<"$bad"; ok=0
  else
    log "    containers healthy: $(grep -c . <<<"$ps")"
  fi
  # 3) Front door answers (mode-agnostic healthy set).
  log "    app URL: $AT_APP_URL"
  at_wait_http "$AT_APP_URL" "$AT_HEALTHY_HTTP" "$HTTP_TIMEOUT" || ok=0
  if [[ "$ok" != 1 ]]; then at_capture_diag "$logdir" "verify"; return 1; fi
  return 0
}

# at_restart <app> <logdir> — exercise the restart lifecycle (the #267 path for
# forward-auth apps): restart, assert it returns to running and stays reachable.
at_restart() {
  local app=$1 logdir=$2 rc=0
  # errexit-safe (no global `set -e` toggle in a sourced library).
  at_cli restart "$AT_DEPLOY_ID" --json > "$logdir/restart.json" 2>"$logdir/restart.err" || rc=$?
  # `hola restart --json` prints a human line before the JSON, so slice from `{`.
  local jstatus dstatus
  jstatus=$(sed -n '/^{/,$p' "$logdir/restart.json" | jq -r '.status // empty' 2>/dev/null || true)
  dstatus=$(at_deploy_status "$AT_DEPLOY_ID")
  log "    restart: exit=$rc job-status=${jstatus:-<none>} deployment-status=${dstatus:-<none>}"
  if [[ "$rc" != 0 || "$jstatus" != "completed" || "$dstatus" != "running" ]]; then
    at_capture_diag "$logdir" "restart"
    err "    restart did not return the deployment to running"
    return 1
  fi
  at_wait_http "$AT_APP_URL" "$AT_HEALTHY_HTTP" "$HTTP_TIMEOUT"
}

# at_stop <app> <logdir> — stop the deployment and assert it left `running`.
at_stop() {
  local app=$1 logdir=$2 rc=0
  at_cli stop "$AT_DEPLOY_ID" > "$logdir/stop.log" 2>&1 || rc=$?
  [[ "$rc" == 0 ]] || { err "    stop command failed (exit $rc)"; return 1; }
  local st; st=$(at_deploy_status "$AT_DEPLOY_ID")
  log "    post-stop status: ${st:-<missing>}"
  [[ "$st" != "running" ]]
}

# at_uninstall <app> <logdir> — uninstall and assert the user-facing outcome: the
# app's containers are gone from the host. A lingering `error` tombstone record is
# only a warning (a known, separate server ordering quirk), not a failure.
at_uninstall() {
  local app=$1 logdir=$2 rc=0
  at_cli uninstall "$AT_DEPLOY_ID" --yes > "$logdir/uninstall.log" 2>&1 || rc=$?
  [[ "$rc" == 0 ]] || { err "    uninstall command failed (exit $rc)"; return 1; }
  # `compose down` of a multi-container stack can lag the API response, so poll for
  # the containers to actually disappear rather than asserting immediately (avoids a
  # false "still present" on a slow teardown).
  local deadline; deadline=$(( $(date +%s) + ${UNINSTALL_TIMEOUT:-45} ))
  while at_ssh "docker ps -a --format '{{.Names}}' | grep -q 'hola-${AT_DEPLOY_ID}'"; do
    if [[ $(date +%s) -ge $deadline ]]; then
      at_ssh "docker ps -a --filter 'name=hola-${AT_DEPLOY_ID}' --format '{{.Names}}\t{{.Status}}'" > "$logdir/uninstall-leftover.txt" 2>/dev/null || true
      err "    container(s) for $AT_DEPLOY_ID still present ${UNINSTALL_TIMEOUT:-45}s after uninstall"; return 1
    fi
    sleep 3
  done
  log "    host containers for $AT_DEPLOY_ID removed"
  local st; st=$(at_deploy_status "$AT_DEPLOY_ID")
  [[ -n "$st" && "$st" != "absent" ]] && warn "    note: a tombstone record lingers in '$st' state"
  return 0
}

# at_run_app <app> <logdir> — the full deterministic per-app test used by the
# catalog sweep: install -> verify up -> [restart -> verify] -> [stop] -> uninstall.
# Lifecycle steps are opt-in (the sweep's default is just install/verify/uninstall):
#   AT_TEST_RESTART=1   also restart and re-verify (the forward-auth #267 path)
#   AT_TEST_STOP=1      also stop and assert it left running (then uninstall removes it)
# Always attempts uninstall (even after an earlier failure) so the next app starts
# from a clean host. Returns 0 only if every attempted step passed. Sets
# AT_LAST_STAGE to the FIRST stage that failed (for the caller's summary).
AT_LAST_STAGE=""
at_run_app() {
  local app=$1 logdir=$2 failed=0
  mkdir -p "$logdir"
  AT_LAST_STAGE=""
  # Record the first failing stage without clobbering it on later failures.
  _mark() { [[ "$failed" == 0 ]] && AT_LAST_STAGE="$1"; failed=1; }

  log "  [$app] install"
  local irc=0; at_install "$app" "$logdir" || irc=$?
  if [[ "$irc" == 2 ]]; then AT_LAST_STAGE="skip"; return 2; fi   # needs manual config
  if [[ "$irc" != 0 ]]; then AT_LAST_STAGE="install"; return 1; fi

  log "  [$app] verify up"
  if ! at_verify_up "$app" "$logdir"; then _mark "verify"; fi

  if [[ "$failed" == 0 && "${AT_TEST_RESTART:-0}" == "1" ]]; then
    log "  [$app] restart"
    if ! at_restart "$app" "$logdir"; then _mark "restart"; fi
  fi

  if [[ "$failed" == 0 && "${AT_TEST_STOP:-0}" == "1" ]]; then
    log "  [$app] stop"
    if ! at_stop "$app" "$logdir"; then _mark "stop"; fi
  fi

  log "  [$app] uninstall"
  if ! at_uninstall "$app" "$logdir"; then _mark "uninstall"; fi

  return "$failed"
}
