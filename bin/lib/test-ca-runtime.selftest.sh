#!/usr/bin/env bash
# Self-test for bin/lib/test-ca-runtime.py (spec 009, FR-010/FR-011 mechanism): the
# OCI runtime shim must add the CA mount + env on `create`, never override a
# container's own env, never duplicate its mount, leave every other subcommand and a
# missing host bundle alone, and always hand runc the original argv unchanged.
# A fake runc records its argv and the config.json it saw. No VM, no Docker.
# Run: bash bin/lib/test-ca-runtime.selftest.sh   (exit 0 = pass)
set -euo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SHIM="$HERE/test-ca-runtime.py"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
# Find a python3 with the full stdlib: some devcontainers ship only python3-minimal
# (no `json`). The VM image the shim actually runs on has the full one.
PY=""
for cand in ${HOLA_SELFTEST_PYTHON:-} python3 /home/*/.local/share/uv/python/*/bin/python3; do
  if command -v "$cand" >/dev/null 2>&1 && "$cand" -c 'import json,tempfile' 2>/dev/null; then PY=$(command -v "$cand"); break; fi
done
[[ -n "$PY" ]] || { echo "test-ca-runtime.selftest: FAILED (no python3 with json found; set HOLA_SELFTEST_PYTHON)"; exit 1; }
FAKE="$T/fake-runc"
cat > "$FAKE" <<'F'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$FAKE_OUT.argv"
b=""; prev=""
for a in "$@"; do [[ "$prev" == --bundle || "$prev" == -b ]] && b=$a; prev=$a; done
[[ -z "$b" ]] && b=$PWD
[[ -f "$b/config.json" ]] && cp "$b/config.json" "$FAKE_OUT.config" || true
exit 0
F
chmod +x "$FAKE"
printf 'FAKE BUNDLE\n' > "$T/bundle.pem"
export HOLA_TEST_CA_REAL_RUNC="$FAKE" HOLA_TEST_CA_BUNDLE="$T/bundle.pem" FAKE_OUT="$T/out"

fails=0
ok()  { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fails=$((fails+1)); }
fresh_bundle() { rm -rf "$T/b" "$T/out."*; mkdir -p "$T/b"
  echo '{"ociVersion":"1.0.2","process":{"env":["PATH=/usr/bin","FOO=bar"]},"mounts":[{"destination":"/proc","type":"proc","source":"proc"}]}' > "$T/b/config.json"; }
cfg() { "$PY" -c "import json,sys;c=json.load(open('$1'));$2"; }
run() { rm -f "$T/out."*; "$PY" "$SHIM" "$@"; }

# 1. create: mount + all three env vars added; original config preserved.
fresh_bundle
run --root /run/x --log /l --log-format json create --bundle "$T/b" --pid-file /p cid
[[ "$(cfg "$T/b/config.json" "print(sum(1 for m in c['mounts'] if m['destination']=='/etc/hola-test-ca/bundle.pem' and m['options']==['rbind','ro'] and m['type']=='bind' and m['source']=='$T/bundle.pem'))")" == 1 ]] && ok "create adds the ro bind mount" || bad "create: mount"
[[ "$(cfg "$T/b/config.json" "e=c['process']['env'];print(all(k+'=/etc/hola-test-ca/bundle.pem' in e for k in ('NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','REQUESTS_CA_BUNDLE')))")" == True ]] && ok "create adds all three env vars" || bad "create: env"
[[ "$(cfg "$T/b/config.json" "print('FOO=bar' in c['process']['env'] and any(m['destination']=='/proc' for m in c['mounts']))")" == True ]] && ok "create preserves existing env + mounts" || bad "create: preserve"
[[ "$(cat "$T/out.argv")" == "$(printf '%s\n' --root /run/x --log /l --log-format json create --bundle "$T/b" --pid-file /p cid)" ]] && ok "create: argv reaches runc byte-for-byte (globals included)" || bad "create: argv"
[[ "$(cfg "$T/out.config" "print(len(c['mounts']))")" == 2 ]] && ok "runc saw the edited config" || bad "runc saw unedited config"

# 1b. system trust-store files that exist in the image are overlaid (so `exec`'d Go/curl
#     processes, which never see the injected env, trust the CA too); absent ones are not.
fresh_bundle; mkdir -p "$T/b/rootfs/etc/ssl/certs"; echo old > "$T/b/rootfs/etc/ssl/certs/ca-certificates.crt"
ln -s /etc/ssl/certs/ca-certificates.crt "$T/b/rootfs/etc/ssl/cert.pem"          # a symlink in the image counts
run create --bundle "$T/b" cid
[[ "$(cfg "$T/b/config.json" "d=sorted(m['destination'] for m in c['mounts'] if m['source']=='$T/bundle.pem');print(' '.join(d))")" == "/etc/hola-test-ca/bundle.pem /etc/ssl/cert.pem /etc/ssl/certs/ca-certificates.crt" ]] && ok "overlays existing system trust files (file + symlink), not absent ones" || bad "system bundle overlay: $(cfg "$T/b/config.json" "print([m['destination'] for m in c['mounts']])")"
[[ "$(cfg "$T/b/config.json" "print(all(m['options']==['rbind','ro'] for m in c['mounts'] if m['source']=='$T/bundle.pem'))")" == True ]] && ok "every overlay is read-only" || bad "overlay not ro"
run create --bundle "$T/b" cid
[[ "$(cfg "$T/b/config.json" "print(len([m for m in c['mounts'] if m['source']=='$T/bundle.pem']))")" == 3 ]] && ok "system overlays not duplicated on a second run" || bad "overlay duplicated"

# 2. a pre-set SSL_CERT_FILE is kept (not overridden)
fresh_bundle; "$PY" - "$T/b/config.json" <<'P'
import json,sys;p=sys.argv[1];c=json.load(open(p));c['process']['env'].append('SSL_CERT_FILE=/custom.pem');json.dump(c,open(p,'w'))
P
run create --bundle "$T/b" cid
[[ "$(cfg "$T/b/config.json" "e=c['process']['env'];print('SSL_CERT_FILE=/custom.pem' in e and sum(x.startswith('SSL_CERT_FILE=') for x in e)==1)")" == True ]] && ok "pre-set SSL_CERT_FILE is kept" || bad "SSL_CERT_FILE overridden"

# 3. running twice does not duplicate the mount or env
fresh_bundle; run create --bundle "$T/b" cid; run create --bundle "$T/b" cid
[[ "$(cfg "$T/b/config.json" "print(sum(m['destination']=='/etc/hola-test-ca/bundle.pem' for m in c['mounts']), sum(x.startswith('NODE_EXTRA_CA_CERTS=') for x in c['process']['env']))")" == "1 1" ]] && ok "idempotent: no duplicate mount/env" || bad "duplicated on second run"

# 3b. -b short flag and cwd default
fresh_bundle; run create -b "$T/b" cid
[[ "$(cfg "$T/b/config.json" "print(len(c['mounts']))")" == 2 ]] && ok "create -b <dir> is honoured" || bad "-b"
fresh_bundle; ( cd "$T/b" && run create cid )
[[ "$(cfg "$T/b/config.json" "print(len(c['mounts']))")" == 2 ]] && ok "create with no --bundle uses the cwd" || bad "cwd default"

# 4. other subcommands: config.json untouched, argv byte-for-byte
for sub in "start cid" "delete --force cid" "state cid" "--version" "kill cid 9" "exec cid ls" "run --bundle $T/b cid"; do
  fresh_bundle; before=$(sha256sum "$T/b/config.json")
  # shellcheck disable=SC2086
  run $sub
  [[ "$before" == "$(sha256sum "$T/b/config.json")" ]] && ok "'$sub': config.json untouched" || bad "'$sub' touched config.json"
  # shellcheck disable=SC2086
  [[ "$(cat "$T/out.argv")" == "$(printf '%s\n' $sub)" ]] && ok "'$sub': argv passthrough" || bad "'$sub' argv changed"
done

# 5. host bundle missing -> inert: config.json unchanged, argv still passes
fresh_bundle; before=$(sha256sum "$T/b/config.json")
HOLA_TEST_CA_BUNDLE="$T/does-not-exist" run create --bundle "$T/b" cid
[[ "$before" == "$(sha256sum "$T/b/config.json")" ]] && ok "missing bundle: inert (config unchanged)" || bad "missing bundle changed config"
[[ "$(cat "$T/out.argv")" == "$(printf '%s\n' create --bundle "$T/b" cid)" ]] && ok "missing bundle: argv still reaches runc" || bad "missing bundle argv"

# 6. unreadable/corrupt config.json -> inert, never blocks
fresh_bundle; echo '{not json' > "$T/b/config.json"
run create --bundle "$T/b" cid 2>/dev/null && [[ "$(cat "$T/b/config.json")" == '{not json' ]] && ok "corrupt config.json: passthrough, untouched" || bad "corrupt config.json blocked/changed"
rm -rf "$T/b"; run create --bundle "$T/b" cid 2>/dev/null && ok "missing bundle dir: passthrough" || bad "missing bundle dir blocked"

(( fails == 0 )) && { echo "test-ca-runtime.selftest: PASS"; exit 0; } || { echo "test-ca-runtime.selftest: FAILED ($fails)"; exit 1; }
