# Data Model: Trusted TLS on Disposable Test VMs (spec 009)

This feature has no database. Its entities are files and harness state.

## Devcontainer side (`CA_DIR`, default `.devcontainer/.test-ca/`, gitignored, mode 0700)

| File | Content | Mode | Lifetime |
|---|---|---|---|
| `ca.pem` | test CA certificate (RSA-3072, `CA:TRUE`, 10 y) | 0644 | until `init --force` |
| `ca.key` | CA private key | **0600** | never leaves the devcontainer (FR-003) |
| `vms/<ip>/cert.pem` | leaf, SAN `<ip>.sslip.io` + `*.<ip>.sslip.io`, 365 d, `serverAuth` | 0644 | re-issued when absent or < 30 d left |
| `vms/<ip>/key.pem` | leaf key | 0600 | as above |
| `vms/<ip>/bundle.pem` | devcontainer system roots + `ca.pem` | 0644 | rebuilt each run |
| `vms/<ip>/spki.txt` | base64 SHA-256 of the leaf SPKI (for Chromium) | 0644 | with the leaf |

Leaves are keyed by IP because DHCP reuses addresses across VMs, so the same leaf is valid for any VM that lands on that IP.

## VM side

| Path | Content | Mode | Written | Notes |
|---|---|---|---|---|
| `/etc/hola-test-ca/bundle.pem` | combined bundle | 0644 | before bootstrap | the shim mounts it into every container |
| `/usr/local/libexec/hola-test-ca-runtime` | OCI runtime front end (POSIX `sh`, `bin/lib/test-ca-runtime.sh`) | 0755 | before bootstrap | the registered runtime path; execs runc directly unless `create` is an argv element (#578) |
| `/usr/local/libexec/hola-test-ca-runtime.py` | OCI runtime shim (Python 3, `bin/lib/test-ca-runtime.py`) | 0755 | before bootstrap | handles `create`; the authoritative argv parse |
| `/etc/docker/daemon.json` | merged: `runtimes.hola-test-ca.path`, `default-runtime: hola-test-ca` | 0644 | before bootstrap | existing keys preserved |
| volume `hola-data:/test-tls/{cert,key}.pem` | leaf + key | 0644 / 0600 | after bootstrap | |
| volume `hola-data:/runtime/traefik/test-tls.yml` | `tls.stores.default.defaultCertificate` | 0644 | after bootstrap | harness-owned; the server never touches it |

The CA key is never on the VM.

## Container side (injected by the shim on OCI `create`)

- **Mount:** `{ destination: /etc/hola-test-ca/bundle.pem, source: /etc/hola-test-ca/bundle.pem, type: bind, options: [rbind, ro] }`.
- **System-store overlay (added after T001/T026 found that `compose exec` processes never see the injected env):** the same bundle is bind-mounted read-only over each of `/etc/ssl/certs/ca-certificates.crt`, `/etc/pki/tls/certs/ca-bundle.crt`, `/etc/ssl/cert.pem`, `/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem` **that already exists in the image's rootfs** (a symlink counts; absent paths are never created). This is what lets a Go binary started by `docker compose exec` (gitea's `admin auth add-oauth`) trust the CA.
- **Overlay skip rule (#577):** a read-only file over the store makes a startup `update-ca-certificates` fail, so the overlay (only the overlay; the mount and env above are unchanged) is skipped when a CA-store rewriter (`update-ca-certificates`, `update-ca-trust`, `c_rehash`, `trust extract`) appears in:
  1. `process.args` (entrypoint + cmd, including a `sh -c` string);
  2. a script `process.args` names: `args[0]` (resolved via the container's `PATH` when bare) and path-looking later args (a tini/dumb-init chain's target, `sh /entrypoint.sh`). Paths and symlinks resolve inside the rootfs, never on the host; only files starting `#!` are read (binaries never), at most 256 KiB each;
  3. a file in a well-known hook directory: `/docker-entrypoint.d`, `/docker-entrypoint-initdb.d`, `/entrypoint.d`, `/etc/cont-init.d`, `/custom-cont-init.d`, `/etc/s6-overlay/scripts`, `/etc/s6-overlay/s6-rc.d/*/{up,run}` (at most 128 files).

  This is a heuristic, not a per-image rule: `config.json` carries no image name or label (Docker fills `annotations` only from `HostConfig.Annotations`). gitea (`/usr/bin/entrypoint /usr/bin/s6-svscan /etc/s6`; the entrypoint never touches the CA store) keeps the overlay. A rewriter reached any other way is not seen, so such an image still gets the overlay and can still fail to start; `VM_TRUSTED_TLS=0` is the escape hatch.
- **Env:** `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, each `=/etc/hola-test-ca/bundle.pem`. A key is added only if `process.env` does not already define it.
- **Inert** when the host bundle file is absent, `config.json` cannot be read, or (front end) the Python shim or `python3` is missing: an error in the shim never stops a container from being created. This says nothing about what the container later does with what was injected (see the overlay skip rule).

## Trusted mode (harness state)

```
CA absent                          → untrusted (today's behaviour, byte-for-byte)
CA present, VM_TRUSTED_TLS=0       → untrusted
CA present, VM_TRUSTED_TLS unset/1 → trusted
trusted + any setup step fails     → run FAILS before any app install (FR-004a)
```

## OIDC trust expectation (`bin/lib/oidc-trust.tsv`)

Columns: `app`, `service`, `runtime` (`go|node|python|unknown`), `probe` (`node|python|curl|none`), `expected` (`covered|unverified|not-covered`).

Rows are as in research.md R3. `app-test.sh` maps a row to a result:

| trusted? | row expected | probe outcome | result |
|---|---|---|---|
| no | any | — | step not run |
| yes | covered | ok | PASS (continue) |
| yes | covered | fail | **FAIL** at stage `sso-trust` |
| yes | unverified / not-covered | — | **SKIP** `trust not covered` (the app's other stages still run and report) |
| yes | app not in table | — | step not run (not a native-oidc app) |

An app whose SSO-trust result is SKIP still reports its install/verify/restart/stop/uninstall results. The SKIP is attached as a note, so one uncovered bundle never hides a real install failure.
