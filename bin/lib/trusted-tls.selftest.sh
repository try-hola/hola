#!/usr/bin/env bash
# Self-test for bin/lib/trusted-tls.sh (spec 009): mode detection (FR-004), flag
# selection (-k iff untrusted), no-op when untrusted (FR-018), fail-closed setup
# (FR-004a), and the OIDC probe result mapping (FR-015, Clarifications Q2).
# vm-ssh, vm-test-ca and curl are stubbed: no VM, no network, seconds.
# Run: bash bin/lib/trusted-tls.selftest.sh   (exit 0 = pass)
set -euo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/ca" "$T/stubs" "$T/leaf"
CALLS="$T/calls.log"; : > "$CALLS"

# --- stubs --------------------------------------------------------------------
cat > "$T/bin/vm-ssh" <<'S'
#!/usr/bin/env bash
shift 2; [[ "$1" == "--" ]] && shift          # --vmid N --
cmd="$*"; cat > /dev/null 2>&1 || true        # drain stdin (pushes)
echo "vm-ssh $cmd" >> "$STUB_CALLS"
[[ -n "${STUB_FAIL:-}" && "$cmd" == *"$STUB_FAIL"* ]] && exit 1
case "$cmd" in
  *"cloud-init status"*)    printf "ci=0\nup=100\n" ;;
  *"cut -d. -f1 /proc/uptime"*) echo 200 ;;
  *"docker info --format"*) echo "${STUB_DEFAULT_RUNTIME:-hola-test-ca}" ;;
  *"docker volume ls"*)     echo "hola_hola-data" ;;
  *"{{.Image}}"*)           echo "ghcr.io/try-hola/server:1.0" ;;
  *"HostConfig.Runtime"*)   echo "${STUB_RT:-hola-test-ca}" ;;
  *"Config.Env"*)           printf '%s\n' "${STUB_ENV:-}" ;;
  *"test -s"*)              exit "${STUB_TEST_RC:-0}" ;;
  *"docker exec"*)          [[ "$cmd" == *"fetch("* || "$cmd" == *"python3 -c"* || "$cmd" == *"curl -fsS"* ]] \
                              && { echo "probe-output" ; exit "${STUB_PROBE_RC:-0}"; } ;;
esac
exit 0
S
cat > "$T/bin/vm-test-ca" <<'S'
#!/usr/bin/env bash
echo "vm-test-ca $*" >> "$STUB_CALLS"
[[ -n "${STUB_CA_FAIL:-}" ]] && exit 1
d="$STUB_LEAF/$3"; mkdir -p "$d"; for f in cert.pem key.pem bundle.pem; do echo x > "$d/$f"; done; echo "$d"
S
cat > "$T/stubs/curl" <<'S'
#!/usr/bin/env bash
echo "curl $*" >> "$STUB_CALLS"; exit "${STUB_CURL_RC:-0}"
S
chmod +x "$T/bin/vm-ssh" "$T/bin/vm-test-ca" "$T/stubs/curl"
exec < /dev/null   # stubs drain stdin; never inherit a terminal/pipe that does not close
export STUB_CALLS="$CALLS" STUB_LEAF="$T/leaf" PATH="$T/stubs:$PATH"

# An OIDC table the probe tests control.
printf 'gitea\tgitea\tgo\tcurl\tcovered\nimmich\timmich-server\tnode\tnode\tcovered\nmealie\tmealie\tpython\tpython\tcovered\nhangar\thangar\tunknown\tnone\tunverified\n' > "$T/oidc.tsv"

BIN_DIR="$T/bin"; CA_DIR="$T/ca"; DOMAIN_BASE=1.2.3.4.sslip.io
export TT_OIDC_TABLE="$T/oidc.tsv" TRUSTED_TLS_TIMEOUT=1 TT_WAIT_INTERVAL=1 TT_RUNTIME_POLLS=1 TT_RUNTIME_POLL_SLEEP=0 TT_SETTLE=0 TT_CLOUD_INIT_TIMEOUT=1 VM_SETTLE_RETRY=0
# shellcheck source=/dev/null
source "$HERE/trusted-tls.sh"
# trusted-tls.sh must have taken BIN_DIR/CA_DIR from us, not re-derived them.
fails=0
ok()  { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fails=$((fails+1)); }
expect() { local name=$1; shift; if "$@"; then ok "$name"; else bad "$name"; fi; }
rc_of() { local rc=0; "$@" >/dev/null 2>"$T/err.txt" || rc=$?; echo "$rc"; }
calls() { wc -l < "$CALLS"; }

# --- mode detection (FR-004) --------------------------------------------------
rm -f "$CA_DIR/ca.pem"
expect "CA absent -> untrusted" bash -c "! (source '$HERE/trusted-tls.sh'; BIN_DIR='$BIN_DIR' CA_DIR='$CA_DIR'; tt_enabled)"
! tt_enabled && ok "tt_enabled false when CA absent" || bad "tt_enabled true without CA"
echo cert > "$CA_DIR/ca.pem"
tt_enabled && ok "CA present -> trusted" || bad "CA present but untrusted"
VM_TRUSTED_TLS=0 tt_enabled && bad "VM_TRUSTED_TLS=0 still trusted" || ok "CA present + VM_TRUSTED_TLS=0 -> untrusted"
VM_TRUSTED_TLS=1 tt_enabled && ok "VM_TRUSTED_TLS=1 -> trusted" || bad "VM_TRUSTED_TLS=1"

# --- flags --------------------------------------------------------------------
[[ "$(tt_curl_tls)" == "--cacert $CA_DIR/ca.pem" ]] && ok "trusted: tt_curl_tls is --cacert <ca>" || bad "tt_curl_tls trusted: $(tt_curl_tls)"
[[ "$(tt_node_tls_env)" == "NODE_EXTRA_CA_CERTS=$CA_DIR/ca.pem" ]] && ok "trusted: tt_node_tls_env is NODE_EXTRA_CA_CERTS" || bad "tt_node_tls_env trusted"
[[ "$(TT_CLI_NEEDS_BYPASS=1 tt_node_tls_env)" == "NODE_TLS_REJECT_UNAUTHORIZED=0" ]] && ok "TT_CLI_NEEDS_BYPASS=1 keeps the CLI-only bypass" || bad "bypass fallback"
[[ "$(VM_TRUSTED_TLS=0 tt_curl_tls)" == "-k" ]] && ok "untrusted: tt_curl_tls is -k" || bad "untrusted tt_curl_tls"
[[ "$(VM_TRUSTED_TLS=0 tt_node_tls_env)" == "NODE_TLS_REJECT_UNAUTHORIZED=0" ]] && ok "untrusted: tt_node_tls_env is NODE_TLS_REJECT_UNAUTHORIZED=0" || bad "untrusted tt_node_tls_env"
[[ "$(VM_TRUSTED_TLS=0 tt_mode_line)" == "trusted TLS: off (VM_TRUSTED_TLS=0)" ]] && ok "mode line names the reason" || bad "mode line"

# --- untrusted: nothing is invoked (FR-018) -------------------------------------
: > "$CALLS"
export VM_TRUSTED_TLS=0
tt_install_runtime 101 1.2.3.4; a=$?; tt_install_traefik_cert 101 1.2.3.4; b=$?; tt_wait_trusted https://x/; c=$?
tt_oidc_probe 101 gitea dep || d=$?
[[ "$a$b$c" == 000 && "$(calls)" == 0 ]] && ok "untrusted: tt_install_*/tt_wait_trusted are no-ops (0 stub calls)" || bad "untrusted invoked stubs ($(calls) calls)"
[[ "${d:-0}" == 3 && "$(calls)" == 0 ]] && ok "untrusted: probe returns 3 (not run)" || bad "untrusted probe rc=${d:-0}"
unset VM_TRUSTED_TLS

# --- trusted happy path ---------------------------------------------------------
: > "$CALLS"
tt_install_runtime 101 1.2.3.4 2>/dev/null && ok "tt_install_runtime succeeds" || bad "tt_install_runtime happy path"
grep -q 'docker info' "$CALLS" && grep -q 'systemctl reload docker' "$CALLS" && ok "reload + DefaultRuntime assertion issued" || bad "reload/assert missing"
tt_install_traefik_cert 101 1.2.3.4 2>/dev/null && grep -q 'hola_hola-data:/data' "$CALLS" && ok "tt_install_traefik_cert writes via the resolved volume" || bad "tt_install_traefik_cert"
tt_wait_trusted https://auth.x/ 2>/dev/null && grep -q -- "--cacert $CA_DIR/ca.pem" "$CALLS" && ok "tt_wait_trusted polls with --cacert (never -k)" || bad "tt_wait_trusted"
grep -qE 'curl .*(^| )-k( |$)' "$CALLS" && bad "-k used in trusted mode" || ok "no -k in any trusted call"

# --- FR-004a: every setup failure is fatal and names its step ----------------------
named() { grep -q "$1" "$T/err.txt"; }
rc=$(export STUB_CA_FAIL=1; rc_of tt_install_runtime 101 1.2.3.4); [[ "$rc" == 1 ]] && named "issue leaf" && ok "FR-004a: issue failure -> 1, names 'issue leaf/bundle'" || bad "issue failure rc=$rc"
rc=$(export STUB_FAIL="cloud-init"; rc_of tt_install_runtime 101 1.2.3.4); [[ "$rc" == 1 ]] && named "cloud-init" && ok "FR-004a: cloud-init never settles -> 1, names it" || bad "cloud-init wait rc=$rc"
grep -q 'cloud-init status --wait' "$CALLS" && ok "tt_install_runtime waits for first-boot cloud-init before pushing anything" || bad "no cloud-init wait"
rc=$(export STUB_FAIL="tee /etc/hola-test-ca"; rc_of tt_install_runtime 101 1.2.3.4); [[ "$rc" == 1 ]] && named "push CA bundle" && ok "FR-004a: bundle push failure -> 1, names 'push CA bundle'" || bad "bundle push rc=$rc"
rc=$(export STUB_FAIL="tee /usr/local/libexec"; rc_of tt_install_runtime 101 1.2.3.4); [[ "$rc" == 1 ]] && named "runtime shim" && ok "FR-004a: shim push failure -> 1, names the shim" || bad "shim push rc=$rc"
rc=$(export STUB_FAIL="sudo python3"; rc_of tt_install_runtime 101 1.2.3.4); [[ "$rc" == 1 ]] && named "daemon.json" && ok "FR-004a: daemon.json merge failure -> 1, names it" || bad "daemon.json rc=$rc"
rc=$(export STUB_DEFAULT_RUNTIME=runc; rc_of tt_install_runtime 101 1.2.3.4); [[ "$rc" == 1 ]] && named "default runtime" && ok "FR-004a: wrong DefaultRuntime -> 1, names it" || bad "DefaultRuntime rc=$rc"
grep -q 'systemctl restart docker' "$CALLS" && ok "falls back from reload to restart before failing" || bad "no restart fallback"
rc=$(export STUB_FAIL="docker volume ls"; rc_of tt_install_traefik_cert 101 1.2.3.4); [[ "$rc" == 1 ]] && named "hola-data" && ok "FR-004a: volume resolve failure -> 1, names it" || bad "volume rc=$rc"
rc=$(export STUB_FAIL="docker run"; rc_of tt_install_traefik_cert 101 1.2.3.4); [[ "$rc" == 1 ]] && named "test-tls.yml" && ok "FR-004a: cert write failure -> 1, names it" || bad "cert write rc=$rc"
rc=$(export STUB_CA_FAIL=1; rc_of tt_install_traefik_cert 101 1.2.3.4); [[ "$rc" == 1 ]] && ok "FR-004a: traefik-cert issue failure -> 1" || bad "traefik issue rc=$rc"
rc=$(export STUB_CURL_RC=60; rc_of tt_wait_trusted https://auth.x/); [[ "$rc" == 1 ]] && named "wait for a verified TLS handshake" && ok "FR-004a: wait timeout (TRUSTED_TLS_TIMEOUT=1) -> 1, names it" || bad "wait timeout rc=$rc"

# --- probe mapping (FR-015) -------------------------------------------------------
p() { local rc=0; tt_oidc_probe 101 "$@" >/dev/null 2>&1 || rc=$?; echo "$rc"; }
[[ "$(p immich dep1)" == 0 ]] && ok "covered + probe ok -> 0" || bad "covered ok"
STUB_PROBE_RC=1 bash -c 'true'; export STUB_PROBE_RC=1; rc=$(p immich dep1); unset STUB_PROBE_RC
[[ "$rc" == 1 ]] && ok "covered + probe fail -> 1" || bad "covered fail rc=$rc"
tt_oidc_probe 101 hangar dep1 || rc=$?; [[ "${rc:-0}" == 2 && "$TT_PROBE_REASON" == "trust not covered" ]] && ok "unverified -> 2 'trust not covered'" || bad "unverified rc=${rc:-0} reason=$TT_PROBE_REASON"
rc=0; tt_oidc_probe 101 vaultwarden dep1 || rc=$?; [[ "$rc" == 3 ]] && ok "app absent from the table -> 3 (not run)" || bad "absent app rc=$rc"
rc=0; VM_TRUSTED_TLS=0 tt_oidc_probe 101 immich dep1 || rc=$?; [[ "$rc" == 3 ]] && ok "untrusted -> 3 (not run)" || bad "untrusted probe rc=$rc"
rc=0; STUB_RT=runc tt_oidc_probe 101 immich dep1 || rc=$?; [[ "$rc" == 1 && "$TT_PROBE_REASON" == *"runtime shim did not apply"* ]] && ok "container not on the shim runtime -> 1" || bad "wrong runtime rc=$rc ($TT_PROBE_REASON)"
rc=0; STUB_TEST_RC=1 tt_oidc_probe 101 immich dep1 || rc=$?; [[ "$rc" == 1 && "$TT_PROBE_REASON" == *"not mounted"* ]] && ok "bundle not mounted in container -> 1" || bad "unmounted rc=$rc"
# URL selection: discovery document from the container env when it names the auth host, else liveness
STUB_ENV="OAUTH_ISSUER_URL=https://auth.$DOMAIN_BASE/application/o/hola-immich/" tt_oidc_probe 101 immich dep1 >/dev/null 2>&1 || true
[[ "$TT_PROBE_URL" == "https://auth.$DOMAIN_BASE/application/o/hola-immich/.well-known/openid-configuration" ]] && ok "probe uses the app's OIDC discovery document when its env names one" || bad "probe url: $TT_PROBE_URL"
STUB_ENV="" tt_oidc_probe 101 immich dep1 >/dev/null 2>&1 || true
[[ "$TT_PROBE_URL" == "https://auth.$DOMAIN_BASE/-/health/live/" ]] && ok "probe falls back to Authentik's liveness URL (and reports it)" || bad "fallback url: $TT_PROBE_URL"
STUB_ENV="OAUTH_ISSUER_URL=https://evil.example/x/" tt_oidc_probe 101 immich dep1 >/dev/null 2>&1 || true
[[ "$TT_PROBE_URL" == "https://auth.$DOMAIN_BASE/-/health/live/" ]] && ok "probe ignores an issuer URL that is not the Authentik host" || bad "foreign issuer used: $TT_PROBE_URL"

(( fails == 0 )) && { echo "trusted-tls.selftest: PASS"; exit 0; } || { echo "trusted-tls.selftest: FAILED ($fails)"; exit 1; }
