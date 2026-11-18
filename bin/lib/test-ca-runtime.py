#!/usr/bin/env python3
"""OCI runtime shim for trusted TLS on disposable test VMs (spec 009, research R2).

Installed on a VM as /usr/local/libexec/hola-test-ca-runtime and registered as
Docker's DEFAULT runtime. Docker's containerd shim invokes it with runc's command
line; on `create --bundle <dir>` it edits <dir>/config.json so that EVERY container
the VM creates (Hola's own stack and every app, however it is (re)created) gets:

  * a read-only bind mount of the host's CA bundle,
  * NODE_EXTRA_CA_CERTS / SSL_CERT_FILE / REQUESTS_CA_BUNDLE pointing at it
    (only for keys the container does not already set), and
  * the same bundle bind-mounted read-only OVER each system trust-store file the
    image already has (/etc/ssl/certs/ca-certificates.crt, ...). The env vars only reach
    the container's main process: `docker exec` builds its environment from Docker's
    config, not the OCI spec, so a process Hola starts with `compose exec` (gitea's
    post-deploy `gitea admin auth add-oauth`, a Go binary) never sees SSL_CERT_FILE.
    Go, curl and OpenSSL read the system file by default, so overlaying it makes the
    trust apply to exec'd processes too. Only files that exist in the image are
    overlaid (never invented), and the bundle is a superset of public roots.

then execs the real runc with the ORIGINAL argv. Every other subcommand is a pure
passthrough. This is the mechanism nvidia-container-runtime uses to inject devices.

It is INERT by construction: if the host bundle is missing or config.json is not
readable/parseable it passes straight through and only writes a note to stderr, so a
broken setup can never stop a container from starting. Test-harness only; nothing in
the Hola product knows about it.

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
        for dest in SYSTEM_BUNDLES:
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
