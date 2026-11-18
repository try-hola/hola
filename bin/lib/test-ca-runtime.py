#!/usr/bin/env python3
"""OCI runtime shim for trusted TLS on disposable test VMs (spec 009, research R2).

Installed on a VM as /usr/local/libexec/hola-test-ca-runtime.py. Docker's DEFAULT
runtime is the POSIX sh front end beside it (bin/lib/test-ca-runtime.sh, installed as
/usr/local/libexec/hola-test-ca-runtime): it execs the real runc directly for every
call whose argv has no `create` element, so healthcheck `exec`s, `state`, `kill` and
`delete` never start Python, and hands everything else here with the argv unchanged
(#578). The authoritative argv parse is this file's; a front-end false positive is just
a passthrough below. On `create --bundle <dir>` it edits <dir>/config.json so that
EVERY container the VM creates (Hola's own stack and every app, however it is
(re)created) gets:

  * a read-only bind mount of the host's CA bundle,
  * NODE_EXTRA_CA_CERTS / SSL_CERT_FILE / REQUESTS_CA_BUNDLE pointing at it
    (only for keys the container does not already set), and
  * unless the container manages its own trust store (below), the same bundle
    bind-mounted read-only OVER each system trust-store file the image already has
    (/etc/ssl/certs/ca-certificates.crt, ...). The env vars only reach the container's
    main process: `docker exec` builds its environment from Docker's config, not the
    OCI spec, so a process Hola starts with `compose exec` (gitea's post-deploy
    `gitea admin auth add-oauth`, a Go binary) never sees SSL_CERT_FILE. Go, curl and
    OpenSSL read the system file by default, so overlaying it makes the trust apply to
    exec'd processes too. Only files that exist in the image are overlaid (never
    invented), and the bundle is a superset of public roots.

    The overlay is SKIPPED (#577) when the container looks like it rewrites its own
    trust store at startup: a read-only bind mount over that file makes
    `update-ca-certificates` fail (EROFS/EBUSY), and under `set -e` that is a crash
    loop. config.json carries no image name or label to key a per-image rule on
    (Docker fills `annotations` only from HostConfig.Annotations, i.e. `--annotation`),
    so the rule is a heuristic over what IS visible: a CA-store rewriter (REWRITERS)
    named in process.args, in a script process.args names (resolved inside the rootfs,
    never on the host), or in a well-known entrypoint hook directory (HOOK_DIRS). A
    rewriter reached any other way is not seen, and such an image still gets the overlay.

then execs the real runc with the ORIGINAL argv. Every other subcommand is a pure
passthrough. This is the mechanism nvidia-container-runtime uses to inject devices.

Errors inside the shim never stop a container from being created: if the host bundle
is missing or config.json is not readable/parseable it passes straight through and only
writes a note to stderr. That is a claim about the shim, not about what the container
later does with what was injected. Test-harness only; nothing in the Hola product knows
about it.

Test overrides (never set in production): HOLA_TEST_CA_BUNDLE (host bundle path),
HOLA_TEST_CA_REAL_RUNC (the runc to exec).
"""
import json
import os
import shutil
import sys
import tempfile

DEST = "/etc/hola-test-ca/bundle.pem"           # path inside the container
HOST_BUNDLE = os.environ.get("HOLA_TEST_CA_BUNDLE", DEST)
ENV_KEYS = ("NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "REQUESTS_CA_BUNDLE")
# System trust-store files (Debian/Ubuntu/Alpine, RHEL/Fedora, Alpine/OpenSSL legacy).
SYSTEM_BUNDLES = (
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/ssl/cert.pem",
    "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
)
# Commands that rewrite a system trust store in place. Seeing one means "this container
# manages its own CA store": do not overlay that store read-only (#577).
REWRITERS = (b"update-ca-certificates", b"update-ca-trust", b"c_rehash", b"trust extract")
# Entrypoint hook directories images run at startup (nginx-style /docker-entrypoint.d,
# s6-overlay v2 cont-init.d, linuxserver custom-cont-init.d, s6-overlay v3 scripts), plus
# s6-overlay v3's per-service s6-rc.d/<svc>/{up,run}.
HOOK_DIRS = ("/docker-entrypoint.d", "/docker-entrypoint-initdb.d", "/entrypoint.d",
             "/etc/cont-init.d", "/custom-cont-init.d", "/etc/s6-overlay/scripts")
S6_RC_DIR = "/etc/s6-overlay/s6-rc.d"
SCAN_BYTES = 256 * 1024      # read at most this much of any one file
SCAN_FILES = 128             # and at most this many hook files per container
DEFAULT_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# runc global options that consume a following value when written as `--opt value`.
GLOBAL_WITH_VALUE = {"--root", "--log", "--log-format", "--criu", "--rootless"}


def real_runc():
    p = os.environ.get("HOLA_TEST_CA_REAL_RUNC")
    if p:
        return p
    for cand in ("/usr/bin/runc", "/usr/sbin/runc", "/usr/local/bin/runc"):
        if os.access(cand, os.X_OK):
            return cand
    return shutil.which("runc") or "runc"


def subcommand(argv):
    """Return (index of the subcommand token, token) or (None, None)."""
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--":
            return None, None
        if a.startswith("-"):
            if "=" not in a and a in GLOBAL_WITH_VALUE:
                i += 1  # skip its value
            i += 1
            continue
        return i, a
    return None, None


def bundle_dir(args):
    """The --bundle/-b value of `create`, else the cwd (runc's default)."""
    i = 0
    while i < len(args):
        a = args[i]
        if a in ("--bundle", "-b") and i + 1 < len(args):
            return args[i + 1]
        if a.startswith("--bundle="):
            return a.split("=", 1)[1]
        if a.startswith("-b=") or (a.startswith("-b") and len(a) > 2 and not a.startswith("--")):
            return a[3:] if a.startswith("-b=") else a[2:]
        i += 1
    return os.getcwd()


def in_rootfs(rootfs, path, cwd="/"):
    """Host path of container path `path`, following symlinks the way the container
    would: an absolute link target is relative to the rootfs, never the host, and `..`
    never climbs above it. None if the link chain is too long. Need not exist."""
    if not path.startswith("/"):
        path = (cwd if cwd.startswith("/") else "/").rstrip("/") + "/" + path
    parts = [p for p in path.split("/") if p not in ("", ".")]
    cur, hops = "", 0
    while parts:
        p = parts.pop(0)
        if p == "..":
            cur = cur.rsplit("/", 1)[0]
            continue
        nxt = cur + "/" + p
        if os.path.islink(rootfs + nxt):
            hops += 1
            if hops > 40:
                return None
            tgt = os.readlink(rootfs + nxt)
            parts = [x for x in tgt.split("/") if x not in ("", ".")] + parts
            if tgt.startswith("/"):
                cur = ""
            continue
        cur = nxt
    return rootfs + (cur or "/")


def _head(host, need_shebang):
    """The first SCAN_BYTES of a regular file, else b"" (missing, not regular,
    unreadable, or -- with need_shebang -- not a script: binaries are never scanned)."""
    try:
        if not os.path.isfile(host):
            return b""
        with open(host, "rb") as f:
            data = f.read(SCAN_BYTES)
    except OSError:
        return b""
    return data if (not need_shebang or data.startswith(b"#!")) else b""


def rewrites_trust_store(cfg, rootfs):
    """The rewriter that marks this container as managing its own CA store, or None."""
    proc = cfg.get("process") or {}
    args = [a for a in (proc.get("args") or []) if isinstance(a, str)]
    cwd = proc.get("cwd") or "/"
    env = proc.get("env") or []
    path = next((e[5:] for e in env if isinstance(e, str) and e.startswith("PATH=")), DEFAULT_PATH)

    def hit(data):
        return next((r.decode() for r in REWRITERS if r in data), None)

    # 1. process.args itself (entrypoint + cmd, including a `sh -c '...'` string).
    found = hit("\0".join(args).encode("utf-8", "replace"))
    if found:
        return found
    # 2. scripts process.args names: args[0], PATH-resolved as the container's exec would,
    #    and later path-looking args (tini/dumb-init chains, `sh /entrypoint.sh`).
    cands = []
    if args:
        if "/" in args[0]:
            cands.append(args[0])
        else:
            cands += [d.rstrip("/") + "/" + args[0] for d in path.split(":") if d.startswith("/")]
    cands += [a for a in args[1:8] if a.startswith("/") or a.startswith("./")]
    for c in cands:
        host = in_rootfs(rootfs, c, cwd)
        found = host and hit(_head(host, need_shebang=True))
        if found:
            return found
    # 3. well-known hook directories (any regular file: s6 `up` files are execline).
    files = []
    for d in HOOK_DIRS + (S6_RC_DIR,):
        host = in_rootfs(rootfs, d)
        if not (host and os.path.isdir(host)):
            continue
        for n in sorted(os.listdir(host)):
            if d == S6_RC_DIR:
                files += [os.path.join(host, n, "up"), os.path.join(host, n, "run")]
            else:
                files.append(os.path.join(host, n))
    for f in files[:SCAN_FILES]:
        # A hook file that is itself a link may point anywhere: resolve it in the rootfs.
        host = in_rootfs(rootfs, "/" + os.path.relpath(f, rootfs)) if os.path.islink(f) else f
        found = host and hit(_head(host, need_shebang=False))
        if found:
            return found
    return None


def inject(bundle):
    cfg_path = os.path.join(bundle, "config.json")
    try:
        if not os.path.isfile(HOST_BUNDLE):
            return  # inert: no bundle on this host
        with open(cfg_path, "r") as f:
            cfg = json.load(f)
        st = os.stat(cfg_path)
    except Exception as e:  # unreadable / unparseable -> inert
        sys.stderr.write("hola-test-ca-runtime: inert (%s)\n" % e)
        return
    try:
        mounts = cfg.setdefault("mounts", [])
        if not any(m.get("destination") == DEST for m in mounts):
            mounts.append({"destination": DEST, "type": "bind", "source": HOST_BUNDLE,
                           "options": ["rbind", "ro"]})
        root = cfg.get("root") or {}
        rootfs = root.get("path", "rootfs")
        if not os.path.isabs(rootfs):
            rootfs = os.path.join(bundle, rootfs)
        rewriter = rewrites_trust_store(cfg, rootfs)
        if rewriter:
            sys.stderr.write("hola-test-ca-runtime: container runs %s; not overlaying the system "
                             "trust store (%s + env still injected)\n" % (rewriter, DEST))
        for dest in (() if rewriter else SYSTEM_BUNDLES):
            # lexists: an (even dangling-on-the-host) symlink in the image is resolved by
            # runc inside the rootfs; an absent path is left alone.
            if os.path.lexists(os.path.join(rootfs, dest.lstrip("/"))) \
                    and not any(m.get("destination") == dest for m in mounts):
                mounts.append({"destination": dest, "type": "bind", "source": HOST_BUNDLE,
                               "options": ["rbind", "ro"]})
        proc = cfg.setdefault("process", {})
        env = proc.setdefault("env", [])
        have = {e.split("=", 1)[0] for e in env if isinstance(e, str)}
        for k in ENV_KEYS:
            if k not in have:
                env.append("%s=%s" % (k, DEST))
        fd, tmp = tempfile.mkstemp(prefix=".config.json.", dir=bundle)
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(cfg, f)
            os.chmod(tmp, st.st_mode & 0o7777)
            os.chown(tmp, st.st_uid, st.st_gid)
            os.replace(tmp, cfg_path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
    except Exception as e:
        sys.stderr.write("hola-test-ca-runtime: inject failed, passing through (%s)\n" % e)


def main():
    argv = sys.argv[1:]
    idx, sub = subcommand(argv)
    if sub == "create":
        inject(bundle_dir(argv[idx + 1:]))
    runc = real_runc()
    os.execv(runc, [runc] + argv)


if __name__ == "__main__":
    main()
