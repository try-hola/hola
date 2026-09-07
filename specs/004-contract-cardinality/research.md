# Research: Contract Cardinality and the Container-Logs Contract

**Feature**: `004-contract-cardinality` · **Date**: 2026-09-04 · **Sources**: #426, #245, Notion prompt "Capability contracts, round 2"

All anchors verified against `main` at `ab246d3` (the prompt's anchors were read at `2ae2f7f`; nothing in the touched files moved between the two).

## R1. Plural participation shape and where the singular form is normalised

**Decision**: Add `AppBackupParticipation = { id: string; preHook?: AppBackupHook; postHook?: AppBackupHook }` to `@hola/shared`. The **canonical** shape everywhere the server operates is `AppBackupParticipation[]`. `coerceManifestBackup` (`packages/server/src/services/core/manifest-backup.ts`) accepts both the singular object and the plural array from a raw bundle manifest and always **emits the array**; the singular form becomes `[{ id: 'default', preHook?, postHook? }]`. The existing `AppBackupConfig` type is kept as the name of the singular form; the manifest/detail/finalized field becomes `backup?: AppBackupDeclaration` where `AppBackupDeclaration = AppBackupConfig | AppBackupParticipation[]`, and one pure helper `backupParticipations(value): AppBackupParticipation[]` (in `@hola/shared/contracts`) is the only reader.

**Rationale**: Two things hold the singular object besides the catalog: (1) `releases/<id>/manifest.json` records written before this feature, which the runner reads on every prepare and every pre-upgrade snapshot, and (2) test stubs that inject `backup` straight into `getVersionDetail`, bypassing coercion. A read-side normaliser is therefore needed anyway (no migration, spec Assumptions), so it is cheaper and safer to make it the single reader than to type the field as array-only and chase every writer. The coercer still emits the array so a freshly read catalog is always canonical, which is what the prompt's "the runner handles exactly one shape" asks for: the runner only ever sees `backupParticipations(...)`.

**Id rule**: same as push target ids (`manifest-push.ts:71-78`): a non-empty trimmed string; first declaration of an id wins, later duplicates are dropped with a warning. A plural entry without a usable id, or with no surviving hook, is dropped with a warning. An empty result → `undefined` (unchanged contract with `acceptorBlocksPresent`).

**Alternatives considered**: making `AppBackupConfig` itself an array (breaks every existing fixture's type and forces a rewrite of the on-disk reader anyway); a separate `backupV2` block (two structures describing one fact, which ADR 0003 rejects).

## R2. Ordering, failure and cleanup policy for the prepare

**Decision**: `backupParticipants()` replaces `backupAcceptors(phase)`. It returns a flat list `Array<{ deploymentId, participationId, preHook?, postHook? }>` ordered by **ascending deployment id, then declaration order**, restricted to running deployments that accept `backup@1`. Prepare iterates the list, runs each `preHook` sequentially, and stops at the **first failure**. Cleanup then runs the `postHook` of every participation that was **started** (succeeded or failed) in the same forward order, logs cleanup failures, and throws with a message naming `deploymentId/participationId` of the failure. Finalize runs every participation's `postHook` in the same order regardless of failures and returns per-participation results. Both callers share two private helpers: `runPreHooksFailClosed(list, ctx)` → `{ started }`, and `runPostHooks(list, ctx)` → results.

**Rationale**: FR-005 to FR-008. Forward order for cleanup (not LIFO) keeps prepare-cleanup and finalize identical, so a post-hook author only has to reason about one order. Stopping at the first failure is what "fail-closed" means once N hooks exist; continuing would only produce more dumps that nothing will read. Running the failed participation's own post-hook cleans up a partial dump.

**Pre-upgrade snapshot** (`capturePreUpgradeSnapshot`, `deployment.ts:2018-2072`) uses the same helpers on the outgoing release's participations: pre-hooks fail-closed (propagating as today so `promote` decides required vs best-effort), post-hooks for every started participation in `finally`.

**Alternatives**: continue past failures and report all (rejected: more side effects for an operation that is going to abort); LIFO cleanup (rejected: two orders to document for no safety gain, since hooks are independent by construction).

## R3. Per-participation reporting on the wire

**Decision**:
- `ContractBackupPrepareResponse` keeps `jobId?` and `apps: string[]` and gains `participations: Array<{ deploymentId: string; participationId: string }>`.
- `ContractBackupFinalizeResponse.results` entries gain `participationId: string`.
- The prepare job's failure `error` reads `backup preHook failed for 1 of 3 participation(s): <deploymentId>/<participationId>`; job log lines carry both ids.

**Rationale**: FR-010/011. Additive on the wire; the provider bolt-on that only reads `jobId` keeps working. The job record has no structured result field (`jobs.ts:70-84` carries only `error`), and adding one is out of proportion; the message and the logs are where a provider looks today.

## R4. Provider cardinality guard

**Decision**: A new create-time seam `assertProviderAllowed(provides: string[] | undefined): Promise<void>` on the base `DeploymentService`, no-op there (the mock stays permissive, like `assertInstanceAllowed`), overridden in `RealDeploymentService`. It runs in `createFromDraft` immediately after `assertInstanceAllowed` (`deployment.ts:752`) and **before** the consent check, so an operator is never asked to consent to an install that will be refused. For each app-provided ref in `provides`, it scans `this.deployments.values()` (the same rehydrated map the instance guard scans) and reads each deployment's roles through `readDeploymentContracts` (degrade-safe); if any other deployment `provides` the ref it throws `ConflictError` with code `PROVIDER_EXISTS`, naming the ref, the existing deployment id and name, and "uninstall it first". Upgrades, rollbacks and restarts never pass through `createFromDraft`, so self-counting is impossible by construction.

**Rollup flag**: `buildContractRollup` sets `ContractRollup.providerConflict: true` when `providers.length > 1` (absent otherwise). The web `ProviderPanel` renders a warning row when set.

**Rationale**: Spec clarification 2 and FR-012/013. Reading N manifests at create time is the same cost `getContracts` already pays per page load and is bounded by the number of installs. Persisting `provides` on the deployment record was rejected: `grantedContracts` is already persisted and would drift from `provides` for a contract without a grant; the manifest on disk is the authority.

## R5. Coverage: recogniser, judgement, wire types

**Decision** (all pure, in `@hola/shared/contracts`):
- `DATABASE_IMAGE_FAMILIES = ['postgres', 'postgresql', 'pgvector', 'postgis', 'timescaledb', 'mysql', 'mariadb', 'percona', 'mongo', 'mongodb', 'mssql', 'cockroachdb', 'couchdb'] as const`.
- `isDatabaseImage(imageRef: string): boolean` — strip registry and path, tag and digest; take the last path segment lower-cased; match when it equals a family, starts with `${family}-`, or ends with `-${family}`. Covers `postgres:17-alpine`, `bitnami/postgresql`, `ghcr.io/immich-app/postgres:14-…`, `mysql-server`, `timescaledb-ha`, `mongodb-community-server`. Never inspects app ids.
- `judgeBackupCoverage(input: { accepts: boolean; participations: AppBackupParticipation[]; databaseServices: string[] }): ContractCoverage` — `targeted` = distinct database services named by some participation's **pre-hook** `service`; `recognised` = `databaseServices.length`; state per FR-016: not accepting → `uncovered`; `recognised > 0 && targeted < recognised` → `partial`; `recognised > 0 && targeted === recognised` → `quiesced`; `recognised === 0` → participations non-empty ? `quiesced` : `as-is`.
- Server side, `readDeploymentContracts` gains a compose read: parse the active release's `compose-override.yml`, keep services whose `profiles` is absent or intersects `deployment.selectedProfiles`, and collect names whose `image` passes `isDatabaseImage`.

**Wire**:
```ts
export type BackupCoverageState = 'quiesced' | 'partial' | 'as-is' | 'uncovered';
export type ContractCoverage = {
  state: BackupCoverageState;
  targeted: number;      // recognised database services a pre-hook quiesces
  recognised: number;    // database services the deployment runs
  participations: Array<{ id: string; service?: string }>; // service = pre-hook service
  databases: string[];   // recognised service names, for the tooltip
};
DeploymentContracts.coverage?: Record<string, ContractCoverage>;  // keyed by ref; backup@1 only today
ContractParticipant.coverage?: ContractCoverage;                   // acceptors of declared contracts
```
`hooks` on both types is kept and still emitted (deprecated in the doc comment) so nothing breaks in one release; the web derives from `coverage` and falls back to `hooks` only when `coverage` is absent.

**Rationale**: Spec clarification 3 and FR-015 to FR-019. The judgement lives in shared so the server computes it and any client renders it (FR-017) while the web tests can still exercise the pure function. Matching on the last path segment is the only rule that survives registries, org prefixes and derived images without listing every vendor.

**Alternatives**: counting participations only (cannot call postiz partial, fails FR-019); a manifest-declared list of stateful services (needs the catalog first, out of scope).

## R6. Participation mode

**Decision**: `ContractDefinition.participation: 'declared' | 'implicit'` (required on every entry; `auth`, `backup`, `push` = `declared`, `container-logs` = `implicit`). `ContractRollup.participation` exposes it. `buildContractRollup`: for an implicit contract, every entry that does not provide it lands in `acceptors` with no `hooks`/`coverage`, and `unaffiliated` is `[]`. `coerceRefs` drops an `accepts` naming an implicit contract with `logger.warn('Dropping \`accepts\` for a contract whose participation is implicit', …)`, mirroring the platform-`provides` drop at `contracts.ts:46-49`.

**Rationale**: Spec clarification 1 and FR-027 to FR-029. Putting the mode on the definition keeps the vocabulary closed and gives the rollup one branch instead of per-contract special cases.

## R7. Container-logs log source

**Decision**: a **platform-managed, redacting Docker API proxy sidecar**, run from the server's own image.

On consent, materialisation injects into the provider's compose:
1. a service `hola-docker-proxy` (reserved name; a user-authored service of that name is a validation error) with `image: ${HOLA_SERVER_IMAGE}` (default `ghcr.io/try-hola/server:${HOLA_VERSION}`, override via `HOLA_SERVER_IMAGE`), `command: ["bun", "src/docker-proxy.ts"]`, `volumes: ["${HOLA_DOCKER_SOCKET:-/var/run/docker.sock}:/var/run/docker.sock:ro"]`, `restart: unless-stopped`, the platform logging block, `security_opt: [no-new-privileges:true]`, the platform labels, **no networks other than the project default** (never the `hola` network, never host ports);
2. `DOCKER_HOST=tcp://hola-docker-proxy:2375` into every other service's `environment`.

The proxy (`packages/server/src/docker-proxy.ts`, pure logic in `packages/server/src/lib/docker-proxy.ts`) forwards **only**:

| Method | Path (optional `/v1.NN` prefix) | Treatment |
|---|---|---|
| GET | `/_ping`, `/version` | pass through |
| GET | `/containers/json` | pass through (list carries names, image, labels, state; no env) |
| GET | `/containers/{id}/json` | **redacted**: response rebuilt from an allowlist of fields (`Id`, `Name`, `Created`, `State`, `Image`, `Config.Tty`, `Config.Labels`, `Config.Image`, `Config.Hostname`) — `Config.Env`, `Config.Cmd`, `Config.Entrypoint`, `HostConfig`, `Mounts`, `NetworkSettings` are dropped |
| GET | `/containers/{id}/logs` | streamed pass-through |
| GET | `/events` | streamed pass-through |
| anything else | | `403` |

**Rationale**: FR-023 forbids start/stop/exec/create/delete, copying files out (`/containers/{id}/archive`) and reading environment variables, while the collectors the catalog will use (Alloy `loki.source.docker`, Promtail, Vector) all call **inspect** to learn a container's TTY setting and labels. That rules out every off-the-shelf option:
- a **read-only bind of `/var/run/docker.sock`**: the `:ro` mode bit restricts the filesystem node, not the protocol; the API is fully writable through it;
- a **read-only mount of `/var/lib/docker/containers`**: kernel-enforced read-only, but every container's `config.v2.json` sits there with its full `Config.Env`, so it leaks every app's secrets, and the JSON log files are only useful with the `json-file` driver;
- **path-prefix proxies** such as `tecnativa/docker-socket-proxy`: `CONTAINERS=1` opens all GETs under `/containers/`, including `archive` (file exfiltration) and unredacted `json` (env); they cannot rewrite response bodies.

A redacting proxy is the smallest thing that meets the envelope and works with real collectors. Running it from the server image avoids a new published artefact: the image is already pulled on every host, already has the socket-group access the server needs, and Bun runs the script from source (`Dockerfile` installs the workspace and runs from `src/`). The sidecar is reachable only on the provider's own compose network, so no other app can reach it (Constitution I and ADR 0004 §5's "no ambient reach" both hold).

**Revocation**: nothing persists beyond the compose project; `docker compose down` on uninstall removes the sidecar and the env. `mintContractEnv` is narrowed to contracts whose `shape === 'brokered'`, so a provisioned-only provider receives no `HOLA_CONTRACT_TOKEN` (FR-026).

**Validator pin**: no rule change. Tests assert `VOLUME_NOT_UNDER_APP_DATA` for `/var/run/docker.sock`, `/var/lib/docker/containers`, `/var/lib/docker` and `/var/run` (FR-025), and a new `RESERVED_SERVICE_NAME` error for a user-authored `hola-docker-proxy` service.

**Alternatives**: proxying the Docker API through the Hola server (makes the orchestrator the data plane for log streams, exactly what ADR 0004 §5 forbids); a platform-owned shipper sidecar that tails files and forwards (pulls log-format knowledge into the platform; the collector app is the catalog's job).

## R8. Platform labels

**Decision**: keys `sh.hola.app` (app id), `sh.hola.deployment` (deployment id), `sh.hola.name` (deployment display name), applied to every service by `applyPlatformDefaults` via a new `PlatformDefaultsRuntime.labels?: Record<string, string>`; presence of `labels` forces the rewrite path even when the env config is a no-op. Merge preserves the app's form: list form (`KEY=value`) gets entries appended/replaced by key; map form gets keys set; a user value under `sh.hola.` is overwritten. The injected proxy sidecar receives the same labels explicitly.

**Rationale**: FR-030/031. Reverse-DNS under the product domain, one namespace to document for collector bundles. Applying them in the platform-defaults layer (not a new injector) keeps "every service" semantics in one place.

## R9. `container-logs@1` definition and grant wording

**Decision**: 
```ts
{
  id: 'container-logs', version: 1, shape: 'provisioned', providerKind: 'app', participation: 'implicit',
  providerGrant: {
    kind: 'container-logs',
    label: 'Read the logs of every container on this host',
    risk: 'This app can read whatever every installed app writes to its logs — which routinely includes tokens, request paths and personal data — and can see which containers exist and how they are labelled. It cannot start, stop or reach into them. Grant it only to a log collector you trust with everything on this host.',
  },
  summary: 'Continuous read access to every container\'s logs for a trusted collector; every install is a subject.',
}
```
`ProviderGrantKind = 'apps-data' | 'container-logs'`. `providerGrantsFor`, `missingGrantConsents`, `grantsInclude` and the wizard's consent block need no change beyond the union.

## R10. Test strategy

| Area | File | New assertions |
|---|---|---|
| Coercion | `server/__tests__/bundles/manifest-backup.test.ts` | singular → `[default]`; plural kept in order; duplicate id dropped with warn; hookless/idless entry dropped; `backupParticipations` on legacy object and array |
| Vocabulary | `server/__tests__/bundles/contracts.test.ts` | four contracts; `participation` on each; implicit `accepts` dropped with warn; implicit rollup buckets; `providerConflict`; `isDatabaseImage` table; `judgeBackupCoverage` table incl. postiz shape |
| Broker | `server/__tests__/deployments/contract-broker.test.ts` | two participations in order; failure in second runs first's and second's post-hooks, not third's; failure message names `dep/participation`; finalize results carry `participationId`; prepare response `participations`; singular fixture unchanged; cross-app ordering by deployment id |
| Snapshot | `server/__tests__/deployments/*snapshot*` (extend the existing pre-upgrade snapshot test) | two participations around the tar; started-only cleanup on failure |
| Guard | `server/__tests__/deployments/contract-provider-guard.test.ts` (new) | second provider refused with `PROVIDER_EXISTS` naming the first; allowed after removal; different contract unaffected; mock base permissive |
| Rollup | `server/__tests__/deployments/contract-rollup.test.ts` | `coverage` on detail and participants from a two-database compose with one hook; profiles exclude a database; `providerConflict` |
| Mounts | `server/__tests__/routing/compose-mounts.test.ts` | `injectContainerLogsSource`: sidecar shape, `DOCKER_HOST` on every other service, idempotent, no `hola` network, labels on sidecar |
| Defaults | `server/__tests__/routing/compose-defaults.test.ts` | labels on every service; list/map merge; override under namespace; no-op config still applies labels |
| Materialise | `server/__tests__/deployments/*materialize*` or auth-provisioning | granted → sidecar present; not granted → absent; provisioned-only → no token env |
| Validator | `server/__tests__/validation/compose-validate.test.ts` | socket, log dir, parents rejected; reserved service name rejected |
| Proxy | `server/__tests__/lib/docker-proxy.test.ts` (new) | allowlist decisions; inspect redaction drops `Env`/`HostConfig`/`Mounts`; version prefix; 403 on POST and on `archive`; streaming pass-through against a fake unix-socket server |
| Tokens | `server/__tests__/auth/contract-tokens.test.ts` | no capability for `container-logs@1`; brokered-only minting |
| Web | `web/__tests__/utils/backup-coverage.test.ts`, `pages/Backups.coverage.test.tsx`, `pages/DeploymentDetail*`, `pages/InstallWizard.grants.test.tsx` | `partial` row and count; postiz fixture; provider-conflict warning; implicit-contract subjects not "uncovered"; container-logs consent row wording |
| CLI | `cli/__tests__/install.test.ts` | `--grant container-logs@1` passthrough; 409 `PROVIDER_EXISTS` message printed |

## R11. Documentation set

- `docs/adr/0004-capability-contracts.md`: status → Accepted (amended 2026-09-04); new §9 acceptor cardinality, §10 provider cardinality (incl. channel-rehearsal limit), §11 participation mode, §12 `container-logs@1` and the log-source argument, §13 platform labels.
- `docs/adr/0002-cross-app-integration.md`: a dated note under §3 / "Status of follow-on work" that `container-logs` is a contract under ADR 0004, not a third `consumes` primitive.
- `docs/OPERATIONS.md` "App backups and coverage": the partial state, the one-provider rule; a short "Container logs" paragraph.
- `docs/ARCHITECTURE.md`: platform labels and the provider grants under the deploy lifecycle.
- `CLAUDE.md` architecture notes: one bullet under ADR 0004 for cardinality, participation mode, `container-logs@1`, labels.

## R12. Follow-ups filed by this feature (FR-034)

- try-hola/apps issue: manifest schema + `bin/validate-manifest.mjs` accept the plural `backup` form; the "runs a database and declares no hooks" warning becomes per recognised database service using the same family list.
- try-hola/apps issue: postiz `temporal-postgres` participation.
- Comment on try-hola/apps#30 naming `provides: ["container-logs@1"]`, `DOCKER_HOST`, the redacted inspect, and the `sh.hola.*` labels.
