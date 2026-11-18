#!/usr/bin/env bash
# Self-test for bin/vm-test-ca (spec 009): CA lifecycle, never-overwrite (FR-002),
# leaf contents, bundle, SPKI stability, and that the key is never printed (FR-003).
# Uses a temp VM_TEST_CA_DIR and a fake system-root bundle. No VM, no network.
# Run: bash bin/vm-test-ca.selftest.sh   (exit 0 = pass)
set -euo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
CA="$HERE/vm-test-ca"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export VM_TEST_CA_DIR="$T/ca" VM_AUDIT_LOG="$T/audit.log" MCP_ENV_FILE="$T/none.env" VM_TEST_CA_SYSTEM_ROOTS="$T/roots.pem"
# A stand-in "system root bundle": one throwaway self-signed cert.
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$T/r.key" -out "$T/roots.pem" -days 2 -subj "/CN=fake-root" 2>/dev/null

fails=0
ok()   { echo "  ok   $1"; }
bad()  { echo "  FAIL $1"; fails=$((fails+1)); }
check() { local name=$1; shift; if "$@" >/dev/null 2>&1; then ok "$name"; else bad "$name"; fi; }
mode() { stat -c %a "$1"; }

OUT="$T/all-output.txt"; : > "$OUT"
run() { "$CA" "$@" 2>&1 | tee -a "$OUT"; return "${PIPESTATUS[0]}"; }

[[ "$("$CA" status 2>/dev/null)" == untrusted* ]] && ok "status: untrusted before init" || bad "status before init"
run init >/dev/null
check "init creates ca.pem + ca.key" test -f "$VM_TEST_CA_DIR/ca.pem" -a -f "$VM_TEST_CA_DIR/ca.key"
[[ "$(mode "$VM_TEST_CA_DIR")" == 700 ]] && ok "CA dir mode 0700" || bad "CA dir mode $(mode "$VM_TEST_CA_DIR")"
[[ "$(mode "$VM_TEST_CA_DIR/ca.key")" == 600 ]] && ok "ca.key mode 0600" || bad "ca.key mode"
openssl x509 -in "$VM_TEST_CA_DIR/ca.pem" -noout -text | grep -q 'CA:TRUE' && ok "ca.pem is CA:TRUE" || bad "CA:TRUE"
[[ "$("$CA" status 2>/dev/null)" == trusted ]] && ok "status: trusted after init" || bad "status after init"
[[ "$(VM_TRUSTED_TLS=0 "$CA" status 2>/dev/null)" == "untrusted: VM_TRUSTED_TLS=0" ]] && ok "status: VM_TRUSTED_TLS=0 forces untrusted" || bad "VM_TRUSTED_TLS=0"

# FR-002: a second init refuses (exit 2) and leaves the key byte-identical.
before=$(sha256sum "$VM_TEST_CA_DIR/ca.key" "$VM_TEST_CA_DIR/ca.pem")
rc=0; run init >/dev/null || rc=$?
[[ "$rc" == 2 ]] && ok "second init exits 2" || bad "second init exit $rc (want 2)"
[[ "$before" == "$(sha256sum "$VM_TEST_CA_DIR/ca.key" "$VM_TEST_CA_DIR/ca.pem")" ]] && ok "second init leaves ca.key/ca.pem byte-identical" || bad "ca.key changed on refused init"

# issue
IP=10.20.30.40; D="$VM_TEST_CA_DIR/vms/$IP"
[[ "$(run issue --ip $IP | tail -1)" == "$D" ]] && ok "issue prints the leaf dir" || bad "issue output"
for f in cert.pem key.pem bundle.pem spki.txt; do check "issue wrote $f" test -s "$D/$f"; done
[[ "$(mode "$D/key.pem")" == 600 ]] && ok "leaf key mode 0600" || bad "leaf key mode"
san=$(openssl x509 -in "$D/cert.pem" -noout -ext subjectAltName 2>/dev/null)
[[ "$san" == *"DNS:$IP.sslip.io"* && "$san" == *"DNS:*.$IP.sslip.io"* ]] && ok "leaf SANs: <ip>.sslip.io + wildcard" || bad "leaf SANs: $san"
openssl x509 -in "$D/cert.pem" -noout -ext extendedKeyUsage 2>/dev/null | grep -q 'TLS Web Server Authentication' && ok "leaf EKU serverAuth" || bad "leaf EKU"
check "leaf expires in ~365 days (within 360..366)" bash -c "
  openssl x509 -in '$D/cert.pem' -noout -checkend $((360*86400)) &&
  ! openssl x509 -in '$D/cert.pem' -noout -checkend $((366*86400))"
check "leaf verifies against ca.pem" openssl verify -CAfile "$VM_TEST_CA_DIR/ca.pem" "$D/cert.pem"
n=$(grep -c 'BEGIN CERTIFICATE' "$D/bundle.pem")
[[ "$n" == 2 ]] && grep -q "$(openssl x509 -in "$VM_TEST_CA_DIR/ca.pem" -outform pem | sed -n 2p)" "$D/bundle.pem" \
  && ok "bundle = system roots + CA ($n certs)" || bad "bundle contents ($n certs)"
s1=$("$CA" spki --ip $IP 2>/dev/null); s2=$("$CA" spki --ip $IP 2>/dev/null)
[[ -n "$s1" && "$s1" == "$s2" ]] && ok "spki stable across calls" || bad "spki unstable"
# re-issue is a no-op while the leaf is fresh
c1=$(sha256sum "$D/cert.pem"); run issue --ip $IP >/dev/null; [[ "$c1" == "$(sha256sum "$D/cert.pem")" ]] && ok "issue is idempotent for a fresh leaf" || bad "leaf re-issued needlessly"

# --force replaces the CA (and drops stale leaves)
run init --force >/dev/null
[[ "$before" != "$(sha256sum "$VM_TEST_CA_DIR/ca.key" "$VM_TEST_CA_DIR/ca.pem")" ]] && ok "--force replaces the CA" || bad "--force did not replace"

# dry-run changes nothing
rm -rf "$T/dry"; VM_TEST_CA_DIR="$T/dry" "$CA" --dry-run init >/dev/null 2>&1; [[ ! -e "$T/dry/ca.key" ]] && ok "--dry-run init writes nothing" || bad "--dry-run wrote"

# FR-003: nothing the tool printed contains the key's PEM body
body=$(sed -n '2p' "$VM_TEST_CA_DIR/ca.key")
if grep -qF "$body" "$OUT" || grep -q 'PRIVATE KEY' "$OUT"; then bad "output leaked key material"; else ok "no output line contains key material"; fi

(( fails == 0 )) && { echo "vm-test-ca.selftest: PASS"; exit 0; } || { echo "vm-test-ca.selftest: FAILED ($fails)"; exit 1; }
