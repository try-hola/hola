#!/usr/bin/env bash
# bin/lib/trusted-tls.sh — trusted TLS on disposable test VMs (spec 009), as sourceable
# helpers shared by bin/vm-catalog-test, bin/vm-e2e-suite, bin/lib/app-test.sh and
# bin/vm-sso-check. TEST-HARNESS ONLY: nothing here touches the Hola product.
#
# Trusted mode is on when the test CA exists ($CA_DIR/ca.pem, created by
# `bin/vm-test-ca init`) and VM_TRUSTED_TLS is not 0. When it is off every helper is a
# no-op or returns TODAY's exact flags (-k / NODE_TLS_REJECT_UNAUTHORIZED=0), so an
# untrusted run is byte-identical to the pre-009 harness (FR-018).
#
# SOURCE it (do not execute). Needs, from bin/_common.sh: BIN_DIR, CA_DIR, log/err/warn.
# Optional: TRUSTED_TLS_TIMEOUT (300) — seconds tt_wait_trusted polls.

# shellcheck disable=SC2034  # TT_PROBE_URL / TT_PROBE_REASON are read by the sourcing script
[[ -n "${__TRUSTED_TLS_SH_LOADED:-}" ]] && return 0
__TRUSTED_TLS_SH_LOADED=1

TT_LIB_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
: "${BIN_DIR:=$(cd "$TT_LIB_DIR/.." && pwd)}"
: "${CA_DIR:=${VM_TEST_CA_DIR:-$(cd "$TT_LIB_DIR/../.." && pwd)/.devcontainer/.test-ca}}"
: "${TRUSTED_TLS_TIMEOUT:=300}"
: "${TT_WAIT_INTERVAL:=5}"            # tt_wait_trusted poll interval (tunable for selftests)
: "${TT_RUNTIME_POLLS:=10}"            # DefaultRuntime polls per reload/restart
: "${TT_RUNTIME_POLL_SLEEP:=2}"
: "${TT_CLOUD_INIT_TIMEOUT:=900}"          # max wait for the VM's first-boot cloud-init to finish
: "${TT_SETTLE:=20}"                       # seconds the VM must stay up after cloud-init says done
TT_BUNDLE_DEST=/etc/hola-test-ca/bundle.pem        # path inside containers AND on the VM
TT_SHIM_DEST=/usr/local/libexec/hola-test-ca-runtime        # sh front end = Docker's runtime path
TT_SHIM_PY_DEST=/usr/local/libexec/hola-test-ca-runtime.py  # the Python shim it hands `create` to
TT_OIDC_TABLE="${TT_OIDC_TABLE:-$TT_LIB_DIR/oidc-trust.tsv}"
TT_PROBE_REASON=""; TT_PROBE_URL=""

# Minimal logging fallbacks so the library also works if sourced on its own.
declare -F log >/dev/null || log() { echo "[vm] $*" >&2; }
declare -F err >/dev/null || err() { echo "[vm] error: $*" >&2; }

# --- mode + flags ------------------------------------------------------------
tt_enabled() { [[ -f "$CA_DIR/ca.pem" && "${VM_TRUSTED_TLS:-1}" != 0 ]]; }

# Why the mode is what it is, for the one-line setup banner.
tt_mode_line() {
  if tt_enabled; then
    echo "trusted TLS: on (CA $(openssl x509 -in "$CA_DIR/ca.pem" -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2 | cut -c1-8))"
  elif [[ -f "$CA_DIR/ca.pem" ]]; then echo "trusted TLS: off (VM_TRUSTED_TLS=0)"
  else echo "trusted TLS: off (no test CA; run bin/vm-test-ca init)"; fi
}

# curl flags: verify against the test CA, or today's -k.
tt_curl_tls() { if tt_enabled; then echo "--cacert $CA_DIR/ca.pem"; else echo "-k"; fi; }
# CLI (Bun/Node) env assignment: trust the test CA, or today's verification bypass.
# TT_CLI_NEEDS_BYPASS=1 is the documented fallback (research R7) if the Bun runtime
# does not honour NODE_EXTRA_CA_CERTS; it keeps the bypass for the CLI process only.
tt_node_tls_env() {
  if tt_enabled && [[ "${TT_CLI_NEEDS_BYPASS:-0}" != 1 ]]; then echo "NODE_EXTRA_CA_CERTS=$CA_DIR/ca.pem"
  else echo "NODE_TLS_REJECT_UNAUTHORIZED=0"; fi
}

# --- helpers -----------------------------------------------------------------
_tt_vm() { local vmid=$1; shift; "$BIN_DIR/vm-ssh" --vmid "$vmid" -- "$@"; }
_tt_fail() { err "trusted TLS: $1 failed${2:+ — $2}"; return 1; }

# A fresh template VM runs cloud-init's package upgrade and may REBOOT a few minutes after
# SSH first answers (#574). That wait now lives in the shared bin/lib/vm-settle.sh
# (vm_wait_settled) so the untrusted flows get it too. tt_install_runtime still calls it
# (a cheap re-check when the suite already waited) because the vm-e2e skill calls
# tt_install_runtime on its own. TT_CLOUD_INIT_TIMEOUT / TT_SETTLE remain its fallbacks.
# shellcheck source=/dev/null
source "$TT_LIB_DIR/vm-settle.sh"

# --- half 2: containers trust the CA (runtime shim), BEFORE bootstrap ----------
# tt_install_runtime <vmid> <ip>
tt_install_runtime() {
  tt_enabled || return 0
  local vmid=$1 ip=$2 d
  d=$("$BIN_DIR/vm-test-ca" issue --ip "$ip" 2>/dev/null) && [[ -s "$d/bundle.pem" ]] \
    || { _tt_fail "issue leaf/bundle for $ip" "bin/vm-test-ca issue"; return 1; }

  vm_wait_settled "$vmid" \
    || { _tt_fail "wait for the VM's first-boot cloud-init to finish" "not done and stable within ${VM_SETTLE_TIMEOUT:-$TT_CLOUD_INIT_TIMEOUT}s"; return 1; }

  _tt_vm "$vmid" "sudo mkdir -p /etc/hola-test-ca /usr/local/libexec && sudo tee $TT_BUNDLE_DEST >/dev/null && sudo chmod 644 $TT_BUNDLE_DEST" \
    < "$d/bundle.pem" >/dev/null 2>&1 \
    || { _tt_fail "push CA bundle to the VM"; return 1; }
  # The Python shim first, then the sh front end that Docker runs (#578): the front end
  # execs runc directly for everything but `create`, so healthchecks never start Python.
  # (It is inert without the shim, but push order keeps that window from ever existing.)
  _tt_vm "$vmid" "sudo tee $TT_SHIM_PY_DEST >/dev/null && sudo chmod 755 $TT_SHIM_PY_DEST" \
    < "$TT_LIB_DIR/test-ca-runtime.py" >/dev/null 2>&1 \
    || { _tt_fail "push the runtime shim to the VM"; return 1; }
  _tt_vm "$vmid" "sudo tee $TT_SHIM_DEST >/dev/null && sudo chmod 755 $TT_SHIM_DEST" \
    < "$TT_LIB_DIR/test-ca-runtime.sh" >/dev/null 2>&1 \
    || { _tt_fail "push the runtime shim front end to the VM"; return 1; }

  # Merge (never clobber) /etc/docker/daemon.json: register the runtime and make it the default.
  # /etc/docker need not exist (a stock engine writes no daemon.json), and an empty file
  # means "no settings", not a parse error.
  local merge='import json,os,tempfile
p="/etc/docker/daemon.json"
try:
    s=open(p).read()
except FileNotFoundError:
    s=""
c=json.loads(s) if s.strip() else {}
c.setdefault("runtimes",{})["hola-test-ca"]={"path":"'"$TT_SHIM_DEST"'"}
c["default-runtime"]="hola-test-ca"
os.makedirs("/etc/docker",exist_ok=True)
fd,t=tempfile.mkstemp(dir="/etc/docker")
os.write(fd,(json.dumps(c,indent=2)+"\n").encode());os.close(fd);os.chmod(t,0o644);os.replace(t,p)'
  printf '%s\n' "$merge" | _tt_vm "$vmid" "sudo python3 -" >/dev/null 2>&1 \
    || { _tt_fail "merge /etc/docker/daemon.json"; return 1; }

  # Reload first (SIGHUP picks up runtimes/default-runtime without killing containers);
  # fall back to a restart. Then ASSERT the default runtime really changed.
  local want=hola-test-ca got="" try
  for try in reload restart; do
    _tt_vm "$vmid" "sudo systemctl $try docker" >/dev/null 2>&1 || true
    local n
    for (( n = 0; n < TT_RUNTIME_POLLS; n++ )); do
      got=$(_tt_vm "$vmid" "docker info --format '{{.DefaultRuntime}}'" 2>/dev/null | tr -d '\r\n ' || true)
      [[ "$got" == "$want" ]] && break 2
      sleep "$TT_RUNTIME_POLL_SLEEP"
    done
  done
  [[ "$got" == "$want" ]] || { _tt_fail "docker default runtime is '${got:-<unknown>}', expected $want (after reload and restart)"; return 1; }
  log "  trusted TLS: runtime shim active on VM $vmid (DefaultRuntime=$got)"
}

# --- half 1: Traefik serves the CA-signed leaf (AFTER bootstrap) ---------------
# tt_install_traefik_cert <vmid> <ip>
tt_install_traefik_cert() {
  tt_enabled || return 0
  local vmid=$1 ip=$2 d vol img
  d=$("$BIN_DIR/vm-test-ca" issue --ip "$ip" 2>/dev/null) && [[ -s "$d/cert.pem" && -s "$d/key.pem" ]] \
    || { _tt_fail "issue leaf for $ip" "bin/vm-test-ca issue"; return 1; }

  vol=$(_tt_vm "$vmid" "docker volume ls --format '{{.Name}}' --filter name=hola-data" 2>/dev/null | grep -E '(^|_)hola-data$' | head -1 | tr -d '\r' || true)
  [[ -n "$vol" ]] || { _tt_fail "resolve the hola-data volume" "no volume matching hola-data on VM $vmid"; return 1; }
  # Any image already on the host that has a shell: prefer the server's, then Traefik's.
  img=$(_tt_vm "$vmid" "docker ps --format '{{.Image}}'" 2>/dev/null | tr -d '\r' | awk '/try-hola\/server/{print; exit} /traefik/{t=$0} END{if(t)print t}' | head -1 || true)
  [[ -n "$img" ]] || { _tt_fail "find a local image to write the volume with" "no running server/traefik image"; return 1; }

  local stage; stage=$(mktemp -d)
  mkdir -p "$stage/test-tls" "$stage/runtime/traefik"
  cp "$d/cert.pem" "$stage/test-tls/cert.pem"; cp "$d/key.pem" "$stage/test-tls/key.pem"
  cat > "$stage/runtime/traefik/test-tls.yml" <<'YML'
# Written by the Hola test harness (spec 009). Not part of the product.
tls:
  stores:
    default:
      defaultCertificate:
        certFile: /data/test-tls/cert.pem
        keyFile: /data/test-tls/key.pem
YML
  tar -C "$stage" --owner=0 --group=0 --numeric-owner -cf - test-tls runtime/traefik/test-tls.yml \
    | _tt_vm "$vmid" "docker run --rm -i --entrypoint sh -v $vol:/data $img -c 'cd /data && tar -xf - && chmod 644 test-tls/cert.pem runtime/traefik/test-tls.yml && chmod 600 test-tls/key.pem'" >/dev/null 2>&1
  local rc=$?
  rm -rf "$stage"
  (( rc == 0 )) || { _tt_fail "write the leaf + test-tls.yml into volume $vol"; return 1; }
  log "  trusted TLS: default certificate installed in $vol (no Traefik restart)"
}

# tt_wait_trusted <url> — poll until the URL answers over TLS that VERIFIES against the
# test CA (no -k). Fails, naming the step, on timeout. Any HTTP status counts: this is a
# TLS check, so an HTTP 4xx/5xx must not be reported as a failed handshake (no -f).
tt_wait_trusted() {
  tt_enabled || return 0
  local url=$1 deadline=$(( $(date +%s) + TRUSTED_TLS_TIMEOUT )) code
  while :; do
    # shellcheck disable=SC2046
    if curl $(tt_curl_tls) -sS -o /dev/null --max-time 10 "$url" 2>/dev/null; then
      log "  trusted TLS: $url verifies against the test CA"; return 0
    fi
    if [[ $(date +%s) -ge $deadline ]]; then
      code=$(curl --cacert "$CA_DIR/ca.pem" -sS -o /dev/null --max-time 10 "$url" 2>&1 | tail -1 || true)
      _tt_fail "wait for a verified TLS handshake on $url" "timeout after ${TRUSTED_TLS_TIMEOUT}s (${code:-no response})"; return 1
    fi
    sleep "$TT_WAIT_INTERVAL"
  done
}

# --- native-OIDC trust probe (research R4) --------------------------------------
# tt_oidc_probe <vmid> <app> <deploymentId>
#   0 = container trusts the CA (probe OK)       1 = covered bundle FAILED the probe
#   2 = SKIP (trust not covered / unverified)    3 = not run (untrusted mode, or app not in the table)
# Sets TT_PROBE_REASON and TT_PROBE_URL. Detail goes to $TT_PROBE_LOG if set.
# Needs DOMAIN_BASE (the auth host is auth.$DOMAIN_BASE).
tt_oidc_probe() {
  local vmid=$1 app=$2 dep=$3 row svc runtime probe expected
  TT_PROBE_REASON=""; TT_PROBE_URL=""
  tt_enabled || { TT_PROBE_REASON="trusted TLS off"; return 3; }
  row=$(grep -v '^#' "$TT_OIDC_TABLE" 2>/dev/null | awk -F'\t' -v a="$app" '$1==a{print; exit}')
  [[ -n "$row" ]] || { TT_PROBE_REASON="not a native-oidc app"; return 3; }
  IFS=$'\t' read -r _ svc runtime probe expected <<<"$row"
  if [[ "$expected" != covered ]]; then TT_PROBE_REASON="trust not covered"; return 2; fi

  local c="hola-${dep}-${svc}-1" log_="${TT_PROBE_LOG:-/dev/null}"
  : > "$log_" 2>/dev/null || log_=/dev/null
  # 1) The shim must have applied to THIS container: its recorded runtime is the shim
  #    and the CA bundle is mounted inside it. (PID 1's environment is NOT readable
  #    in many images — non-root PID 1, s6-overlay — so it cannot be the proof; the
  #    variables are exercised by the probe below and by vm-sso-check's full login.)
  local rt
  rt=$(_tt_vm "$vmid" "docker inspect --format '{{.HostConfig.Runtime}}' $c" 2>/dev/null | tr -d '\r\n ' || true)
  { echo "# container $c runtime: ${rt:-<none>}"; } >> "$log_"
  if [[ "$rt" != hola-test-ca ]]; then
    TT_PROBE_REASON="$c was created with runtime '${rt:-<missing>}', not hola-test-ca (the runtime shim did not apply to it)"; return 1
  fi
  if ! _tt_vm "$vmid" "docker exec $c test -s $TT_BUNDLE_DEST" >/dev/null 2>&1; then
    TT_PROBE_REASON="$TT_BUNDLE_DEST is not mounted in $c (the runtime shim did not apply to it)"; return 1
  fi
  # 2) Pick the URL: the app's own OIDC discovery document if its env names one on the
  #    Authentik host, else Authentik's liveness endpoint (same router + same handshake).
  #    An explicit-endpoint variable (OIDC_AUTH_URL=…/application/o/authorize/, the token,
  #    userinfo, jwks or end-session URL) is not an issuer: appending the discovery path
  #    to it would 404 and FAIL an app whose trust is fine, so those values are skipped.
  local auth="auth.${DOMAIN_BASE:-}" url="https://auth.${DOMAIN_BASE:-}/-/health/live/" v auth_re
  auth_re=${auth//./\\.}
  v=$(_tt_vm "$vmid" "docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' $c" 2>/dev/null \
      | tr -d '\r' \
      | grep -iE '^[A-Z0-9_]*(ISSUER|OIDC|DISCOVERY)[A-Z0-9_]*=https://'"$auth_re"'/' \
      | grep -vE '/application/o/(authorize|token|userinfo|revoke|introspect|device)/?$|/(jwks|end-session)/?$' \
      | head -1 | cut -d= -f2- || true)
  if [[ -n "$v" ]]; then
    [[ "$v" == *openid-configuration* ]] && url=$v || url="${v%/}/.well-known/openid-configuration"
  fi
  TT_PROBE_URL=$url
  echo "# probe url: $url (probe=$probe)" >> "$log_"
  # 3) Fetch it with the app's OWN runtime and the injected CA env (docker exec does not
  #    inherit OCI-injected env, so pass it explicitly — research R2).
  local envs="-e NODE_EXTRA_CA_CERTS=$TT_BUNDLE_DEST -e SSL_CERT_FILE=$TT_BUNDLE_DEST -e REQUESTS_CA_BUNDLE=$TT_BUNDLE_DEST" out rc=0
  case "$probe" in
    node)   out=$(_tt_vm "$vmid" "docker exec $envs $c node -e 'fetch(process.argv[1]).then(r=>process.exit(r.ok?0:1),e=>{console.error(String(e.cause&&e.cause.code||e.message));process.exit(1)})' '$url'" 2>&1) || rc=$? ;;
    python) out=$(_tt_vm "$vmid" "docker exec $envs $c python3 -c 'import urllib.request,sys;urllib.request.urlopen(sys.argv[1],timeout=20)' '$url'" 2>&1) || rc=$? ;;
    # curl (Go apps, e.g. gitea): deliberately NO env and NO --cacert. Hola runs these
    # apps' post-deploy setup through `compose exec` (gitea's `admin auth add-oauth`, a
    # Go binary), which never sees the shim's env; it works only because the shim also
    # overlays the image's system trust file. So prove exactly that path.
    curl)   out=$(_tt_vm "$vmid" "docker exec $c curl -fsS -o /dev/null --max-time 20 '$url'" 2>&1) || rc=$? ;;
    *)      TT_PROBE_REASON="trust not covered"; return 2 ;;
  esac
  { echo "# probe exit=$rc"; echo "$out"; } >> "$log_"
  if (( rc == 0 )); then return 0; fi
  TT_PROBE_REASON="$app ($runtime) could not fetch $url over TLS from inside $c: $(tail -1 <<<"$out" | cut -c1-200)"
  return 1
}
