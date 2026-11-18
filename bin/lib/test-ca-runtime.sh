#!/bin/sh
# OCI runtime front end for trusted TLS on disposable test VMs (spec 009, #578).
#
# Installed on a VM as /usr/local/libexec/hola-test-ca-runtime and registered as
# Docker's DEFAULT runtime, in front of the Python shim (bin/lib/test-ca-runtime.py,
# installed beside it as hola-test-ca-runtime.py). Docker calls the runtime for every
# runc operation, including every healthcheck `exec`; only `create` needs the shim, so
# this execs the real runc DIRECTLY unless `create` appears as an argv element, and in
# that case execs the Python shim with the argv unchanged.
#
# The check is deliberately conservative and NOT a parse: the authoritative argv parse
# (runc's global options, what the subcommand is) lives in the Python shim alone. A
# false positive (some option VALUE spelled `create`) only costs a Python start, and
# the shim then passes it through; a real `create` always has the bare element, so it
# can never skip the shim. Either way the original argv reaches runc byte for byte.
#
# Inert like the shim: if the shim or python3 is missing, `create` passes straight to
# runc, so a broken install can never stop a container from being created.
#
# Test overrides (never set in production): HOLA_TEST_CA_REAL_RUNC (the runc to exec),
# HOLA_TEST_CA_SHIM (the Python shim), HOLA_TEST_CA_PYTHON (its interpreter).

for a in "$@"; do
  if [ "$a" = create ]; then
    shim=${HOLA_TEST_CA_SHIM:-/usr/local/libexec/hola-test-ca-runtime.py}
    py=${HOLA_TEST_CA_PYTHON:-python3}
    if [ -r "$shim" ] && command -v "$py" >/dev/null 2>&1; then
      exec "$py" "$shim" "$@"
    fi
    echo "hola-test-ca-runtime: inert (no $shim or $py), passing through" >&2
    break
  fi
done

# Same search order as the Python shim's real_runc().
if [ -n "${HOLA_TEST_CA_REAL_RUNC:-}" ]; then exec "$HOLA_TEST_CA_REAL_RUNC" "$@"; fi
for c in /usr/bin/runc /usr/sbin/runc /usr/local/bin/runc; do
  if [ -x "$c" ]; then exec "$c" "$@"; fi
done
exec runc "$@"
