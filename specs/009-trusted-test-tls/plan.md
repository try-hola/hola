# Implementation Plan: Trusted TLS on Disposable Test VMs

**Branch**: `009-trusted-test-tls` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/009-trusted-test-tls/spec.md`

## Summary

The harness creates a private test CA once, in the devcontainer. Then, on every disposable VM:

1. **Half 1:** it signs a wildcard leaf for `<ip>.sslip.io` and drops it into Traefik's watched dynamic-config directory as the default TLS-store certificate.
2. **Half 2:** it makes every container on the VM trust that CA through an **OCI runtime shim**. The shim is installed as Docker's default runtime before `hola bootstrap`. It bind-mounts a combined root bundle read-only into every container and sets `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE` and `REQUESTS_CA_BUNDLE`.

The harness's own probes then verify TLS instead of skipping it. A new `sso-trust` stage in the shared per-app test asserts that native-OIDC apps can reach Authentik from inside their containers. An opt-in `bin/vm-sso-check` runs full headless logins and the EffectCraft service-worker check.

**Nothing under `packages/` changes.** The user ruled out a server hook on 2026-11-18, so the shim exists to keep this entirely below Hola.

## Technical Context

**Language/Version**:
- Bash 5: the harness scripts, matching `bin/*`.
- Python 3: the on-VM runtime shim. The Ubuntu cloud image ships it.
- Bun / Node ESM: the Playwright scripts, matching `bin/lib/web-check.mjs`.

**Primary Dependencies**:
- `openssl` 3 in the devcontainer, already present.
- On the VM: Docker Engine with containerd/runc (preinstalled in the template), and Traefik v3 (the file provider).
- Playwright Chromium, already used by `vm-web-check`.

**Storage**: Files only. See [data-model.md](data-model.md).

**Testing**:
- Offline bash selftests, following the `bin/lib/app-test.selftest.sh` precedent: no VM, milliseconds.
- The VM acceptance run in [quickstart.md](quickstart.md).
- The product gate (`bun run typecheck && bun run lint && bun run test && bun run build`) runs once, unchanged, since no package changes.

**Target Platform**: Devcontainer (Ubuntu 24.04) → Proxmox Ubuntu VM.

**Project Type**: Test harness, i.e. CLI scripts.

**Performance Goals**: Trusted-mode setup adds ≤ 60 s to a suite run. The `sso-trust` probe takes ≤ 10 s per app.

**Constraints**:
- FR-018: when untrusted, output is byte-identical to today's.
- FR-003: the CA key never leaves the devcontainer.
- FR-020: nothing changes under `packages/`.

**Scale/Scope**:
- Six native-OIDC bundles.
- Two suites: `vm-catalog-test` (Authentik mode) and `vm-e2e-suite` (mode=none, Half 1 only).

## Constitution Check

*GATE: must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Traefik-only ingress | ✅ | No ports. The cert is delivered through Traefik's own file provider. The validator is untouched. |
| II. Remote catalog | ✅ | No catalog change. The expectation table is harness test data, not a catalog. |
| III. Async deploy lifecycle | ✅ | No server change. |
| IV. Real/Mock pairs | ✅ N/A | No new service. |
| V. Generic cross-app primitives | ✅ | No per-app server logic. Per-app data lives only in the harness's test table (recipes are a test concern). |
| VI. Auth platform-agnostic | ✅ | Probes target the issuer URL Hola provisions. No Authentik coupling enters the product. The SSO-login script is test-side. |
| VII. Quality gates | ✅ | Branch + PR. The full product gate runs once. New selftests cover the harness. |
| Constraint: runtime artefacts not committed | ✅ | The CA and leaves are gitignored. |
| Constraint: e2e via `bin/vm-*` | ✅ | This feature *is* that tooling. |

**Post-design re-check:** still passes. The runtime shim modifies only the throwaway VM's Docker configuration, which no principle governs, and no product path changes. Hola's mount gate (`assertResolvedMountsContained`) is not weakened. It never sees the shim's mount, because the shim acts after compose resolution, on a test VM only.

## Project Structure

### Documentation (this feature)

```text
specs/009-trusted-test-tls/
├── spec.md
├── plan.md                       # this file
├── research.md                   # anchors verified; R1–R8 decisions
├── data-model.md                 # files, trusted-mode states, result mapping
├── quickstart.md                 # VM acceptance run
├── contracts/harness-interface.md
├── checklists/requirements.md
└── tasks.md                      # /speckit-tasks
```

### Source Code (repository root)

```text
bin/
├── _common.sh                    # + CA_DIR default (next to KEYS_DIR)
├── vm-test-ca                    # NEW: init | issue | spki | status
├── vm-test-ca.selftest.sh        # NEW
├── vm-sso-check                  # NEW: opt-in full SSO + service-worker check
├── vm-catalog-test               # + trusted-mode steps; http_code via tt_curl_tls; --keep
├── vm-e2e-suite                  # + trusted-mode steps (Half 1); api_cli/http_code/step_install via tt_*
├── vm-web-check                  # + WEB_CHECK_SPKI passthrough
└── lib/
    ├── trusted-tls.sh            # NEW: tt_* helpers (contract)
    ├── trusted-tls.selftest.sh   # NEW
    ├── test-ca-runtime.py        # NEW: OCI runtime shim (pushed to the VM)
    ├── test-ca-runtime.selftest.sh  # NEW
    ├── oidc-trust.tsv            # NEW: per-bundle expectation table (FR-014)
    ├── sso-login.mjs             # NEW: Playwright SSO + service-worker recipes
    ├── app-test.sh               # + sso-trust stage; TLS flags via tt_*
    ├── app-test.selftest.sh      # + sso-trust mapping cases; untrusted byte-identical
    └── web-check.mjs             # + SPKI launch arg when WEB_CHECK_SPKI is set
.claude/skills/vm-e2e/SKILL.md    # step 2 + preflight prose
docs/MCP_VM_TESTING.md            # "DNS & TLS for the test VM" rewritten for trusted mode
.gitignore                        # + .devcontainer/.test-ca/
```

**Structure Decision**:
- The existing `bin/` and `bin/lib/` layout is kept. New scripts follow `bin/_common.sh` conventions: `--dry-run`, audit logging through the same helpers, and `vm-ssh` stdin piping (there is no scp).
- `packages/` is untouched.

## Key Design Points

These are summaries. The decisions and evidence are in research.md.

1. **R1: default-store certificate.**
   - `test-tls.yml` is written in `hola-data:/runtime/traefik/`. The PEMs go in `hola-data:/test-tls/`.
   - Every router inherits the entrypoint resolver and sets no `tls.options`, so the default certificate is served on SNI whenever ACME cannot issue.
   - This is verified per router kind in spike T001.
2. **R2: OCI runtime shim.**
   - It is installed before bootstrap, so every container (Hola's own included) is created through it.
   - It edits `config.json` on `create` only, never overrides an env key the container sets, and passes through when the bundle file is missing.
   - It is verified in spike T001 **before** dependent work. If it is not viable, the run stops and reports. There is no server-hook fallback.
3. **The `docker exec` env gap.** Probes assert the variables on PID 1 (`/proc/1/environ`), then pass them explicitly with `-e`.
4. **Ordering (contract):** `wait-ssh → runtime shim → bootstrap → verify → traefik cert → wait-trusted → tests`. `vm-catalog-test --server-image local` recreates the server, so `wait-trusted` re-runs after it.
5. **FR-018 discipline.**
   - Every `tt_*` helper returns today's exact flags when untrusted.
   - A golden selftest captures today's command lines and rendered env with the CA absent, and diffs them.
6. **Secrets.** The `akadmin` password is read over `vm-ssh` from `/opt/hola/.env` into process env only, and is never echoed or logged. The CA key is never pushed.

## Risks

| Risk | Mitigation |
|---|---|
| The shim doesn't work on the template's Docker/containerd version | Spike T001 first. Stop and report; no product fallback. |
| A router kind doesn't fall back to the default cert | Spike T001 checks every kind. If one fails, record it and stop. Any fix would need a product change, so it goes back to the user. |
| Chromium's SPKI flag doesn't grant a secure context for service workers | NSS-DB fallback (R6). |
| hangar's runtime is unknown | Marked `unverified` → SKIP. The first trusted run records the truth in the table. |
| Bun ignores `NODE_EXTRA_CA_CERTS` for the CLI | Spike T001 checks it. If so, fall back to `NODE_TLS_REJECT_UNAUTHORIZED=0` for the CLI only, and document that the harness's *own* CLI calls are the one remaining unverified path. |

## Complexity Tracking

No constitution violations.
