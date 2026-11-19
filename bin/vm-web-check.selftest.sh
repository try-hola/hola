#!/usr/bin/env bash
# Self-test for bin/vm-web-check's sign-in plumbing (#575): the dashboard's auth mode
# (GET /api/auth/config) decides whether the Authentik password is fetched from the VM
# at all, and when it is, it reaches the browser script ONLY through its environment —
# never argv, stdout/stderr or the audit log. bun, curl and bin/vm-ssh are stubbed; the
# real vm-web-check + _common.sh + lib run from a scratch copy of bin/.
# No VM, no browser, no network, seconds.
# Run: bash bin/vm-web-check.selftest.sh   (exit 0 = pass)
set -euo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/root/node_modules/playwright" "$T/stubs" "$T/noca" "$T/ca"
cp -R "$HERE" "$T/root/bin"
exec < /dev/null

SECRET='s3cr3t-Ak-pw-DO-NOT-PRINT'
URL_HOST=apps.10.0.0.5.sslip.io

# bun: record argv and the env the browser script would see (the password only as a
# match flag, so this log never holds it either).
cat > "$T/stubs/bun" <<'S'
#!/usr/bin/env bash
pw=no; [[ -n "${WEB_CHECK_SSO_PASSWORD:-}" ]] && pw=set
[[ "${WEB_CHECK_SSO_PASSWORD:-}" == "$EXPECT_PW" ]] && pw="$pw,match"
echo "bun argv=[$*] url=${HOLA_BASE_URL-} key=${HOLA_API_KEY-} spki=${WEB_CHECK_SPKI-} pw=$pw" >> "$STUB_LOG"
printf '%s\n' "$*" >> "$ARGV_LOG"
S
# curl: answer /api/auth/config with $CONFIG_BODY (CURL_RC != 0 = unreachable).
cat > "$T/stubs/curl" <<'S'
#!/usr/bin/env bash
echo "curl argv=[$*]" >> "$STUB_LOG"
[[ "${CURL_RC:-0}" == 0 ]] || exit "$CURL_RC"
printf '%s' "$CONFIG_BODY"
S
# vm-ssh --vmid N -- "grep -m1 '^KEY=' /opt/hola/.env": answer from $VM_ENV.
cat > "$T/root/bin/vm-ssh" <<'S'
#!/usr/bin/env bash
echo "vm-ssh vmid=$2" >> "$STUB_LOG"
key=$(sed -nE "s/.*'\^([A-Z_]+)=.*/\1/p" <<<"$4")
grep -m1 "^$key=" "$VM_ENV" || exit 1
S
cat > "$T/root/bin/vm-test-ca" <<'S'
#!/usr/bin/env bash
echo "stub-spki"
S
chmod +x "$T/stubs/"* "$T/root/bin/vm-ssh" "$T/root/bin/vm-test-ca"
: > "$T/ca/ca.pem"

fails=0
ok()  { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fails=$((fails+1)); }

# run <config-json> <vm-env-lines> [extra env assignments...] -- [vm-web-check args...]
run() {
  local body=$1 vmenv=$2; shift 2
  local -a extra=()
  while [[ $# -gt 0 && "$1" != -- ]]; do extra+=("$1"); shift; done
  [[ "${1:-}" == -- ]] && shift
  printf '%b' "$vmenv" > "$T/vm.env"
  : > "$T/stub.log"; : > "$T/argv.log"; : > "$T/audit.log"
  RC=0
  env -i PATH="$T/stubs:$PATH" HOME="$T" STUB_LOG="$T/stub.log" ARGV_LOG="$T/argv.log" \
    EXPECT_PW="$SECRET" VM_ENV="$T/vm.env" CONFIG_BODY="$body" \
    VM_TEST_CA_DIR="$T/noca" MCP_ENV_FILE="$T/none.env" VM_AUDIT_LOG="$T/audit.log" \
    VM_STATE_FILE="$T/state" HOLA_ENV_FILE="$T/none.env" "${extra[@]}" \
    bash "$T/root/bin/vm-web-check" --url "https://$URL_HOST" --key adm1nkey "$@" > "$T/out" 2>&1 || RC=$?
  OUT=$(cat "$T/out"); LOG=$(cat "$T/stub.log")
}
no_leak() {
  if grep -qF "$SECRET" "$T/out" "$T/argv.log" "$T/audit.log" "$T/stub.log"; then bad "$1: password leaked to output/argv/audit"
  else ok "$1: password absent from output, argv and audit log"; fi
}
VMENV="HOLA_DOMAIN=$URL_HOST\nAUTHENTIK_BOOTSTRAP_PASSWORD=$SECRET\n"

run '{"mode":"apikey"}' "$VMENV" -- --vmid 101
[[ "$RC" == 0 ]] && grep -q 'key=adm1nkey' <<<"$LOG" && grep -q 'pw=no' <<<"$LOG" \
  && ok "apikey: browser runs with the admin key and no SSO password" || bad "apikey: rc=$RC log=$LOG"
grep -q 'vm-ssh' <<<"$LOG" && bad "apikey: VM was contacted" || ok "apikey: the VM is never contacted"
grep -q 'curl argv=\[.*-k .*https://apps.10.0.0.5.sslip.io/api/auth/config\]' <<<"$LOG" \
  && ok "untrusted: the mode probe uses -k, like the browser's ignoreHTTPSErrors" || bad "probe argv: $LOG"

run '{"mode":"none"}' "$VMENV" -- --vmid 101
[[ "$RC" == 0 ]] && ! grep -q 'vm-ssh' <<<"$LOG" && grep -q 'pw=no' <<<"$LOG" \
  && ok "none: unchanged path, no VM access" || bad "none: rc=$RC log=$LOG"

run '{"mode":"oidc","oidc":{"issuer":"https://auth.x/"}}' "$VMENV" -- --vmid 101
[[ "$RC" == 0 ]] && grep -q 'vm-ssh vmid=101' <<<"$LOG" && grep -q 'pw=set,match' <<<"$LOG" \
  && ok "oidc: password read from VM 101 and handed to the browser via env" || bad "oidc: rc=$RC log=$LOG out=$OUT"
grep -q 'read from VM 101 (not printed)' <<<"$OUT" && ok "oidc: says where the password came from" || bad "oidc: no provenance line: $OUT"
no_leak "oidc"

run '{"mode":"oidc"}' "HOLA_DOMAIN=apps.10.0.0.9.sslip.io\nAUTHENTIK_BOOTSTRAP_PASSWORD=$SECRET\n" -- --vmid 102
[[ "$RC" != 0 ]] && ! grep -q '^bun' <<<"$LOG" && grep -q 'VM 102 serves apps.10.0.0.9.sslip.io, not apps.10.0.0.5.sslip.io' <<<"$OUT" \
  && ok "oidc: a VM serving another host is refused before any password is read" || bad "mismatch: rc=$RC out=$OUT"
[[ $(grep -c 'vm-ssh' <<<"$LOG") == 1 ]] && ok "mismatch: only HOLA_DOMAIN was read" || bad "mismatch: vm-ssh calls: $LOG"
no_leak "mismatch"

run '{"mode":"oidc"}' "HOLA_DOMAIN=$URL_HOST\n" -- --vmid 101
[[ "$RC" != 0 ]] && ! grep -q '^bun' <<<"$LOG" && grep -q 'no AUTHENTIK_BOOTSTRAP_PASSWORD' <<<"$OUT" \
  && ok "oidc: a VM without the Authentik password fails clearly" || bad "no-pw: rc=$RC out=$OUT"

run '{"mode":"oidc"}' "$VMENV"
[[ "$RC" != 0 ]] && ! grep -q '^bun' <<<"$LOG" && grep -q 'no VM id given' <<<"$OUT" \
  && ok "oidc: no --vmid and no VM in state fails clearly" || bad "no-vmid: rc=$RC out=$OUT"

run '{"mode":"oidc"}' "" "WEB_CHECK_SSO_PASSWORD=$SECRET"
[[ "$RC" == 0 ]] && ! grep -q 'vm-ssh' <<<"$LOG" && grep -q 'pw=set,match' <<<"$LOG" \
  && ok "oidc: a caller-supplied WEB_CHECK_SSO_PASSWORD is used without touching the VM" || bad "preset: rc=$RC log=$LOG"
no_leak "preset"

run '' "$VMENV" CURL_RC=7 -- --vmid 101
[[ "$RC" == 0 ]] && ! grep -q 'vm-ssh' <<<"$LOG" && grep -q 'auth mode: unknown' <<<"$OUT" \
  && ok "probe unreachable: the browser still runs (and reports), no VM access" || bad "unreachable: rc=$RC out=$OUT"

run '{"mode":"oidc"}' "$VMENV" VM_TEST_CA_DIR="$T/ca" -- --vmid 101
grep -q "curl argv=\[.*--cacert $T/ca/ca.pem .*\]" <<<"$LOG" && grep -q 'spki=stub-spki' <<<"$LOG" && grep -q 'pw=set,match' <<<"$LOG" \
  && ok "trusted: probe verifies against the test CA; SPKI + password reach the browser" || bad "trusted: rc=$RC log=$LOG"
no_leak "trusted"

(( fails == 0 )) && echo "PASS vm-web-check selftest" || { echo "FAIL vm-web-check selftest ($fails)"; exit 1; }
