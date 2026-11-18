---
description: "Task list for spec 009, trusted TLS on disposable test VMs"
---

# Tasks: Trusted TLS on Disposable Test VMs

**Input**: Design documents from `specs/009-trusted-test-tls/`: plan.md, spec.md, research.md, data-model.md, contracts/harness-interface.md, quickstart.md

**Tests**: The spec requires test-backed verification. FR-002, FR-004/004a, FR-010, FR-015 and FR-018 each get an offline selftest, following the `bin/lib/app-test.selftest.sh` precedent: stubbed, no VM, milliseconds. The VM acceptance run is quickstart.md.

**Hard rules for every task:**
- Change **nothing under `packages/`** (FR-020, user decision).
- Never print or push `ca.key`. Never print secret values from `.devcontainer/*.env` or `/opt/hola/.env`.
- Untrusted mode must stay byte-identical to today's behaviour (FR-018).
- Deferred work becomes a `gh issue create`, never an inline TODO.
- Destroy every VM you create (`bin/vm-destroy --vmid <id> --yes`), unless a task says to keep it. Destroy it at the end in that case too.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Spike (GATE: blocks everything that depends on the shim or the default certificate)

- [X] T001 VM spike: prove the three load-bearing assumptions before building on them, following quickstart.md §2 and research.md R1/R2/R7.
  1. Write a first working version of the OCI runtime shim at `bin/lib/test-ca-runtime.py`, per data-model.md "Container side" and research R2.
  2. Generate a throwaway CA and leaf by hand with `openssl`, in the scratchpad, not in `.devcontainer/`.
  3. On a fresh VM (`bin/vm-create` → `bin/vm-wait-ssh`), before bootstrap:
     - push the bundle to `/etc/hola-test-ca/bundle.pem` and the shim to `/usr/local/libexec/hola-test-ca-runtime`;
     - merge `/etc/docker/daemon.json`;
     - `systemctl reload docker`, falling back to `restart`;
     - assert that `docker info --format '{{.DefaultRuntime}}'` is `hola-test-ca`;
     - assert that `docker run --rm alpine` sees all three env vars on PID 1 and the read-only file.
  4. Bootstrap in Authentik mode, as `bin/vm-catalog-test`'s `setup_render_env` does. Assert that the hola-server container's PID 1 has the vars.
  5. Write the leaf into the `hola-data` volume at `/test-tls/` and `test-tls.yml` into `/runtime/traefik/`. **Without** restarting Traefik, check with `openssl s_client -servername` that `apps.<base>`, `auth.<base>`, an installed forward-auth app's host, a bypass path (`bypassPaths`, e.g. hindsight's `/v1/`), a protected-bypass path, and the `/outpost.goauthentik.io/` path all present the test CA's leaf. Find which catalog app emits a protected-bypass router from `packages/server/src/services/core/routing.ts` (~:452) and the catalog manifests.
  6. From the devcontainer, check whether `NODE_EXTRA_CA_CERTS=<ca.pem> bun --cwd packages/cli src/index.ts --url https://apps.<base> …` verifies without `NODE_TLS_REJECT_UNAUTHORIZED`.
  7. Record every result (pass/fail, Docker/containerd versions, exact commands) in a new `## Spike results (T001)` section at the end of `specs/009-trusted-test-tls/research.md`.
  8. **If the shim or the default-certificate fallback fails: STOP the whole implementation and report. Do NOT add a server hook or touch `packages/`.** If only the Bun check fails, continue with the R7 fallback (`NODE_TLS_REJECT_UNAUTHORIZED=0` for the CLI only) and note it.
  9. Destroy the VM.

> **Implementation notes (2026-11-18).** All tasks done. Deviations from the design, each recorded in research.md: (1) the shim also overlays the image's system trust-store files, because `compose exec` processes (gitea's OIDC setup) never see the injected env; (2) `tt_install_traefik_cert` + `tt_wait_trusted` run right after bootstrap and before `verify_stack`, not after it; (3) `tt_install_runtime` first waits for the VM's first-boot cloud-init to finish (a mid-bootstrap reboot killed `install.sh`); (4) `tt_oidc_probe` proves shim application via the container's recorded runtime + mounted bundle (PID 1's environ is unreadable in many images) and the Go/curl probe passes no env; (5) T001's spike VM stayed up through development and was destroyed after T001 results were recorded. Issues filed for deferred work: #574 (cloud-init wait for untrusted flows), #575 (vm-web-check on Authentik-mode VMs), #576 (hangar trust coverage, upgrade-path variant of SC-005, product `curl -sk`).

## Phase 2: Setup

- [X] T002 [P] Add `.devcontainer/.test-ca/` to `.gitignore`, next to the existing `.devcontainer/.vm-keys/` entry (around line 47).
- [X] T003 [P] In `bin/_common.sh`, next to `KEYS_DIR` (lines 9-14), add `CA_DIR="${VM_TEST_CA_DIR:-$ROOT_DIR/.devcontainer/.test-ca}"`.
- [X] T004 [P] Create `bin/lib/oidc-trust.tsv`, the per-bundle expectation table from research.md R3, with columns `app service runtime probe expected`. Rows: gitea/gitea/go/curl/covered, immich/immich-server/node/node/covered, postiz/postiz/node/node/covered, actual-budget/actual-budget/node/node/covered, mealie/mealie/python/python/covered, hangar/hangar/unknown/none/unverified. Add a header comment explaining the columns and that it is harness test data (FR-014).

## Phase 3: Foundational (CA tooling + the `tt_*` library; blocks US1–US3)

- [X] T005 Implement `bin/vm-test-ca`, per contracts/harness-interface.md and research R7. It sources `bin/_common.sh` and supports `--dry-run`.
  - `init [--force]`: RSA-3072 CA, 10 years, `basicConstraints=critical,CA:TRUE`, `keyUsage=critical,keyCertSign,cRLSign`. Directory 0700, `ca.key` 0600. Exits 2 if the CA exists without `--force`.
  - `issue --ip <ip>`: writes `$CA_DIR/vms/<ip>/{cert.pem,key.pem,bundle.pem,spki.txt}`. The leaf is valid 365 days, with SAN `DNS:<ip>.sslip.io,DNS:*.<ip>.sslip.io` and EKU `serverAuth`. It re-issues the leaf when it is absent or has fewer than 30 days left. The bundle is `/etc/ssl/certs/ca-certificates.crt` + `ca.pem`. The SPKI is the base64 SHA-256 of the DER public key.
  - `spki --ip <ip>`.
  - `status`: prints `trusted`/`untrusted` and the reason.
  - It never prints `ca.key`.
- [X] T006 [P] Selftest `bin/vm-test-ca.selftest.sh`. It sets `VM_TEST_CA_DIR` to a temp dir and asserts:
  - init creates files with the right modes;
  - a second init exits 2 and leaves `ca.key` byte-identical (FR-002);
  - `--force` replaces it;
  - issue produces a leaf whose SANs and validity match (`openssl x509 -noout -ext subjectAltName -enddate`) and which verifies against `ca.pem` (`openssl verify`);
  - the bundle contains the system roots plus the CA;
  - `spki` is stable across calls;
  - no output line contains the key's PEM body (FR-003).
- [X] T007 Finalise the shim `bin/lib/test-ca-runtime.py` from the T001 version. It has three behaviours:
  - **`create`:** for runc's `create` subcommand only, locate `--bundle <dir>` (also `-b`, and the cwd default per runc semantics), then edit `config.json` atomically:
    - append the `rbind,ro` mount for `/etc/hola-test-ca/bundle.pem`, unless a mount with that destination already exists;
    - append the three env vars only for keys absent from `process.env`.
  - **passthrough:** `os.execv` the real runc (`/usr/bin/runc`, overridable by the `HOLA_TEST_CA_REAL_RUNC` env var, for tests) with the original argv unchanged.
  - **inert:** pure passthrough when the bundle file is missing or `config.json` is unreadable. It must never block container start, and writes a diagnostic to stderr only.
- [X] T008 [P] Selftest `bin/lib/test-ca-runtime.selftest.sh`, using a fake runc that dumps its argv and the bundle's `config.json` to a temp file, a temp bundle dir and a temp CA-bundle path (made overridable via an env var for the test only). It asserts:
  - on `create`, the mount and all three env vars are added;
  - a pre-set `SSL_CERT_FILE` is kept;
  - running twice doesn't duplicate the mount;
  - `start`/`delete`/`state`/`--version` don't touch `config.json`;
  - with the bundle file missing, `config.json` is unchanged;
  - argv reaches runc byte-for-byte in all cases (FR-010, FR-011 mechanism).
- [X] T009 Implement `bin/lib/trusted-tls.sh`, sourced, per the contract table:
  - `tt_enabled` (`[[ -f $CA_DIR/ca.pem && ${VM_TRUSTED_TLS:-1} != 0 ]]`), `tt_curl_tls`, `tt_node_tls_env`;
  - `tt_install_runtime <vmid> <ip>`: calls `vm-test-ca issue`, pushes the bundle and shim via `"$BIN_DIR/vm-ssh" --vmid … -- 'sudo …'` over stdin (no scp), merges daemon.json with python3 (preserving keys), reloads or restarts, and asserts `DefaultRuntime`;
  - `tt_install_traefik_cert <vmid> <ip>`: resolves the `hola-data` volume by `docker volume ls --filter name=hola-data`, and writes the PEMs and `test-tls.yml` via `docker run --rm -i -v <vol>:/data <image already on host, e.g. the traefik image from docker ps> sh -c 'cat > …'`;
  - `tt_wait_trusted <url>`: `curl --cacert -fsS` every 5 s up to `TRUSTED_TLS_TIMEOUT`;
  - `tt_oidc_probe <vmid> <app> <deploymentId>`: implements research R4 and the data-model result table, returning 0/1/2/3 and setting `TT_PROBE_REASON`/`TT_PROBE_URL`.

  Every helper except the predicates must `return 1` with a message naming the step on failure (FR-004a). When untrusted, every helper is a no-op or returns today's exact flags.
- [X] T010 [P] Selftest `bin/lib/trusted-tls.selftest.sh`, with stubs for `vm-ssh`/`vm-test-ca`/curl. It covers:
  - **mode detection:** CA absent → untrusted; CA present → trusted; CA present with `VM_TRUSTED_TLS=0` → untrusted (FR-004);
  - **flags:** `tt_curl_tls` is `-k` iff untrusted; `tt_node_tls_env` likewise;
  - **untrusted:** `tt_install_*`/`tt_wait_trusted` invoke no stub at all;
  - **FR-004a:** a stubbed failure in `issue`, in the push, in the DefaultRuntime check, or a wait timeout (with `TRUSTED_TLS_TIMEOUT=1`), each returns non-zero with a message naming the step;
  - **probe mapping:** covered+ok → 0; covered+fail → 1; unverified → 2 with `TT_PROBE_REASON` "trust not covered"; app absent from the TSV → 3; untrusted → 3 (FR-015).

**Checkpoint:** `bash bin/vm-test-ca.selftest.sh && bash bin/lib/test-ca-runtime.selftest.sh && bash bin/lib/trusted-tls.selftest.sh && bash bin/lib/app-test.selftest.sh` all exit 0.

## Phase 4: User Story 1, harness-verified TLS on every endpoint (P1) 🎯 MVP

**Goal**: Traefik serves the CA-signed leaf, and the harness's own probes verify it instead of skipping verification.

**Independent test**: quickstart §3's grep finds no `-k`/`NODE_TLS_REJECT_UNAUTHORIZED` in a trusted run; quickstart §6 is unchanged.

- [X] T011 [US1] Capture the FR-018 golden **before editing any suite**. Create `bin/lib/untrusted-golden.selftest.sh`. It sources each suite's env-render function and the TLS-bearing helpers (`at_http_code`, `at_cli`, `_at_install_exec`, vm-e2e-suite's `api_cli`/`http_code`/`step_install` command construction, vm-catalog-test's `http_code`) with `vm-ssh`/`bun`/`curl` stubbed to echo their argv. It records the rendered `hola.env` and the argv into `bin/lib/testdata/untrusted-golden.txt`, with fixed IP/keys, generated now from today's unmodified scripts. On later runs it diffs against that file. It runs with the CA absent (`VM_TEST_CA_DIR` set to an empty temp dir).

  If a suite isn't sourceable without running, add a minimal `if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi` guard. Commit that guard only if the golden output is unchanged by it.
- [X] T012 [US1] Edit `bin/lib/app-test.sh`:
  - source `bin/lib/trusted-tls.sh`;
  - `at_http_code` (:58) uses `$(tt_curl_tls)`;
  - `at_cli` (:50) and `_at_install_exec` (:104) use `$(tt_node_tls_env)` (or the T001 Bun fallback);
  - keep argv byte-identical when untrusted (T011 must still pass).
- [X] T013 [US1] Edit `bin/vm-catalog-test`:
  - `http_code` (:161) uses `tt_curl_tls`;
  - add `setup_trust_runtime` (calls `tt_install_runtime`) between `vm-wait-ssh` and `setup_bootstrap`;
  - add `setup_trust_traefik` (`tt_install_traefik_cert` + `tt_wait_trusted https://auth.$DOMAIN_BASE/-/health/live/`) after `setup_verify_stack`;
  - re-run `tt_wait_trusted` after `setup_local_server_image`;
  - any of these failing fails setup before any app is installed (FR-004a);
  - add a `--keep` flag (never destroy the VM at the end; print the VMID) and document it in the usage header;
  - print one setup line `trusted TLS: on (CA <fingerprint short>)` or `trusted TLS: off (<reason>)` to stderr, never stdout, so the terse stdout contract is unchanged when untrusted.
- [X] T014 [US1] Edit `bin/vm-e2e-suite`:
  - `api_cli` (:128), `http_code` (:133) and `step_install` (:286) use the `tt_*` helpers;
  - add `step_trust_runtime` before `step_bootstrap`;
  - add `step_trust_traefik` + `tt_wait_trusted https://apps.$DOMAIN_BASE/` after `step_verify_stack` (mode=none has no auth host, research R7);
  - fix the dry-run text at :330 to reflect the chosen flag.
- [X] T015 [US1] Run the checkpoint selftests plus `bash bin/lib/untrusted-golden.selftest.sh`. The golden must be unchanged (FR-018/SC-004).

**Checkpoint:** US1 is complete offline. VM verification is in T026.

## Phase 5: User Story 2, native-OIDC apps complete SSO (P1)

**Goal**: app containers trust the CA, which is asserted per app, and full SSO logins work per runtime.

**Independent test**: quickstart §3 and §4.

- [X] T016 [US2] Add the `sso-trust` stage to `bin/lib/app-test.sh`:
  - in `at_run_app`, after `at_verify_up`, and again after `at_restart` when restart is enabled (SC-005), call `tt_oidc_probe "$VMID" "$app" "$AT_DEPLOY_ID"`;
  - rc 1 → return 1 with `AT_LAST_STAGE=sso-trust`;
  - rc 2 → set `AT_NOTE="sso-trust: SKIP (${TT_PROBE_REASON})"` and continue;
  - rc 0/3 → continue.
  - Write probe details (URL used, `/proc/1/environ` CA lines only, probe stderr) to the app's log dir.
- [X] T017 [US2] In `bin/vm-catalog-test`'s `emit()` (:108-116), append `AT_NOTE` when it is set, e.g. `PASS gitea (1m12s)  [sso-trust: SKIP (trust not covered)]`. Untrusted runs never set it, so stdout is unchanged (T011 golden).
- [X] T018 [P] [US2] Extend `bin/lib/app-test.selftest.sh` with a stubbed `tt_oidc_probe`:
  - covered+fail → that app FAILs at `sso-trust` while the sweep continues;
  - SKIP → the app PASSes with its note;
  - not-run → no note;
  - the probe is re-invoked after restart when `AT_TEST_RESTART=1`.
- [X] T019 [US2] Create `bin/lib/sso-login.mjs` (Playwright, the same import style as `bin/lib/web-check.mjs`).
  - Inputs come from env: `SSO_BASE`, `SSO_APP`, `SSO_USER=akadmin`, `SSO_PASSWORD`, `WEB_CHECK_SPKI`, `SSO_OUT`, and optional `SSO_SW_PATH`.
  - Launch Chromium with `--ignore-certificate-errors-spki-list=$WEB_CHECK_SPKI` and `ignoreHTTPSErrors: false`.
  - Per-app recipes from research R5: gitea `/user/login` → `/api/v1/user`; immich `/auth/login` → `/api/users/me`; mealie `/login` → `/api/users/self`; plus a generic forward-auth recipe (load the app root → Authentik flow → back on the app host) for craft-apps.
  - The Authentik flow: `input[name=uidField]` → Enter → `input[name=password]` → Enter → click consent/continue if present.
  - After login, if `SSO_SW_PATH` is set, open it and assert that `navigator.serviceWorker.ready` resolves within 30 s.
  - Print `PASS sso <app>` / `FAIL sso <app> <hop>`, take a screenshot per hop, and never print the password.
- [X] T020 [US2] Create `bin/vm-sso-check`, per the contract. It:
  - sources `_common.sh`, `trusted-tls.sh` and `app-test.sh`;
  - requires trusted mode (exit 1 otherwise);
  - resolves IP and base from the VM state;
  - reads `AUTHENTIK_BOOTSTRAP_PASSWORD` via `vm-ssh -- "grep '^AUTHENTIK_BOOTSTRAP_PASSWORD=' /opt/hola/.env"` into a variable, never echoed;
  - installs each named app that isn't installed, using `at_install`;
  - runs `sso-login.mjs` per app, supporting `--service-worker <path>`;
  - supports `--dry-run`.
- [X] T021 [US2] Update `bin/lib/oidc-trust.tsv` if T026 finds a bundle's real runtime differs (e.g. hangar). Record the evidence in research.md's spike section.

## Phase 6: User Story 3, browser trusts the CA (P2)

**Goal**: `vm-web-check` verifies TLS and service workers register.

**Independent test**: quickstart §5.

- [X] T022 [US3] Edit `bin/lib/web-check.mjs`. When `WEB_CHECK_SPKI` is set, launch with `args: ['--ignore-certificate-errors-spki-list=' + spki]` and `ignoreHTTPSErrors: false`. Otherwise it stays exactly as today.
- [X] T023 [US3] Edit `bin/vm-web-check`. In trusted mode, derive the IP from the `HOLA_DOMAIN` host, export `WEB_CHECK_SPKI=$(bin/vm-test-ca spki --ip <ip>)`, and pass it through. Untrusted: unchanged.

## Phase 7: User Story 4, CA lifecycle and docs (P2)

- [X] T024 [P] [US4] Rewrite `docs/MCP_VM_TESTING.md` "DNS & TLS for the test VM" (:278-332), and fix the "self-signed TLS" mention at :144. Cover:
  - trusted mode (on when the CA is present; `VM_TRUSTED_TLS=0` turns it off);
  - `bin/vm-test-ca init`;
  - what gets pushed to the VM (the data-model VM table; never the CA key);
  - the runtime shim and why it is below Hola (the user decision, nothing in the product);
  - the `docker exec` env caveat;
  - the per-bundle expectation table;
  - `bin/vm-sso-check`;
  - the remaining `curl -sk` inside the product's bootstrap verify, noted as out of scope.

  Keep the staging (:302-316) and creds (:318-330) subsections accurate.
- [X] T025 [P] [US4] Update `.claude/skills/vm-e2e/SKILL.md`:
  - Preflight step 2 (:39-80) and line 45 claim "(self-signed TLS; the verify uses `curl -k`)". Replace that with trusted mode: run `bin/vm-test-ca init` once; trusted is the default when the CA is present.
  - Workflow step 2 (:95-104): note that the runtime shim must be installed after `vm-wait-ssh` and before bootstrap (`tt_install_runtime`).

## Phase 8: VM acceptance + polish

- [X] T026 Run quickstart.md §3–§6 on fresh VMs and record the outcomes in `specs/009-trusted-test-tls/research.md` under `## Acceptance results`:
  - **§3:** `bin/vm-catalog-test --apps gitea,immich,mealie,postiz,actual-budget --restart --keep`; no FAIL, and the grep is clean (SC-001, SC-005).
  - **§4:** `bin/vm-sso-check` for gitea, immich and mealie on the kept VM (SC-002).
  - **§5:** craft-apps with `--service-worker /effectcraft/` (SC-003). If it fails under the SPKI flag, implement the NSS-DB fallback from research R6 in `sso-login.mjs`/`web-check.mjs` and rerun.
  - **§6:** `VM_TRUSTED_TLS=0 bin/vm-catalog-test --apps uptime-kuma` on a separate VM (SC-004).

  Also record the wall-clock time the trusted-mode setup steps add, against the plan's ≤ 60 s goal.

  Destroy every VM afterwards. Any acceptance item that cannot pass for an environmental reason gets a `gh issue create` naming the evidence, and the result is recorded verbatim as not passed.
- [X] T027 [P] Run `shellcheck` (if available) on every new or edited bash file, and `bash -n` regardless. Fix the findings.
- [X] T028 Confirm FR-020: `git diff --stat main -- packages/` is empty, and `git status` shows only harness paths, `.gitignore`, the spec dir and the CLAUDE.md SPECKIT pointer.
- [X] T029 Run the product gate once: `bun run typecheck && bun run lint && bun run typecheck && bun run test && bun run build`. Expect it to be unchanged and green. Record any pre-existing baseline failures rather than chasing them.

## Dependencies & Execution Order

- **T001 gates T007, T009, T013, T014 and T026.** If T001 stops, everything stops.
- Setup (T002–T004) is independent and can run in parallel with T001.
- Foundational: T005 → T006; T007 → T008; T009 (needs T003, T005, T007) → T010.
- **T011 must run before T012–T014**: the golden is captured from unmodified scripts.
- US1 (T012–T015) needs Foundational. US2 (T016–T021) needs US1's `app-test.sh` wiring (T012). US3 (T022–T023) needs only T005. US4 (T024–T025) can be written any time after T001.
- T026 needs everything above. T027–T029 come last.

## Parallel Examples

- After T001: T002, T003 and T004 together. Then T006, T008 and T010 alongside their implementations' completion.
- US3 (T022–T023) and US4 (T024–T025) run in parallel with US2.

## Implementation Strategy

- **MVP = T001 + Foundational + US1.** That gives trusted front-door TLS and verified harness probes.
- US2 is the reason for the feature (it unblocks gitea 28), so it follows immediately.
- US3 and US4 complete it. T026 is the single VM acceptance pass, covering every SC.
