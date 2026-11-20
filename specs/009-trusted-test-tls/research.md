# Research: Trusted TLS on Disposable Test VMs (spec 009)

The decisions below were grounded against the code on 2026-11-18 (`main` @ `df7c642`). File:line anchors are given at that SHA.

## Anchor verification (prompt → reality)

| Prompt claim | Verified | Notes |
|---|---|---|
| `bin/vm-catalog-test:224` renders `ACME_DNS_PROVIDER=` | ✅ | `ACME_CA_SERVER=` is at :223. Env rendered by `setup_render_env` (207-236). |
| `bin/vm-e2e-suite:189` same | ✅ | `ACME_CA_SERVER=` at :188; `step_render_env` (173-200). |
| `bin/lib/app-test.sh:58` `curl -k` | ✅ | Also `NODE_TLS_REJECT_UNAUTHORIZED=0` at :50 (`at_cli`) and :104 (`_at_install_exec`). |
| `bin/lib/web-check.mjs:24-25` `ignoreHTTPSErrors` | ✅ | Chromium launched with no args (:23). |
| `docs/MCP_VM_TESTING.md:278-330` / `:296-300` | ✅ | Section runs 278-332. "self-signed TLS" also at :144. |
| `docker-compose.yml:51-52` file provider dir + watch | ✅ | Dir is on the **named volume** `hola-data` (Traefik mounts it `:ro`, :83). No static `tls.options`/default cert. |
| `routing.ts:28-31` merge comment; server writes only 3 files | ✅ | `routing-map.json` :26, `dynamic.yml` :27, `core.yml` :31. Atomic `.tmp.<uuid>` siblings are renamed. No readdir/unlink of the dir anywhere. |
| `compose-defaults.ts:187` `applyPlatformDefaults` | ✅ | Not used (user decision, see R2). |

**Other insecure-TLS sites the prompt did not list:**
- `bin/vm-e2e-suite:128` (`NODE_TLS_REJECT_UNAUTHORIZED=0`, `api_cli`), `:133` (`curl -k`), `:286` (`NODE_TLS_REJECT_UNAUTHORIZED=0`, `step_install`).
- `bin/vm-catalog-test:161` (`curl -k`, `http_code`).
- `.claude/skills/vm-e2e/SKILL.md:45` (prose).

`packages/cli/src/commands/bootstrap/bootstrap.ts:350` (`curl -sk`, warn-only verify) is product code and is left alone (FR-020).

## R1 — Half 1: deliver the leaf through the watched Traefik directory

**Decision.** After bootstrap, the harness:
1. writes the leaf certificate and key into the `hola-data` volume at `/data/test-tls/{cert,key}.pem`;
2. writes `/data/runtime/traefik/test-tls.yml`:

   ```yaml
   tls:
     stores:
       default:
         defaultCertificate:
           certFile: /data/test-tls/cert.pem
           keyFile: /data/test-tls/key.pem
   ```

It reaches the volume with `docker run --rm -i -v hola_hola-data:/data <an image already on the host> sh -c 'cat > …'`, using the image Traefik or the server already runs. The volume name is resolved with `docker volume ls`/`inspect` rather than hard-coded.

**Rationale.**
- Traefik's file provider watches the whole directory (:51-52) and merges every file in it.
- The server never cleans that directory.
- `routerTlsBlock` (`routing.ts:313-316`) returns `{}` unless `HOLA_TLS_CERT_RESOLVER` is set. That variable is unset on test VMs, so every router kind (app :349, outpost :390, bypass :409, protected-bypass :452, core :486) inherits only the entrypoint's `certresolver=le`. When ACME cannot issue, Traefik serves the default-store certificate for SNI.
- Certificates live outside `runtime/traefik/`, so the provider never tries to parse a PEM.

**To verify on a VM (FR-007).**
- `openssl s_client -servername <host>` against one host of each router kind returns the test leaf.
- The file is picked up with no Traefik restart.

**Alternatives rejected.**
- Putting the PEMs in `/opt/hola/traefik/acme`: that is Traefik's ACME store, and mixing in harness files risks confusing it.
- Changing Traefik's static config: that is a product file (FR-020).

**Side note.** `ACME_CA_SERVER` is empty, so Traefik keeps trying production Let's Encrypt HTTP-01 for every host. That is unchanged from today and harmless (it fails). Changing it would alter the rendered env when the CA is absent, so it is out of scope.

## R2 — Half 2: container trust with no Hola change (user decision)

**Constraint.** On 2026-11-18 the user said "keep it test harness only". The test-only server hook is withdrawn (spec FR-012/FR-013).

**Evidence that per-deployment edits cannot work.** These are the things a pure harness would otherwise try:
- `materializeCompose` rewrites `deployments/<id>/runtime/docker-compose.yml` and `.env` on every start, restart, deploy, rollback and promote (`deployment.ts` ~5729, ~5804). A patch dies on the next server-driven restart, and `at_restart` exercises exactly that.
- Every compose call passes an explicit `-f <runtime>/docker-compose.yml -p hola-<id>` (`docker.ts` :305, :357, :395, :431, :454), so override files are never merged.
- The child env is an allowlist without `COMPOSE_FILE` (`docker.ts:147-196`).
- `hola install --set` reaches only the interpolation `.env`, not container env (`deployment.ts:2689-2717`).
- `docker exec` patching cannot work: Node reads `NODE_EXTRA_CA_CERTS` only at process start, containers are recreated on restart, and gitea's OIDC setup runs inside the deploy job.
- `daemon.json` has no "default mount" or "default env" option.

**Decision: an OCI runtime shim installed as the VM's default Docker runtime.**
- The harness installs `/usr/local/libexec/hola-test-ca-runtime.py`, a small Python 3 script, and in front of it `/usr/local/libexec/hola-test-ca-runtime`, a POSIX `sh` front end, before `hola bootstrap`. The front end is the registered runtime path: it `exec`s the real `runc` directly unless `create` appears as an argv element, so healthcheck `exec`s and every other non-`create` call never start Python (#578). The authoritative argv parse stays in the Python shim; a front-end false positive only costs a Python start.
- It registers the front end in `/etc/docker/daemon.json` (`runtimes.hola-test-ca.path` + `default-runtime: hola-test-ca`) and reloads `dockerd`.
- Docker's containerd shim invokes the runtime binary with runc's CLI. On `create --bundle <dir>`, the shim edits `<dir>/config.json`, then `exec`s the real `runc` with the original arguments. Every other subcommand passes straight through. This is the same mechanism `nvidia-container-runtime` uses to inject devices into every container.
- The edit:
  - appends one read-only bind mount, `/etc/hola-test-ca/bundle.pem` → `/etc/hola-test-ca/bundle.pem` (`rbind`, `ro`);
  - appends `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE` and `REQUESTS_CA_BUNDLE` to `process.env`, all pointing at that path, and only for keys the container does not already set.
- The shim is **inert** when the bundle file is missing or `config.json` cannot be read (passthrough), and the front end is inert when the Python shim or `python3` is missing, so an error *in the shim* can never stop a container from being created. That is a claim about the shim only: what the container then does with what was injected is the container's (see the addendum on the system-store overlay).

**Why this satisfies the requirements.**
- **FR-011 (survives everything):** it sits below Docker's container creation, so every container Hola (re)creates, on any lifecycle path, inherits it. That includes Hola's own server (whose dashboard OIDC discovery fetch, `oidc-provider.ts:142-143`, gains trust too), Traefik and Authentik, all harmlessly, because the bundle is a superset of public roots.
- **FR-020 (nothing under `packages/`):** it touches no Hola package.
- **Unaffected by Hola's mount gate:** `assertResolvedMountsContained` judges the *compose* configuration. The shim acts after compose, at the OCI layer, so the gate neither sees nor needs to allow it. That is acceptable because this is a throwaway VM's runtime, not a product path.
- **Environment caveat:** `docker exec` builds its process env from Docker's container config, not the OCI spec, so an exec'd probe does **not** inherit the injected variables. Probes therefore (a) assert the variables reached PID 1 via `/proc/1/environ` (proving the app process has them), then (b) run with the same variables passed explicitly (`docker exec -e …`).

**Ordering.**
- `default-runtime` applies to containers **created after** the change. Containers record their runtime at creation.
- So the shim is installed right after `vm-wait-ssh` and **before** `hola bootstrap`. The VM's IP is known at that point, so the bundle can be built.
- `dockerd` reloads `runtimes`/`default-runtime` on SIGHUP (`systemctl reload docker`). The harness falls back to `systemctl restart docker` and then checks `docker info --format '{{.DefaultRuntime}}'` equals `hola-test-ca` (FR-004a: fail before bootstrap if not).

**Combined bundle.**
- It is built in the devcontainer: the devcontainer's `/etc/ssl/certs/ca-certificates.crt` plus the test CA certificate.
- It is pushed to `/etc/hola-test-ca/bundle.pem` (0644) on the VM.
- One file serves all three variables. Node tolerates duplicate roots in `NODE_EXTRA_CA_CERTS`, and Go and Python need the full set.

**Addendum (found by running it, see "Spike results" and "Acceptance results").** The three env vars only reach a container's *main* process. Hola runs some apps' post-deploy setup through `docker compose exec` (gitea's `gitea admin auth add-oauth`, a Go binary), and `exec` builds its environment from Docker's config, not the OCI spec, so that process never saw `SSL_CERT_FILE` and failed with `x509: certificate signed by unknown authority`, which is the very failure this feature exists to catch. The shim therefore also overlays the bundle, read-only, on each system trust-store file the image already has (Go, curl and OpenSSL read those by default). Still harness-only and below Hola.

**Narrowing the overlay (#577).** A read-only bind mount over the system store breaks an image that rewrites that store at startup (`update-ca-certificates` gets EROFS/EBUSY; under `set -e` that is a crash loop). A per-image opt-in keyed on the catalog app was the preferred fix, but the shim cannot see the image: the OCI spec Docker generates fills `annotations` only from `HostConfig.Annotations` (`coci.WithAnnotations(c.HostConfig.Annotations)` in moby `daemon/oci_linux.go`, checked at `docker-v29.1.3`), so `config.json` carries no image name and no container labels unless Hola itself set annotations, which would be a product change. The shim therefore skips the overlay (keeping the bundle mount and the env) when a CA-store rewriter (`update-ca-certificates`, `update-ca-trust`, `c_rehash`, `trust extract`) appears in `process.args`, in a script `process.args` names (args[0] resolved via the container's `PATH`, later path-looking args such as a tini chain's target; resolved inside the rootfs, never on the host; binaries are not scanned), or in a well-known entrypoint hook directory (`/docker-entrypoint.d`, `/docker-entrypoint-initdb.d`, `/entrypoint.d`, `/etc/cont-init.d`, `/custom-cont-init.d`, `/etc/s6-overlay/scripts`, `/etc/s6-overlay/s6-rc.d/*/{up,run}`). gitea keeps the overlay: its `process.args` are `/usr/bin/entrypoint /usr/bin/s6-svscan /etc/s6`, and that entrypoint renames users and `exec`s s6 without touching the CA store. A rewriter reached any other way (a helper sourced from elsewhere, a compiled init) is not seen; such an image still gets the overlay and can still fail, and `VM_TRUSTED_TLS=0` remains the escape hatch.

**Risk and fallback.** If the shim proves non-viable on the VM's Docker version (spike task T001), the run **stops and reports**. It does not fall back to a server hook, because the user ruled that out.

**Alternatives rejected.**
- **Test-only server hook:** user decision.
- **Re-tagging images with the CA baked in:** `composePull` re-pulls before every up.
- **Wrapping `docker` inside hola-server:** that modifies the product image.
- **A `docker-compose.test-ca.yml` overlay via `COMPOSE_FILE`:** it only reaches Hola's own stack, not apps. It isn't needed either, because the shim covers the server too.

## R3 — Per-bundle expectation table (FR-014)

| Bundle | OIDC back-channel service | Runtime | Mechanism | Expected |
|---|---|---|---|---|
| gitea | `gitea` | Go (Alpine) | `SSL_CERT_FILE` (replaces roots → combined bundle) | covered |
| immich | `immich-server` | Node 24 | `NODE_EXTRA_CA_CERTS` | covered |
| postiz | `postiz` | Node 22 | `NODE_EXTRA_CA_CERTS` | covered |
| actual-budget | `actual-budget` | Node 24 | `NODE_EXTRA_CA_CERTS` | covered |
| mealie | `mealie` | Python 3.14 | `SSL_CERT_FILE` + `REQUESTS_CA_BUNDLE` | covered |
| hangar | `hangar` | Python 3.12 (Debian 13, FastAPI/uvicorn; Authlib over httpx 0.28) | `SSL_CERT_FILE` (httpx's `trust_env` path; without it httpx would use certifi's bundle) | covered (#576) |

The table lives as data in the harness (`bin/lib/oidc-trust.tsv`) so `app-test.sh` reads one source. The docs reproduce it.

## R4 — In-container discovery probe (FR-015)

- The ideal target is the app's own discovery document, `https://auth.<base>/application/o/<slug>/.well-known/openid-configuration`. The provider slug is Hola's provisioning detail, though, and not reliably known to the harness.
- **Decision:** the probe fetches the discovery document when an issuer URL is visible in the container's PID-1 env (`*ISSUER*`/`OIDC_*`/`*_DISCOVERY*`). Otherwise it fetches `https://auth.<base>/-/health/live/`. Both go through the same Traefik router and the same TLS handshake, so either proves the container trusts the CA. The report names which URL was used.
- The probe runs the app's **own runtime** with the injected env, using `docker exec -e …`:
  - Node: `node -e "fetch(u).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"`.
  - Python: `python3 -c "import urllib.request,sys;urllib.request.urlopen(sys.argv[1])" u`.
  - Go (gitea): the image ships `curl`. The probe uses `curl --cacert "$SSL_CERT_FILE"`, and the Go app's own proof is the full login (R5).
- The TSV gives the probe kind per bundle.
- **Result mapping (Clarifications Q2):**
  - covered and fail → FAIL (stage `sso-trust`);
  - not covered or unverified → SKIP (`trust not covered`);
  - trusted mode off → step not run.

## R5 — Full headless SSO login (FR-016)

- **New script:** `bin/vm-sso-check --app <gitea|immich|mealie|…>`. It is opt-in and not part of `vm-catalog-test`'s default sweep.
- It generalizes the scratchpad Playwright flow that already logged into immich through Authentik: app login page → "Login with authentik" → `uidField` → password → consent → app session → an authenticated API call.
- **Credentials:** `akadmin`, with the password read from `AUTHENTIK_BOOTSTRAP_PASSWORD` in `/opt/hola/.env` over `vm-ssh`. It is never printed and is held only in the process env.
- **Per-app recipes:**

  | App | Login entry | Authenticated probe |
  |---|---|---|
  | gitea (Go) | `/user/login` | `/api/v1/user` |
  | immich (Node) | `/auth/login` | `/api/users/me` |
  | mealie (Python) | `/login` | `/api/users/self` |
  | hangar (Python) | `/` (the SPA's "Sign in with SSO" link to `/auth/login`) | `/api/v1/me` (added for #576) |

## R6 — Browser trust and service workers (FR-017)

**Decision.** In trusted mode, `web-check.mjs` and `vm-sso-check`:
- launch Chromium with `--ignore-certificate-errors-spki-list=<base64 sha256 of the leaf's SPKI>`;
- set `ignoreHTTPSErrors: false`.

The web-platform-tests runner uses this same flag to give Chromium a trusted test CA, and pages served with a listed SPKI are treated as secure contexts, so service workers register.

**Fallback.** If EffectCraft's service worker does not register under the flag (verified in quickstart), use an NSS DB (`certutil -A -d sql:$HOME/.pki/nssdb -t C,, -i ca.pem`) with a dedicated `userDataDir`.

The SPKI hash comes from `bin/vm-test-ca spki`.

## R7 — CA lifecycle and harness CLIs (FR-001..004, FR-008/009)

- **`bin/vm-test-ca`** has these subcommands:
  - `init [--force]`: RSA-3072 CA, 10 years, `CA:TRUE`, `keyUsage=keyCertSign,cRLSign`.
  - `issue --ip <ip> --out <dir>`: 365-day leaf with SAN `DNS:<ip>.sslip.io, DNS:*.<ip>.sslip.io`, `extendedKeyUsage=serverAuth`, plus the combined bundle.
  - `spki <cert>`.
  - `status`.
- The CA is stored in `CA_DIR="${VM_TEST_CA_DIR:-$ROOT_DIR/.devcontainer/.test-ca}"`, set in `_common.sh` next to `KEYS_DIR`. It is gitignored. The key is 0600 and the directory 0700.
- **Trusted mode:** `[[ -f $CA_DIR/ca.pem && ${VM_TRUSTED_TLS:-1} != 0 ]]`.
- **`bin/lib/trusted-tls.sh`** is sourced. Its helpers:
  - `tt_enabled`;
  - `tt_curl_tls`: echoes `--cacert <ca>` or `-k`;
  - `tt_node_tls_env`: `NODE_EXTRA_CA_CERTS=<ca>` or `NODE_TLS_REJECT_UNAUTHORIZED=0`. Bun 1.4 honours `NODE_EXTRA_CA_CERTS`; verify in T001.
  - `tt_install_runtime`;
  - `tt_install_traefik_cert`;
  - `tt_wait_trusted`;
  - `tt_oidc_probe`.
- **Untrusted mode** keeps today's exact flags (FR-018). In trusted mode no `-k`/`NODE_TLS_REJECT_UNAUTHORIZED` path runs (SC-001). `bootstrap.ts`'s own `curl -sk` runs on the VM inside product code and is out of scope; the docs record it.
- **`tt_wait_trusted`** polls `curl --cacert <ca> -fsS https://auth.<base>/-/health/live/`, which is Authentik's own liveness endpoint. It runs every 5 s for up to `TRUSTED_TLS_TIMEOUT=300`, and on timeout fails naming the step.
- **`vm-e2e-suite`** is `mode=none`, so there is no `auth.` host. Its wait targets `apps.<base>/` instead (the dashboard).

## R8 — Testing the harness

- **There is a precedent:** `bin/lib/app-test.selftest.sh` stubs the VM and the CLI and runs in milliseconds.
- **New selftests:**
  - `bin/lib/trusted-tls.selftest.sh`. It covers:
    - mode detection;
    - flag selection (`-k` iff untrusted);
    - the `VM_TRUSTED_TLS=0` override;
    - FR-004a (failures abort);
    - the SSO-trust result mapping (FAIL/SKIP/not run).
  - `bin/lib/test-ca-runtime.selftest.sh`. It runs the shim against a fake bundle dir and a fake `runc` that dumps its args and the config. It asserts:
    - the mount and env are added on `create`;
    - existing env keys are not overridden;
    - non-`create` subcommands and a missing bundle file are pure passthrough;
    - argv reaches runc byte-for-byte;
    - the system-store overlay is applied to the gitea shape and skipped for each rewriter signal (#577);
    - the `sh` front end sends non-`create` calls (a healthcheck-style `exec` included) straight to runc without starting Python, routes `create` through the Python shim, and the argv is byte-identical through both layers (#578).
  - `bin/vm-test-ca` selftest, in a temp dir: init, refuse to overwrite, `--force`, issue (SANs and validity checked with `openssl x509 -text`), `spki` hash stable, bundle = system roots + CA.
- **"Absent ⇒ unchanged" (FR-018/SC-004):** a selftest renders the env and the command lines with the CA absent and diffs them against a golden copy captured from today's scripts.
- **Product suites:** `bun run test` etc. are unaffected (no `packages/` change) but are still run once as the gate.

## Spike results (T001)

Run 2026-11-18 on a fresh disposable VM (Ubuntu 24.04 template, 8 GiB RAM, 19 GB disk), Authentik mode, `hola bootstrap` of 0.11.0-rc.12. **Gate result: PASS. The shim and the Traefik default-certificate fallback both work; implementation proceeds. No server hook, nothing under `packages/`.**

**Versions on the VM:** Docker 29.1.3 (`29.1.3-0ubuntu3~24.04.2`), containerd 2.2.1, runc 1.3.4 at `/usr/sbin/runc` (not `/usr/bin/runc`; the shim searches `/usr/bin`, `/usr/sbin`, `/usr/local/bin`, then `PATH`), Python 3.12.3 with the full stdlib. Traefik `traefik:v3.5`.

| # | Assumption | Result | Evidence |
|---|---|---|---|
| 3a | Pushing bundle + shim + merged `daemon.json`, then `systemctl reload docker` (no restart needed) makes the shim the default runtime | **PASS** | `docker info --format '{{.DefaultRuntime}}'` → `hola-test-ca` straight after `reload`. |
| 3b | `docker run --rm alpine` sees the three env vars on PID 1 and the read-only file | **PASS** | `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE` all `=/etc/hola-test-ca/bundle.pem`; the file is mounted (121 certs) and `touch` on it fails with "Read-only file system" even under `--read-only`. |
| 4 | After `hola bootstrap` (Authentik mode) every Hola container carries the runtime + vars | **PASS** | `hola-server`, `traefik`, `authentik-server` have `HostConfig.Runtime=hola-test-ca` and all three vars on PID 1. App containers (remo, calibre-web) also report `Runtime=hola-test-ca`. |
| 5 | Default-store cert dropped into the watched dir, **no Traefik restart**, is served for every router kind | **PASS** | Written into volume `hola_hola-data` (`/test-tls/{cert,key}.pem`, `/runtime/traefik/test-tls.yml`) in 2.3 s. `openssl s_client -servername` returned issuer `CN = Hola Test CA` (subject `*.192.168.1.130.sslip.io`) for: core `apps.<base>`, `auth.<base>`, `traefik.<base>`; forward-auth app host (`calibre-web`, `remo`); **plain bypass** (`remo` `/api/v1/setup/`, router `remo-…-bypass-0`); **protected bypass** (`calibre-web` `/opds`, `/kobo/`, routers `…-protected-bypass-0/1`); **outpost** (`/outpost.goauthentik.io/ping`, HTTP 204). `curl --cacert ca.pem` reports `ssl_verify_result=0` on all of them. (Hindsight, the catalog's other bypassPaths app, could not be used: its API container never became healthy on a 2-CPU VM, unrelated to TLS. `remo` and `calibre-web` cover the same router kinds.) |
| 6 | Bun verifies with `NODE_EXTRA_CA_CERTS` and no `NODE_TLS_REJECT_UNAUTHORIZED` | **PASS** | Bun 1.4.4: `hola catalog --json` succeeded with `NODE_EXTRA_CA_CERTS=ca.pem`; the control without it failed with `unable to verify the first certificate`. So no R7 fallback is needed for the CLI. |

**Findings that change details (none change the design):**
1. **`/proc/1/environ` is not a reliable probe.** In containers whose PID 1 is non-root (nginx-unprivileged for `remo`) even `docker exec -u 0` gets "Permission denied" (no `CAP_SYS_PTRACE`), and s6-overlay images (`calibre-web`) scrub PID 1's environment. R4's "assert the vars reached PID 1" is therefore replaced by two checks that always work: the container's recorded `HostConfig.Runtime` is `hola-test-ca`, and the bundle file is present and non-empty inside it. The vars themselves are proven by the probe (passed explicitly with `docker exec -e`, R2) and, per app, by the full login in `vm-sso-check`.
2. **A transient first `hola bootstrap` failure** ("Install failed", before any container was created) was not reproducible: re-running `scripts/install.sh` by hand on the same VM succeeded with the shim already active. Not attributed to the shim (nothing had been created when it failed); recorded in case it recurs.
3. **The Proxmox API host `lab1` does not resolve from this devcontainer**; the harness helpers work with `PROXMOX_API_URL=https://<lab1 tailnet IP>:8006` exported (an operator environment fact, not a harness change).
4. **The devcontainer's `python3` is `python3-minimal` (no `json` module).** The on-VM shim is unaffected (the VM has the full stdlib); the offline shim selftest looks for a full python (`HOLA_SELFTEST_PYTHON`, `python3`, or the uv-managed interpreter).
5. Install of a fresh app raced once on the known first-deploy ENOENT (`calibre-web` attempt 1 `failed`, attempt 2 `completed`), unchanged product behaviour that `at_install` already retries.

## Acceptance results

Run 2026-11-18 on `main` @ `df7c642` + this branch, Docker 29.1.3 / containerd 2.2.1 / runc 1.3.4, Hola 0.11.0-rc.12 (the released server image, no `--server-image local`), 8 GiB VMs. Disk on the acceptance VM was grown to ~45 GB (`qm resize` + `growpart`) so the five-app sweep did not hit the 19 GB template disk. Environment note: `lab1` does not resolve in this devcontainer, so every helper ran with `PROXMOX_API_URL=https://<lab1 tailnet IP>:8006` exported.

### §3, SC-001 and SC-005: catalog run in trusted mode

`bin/vm-catalog-test --apps gitea,immich,mealie,postiz,actual-budget --restart --keep --memory 8192` (stdout, verbatim):

```
# catalog sweep: 5 app(s) on VM 104 (mode=authentik, restart=1)
PASS actual-budget    (0m35s)
PASS gitea            (1m21s)
PASS immich           (1m56s)
PASS mealie           (1m11s)
PASS postiz           (4m30s)
  5 app(s): 5 passed, 0 failed, 0 skipped
```

- **SC-001: PASS.** 5/5 PASS, no `sso-trust` FAIL, and `grep -rn -- ' -k \|NODE_TLS_REJECT_UNAUTHORIZED' logs/vm-catalog-test/` printed nothing. The setup log shows `trusted TLS: on`, `runtime shim active … DefaultRuntime=hola-test-ca`, and `https://auth.<base>/-/health/live/ verifies against the test CA`.
- **SC-005: PASS.** With `--restart` each app's `sso-trust` probe ran, the server restarted it (recreating its containers and re-materialising the compose), and the probe ran again and passed: gitea, immich, mealie, postiz, actual-budget (per-app `run.log`: `[<app>] sso-trust: ok` and `[<app>] sso-trust (after restart): ok`). mealie and actual-budget fetched their real OIDC discovery document (`…/application/o/hola-<app>-<id>/.well-known/openid-configuration`); gitea, immich and postiz used Authentik's liveness URL (their env names no issuer), and the report names which. The upgrade variant was not run in this acceptance pass; restart is the stated primary coverage. It was verified afterwards (see "SC-005, upgrade variant" below).
- Not exercised here: `hangar` (then `unverified` in `bin/lib/oidc-trust.tsv`, so SKIP: `trust not covered`; T021 therefore changed nothing). Covered since by #576, below.

### SC-005, upgrade variant (#576)

Not re-run for #576; it had already been verified twice on trusted-TLS VMs, with gitea as the subject (a one-way-migration major upgrade, which recreates the containers on a new image as well as re-materialising the compose):
- **try-hola/apps#192** (2026-11-18, Hola 0.11.0-rc.12, Authentik mode, trusted TLS): gitea bundle 2.0.2 (Gitea 1.27.3) → `hola upgrade --app-version 3.0.0-rc.1 --snapshot` (Gitea 28.4) gave `Done (completed)`; `bin/vm-sso-check --app gitea` gave `PASS sso gitea` on 1.27 before the upgrade **and** on 28.4 after it (OAuth source still exactly one, the SSO user not duplicated). `hola restart` + `PASS sso gitea` and a fresh 3.0.0-rc.1 install + `PASS sso gitea` passed on the same VM. The evidence table is in that PR's body.
- **try-hola/hola#586** (VM tests, Authentik mode, trusted TLS): gitea 2.0.2 → 3.0.0 `--snapshot` with `PASS sso gitea` before the upgrade, then a data-aware rollback (`--restore-data`) back to 2.0.2 with `PASS sso gitea` again after it.

**SC-005 (upgrade): PASS** on that evidence. The issue named immich as the subject; gitea is the stronger case (Go, the bundle that needed the system trust-store overlay, and an upgrade that crosses one-way migrations).

### hangar (#576): runtime recorded, trust covered

Image `ghcr.io/get2knowio/hangar:0.3.11@sha256:fd57a43e…` (bundle 1.4.10), inspected locally: Debian 13, **Python 3.12.13**, OpenSSL 3.5.6, `uvicorn hangar.main:app`, runs as the non-root `hangar` user. The OIDC back-channel (discovery, token exchange, JWKS) is made by the **`hangar`** service through **Authlib's Starlette client over httpx 0.28.1** (`hangar/auth/oidc.py`: `server_metadata_url = <HANGAR_OIDC_ISSUER>/.well-known/openid-configuration`). httpx's `create_ssl_context` with the defaults (`verify=True`, `trust_env=True`) loads `SSL_CERT_FILE` when it is set and otherwise **certifi's** bundle, not the system store, so the shim's `SSL_CERT_FILE` is the mechanism (the system-store overlay alone would not reach it). `hangar-init` is a one-shot `chown` and makes no network call. The row is now `hangar	hangar	python	python	covered`; the `python` probe (urllib, same OpenSSL, same `SSL_CERT_FILE`) fits, and the full login proves httpx itself.

`bin/vm-catalog-test --apps hangar --restart --keep` (trusted mode, VM 101, Hola 0.11.0-rc.13), stdout excerpt:

```
# catalog sweep: 1 app(s) on VM 101 (mode=authentik, restart=1)
PASS hangar           (0m44s)
  1 app(s): 1 passed, 0 failed, 0 skipped
```

No `[sso-trust: SKIP …]` note on the line. `run.log`:

```
[hangar] sso-trust: ok (https://auth.<base>/application/o/hola-hangar-77339d74/.well-known/openid-configuration)
[hangar] sso-trust (after-restart): ok (https://auth.<base>/application/o/hola-hangar-77339d74/.well-known/openid-configuration)
```

The probe fetched hangar's real discovery document (the issuer from `HANGAR_OIDC_ISSUER`), not the liveness fallback. Then `bin/vm-sso-check --vmid 101 --app hangar` → `PASS sso hangar`: `/` → "Sign in with SSO" → Authentik (akadmin) → back on `/`, `GET /api/v1/me -> 200`. That route answers `401` without a session (checked with `curl --cacert`, `ssl_verify_result=0`), and the hangar container logged `auth.oidc_login actor=akadmin`, so the server-side httpx token exchange verified Authentik's certificate. The container's `HostConfig.Runtime` was `hola-test-ca`. `sso-login.mjs` gained a `hangar` recipe (`login: '/'`, `check: '/api/v1/me'`).

### §4, SC-002: full SSO per runtime

`bin/vm-sso-check --vmid 104 --app gitea --app immich --app mealie` on the kept VM, exit 0:

```
PASS sso gitea
PASS sso immich
PASS sso mealie
```

**SC-002: PASS.** Go (gitea, authenticated page `/user/settings`), Node (immich, `/api/users/me` 200 as the OAuth user) and Python (mealie, `/api/users/self`), each through the app's login page, Authentik (akadmin + consent) and back, with TLS verified (Chromium given the leaf's SPKI, `ignoreHTTPSErrors: false`).

### §5, SC-003: service worker

`bin/vm-sso-check --vmid 104 --app craft-apps --service-worker /effectcraft/` → `PASS sso craft-apps`, log: `isSecureContext=true`, `service worker ready, scope https://craft-apps.<base>/effectcraft/`. **SC-003: PASS** under the SPKI flag; the NSS-DB fallback (R6) was not needed.

### §6, SC-004: absent ⇒ unchanged

`VM_TRUSTED_TLS=0 bin/vm-catalog-test --apps uptime-kuma --keep` on a separate VM: `PASS uptime-kuma (0m56s)`, summary `1 app(s): 1 passed, 0 failed, 0 skipped`; the setup line was `trusted TLS: off (VM_TRUSTED_TLS=0)`. On the VM: `/etc/hola-test-ca`, `/usr/local/libexec/hola-test-ca-runtime`, `/etc/docker/daemon.json` and the `test-tls` volume paths do **not** exist, `docker info` reports `default-runtime=runc`, and `hola-server`/`traefik` have `HostConfig.Runtime=runc`. **SC-004: PASS** (the golden selftest covers the command lines offline).

### Setup cost (plan goal: trusted-mode setup adds ≤ 60 s)

Measured on a settled VM: `tt_install_runtime` 23.7 s (of which 20 s is the post-cloud-init stability window; push + merge + reload ≈ 3.7 s), `tt_install_traefik_cert` 2.3 s, `tt_wait_trusted` 0.04 s, plus one verified wait on the auth host: **about 26 s, within the 60 s goal**. On a *fresh* template VM `tt_install_runtime` also blocks until the first-boot cloud-init finishes (see below), which is environment time the old flow spent as a failed or flaky bootstrap.

### Findings during acceptance (all fixed inside the harness)

1. **gitea's OIDC setup failed with `x509: certificate signed by unknown authority`.** Hola runs it through `docker compose exec`, and `exec` does not see the shim's env. Fixed in the shim (it now also overlays the system trust-store files the image has); gitea then installed and logged in. The `sso-trust` curl probe passes no env and no `--cacert` for exactly this reason.
2. **A fresh template VM reboots mid-`hola bootstrap`.** cloud-init's package upgrade (it installed a new kernel and wrote `/var/run/reboot-required`) rebooted the VM a few minutes after SSH first answered; that killed `install.sh` ("Install failed", then `Connection refused`) on the first two VMs (confirmed on the second: the VM's uptime had reset and `/var/run/reboot-required` existed). Pre-existing (see the vm-e2e skill's "SSH can go refused again"), not caused by the shim. `tt_install_runtime` now waits for cloud-init to finish and the VM to stay up for 20 s first (trusted mode only; untrusted flow untouched).
3. **`verify_stack` had to move after the Traefik certificate step** (it now verifies TLS); see the contract.
4. **Fresh immich redirects every visitor to `/auth/register`**; `sso-login.mjs` creates a throwaway admin through immich's own API before the OAuth login.
5. **`bin/vm-web-check` is unchanged in what it can do on an Authentik-mode VM**: it signs in with the admin key, but an Authentik-mode dashboard presents Authentik's login instead, so the existing check times out on its sign-in click in trusted and untrusted mode alike. Trusted-mode TLS itself was verified: it loads the dashboard (`HTTP 200 title="Hola"`) with errors not ignored, and a wrong SPKI fails with `ERR_CERT_AUTHORITY_INVALID`.
