#!/usr/bin/env bash
# Self-test for bin/_common.sh directory resolution (#579): CA_DIR / KEYS_DIR must
# resolve with precedence explicit process env > mcp.env > default, both at source
# time and after load_env, and a child process re-sourcing _common.sh must agree
# with its parent. No VM, no network.
# Run: bash bin/_common.selftest.sh   (exit 0 = pass)
set -euo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

fails=0
ok()  { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fails=$((fails+1)); }
expect_eq() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (want '$3', got '$2')"; fi; }

cat > "$T/set.env" <<EOF
# comment
VM_KEYS_DIR=$T/file-keys
VM_TEST_CA_DIR=$T/file-ca
VM_TEST_CA_DIR=$T/second-occurrence-ignored
EOF
: > "$T/empty.env"

# probe <env-file> [VAR=VAL…]: in a clean shell, source _common.sh, print the dirs
# at source time, after load_env, and as seen by a child that re-sources it.
probe() {
  local envfile=$1; shift
  env -i PATH="$PATH" HOME="$T" MCP_ENV_FILE="$envfile" VM_AUDIT_LOG="$T/audit.log" "$@" \
    bash -c '
      source "$1/bin/_common.sh"
      echo "src $CA_DIR $KEYS_DIR"
      load_env 2>/dev/null
      echo "env $CA_DIR $KEYS_DIR"
      bash -c "source \"$1/bin/_common.sh\"; echo \"child \$CA_DIR \$KEYS_DIR\""
    ' _ "$ROOT"
}

# check <label> <want_ca> <want_keys> <env-file> [VAR=VAL…]
check() {
  local label=$1 ca=$2 keys=$3; shift 3
  local out; out=$(probe "$@")
  expect_eq "$label: at source time"  "$(sed -n 1p <<<"$out")" "src $ca $keys"
  expect_eq "$label: after load_env"  "$(sed -n 2p <<<"$out")" "env $ca $keys"
  expect_eq "$label: child agrees"    "$(sed -n 3p <<<"$out")" "child $ca $keys"
}

DCA="$ROOT/.devcontainer/.test-ca"; DKEYS="$ROOT/.devcontainer/.vm-keys"
check "default (no env file)"      "$DCA" "$DKEYS" "$T/missing.env"
check "default (empty env file)"   "$DCA" "$DKEYS" "$T/empty.env"
check "process env"                "$T/p-ca" "$T/p-keys" "$T/empty.env" VM_TEST_CA_DIR="$T/p-ca" VM_KEYS_DIR="$T/p-keys"
check "mcp.env only"               "$T/file-ca" "$T/file-keys" "$T/set.env"
check "process env beats mcp.env"  "$T/p-ca" "$T/p-keys" "$T/set.env" VM_TEST_CA_DIR="$T/p-ca" VM_KEYS_DIR="$T/p-keys"
check "mixed: CA from env, keys from file" "$T/p-ca" "$T/file-keys" "$T/set.env" VM_TEST_CA_DIR="$T/p-ca"
check "empty process value falls to mcp.env (as load_env does)" "$T/file-ca" "$T/file-keys" "$T/set.env" VM_TEST_CA_DIR= VM_KEYS_DIR=

# bin/vm-test-ca never calls load_env: it must still honour an mcp.env-only value.
mkdir -p "$T/file-ca"
st=$(env -i PATH="$PATH" HOME="$T" MCP_ENV_FILE="$T/set.env" VM_AUDIT_LOG="$T/audit.log" "$ROOT/bin/vm-test-ca" status 2>/dev/null)
expect_eq "vm-test-ca status uses the mcp.env CA dir" "$st" "untrusted: no test CA in $T/file-ca (run bin/vm-test-ca init)"

if (( fails )); then echo "_common.selftest: FAILED ($fails)"; exit 1; fi
echo "_common.selftest: PASS"
