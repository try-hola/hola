#!/usr/bin/env bash
# Self-test for FR-018 / SC-004 (spec 009): with the test CA ABSENT the harness must
# behave byte-identically to the pre-009 scripts. This renders each suite's Hola
# .env and records the exact argv/environment of every TLS-bearing command
# (at_cli, at_http_code, _at_install_exec, vm-e2e-suite's api_cli/http_code/
# step_install, vm-catalog-test's http_code) with bun/curl/openssl stubbed, then
# diffs the transcript against bin/lib/testdata/untrusted-golden.txt, which was
# generated from the UNMODIFIED scripts (before any 009 edit).
# Run: bash bin/lib/untrusted-golden.selftest.sh [--regen]   (exit 0 = identical)
set -euo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
GOLDEN="$HERE/testdata/untrusted-golden.txt"
REGEN=0; [[ "${1:-}" == "--regen" ]] && REGEN=1

T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/stubs" "$T/noca" "$T/e2elogs"
: > "$T/empty.env"
# Stubs: record argv + the TLS-relevant environment, answer plausibly.
cat > "$T/stubs/bun" <<'STUB'
#!/usr/bin/env bash
echo "bun argv=[$*] TLS_REJECT=${NODE_TLS_REJECT_UNAUTHORIZED-<unset>} EXTRA_CA=${NODE_EXTRA_CA_CERTS-<unset>} API_URL=${HOLA_API_URL-<unset>} TOKEN=${HOLA_TOKEN-<unset>} NOUPD=${HOLA_NO_UPDATE_NOTICE-<unset>}" >> "$STUB_LOG"
echo '{"status":"completed","deploymentId":"dep1","items":[]}'
STUB
cat > "$T/stubs/curl" <<'STUB'
#!/usr/bin/env bash
echo "curl argv=[$*]" >> "$STUB_LOG"
printf 200
STUB
cat > "$T/stubs/openssl" <<'STUB'
#!/usr/bin/env bash
echo 000102030405060708090a0b0c0d0e0f1011121314151617
STUB
chmod +x "$T/stubs/"*

# run_section <label> <suite> <snippet>: source the suite in a clean shell (CA absent,
# no real env file, stubs first on PATH), run the snippet, then print the stub log.
run_section() {
  local label=$1 suite=$2 snippet=$3
  echo "### $label"
  : > "$T/stub.log"
  env -i PATH="$T/stubs:$PATH" HOME="$T" STUB_LOG="$T/stub.log" T="$T" \
    VM_TEST_CA_DIR="$T/noca" MCP_ENV_FILE="$T/empty.env" VM_AUDIT_LOG="$T/audit.log" \
    VM_STATE_FILE="$T/state" \
    bash -c 'suite=$1; snippet=$2; set --; source "$suite"; eval "$snippet"' \
      "$ROOT/bin/golden-host" "$suite" "$snippet" 2>/dev/null || echo "(section exit $?)"
  echo "-- stub log"; cat "$T/stub.log"
}

transcript() {
  run_section "vm-catalog-test" "$ROOT/bin/vm-catalog-test" '
    VMID=101; IP=10.0.0.5; VM_ID=101
    HOLA_ENV_OUT="$T/cat.env"; setup_render_env >/dev/null 2>&1
    echo "-- rendered env"; cat "$HOLA_ENV_OUT"
    echo "http_code=$(http_code https://apps.x/)"
    echo "at_http_code=$(at_http_code https://a.x/)"
    at_cli deployments --json >/dev/null
    _at_install_exec gitea "$T/err" --set A=B >/dev/null
    _at_install_exec uptime-kuma "$T/err" >/dev/null
  '
  run_section "vm-e2e-suite" "$ROOT/bin/vm-e2e-suite" '
    VMID=101; IP=10.0.0.5; VM_ID=101; LOG_DIR="$T/e2elogs"
    HOLA_ENV_OUT="$T/e2e.env"; step_render_env >/dev/null 2>&1
    echo "-- rendered env"; cat "$HOLA_ENV_OUT"
    echo "http_code=$(http_code https://apps.x/)"
    api_cli deployments --json >/dev/null
    step_install >/dev/null 2>&1
  '
}

OUT="$T/transcript.txt"
transcript 2>&1 | sed -e "s#$ROOT#<ROOT>#g" -e "s#$T#<TMP>#g" > "$OUT"

if [[ "$REGEN" == 1 ]]; then
  mkdir -p "$(dirname "$GOLDEN")"; cp "$OUT" "$GOLDEN"
  echo "untrusted-golden.selftest: regenerated $GOLDEN"; exit 0
fi
[[ -f "$GOLDEN" ]] || { echo "untrusted-golden.selftest: FAILED (no golden at $GOLDEN)"; exit 1; }
if diff -u "$GOLDEN" "$OUT"; then
  echo "untrusted-golden.selftest: PASS (untrusted transcript identical to golden, $(wc -l < "$GOLDEN") lines)"
else
  echo "untrusted-golden.selftest: FAILED (untrusted behaviour drifted from the pre-009 golden)"; exit 1
fi
