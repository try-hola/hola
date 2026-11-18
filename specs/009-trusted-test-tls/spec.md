# Feature Specification: Trusted TLS on Disposable Test VMs

**Feature Branch**: `009-trusted-test-tls`

**Created**: 2026-11-18

**Status**: Draft

**Input**: Spec prompt "Trusted TLS on disposable test VMs — a harness-owned private CA, so native-OIDC SSO and service workers are testable on LAN-only VMs" (Notion, https://app.notion.com/p/41cacfdc54e881d8be7fc9938c768a71). Unblocks try-hola/apps#192 / #194 (gitea 28) — those live in another repository and are not closed by this work.

## Scope statement *(read first)*

This is a **test-harness capability only**. It adds nothing an operator can see or configure: no `hola init` question, no install-wizard surface, no API field, no setting, no `docs/OPERATIONS.md` text. The harness is `bin/`, `bin/lib/`, `.claude/skills/vm-e2e/` and `docs/MCP_VM_TESTING.md`. If any Hola server change proves unavoidable, it MUST be inert unless the harness explicitly turns it on, and this spec (or its plan) MUST record why a harness-only alternative was not sufficient.

## Background

Disposable Proxmox test VMs are LAN-only and addressed as `<vm-ip>.sslip.io`. The harness renders an empty `ACME_DNS_PROVIDER` (`bin/vm-catalog-test:224`, `bin/vm-e2e-suite:189`), HTTP-01 cannot succeed from the LAN, and Traefik therefore serves its built-in self-signed default certificate (`docs/MCP_VM_TESTING.md:296-300`). The harness hides that from itself (`curl -k` in `bin/lib/app-test.sh:58`, `ignoreHTTPSErrors: true` in `bin/lib/web-check.mjs:24-25`) — but the **apps cannot**:

- Every `auth.mode: native-oidc` bundle makes **server-side** HTTPS calls to `https://auth.<base>` (discovery, token exchange, JWKS, userinfo) and rejects the certificate. Observed 2026-11-17 on immich: `Error in OAuth discovery … self-signed certificate`, `POST /api/oauth/authorize` → 500. Affected bundles today: gitea (Go), immich, postiz, actual-budget (Node), mealie (Python), hangar.
- Chromium refuses to register service workers on an untrusted certificate, so offline-mode features (EffectCraft in the craft-apps bundle) cannot be verified.

So the SSO path of a native-OIDC app — the path most likely to break on an upgrade — is the one the VM suite cannot exercise, and the gitea 28 major upgrade is blocked on exactly that.

**Decided direction** (2026-11-18 research): a private CA owned by the test harness. Chosen over Let's Encrypt DNS-01 on a real test subdomain because it needs no external DNS, no cloud credential on throwaway VMs, no inbound internet reachability, and spends no ACME rate-limit budget shared with production. Tailscale certificates were ruled out (machine name only, no `<app>.<base>` subdomains — tailscale/tailscale#7081).

## Clarifications

### Session 2026-11-18

Run unattended. Each answer below is the recommended option, accepted by the pipeline.

- Q: Where does the CA live, and what turns trusted mode off when it is present? → A: The CA lives in `.devcontainer/.test-ca/` (gitignored, beside `.vm-keys/`). Trusted mode is on when that directory holds a CA, and `VM_TRUSTED_TLS=0` in the environment turns it off. This matches the existing `.devcontainer/.vm-*` convention, and an env var works the same for every `bin/` script and for CI.
- Q: When trusted mode is active and an app's in-container OIDC discovery check fails, what does the shared per-app test report? → A: A covered bundle gets **FAIL**. A bundle the expectation table lists as not covered gets **SKIP (trust not covered)**. Outside trusted mode the check doesn't run at all. A soft warning would let SSO regress silently, which is the failure this feature exists to catch.
- Q: Does every catalog run perform full headless SSO logins, or only discovery? → A: Every run checks discovery, which is cheap and needs no browser. The full headless login per runtime is a separate opt-in harness script, run for acceptance (SC-002) and before an SSO-sensitive upgrade merges. A browser login per app on every run would multiply runtime and flakiness across the whole catalog.
- Q: How long is a VM leaf certificate valid, and how long is the CA valid? → A: The leaf is valid for 365 days and the CA for 10 years. Rotation is a non-goal. Browsers' public-CA lifetime caps don't apply to a locally trusted private root.
- Q: (user decision, received during planning) Is a test-only, off-by-default server hook an acceptable fallback for container trust? → A: **No. Keep it test-harness only.** FR-012 is amended and FR-013 is withdrawn. Container trust must come from the VM side, below Hola, and nothing may ship in the product.
- Q: If trusted mode is on but the harness can't establish trust (leaf signing fails, or `auth.<base>` never verifies), does the run continue untrusted? → A: No. The run fails before any app is installed, naming the step that failed. Silently degrading would report "trusted" results that were never trusted. A runner who wants the old behaviour sets `VM_TRUSTED_TLS=0`.

## User Scenarios & Testing *(mandatory)*

The "user" throughout is the **test runner**: a developer or an agent driving `bin/vm-catalog-test`, `bin/vm-e2e-suite` or the `vm-e2e` skill from the devcontainer.

### User Story 1 — Every HTTPS endpoint on a test VM presents a certificate the harness can verify (Priority: P1)

The test runner creates a VM and runs a suite. Every hostname the VM serves — the dashboard, `auth.<base>`, the Traefik dashboard host, and every installed app — presents a certificate chained to the harness's own CA, and the harness's own HTTP checks verify it instead of skipping verification.

**Why this priority**: It is the foundation for everything else: without a CA-signed certificate on the front door, neither apps nor browsers can be made to trust anything. It is also independently valuable — harness checks stop running with verification disabled.

**Independent Test**: On a fresh VM with the CA present, `curl --cacert <ca>` (no `-k`) to `https://auth.<base>/`, the dashboard and one installed app all succeed; with the CA absent, the same run behaves exactly as today.

**Acceptance Scenarios**:

1. **Given** the harness CA exists in the devcontainer, **When** a suite bootstraps a VM, **Then** a leaf certificate covering `<ip>.sslip.io` and `*.<ip>.sslip.io` is signed in the devcontainer and installed on the VM, and Traefik serves it for every router Hola emits (app, bypass, protected-bypass, outpost, core) without a Traefik restart.
2. **Given** trusted mode is active, **When** the harness waits for the stack, **Then** it waits until `https://auth.<base>/` verifies against the CA (not merely responds), and fails with a clear message if it never does within its timeout.
3. **Given** trusted mode is active, **When** the shared per-app test probes an app over HTTPS, **Then** it verifies the certificate against the CA rather than skipping verification.
4. **Given** the CA is absent, **When** any suite runs, **Then** its behaviour, the files it places on the VM and every rendered compose are unchanged from today.

---

### User Story 2 — Native-OIDC apps complete SSO against Authentik on a test VM (Priority: P1)

The test runner installs a native-OIDC app (gitea, immich, mealie, postiz …). The app's own server process trusts the harness CA in addition to the public roots, so its back-channel calls to Authentik succeed, and the suite asserts it.

**Why this priority**: This is the reason the feature exists — it unblocks gitea 28 and makes the SSO path of every native-OIDC bundle testable before an upgrade merges.

**Independent Test**: With trusted mode on, install immich (Node), gitea (Go) and mealie (Python); from inside each app container, fetching Authentik's OIDC discovery document succeeds with verification on; one full headless SSO login per runtime ends logged in. Each app can still reach a public HTTPS endpoint (the bundle replaced nothing it needed).

**Acceptance Scenarios**:

1. **Given** trusted mode is active and a native-OIDC app is installed, **When** the shared per-app test runs, **Then** it asserts that OIDC discovery against `https://auth.<base>` succeeds from inside the app's container with certificate verification on.
2. **Given** trusted mode is active, **When** a headless browser performs a full SSO login for one app per runtime (Go, Node, Python), **Then** each ends authenticated in the app.
3. **Given** trusted mode is active, **When** an app container makes an HTTPS call to a public site, **Then** it still verifies (the trust material reaching the container is the public roots **plus** the test CA, never the test CA alone).
4. **Given** an app is redeployed, upgraded or restarted, **When** it comes back up, **Then** it still trusts the CA (trust survives every lifecycle operation, not just the first install).
5. **Given** an app whose runtime does not honour any of the supported trust mechanisms (e.g. Java, a hard-pinned bundle), **When** the suite runs, **Then** the per-bundle expectation table records it as not covered, and the suite reports it as such rather than claiming success or failing the whole run.

---

### User Story 3 — The headless browser trusts the CA, so service workers register (Priority: P2)

The test runner's headless browser checks run with certificate errors **not** ignored, trusting the harness CA instead, so features that browsers only enable on a trusted origin (service workers, offline mode) are exercised.

**Why this priority**: It closes the last place the harness disables verification and makes EffectCraft offline mode verifiable, but nothing else depends on it.

**Independent Test**: With trusted mode on, `bin/vm-web-check` loads the dashboard and an app with error-ignoring disabled and succeeds; on the craft-apps bundle, EffectCraft's service worker registers.

**Acceptance Scenarios**:

1. **Given** trusted mode is active, **When** the browser check runs, **Then** it does not ignore HTTPS errors and every page loads.
2. **Given** trusted mode is active and craft-apps is installed, **When** EffectCraft is opened, **Then** its service worker registers.
3. **Given** the CA is absent, **When** the browser check runs, **Then** it behaves exactly as today.

---

### User Story 4 — The CA is created once and kept out of reach of the VMs (Priority: P2)

The test runner creates the CA once in the devcontainer with a single documented command, and the documentation and the `vm-e2e` skill describe trusted mode as the default whenever the CA is present.

**Why this priority**: Required for anyone to use the feature, but small.

**Independent Test**: Run the CA-creation command on a devcontainer with no CA: a CA appears in a gitignored location; running it again does not replace it. No VM ever receives the CA private key.

**Acceptance Scenarios**:

1. **Given** no CA exists, **When** the runner runs the creation command, **Then** a CA certificate and key are written to `.devcontainer/.test-ca/` (gitignored), with owner-only permissions on the key.
2. **Given** a CA exists, **When** the creation command runs again, **Then** it refuses to overwrite it unless explicitly forced.
3. **Given** any suite run in trusted mode, **When** its files reach the VM, **Then** only the leaf certificate, the leaf key, the Traefik TLS file, the combined trust bundle, the runtime shim and the `daemon.json` merge reach the VM. The CA key never does.
4. **Given** the docs, **When** a reader looks up "DNS & TLS for the test VM" in `docs/MCP_VM_TESTING.md` or step 2 of the `vm-e2e` skill, **Then** both describe trusted mode, how to create the CA, and that it becomes the default when present.

### Edge Cases

- **CA present but a leaf cannot be issued** (e.g. the VM IP cannot be determined): the run fails loudly before tests start; it never silently falls back to untrusted mode while claiming trusted mode.
- **Traefik's `le` resolver attempts and fails issuance**: the router must still serve the default-store certificate. If any router kind does not fall back, it is a finding the plan must resolve, not something to work around per app.
- **The file provider picks up the TLS file after Traefik has started**: the new certificate is served without a Traefik restart.
- **Hola later writes or cleans the Traefik directory**: the harness file must survive normal server operation (deploys, uninstalls, server restarts).
- **An app is installed before trusted mode is fully in place** (e.g. the catalog test installs apps quickly after bootstrap): the per-app test must not assert SSO until trust is established; ordering is the harness's responsibility.
- **A container image has no system CA store** (distroless, scratch): the combined bundle must still be a self-contained file, so the runtime env vars work without one.
- **Leaf expiry during a long-kept VM**: leaf validity is long enough for any realistic kept-on-fail VM (rotation is a non-goal).
- *(withdrawn 2026-11-18 with FR-013)* ~~A server-side hook configured with a missing path.~~ The equivalent now is a VM where the runtime shim is installed but its bundle file is missing. The shim passes through (inert), and the harness's `DefaultRuntime` and PID-1 environment checks fail the run before any app is installed (FR-004a).

## Requirements *(mandatory)*

### Functional Requirements

**CA lifecycle (devcontainer side)**

- **FR-001**: The harness MUST provide one command that creates a private test CA in the devcontainer. The CA lives in `.devcontainer/.test-ca/`, which is gitignored. The private key MUST be readable only by its owner. The CA is valid for 10 years.
- **FR-002**: The command MUST NOT overwrite an existing CA unless explicitly forced. Rotation is a non-goal.
- **FR-003**: The CA private key MUST never be copied to a VM, logged, or committed.
- **FR-004**: Trusted mode MUST be on by default when the CA is present and off when it is absent. Setting `VM_TRUSTED_TLS=0` MUST turn it off even when the CA is present.
- **FR-004a**: If trusted mode is on but trust cannot be established (leaf signing fails, or FR-008's wait times out), the run MUST fail before any app is installed and name the failed step. It MUST NOT continue in untrusted mode.

**Half 1 — Traefik serves a CA-signed certificate**

- **FR-005**: In trusted mode, after bootstrap the harness MUST sign, in the devcontainer, a leaf certificate covering `<ip>.sslip.io` and `*.<ip>.sslip.io`, valid for 365 days. It MUST install the leaf on the VM so that Traefik serves it as its default certificate.
- **FR-006**: The certificate MUST be delivered through Traefik's watched dynamic-config directory as a harness-owned file, with no change to Hola's server, compose stack or Traefik static configuration (the expected outcome; any deviation needs FR-020's justification).
- **FR-007**: The plan MUST verify, on a real VM, that the default-store certificate is served for every router kind Hola emits (app, bypass, protected-bypass, outpost, core) when the `le` resolver cannot issue, and that it is picked up without a Traefik restart.
- **FR-008**: In trusted mode the harness MUST wait until `https://auth.<base>/` verifies against the CA before running tests, and fail clearly on timeout.
- **FR-009**: In trusted mode the harness's own HTTPS checks (the shared per-app test and suite-level probes) MUST verify against the CA instead of disabling verification.

**Half 2 — app containers trust the CA**

- **FR-010**: In trusted mode every service of every installed app MUST receive a **combined** trust bundle (the public roots plus the test CA) and the runtime trust settings that make Node, Go and Python processes use it, at least: `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`.
- **FR-011**: Container trust MUST survive every lifecycle operation that re-materializes an app (install, redeploy, upgrade, rollback, restart, server restart).
- **FR-012** *(amended 2026-11-18 by user decision — see Clarifications)*: Container trust MUST be delivered by a **pure-harness** mechanism only. The test-only server hook is withdrawn. No Hola package code (`packages/*`) changes for this feature. The mechanism must act **below** Hola, on the throwaway VM's container runtime, so that every container Hola creates inherits it no matter how often Hola re-materializes the compose. The plan MUST record why per-deployment compose edits were rejected (the materialized compose under `/data/deployments/<id>/runtime` is rewritten on every redeploy) and MUST name the mechanism chosen.
- **FR-013** *(withdrawn 2026-11-18)*: ~~Requirements for a test-only server hook.~~ The hook is no longer an option. Its intent is now carried by FR-012, FR-018 and SC-006: nothing changes for a non-harness host, and nothing ships in the product.
- **FR-014**: The spec's deliverables MUST include a per-bundle expectation table listing each `native-oidc` catalog bundle, its runtime, the trust mechanism expected to cover it, and whether it is expected to be covered. Bundles not covered (e.g. Java, pinned bundles) are recorded, not claimed.

**Assertions and browser**

- **FR-015**: The shared per-app test (`bin/lib/app-test.sh`, the single source of truth) MUST, in trusted mode and for `native-oidc` apps, assert that OIDC discovery against `https://auth.<base>` succeeds from inside the app container with verification on. The test reports results as follows:
  - a covered bundle that fails the check reports **FAIL**;
  - a bundle the expectation table marks `unverified` or `not-covered` gets an `sso-trust` result of **SKIP (trust not covered)**. That result is attached to the app's line as a note, and the app's overall result still comes from its other stages;
  - outside trusted mode, the check does not run.
- **FR-016**: The harness MUST provide a separate, opt-in script that runs a full headless SSO login for at least one app per runtime (Go, Node, Python) in trusted mode. It is used for acceptance and before SSO-sensitive upgrades merge, not on every catalog run.
- **FR-017**: In trusted mode the headless browser check MUST NOT ignore HTTPS errors and MUST trust the CA by a mechanism under which service-worker registration works, verified on EffectCraft.

**Unchanged when absent; documentation**

- **FR-018**: With the CA absent (or trusted mode turned off), every harness script, every file placed on the VM, and every rendered compose MUST be unchanged from today's behaviour.
- **FR-019**: `docs/MCP_VM_TESTING.md` ("DNS & TLS for the test VM") and `.claude/skills/vm-e2e/SKILL.md` step 2 MUST describe trusted mode, CA creation and the per-bundle expectation table. No operator-facing documentation changes.
- **FR-020** *(tightened 2026-11-18)*: The feature MUST NOT change anything outside the harness paths (`bin/`, `bin/lib/`, `.claude/skills/vm-e2e/`, `docs/MCP_VM_TESTING.md`, `.gitignore`, this spec directory, and the `CLAUDE.md` SPECKIT plan pointer). In particular, nothing changes under `packages/`.

### Key Entities

- **Test CA**: a self-signed root certificate plus private key, devcontainer-only, created once.
- **VM leaf certificate**: issued per VM by the test CA for `<ip>.sslip.io` and its wildcard; its key travels to the VM, the CA key never does.
- **Traefik TLS file**: a harness-owned dynamic-config file setting the default TLS store certificate, placed beside the server's own files in the watched directory.
- **Combined trust bundle**: public roots plus the test CA, as one file, delivered to app containers.
- **Runtime shim**: a harness-installed wrapper set as the VM's default container runtime. It adds the bundle mount and the trust environment variables to every container at creation. It is inert when the bundle is missing.
- **Per-bundle expectation table**: native-OIDC bundle → runtime → mechanism → covered or not.
- **Trusted mode**: the harness state derived from the CA's presence, plus an explicit off switch.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a fresh VM from `bin/vm-catalog-test` with the CA present, gitea, immich, mealie and postiz each complete OIDC discovery against Authentik from inside their containers, and no `-k` / ignore-HTTPS-errors path is exercised anywhere in the run.
- **SC-002**: At least one full headless SSO login per runtime (Go, Node, Python) succeeds on that VM.
- **SC-003**: EffectCraft's service worker registers in the headless browser on that VM.
- **SC-004**: With the CA absent, a harness run produces the same files on the VM and the same rendered compose for every app as before this feature (zero differences).
- **SC-005**: An app's container trust survives a redeploy and an upgrade on the VM (verified on at least one native-OIDC app).
- **SC-006**: No operator-visible surface changes: `hola init`, the wizard, the API schema, settings and `docs/OPERATIONS.md` are untouched.

## Assumptions

- The test runner works from the devcontainer, where `.devcontainer/mcp.env` and the existing `bin/vm-*` helpers live; the CA is generated with `openssl` (always present) rather than requiring a new tool.
- sslip.io still needs public DNS resolution; that already works and fully offline VMs are out of scope.
- Leaf validity of 365 days and CA validity of 10 years are sufficient; rotation and revocation are non-goals.
- The combined bundle's public roots come from the devcontainer's system CA store at the time trusted mode is set up.
- Traefik's file provider merges every file in its watched directory and the server neither cleans nor rewrites harness-owned files there (`packages/server/src/services/core/routing.ts:28-31`); FR-007 verifies the fallback behaviour on a real VM.
- *(amended 2026-11-18)* The server-side seam (`applyPlatformDefaults`, `packages/server/src/services/core/compose-defaults.ts:187`) is deliberately **not** used: the user ruled out any product change. Container trust is applied on the VM below Hola, at the container-runtime layer.

## Out of Scope

- Any operator-facing custom-CA / homelab-PKI feature.
- Let's Encrypt DNS-01 for VMs (the recorded alternative; the overlay `packages/compose/docker-compose.dns01.yml` already exists).
- Fully offline VMs.
- Closing try-hola/apps#192 / #194 (another repository; this unblocks them).
