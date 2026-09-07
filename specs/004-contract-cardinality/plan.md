# Implementation Plan: Contract Cardinality and the Container-Logs Contract

**Branch**: `004-contract-cardinality` | **Date**: 2026-09-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-contract-cardinality/spec.md` (GitHub issues #426, #245; Notion Spec Prompts row "Capability contracts, round 2")

## Summary

Make acceptor participation in a capability contract a **list**: the `backup` block accepts a
plural form (each participation with an `id` and its own hooks), the singular form is
normalised to one participation named `default`, the broker and the pre-upgrade snapshot run
participations in declaration order fail-closed with started-only cleanup, and both report per
participation. Enforce **one provider per contract per host** at create time and flag legacy
pairs in the rollup. Carry a server-computed **coverage judgement** (`quiesced` / `partial` /
`as-is` / `uncovered`, derived from a closed database-image-family recogniser over the
release compose) through the API so the dashboard stops calling a two-database app with one
hook "covered". Add **`container-logs@1`** as the first app-provided *provisioned* contract with
**implicit** participation and a new `container-logs` provider grant: on operator consent the
server injects a redacting Docker-API proxy sidecar (run from the server's own image) plus
`DOCKER_HOST` into the collector's compose, and every app container gains `sh.hola.*` labels so
logs group by app. ADR 0004 and ADR 0002 are amended; catalog-side work is filed in
`try-hola/apps`.

## Technical Context

**Language/Version**: TypeScript (Bun workspaces); server on Bun, web on Vite/React 19, CLI on
`sade`. The new proxy is a standalone Bun script in the server package.

**Primary Dependencies**: `@hola/shared` (`contracts.ts` vocabulary, wire types), `yaml` (already
used by every compose injector). No new packages.

**Storage**: No schema change. Participations are derived on read from
`releases/<id>/manifest.json` (singular objects on disk are normalised); coverage is computed on
read from the release's `compose-override.yml`; the provider guard reads the same files. **No
migration.**

**Testing**: server `bun:test` under `packages/server/src/__tests__/<area>/`; web and CLI `vitest`.
Broker tests run `RealDeploymentService` against an exec-recording docker double
(`contract-broker.test.ts`); the proxy is tested against a fake Docker API on a temp unix socket.

**Target Platform**: Linux Docker host (server + sidecar), browser SPA, CLI.

**Project Type**: Monorepo web service + SPA + CLI; touches `shared`, `server`, `web`, `cli`
(tests only), `docs`.

**Performance Goals**: `getContracts` adds one compose read per deployment (same order as the
manifest read it already does). The proxy streams logs/events without buffering; only the
inspect response is materialised for redaction.

**Constraints**:
- Every existing singular `backup` manifest and every on-disk release manifest keeps working
  (spec FR-002; ADR 0003).
- `CONTRACTS` stays closed; unknown or implicit-`accepts` refs degrade with a warning.
- `validateVolumes` unchanged; the platform's post-validation injection is the only way to the
  socket, and the sidecar never joins the `hola` network or publishes ports (Constitution I).
- No per-app logic anywhere (Constitution V): recognition is by image family, guard and rollup
  by contract ref.
- Mock base class stays permissive (new guard is a no-op seam, like `assertInstanceAllowed`).
- Grant injection happens in `materializeCompose` inside the lifecycle job, never at create time
  (Constitution III).

**Scale/Scope**: ~3 shared files, ~9 server source files (+1 new script, +1 new lib module),
~5 web files, 2 ADRs + 3 docs, ~14 new/extended test files. See "Project Structure".

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Traefik-only ingress | ✅ | No host ports anywhere. The injected proxy sidecar is reachable only on the provider's project network; the validator still rejects user-authored socket/log-dir mounts and a reserved-name service (R7). |
| II. Remote catalog as single source of truth | ✅ | Plural `backup` and `provides: container-logs@1` come from the bundle manifest through the existing coercers. No bundled catalog; `MockCatalogService` stays empty; tests inject stubs. |
| III. Async deploy lifecycle | ✅ | The provider guard and consent check run with the other create-time guards (no side effects). All injection (labels, sidecar, env) happens in `materializeCompose` inside `runLifecycleJob`. |
| IV. Real/Mock service pairs | ✅ | No new service. `assertProviderAllowed` is a base no-op overridden by `RealDeploymentService`; the proxy is a script, not a service, with its logic in a pure module tested hermetically. |
| V. Generic cross-app primitives | ✅ | `container-logs@1` is a contract in the closed table with a generic grant; coverage recognises image families, never app ids; the implicit-participation branch is contract-agnostic. ADR 0004 is amended and ADR 0002 cross-references (the "ADR before implementation" rule is met by the amendment landing in the same PR, as ADR 0005 did for spec 003). |
| VI. Auth platform-agnostic, default-on | ✅ n/a | Provisioner untouched. The contract token narrows to brokered contracts; auth tokens unaffected. |
| VII. Quality gates | ✅ | `bun run typecheck && bun run lint && bun run test && bun run build`; re-run typecheck after lint fixes. |

**Post-design re-check (Phase 1)**: unchanged. One deliberate design cost, not a violation: the
proxy runs from the **server image** with a second entrypoint (R7), which couples the sidecar's
version to the server's. Accepted because the alternative is a new published artefact, and the
server already pins its own image per host.

## Project Structure

### Documentation (this feature)

```text
specs/004-contract-cardinality/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R12 + test strategy
├── data-model.md        # Phase 1: participation, definition, coverage, labels, proxy contract
├── quickstart.md        # Phase 1: validation scenarios
├── contracts/
│   ├── api.md           # HTTP wire changes (broker, rollup, detail, create rejection)
│   ├── manifest.md      # What the server accepts from a bundle manifest
│   ├── compose.md       # Materialised compose: labels, sidecar, env, validator pins
│   └── web.md           # Dashboard and CLI surfaces
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/shared/src/
├── contracts.ts                 # + participation on ContractDefinition; + container-logs@1;
│                                #   ProviderGrantKind |= 'container-logs'; + backupParticipations,
│                                #   DATABASE_IMAGE_FAMILIES, isDatabaseImage, judgeBackupCoverage,
│                                #   CONTAINER_LOGS_CONTRACT_REF, PLATFORM_LABEL_* keys
├── index.ts                     # + AppBackupParticipation, AppBackupDeclaration, BackupCoverageState,
│                                #   ContractCoverage; DeploymentContracts.coverage; ContractParticipant.coverage;
│                                #   ContractRollup.participation/providerConflict; prepare/finalize shapes;
│                                #   backup field → AppBackupDeclaration; + 'RESERVED_SERVICE_NAME'
└── compose-validate.ts          # + reserved service name check (hola-docker-proxy)

packages/server/src/
├── docker-proxy.ts              # NEW: Bun entrypoint — listens :2375, forwards to the socket via lib/docker-proxy
├── lib/docker-proxy.ts          # NEW: pure allowlist + inspect redaction + stream forwarding helpers
├── config/compose-defaults.ts   # (unchanged config; labels come from runtime)
└── services/core/
    ├── manifest-backup.ts       # plural + singular → AppBackupParticipation[]; id/dup/hookless drops
    ├── contracts.ts             # coerceRefs drops implicit accepts; buildContractRollup: participation,
    │                            #   implicit buckets, providerConflict, coverage passthrough
    ├── compose-defaults.ts      # PlatformDefaultsRuntime.labels; list/map merge; forces rewrite
    ├── compose-mounts.ts        # + CONTAINER_LOGS_PROXY_SERVICE, injectContainerLogsSource(compose, opts)
    └── deployment.ts            # assertProviderAllowed seam + Real override (after assertInstanceAllowed);
                                 #   backupParticipants(); runPreHooksFailClosed/runPostHooks; prepare/finalize/
                                 #   snapshot on participations; readDeploymentContracts coverage (compose read,
                                 #   profiles); materializeCompose: labels runtime + container-logs injection;
                                 #   mintContractEnv brokered-only

packages/server/src/__tests__/
├── bundles/manifest-backup.test.ts          # extend
├── bundles/contracts.test.ts                # extend (table, participation, recogniser, judgement, rollup)
├── deployments/contract-broker.test.ts      # extend (multi-participation, ordering, cleanup, reporting)
├── deployments/contract-provider-guard.test.ts   # NEW
├── deployments/contract-rollup.test.ts      # extend (coverage from compose, profiles, conflict)
├── deployments/pre-upgrade-snapshot*.test.ts     # extend the existing snapshot test with participations
├── routing/compose-mounts.test.ts           # extend (container-logs injection)
├── routing/compose-defaults.test.ts         # extend (labels)
├── validation/compose-validate.test.ts      # extend (socket/log-dir/parents pins, reserved name)
├── lib/docker-proxy.test.ts                 # NEW (fake socket server)
└── auth/contract-tokens.test.ts             # extend (brokered-only, container-logs no capability)

packages/web/src/
├── utils/backup-coverage.ts     # partial state, coverage-first derivation, implicit guard
├── components/BackupCoverage.tsx # partial badge + counts, summary wording, provider-conflict warning,
│                                #   per-app unquiesced services
├── pages/DeploymentDetail.tsx   # coverage-first state; grant label for container-logs
├── pages/InstallWizard.tsx      # PROVIDER_EXISTS surfaced (message + link)
└── __tests__/utils/backup-coverage.test.ts, pages/Backups.coverage.test.tsx,
    pages/InstallWizard.grants.test.tsx, pages/DeploymentDetail*.test.tsx

packages/cli/src/__tests__/install.test.ts   # --grant container-logs@1; PROVIDER_EXISTS message

docs/adr/0004-capability-contracts.md        # status + §9–§13
docs/adr/0002-cross-app-integration.md       # container-logs note
docs/OPERATIONS.md                           # coverage states, one provider, container logs
docs/ARCHITECTURE.md                         # labels + provider grants in the lifecycle
CLAUDE.md                                    # architecture-notes bullet
```

**Structure Decision**: No new service. Two new server files (the proxy entrypoint and its pure
module) because the proxy runs as a separate process; everything else lands on the seams
`research.md` names.

## Design overview

1. **Shared vocabulary** (`@hola/shared/contracts`): `participation` on every definition,
   `container-logs@1` with its grant (R6, R9); `backupParticipations()` (R1);
   `DATABASE_IMAGE_FAMILIES` / `isDatabaseImage` / `judgeBackupCoverage` (R5); label keys (R8).
2. **Coercion**: `coerceManifestBackup` emits `AppBackupParticipation[]` from either form with the
   drop rules (R1); `coerceRefs` drops implicit `accepts` (R6).
3. **Runner**: `backupParticipants()` ordered list; `runPreHooksFailClosed` + `runPostHooks`
   shared by `runContractBackupPrepare`, `finalizeContractBackup` and
   `capturePreUpgradeSnapshot` (R2); wire shapes per R3.
4. **Guard**: `assertProviderAllowed` seam after `assertInstanceAllowed`, `PROVIDER_EXISTS` (R4);
   `providerConflict` in the rollup.
5. **Coverage**: `readDeploymentContracts` reads the release compose, applies profiles, computes
   `coverage['backup@1']`; `buildContractRollup` copies it onto acceptors and applies the
   implicit-bucket rule (R5, R6).
6. **Materialise**: labels via `applyPlatformDefaults` runtime (R8); `injectContainerLogsSource`
   after the apps-data branch when `grantsInclude(granted, 'container-logs')` (R7);
   `mintContractEnv` brokered-only.
7. **Proxy**: `lib/docker-proxy.ts` (decide, redact, forward) + `docker-proxy.ts` entrypoint (R7);
   validator reserved-name rule and mount pins.
8. **Clients**: web per `contracts/web.md`; CLI unchanged except tests.
9. **Docs + follow-ups**: R11, R12; issue numbers recorded in `tasks.md`.

## Risks and mitigations

- **Collector compatibility with the redacted inspect** — Alloy/Promtail read `Config.Tty` and
  `Config.Labels`, both kept; Vector additionally reads `Name`/`Image`, kept. Verified against the
  field allowlist in `data-model.md`; the ADR records the allowlist so a future collector's needs
  are a one-line, reviewed change.
- **Server image as sidecar image** — `HOLA_VERSION` may be unset in dev (`:latest`); the
  `HOLA_SERVER_IMAGE` override covers dev and air-gapped hosts, and the materialise test asserts
  the resolution order.
- **Socket path or group differs on the host** — `HOLA_DOCKER_SOCKET` override; the sidecar runs
  the same image as the server, which already reaches the socket.
- **Coverage false positives** from the recogniser (a `postgres` client-tools image) — bounded
  by the closed family list and last-segment matching; a false "partial" is the safe direction
  and is fixed by a hook or a list change, never by app-specific code.
- **On-disk singular manifests** — every reader goes through `backupParticipations`; the broker
  test keeps a singular fixture to prove byte-identical behaviour.
- **`applyPlatformDefaults` early return** — labels must force the rewrite; covered by a test
  with an all-disabled config.

## Complexity Tracking

No constitution violations; nothing to justify.
