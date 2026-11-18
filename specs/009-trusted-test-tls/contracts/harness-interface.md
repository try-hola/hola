# Contract: Harness Interface for Trusted TLS (spec 009)

Every surface here belongs to the test harness. Nothing is exposed by Hola itself.

## `bin/vm-test-ca`

```
bin/vm-test-ca init [--force]            # create CA in $CA_DIR; refuses if present unless --force
bin/vm-test-ca issue --ip <ip>           # (re)issue the leaf + bundle + spki under $CA_DIR/vms/<ip>/; prints that dir
bin/vm-test-ca spki --ip <ip>            # print base64 SHA-256 SPKI of the leaf
bin/vm-test-ca status                    # print trusted|untrusted and why; exit 0 either way
bin/vm-test-ca --dry-run <cmd>           # print the openssl commands, change nothing
```

**Exit codes:**
- `0` ok.
- `1` failure. A message on stderr names the step.
- `2` `init` refused because the CA already exists.

**Never:** print or copy `ca.key` anywhere.

## Environment

| Variable | Default | Effect |
|---|---|---|
| `VM_TEST_CA_DIR` | `$ROOT_DIR/.devcontainer/.test-ca` | CA location |
| `VM_TRUSTED_TLS` | `1` | `0` forces untrusted mode with the CA present |
| `TRUSTED_TLS_TIMEOUT` | `300` | seconds `tt_wait_trusted` polls before failing |

## `bin/lib/trusted-tls.sh` (sourced)

These are the functions the suites and `app-test.sh` call. Every function is side-effect-free when untrusted, except where stated.

| Function | Untrusted | Trusted |
|---|---|---|
| `tt_enabled` | returns 1 | returns 0 |
| `tt_curl_tls` | echoes `-k` | echoes `--cacert <ca.pem>` |
| `tt_node_tls_env` | echoes `NODE_TLS_REJECT_UNAUTHORIZED=0` | echoes `NODE_EXTRA_CA_CERTS=<ca.pem>` |
| `tt_install_runtime <vmid> <ip>` | no-op | issues leaf/bundle; pushes bundle and shim; merges daemon.json; reloads; asserts `DefaultRuntime=hola-test-ca`; **fails** otherwise |
| `tt_install_traefik_cert <vmid> <ip>` | no-op | pushes leaf into `hola-data`; writes `test-tls.yml` |
| `tt_wait_trusted <url>` | no-op | polls with `--cacert` until it verifies; **fails** on timeout |
| `tt_oidc_probe <vmid> <app> <deploymentId>` | returns 3 (not run) | returns 0 ok, 1 fail, 2 skip (with `TT_PROBE_REASON`/`TT_PROBE_URL` set). Checks the container's recorded runtime and the mounted bundle (PID 1's environment is not readable in many images), then fetches the URL with the app's own runtime; the `curl` (Go) probe passes **no env and no `--cacert`**, proving the system-store overlay that `compose exec` relies on |

**Suite call order (trusted mode).** `tt_install_traefik_cert` + `tt_wait_trusted` run **right after bootstrap and before `verify_stack`**, not after it: `verify_stack` probes the dashboard and now verifies TLS, so the CA-signed certificate has to be in place first.

```
vm-create → vm-wait-ssh → tt_install_runtime → hola bootstrap
         → tt_install_traefik_cert → tt_wait_trusted (dashboard) → verify_stack
         → (catalog: wait for Authentik → tt_wait_trusted auth host) → … app tests …
```

`vm-catalog-test` also re-runs `tt_wait_trusted` after `setup_local_server_image`, which recreates the server container.

## `bin/lib/app-test.sh` additions

- `at_http_code` and `at_cli`/`_at_install_exec` take their TLS flags from `tt_curl_tls`/`tt_node_tls_env`. In untrusted mode the command lines are byte-identical to today's.
- There is a new stage, `sso-trust`, which runs after `verify-up` for apps listed in `oidc-trust.tsv`:
  - **fail** → the app's overall result is FAIL with `AT_LAST_STAGE=sso-trust`;
  - **skip** → the app's overall result is unchanged, and the result line carries a note: `sso-trust: SKIP (trust not covered)`;
  - **not run** → nothing printed.

## `bin/vm-sso-check` (new, opt-in)

```
bin/vm-sso-check --vmid <id> --app <name> [--app <name> …] [--service-worker <path>] [--out <dir>]
```

- It runs on an existing trusted VM, for example one kept by `vm-catalog-test --keep`.
- It installs any named app that is not yet installed, using the same `app-test.sh` install, and leaves installed apps alone.
- `--service-worker <path>` asserts that `navigator.serviceWorker.ready` resolves within 30 s on `https://<app>.<base><path>` (SC-003).

- It requires trusted mode, and exits 1 with a message if untrusted.
- It prints `PASS sso <app>` or `FAIL sso <app> <hop>` per app and writes screenshots to `--out`.
- Exit codes: 0 if all pass, 1 otherwise.

## `bin/vm-catalog-test --keep` (new flag)

When the run ends, the VM is kept rather than destroyed, regardless of the result, and its VMID is printed. Apps are still uninstalled per app, as today.

## `bin/vm-web-check` / `web-check.mjs`

- **Trusted mode:** `WEB_CHECK_SPKI=<hash>` → Chromium gets `--ignore-certificate-errors-spki-list=<hash>` and `ignoreHTTPSErrors: false`.
- **Untrusted:** unchanged.

## On-VM artefacts

These are listed in data-model.md, "VM side". In untrusted mode none are written (FR-018).
