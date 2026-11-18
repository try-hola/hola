#!/usr/bin/env bash
# Self-test for bin/lib/test-ca-runtime.py and its sh front end test-ca-runtime.sh (spec 009; #577, #578): the
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
printf '%s\0' "$@" > "$FAKE_OUT.argv0"      # exact bytes, for the two-layer checks
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

# --- #577: no read-only overlay for a container that rewrites its own trust store -------
# rootfs_case <process-json>: a bundle whose rootfs has /etc/ssl/certs/ca-certificates.crt
# and whose config.json has the given "process" object. Fixture files are added after.
rootfs_case() { fresh_bundle; mkdir -p "$T/b/rootfs/etc/ssl/certs"; echo old > "$T/b/rootfs/etc/ssl/certs/ca-certificates.crt"
  "$PY" - "$T/b/config.json" "$1" <<'P'
import json,sys;p=sys.argv[1];c=json.load(open(p));pr=json.loads(sys.argv[2]);pr.setdefault('env',c['process']['env']);c['process']=pr;json.dump(c,open(p,'w'))
P
}
script() { mkdir -p "$(dirname "$T/b/rootfs$1")"; printf '%s\n' "${@:2}" > "$T/b/rootfs$1"; chmod +x "$T/b/rootfs$1"; }
overlay_n() { cfg "$T/b/config.json" "print(sum(m['destination']=='/etc/ssl/certs/ca-certificates.crt' for m in c['mounts']))"; }
still_injected() { [[ "$(cfg "$T/b/config.json" "e=c['process']['env'];print(any(m['destination']=='/etc/hola-test-ca/bundle.pem' for m in c['mounts']) and 'SSL_CERT_FILE=/etc/hola-test-ca/bundle.pem' in e)")" == True ]]; }
expect_overlay() {   # <label> <1|0>
  if [[ "$(overlay_n)" == "$2" ]] && still_injected; then ok "$1"; else bad "$1 (overlay=$(overlay_n))"; fi; }

# gitea's real shape (Dockerfile ENTRYPOINT /usr/bin/entrypoint, CMD s6-svscan /etc/s6):
# its entrypoint renames users and execs s6; it never touches the CA store -> OVERLAY.
rootfs_case '{"args":["/usr/bin/entrypoint","/usr/bin/s6-svscan","/etc/s6"],"cwd":"/"}'
script /usr/bin/entrypoint '#!/bin/sh' 'if [ "${USER}" != "git" ]; then' '    sed -i -e "s/^git\:/${USER}\:/g" /etc/passwd' 'fi' \
  'for FOLDER in /data/gitea/conf /data/gitea/log /data/git /data/ssh; do' '    mkdir -p ${FOLDER}' 'done' \
  'if [ $# -gt 0 ]; then' '    exec "$@"' 'else' '    exec /usr/bin/s6-svscan /etc/s6' 'fi'
printf '\177ELF update-ca-certificates' > "$T/b/rootfs/usr/bin/s6-svscan"   # a binary is never scanned
mkdir -p "$T/b/rootfs/etc/s6/gitea"
run create --bundle "$T/b" cid 2>/dev/null; expect_overlay "gitea shape (entrypoint -> s6-svscan): system store IS overlaid" 1

rootfs_case '{"args":["/bin/sh","-c","update-ca-certificates && exec app"]}'
run create --bundle "$T/b" cid 2>"$T/err"; expect_overlay "rewriter in process.args (sh -c): overlay skipped, mount+env kept" 0
grep -q "not overlaying" "$T/err" && ok "skip is noted on stderr" || bad "skip not noted"

rootfs_case '{"args":["/entrypoint.sh","app"]}'
script /entrypoint.sh '#!/bin/sh' 'set -e' 'cp /certs/*.crt /usr/local/share/ca-certificates/' 'update-ca-certificates' 'exec "$@"'
run create --bundle "$T/b" cid 2>/dev/null; expect_overlay "rewriter in the entrypoint script: overlay skipped" 0

rootfs_case '{"args":["docker-entrypoint.sh","app"],"env":["PATH=/usr/local/bin:/usr/bin"]}'
script /usr/local/bin/docker-entrypoint.sh '#!/bin/bash' 'update-ca-trust extract' 'exec "$@"'
run create --bundle "$T/b" cid 2>/dev/null; expect_overlay "bare args[0] resolved via the container's PATH: overlay skipped" 0

rootfs_case '{"args":["/sbin/tini","--","/init.sh"]}'
printf '\177ELF' > "$T/b/rootfs/init-bin"; mkdir -p "$T/b/rootfs/sbin"; cp "$T/b/rootfs/init-bin" "$T/b/rootfs/sbin/tini"
script /init.sh '#!/bin/sh' 'c_rehash /etc/ssl/certs' 'exec app'
run create --bundle "$T/b" cid 2>/dev/null; expect_overlay "script behind a tini chain: overlay skipped" 0

rootfs_case '{"args":["/start"]}'
script /opt/real-start '#!/bin/sh' 'update-ca-certificates'; ln -s /opt/real-start "$T/b/rootfs/start"
run create --bundle "$T/b" cid 2>/dev/null; expect_overlay "absolute symlinked entrypoint resolved inside the rootfs: overlay skipped" 0

# An absolute link must resolve against the ROOTFS, never the host: a host file that
# names a rewriter is not read, so the overlay stays.
rootfs_case '{"args":["/start"]}'
printf '#!/bin/sh\nupdate-ca-certificates\n' > "$T/host-script"; ln -s "$T/host-script" "$T/b/rootfs/start"
run create --bundle "$T/b" cid 2>/dev/null; expect_overlay "symlink to a HOST path is not followed out of the rootfs" 1

rootfs_case '{"args":["/docker-entrypoint.sh","nginx"]}'
script /docker-entrypoint.sh '#!/bin/sh' 'for f in /docker-entrypoint.d/*.sh; do . "$f"; done' 'exec "$@"'
script /docker-entrypoint.d/10-ca.sh '#!/bin/sh' 'update-ca-certificates --fresh'
run create --bundle "$T/b" cid 2>/dev/null; expect_overlay "rewriter in /docker-entrypoint.d: overlay skipped" 0

rootfs_case '{"args":["/init"]}'
printf '\177ELF' > "$T/b/rootfs/init"
script /etc/s6-overlay/s6-rc.d/init-certs/up '/etc/s6-overlay/s6-rc.d/init-certs/run'
script /etc/s6-overlay/s6-rc.d/init-certs/run '#!/command/with-contenv bash' 'update-ca-certificates'
run create --bundle "$T/b" cid 2>/dev/null; expect_overlay "rewriter in an s6-overlay v3 s6-rc.d service: overlay skipped" 0

rootfs_case '{"args":["/entrypoint.sh"]}'
script /entrypoint.sh '#!/bin/sh' 'export SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt' 'exec app'
run create --bundle "$T/b" cid 2>/dev/null; expect_overlay "an entrypoint that only READS the store keeps the overlay" 1

# --- #578: the sh front end (what Docker runs) ------------------------------------------
FE="$HERE/test-ca-runtime.sh"
PYW="$T/py-wrap"                 # records that Python started, and the argv it was given
cat > "$PYW" <<W
#!/usr/bin/env bash
echo started >> "\$FAKE_OUT.py"
printf '%s\0' "\${@:2}" > "\$FAKE_OUT.pyargv0"
exec "$PY" "\$@"
W
chmod +x "$PYW"
run_fe() { rm -f "$T/out."*; HOLA_TEST_CA_SHIM="${FE_SHIM:-$SHIM}" HOLA_TEST_CA_PYTHON="$PYW" sh "$FE" "$@"; }
argv0_is() { printf '%s\0' "$@" | cmp -s - "$T/out.argv0"; }

# Non-create calls never start Python; argv and config.json untouched. The first is the
# shape containerd's shim uses for a healthcheck exec.
for sub in "--root /run/docker/runtime-runc/moby --log /run/x/log.json --log-format json exec --process /tmp/runc-process1 --detach --pid-file /run/x/p.pid cid" \
           "start cid" "state cid" "kill cid 9" "delete --force cid" "--version" "features" "ps --format json cid"; do
  fresh_bundle; before=$(sha256sum "$T/b/config.json")
  # shellcheck disable=SC2086
  run_fe $sub
  # shellcheck disable=SC2086
  if [[ ! -e "$T/out.py" ]] && argv0_is $sub && [[ "$before" == "$(sha256sum "$T/b/config.json")" ]]; then
    ok "front end '${sub:0:40}': straight to runc, no Python, argv byte-identical"
  else bad "front end '$sub' (python=$([[ -e "$T/out.py" ]] && echo started || echo no))"; fi
done

# create goes through Python, which edits config.json; argv identical through BOTH
# layers, including awkward bytes (spaces, an empty element, a glob, a leading dash).
fresh_bundle
args=(--root /run/x --log "/l with space" --log-format json create --bundle "$T/b" --pid-file '/p*' --console-socket "" -- cid)
run_fe "${args[@]}"
[[ -e "$T/out.py" ]] && ok "front end: create starts the Python shim" || bad "front end: create skipped Python"
printf '%s\0' "${args[@]}" | cmp -s - "$T/out.pyargv0" && ok "front end -> Python: argv byte-identical" || bad "front end -> Python argv changed"
argv0_is "${args[@]}" && ok "front end -> Python -> runc: argv byte-identical" || bad "two-layer argv changed"
[[ "$(cfg "$T/out.config" "print(any(m['destination']=='/etc/hola-test-ca/bundle.pem' for m in c['mounts']))")" == True ]] && ok "front end: runc saw the shim's edited config" || bad "front end: config not edited"

# A false positive (an option VALUE spelled `create`) costs a Python start, nothing else:
# the shim's authoritative parse says `exec`, so config.json is untouched.
fresh_bundle; before=$(sha256sum "$T/b/config.json")
( cd "$T/b" && run_fe exec --process create cid )
[[ -e "$T/out.py" && "$before" == "$(sha256sum "$T/b/config.json")" ]] && argv0_is exec --process create cid \
  && ok "front end false positive ('create' as a value): Python parses it as exec, passthrough" || bad "false positive mishandled"

# Inert: no Python shim on the host -> create still reaches runc unchanged.
fresh_bundle; before=$(sha256sum "$T/b/config.json")
FE_SHIM="$T/no-such-shim.py" run_fe create --bundle "$T/b" cid 2>/dev/null
[[ ! -e "$T/out.py" && "$before" == "$(sha256sum "$T/b/config.json")" ]] && argv0_is create --bundle "$T/b" cid \
  && ok "front end without the shim: inert passthrough" || bad "front end without shim blocked/changed"

(( fails == 0 )) && { echo "test-ca-runtime.selftest: PASS"; exit 0; } || { echo "test-ca-runtime.selftest: FAILED ($fails)"; exit 1; }
