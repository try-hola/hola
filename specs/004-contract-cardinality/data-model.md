# Data Model: Contract Cardinality and the Container-Logs Contract

**Feature**: `004-contract-cardinality` · **Date**: 2026-09-04

## Participation (acceptor side of a declared contract)

```
AppBackupParticipation:
  id:        string            # unique within the app; `default` for the singular form
  preHook?:  AppBackupHook     # { service, command[] } — the quiesce; names the target service
  postHook?: AppBackupHook     # cleanup; runs in finalize and in failure cleanup
```

**Declaration forms accepted from a bundle manifest** (`backup` block):

| Form | Example | Normalised to |
|---|---|---|
| singular (existing) | `{ "preHook": {…}, "postHook": {…} }` | `[{ id: 'default', preHook, postHook }]` |
| plural | `[{ "id": "app-db", … }, { "id": "temporal-db", … }]` | as given, in order |

**Validation (coercion, drop-with-warning, never throw)**:
- plural entry with no usable `id` (non-string, empty after trim) → dropped;
- plural entry whose `id` repeats an earlier one → dropped, first wins;
- entry with neither a well-formed `preHook` nor `postHook` → dropped;
- hook rules unchanged: `service` non-empty string, `command` non-empty all-string argv;
- an empty result → block absent (`undefined`).

**Wire/finalized type**: `backup?: AppBackupDeclaration = AppBackupConfig | AppBackupParticipation[]`. Readers call `backupParticipations(value)`; the coercer always writes the array. Records on disk written before this feature hold the singular object and are read through the same helper (no migration).

**Invariant across contracts**: acceptor participation is a list. `push@1` (`AppPushTarget[]`) already conforms; `backup@1` conforms after this feature; `auth@1` is one participation by nature (one identity per app) and its block is unchanged.

## Contract definition (closed table, `@hola/shared/contracts`)

```
ContractDefinition:
  id, version, shape, providerKind, providerGrant?, acceptorBlock?, summary   # existing
  participation: 'declared' | 'implicit'                                      # NEW, required
```

| ref | shape | providerKind | participation | acceptorBlock | providerGrant.kind |
|---|---|---|---|---|---|
| `auth@1` | provisioned | platform | declared | `auth` | — |
| `backup@1` | brokered | app | declared | `backup` | `apps-data` |
| `push@1` | brokered | platform | declared | `push` | — |
| `container-logs@1` | provisioned | app | implicit | — | `container-logs` |

`ProviderGrantKind = 'apps-data' | 'container-logs'`.

**Coercion additions** (`services/core/contracts.ts`): `accepts` naming an `implicit` contract → dropped with warning. Everything else unchanged.

## Provider guard (create-time invariant)

For every app-provided ref `r` in the new install's `provides`: no other deployment in the live set (the rehydrated in-memory map, identical to the single-instance guard's set) may have `r` in its active release's `provides`. Violation → `ConflictError` `{ code: 'PROVIDER_EXISTS', contract: r, existing: { id, name } }`. Evaluated after `assertInstanceAllowed` and before the consent check. Not persisted. Self is never in the set (creation-only path).

## Coverage judgement (per deployment, per declared contract with an acceptor block that quiesces; `backup@1` only today)

```
ContractCoverage:
  state:          'quiesced' | 'partial' | 'as-is' | 'uncovered'
  targeted:       number     # distinct recognised database services named by a pre-hook
  recognised:     number     # database services the deployment runs
  participations: Array<{ id: string; service?: string }>   # service = pre-hook service
  databases:      string[]   # recognised service names
```

**Inputs**: `accepts` (contains `backup@1`), `backupParticipations(manifest.backup)`, and the recognised database services of the active release's `compose-override.yml` (services whose `profiles` is absent or intersects `deployment.selectedProfiles`, whose `image` passes `isDatabaseImage`).

**State table**:

| accepts | recognised | targeted vs recognised | participations | state |
|---|---|---|---|---|
| no | any | any | any | `uncovered` |
| yes | 0 | — | ≥ 1 | `quiesced` |
| yes | 0 | — | 0 | `as-is` |
| yes | > 0 | targeted = recognised | — | `quiesced` |
| yes | > 0 | targeted < recognised | — | `partial` (includes 0 of N) |

**Recogniser**: `DATABASE_IMAGE_FAMILIES` (closed list, R5) matched against the lower-cased last path segment of the image reference (registry, path, tag and digest stripped): equal, `family-*`, or `*-family`.

## Wire types (`@hola/shared`)

| Type | Change |
|---|---|
| `ContractBackupPrepareResponse` | + `participations: Array<{ deploymentId; participationId }>` |
| `ContractBackupFinalizeResponse.results[]` | + `participationId: string` |
| `DeploymentContracts` | + `coverage?: Record<string, ContractCoverage>` (keyed by ref); `hooks` kept, marked deprecated |
| `ContractParticipant` | + `coverage?: ContractCoverage`; `hooks` kept, marked deprecated |
| `ContractRollup` | + `participation: 'declared' \| 'implicit'`; + `providerConflict?: true` |
| `ContractDefinition` | + `participation` |
| `ProviderGrantKind` | + `'container-logs'` |
| `ComposeValidationIssue.code` | + `'RESERVED_SERVICE_NAME'` |

## Rollup buckets

| participation | providers | acceptors | unaffiliated |
|---|---|---|---|
| declared | entries with `provides ∋ ref` | entries with `accepts ∋ ref` (with `coverage` when computed) | the rest |
| implicit | entries with `provides ∋ ref` | every other entry | always `[]` |

`providerConflict: true` when `providers.length > 1`.

## Provider grant injection (materialise time, provider deployments only)

| grant kind | precondition | effect on the provider's compose |
|---|---|---|
| `apps-data` | granted (declared ∩ consented) | `<appsRoot>:<appsRoot>:ro` on every service (unchanged) |
| `container-logs` | granted | service `hola-docker-proxy` added (R7); `DOCKER_HOST=tcp://hola-docker-proxy:2375` on every other service |

Contract token minted only when the granted set contains a `brokered` contract.

## Platform labels (every app service, every deployment)

| key | value |
|---|---|
| `sh.hola.app` | app id (`deployment.app`) |
| `sh.hola.deployment` | deployment id |
| `sh.hola.name` | deployment display name |

Merged into list or map form as found; platform values win under the `sh.hola.` prefix; user labels elsewhere preserved. The injected proxy sidecar carries the same three.

## Redacting proxy (request/response contract)

| allowed | response |
|---|---|
| `GET /_ping`, `/version` | pass-through |
| `GET /containers/json` | pass-through |
| `GET /containers/{id}/json` | allowlisted fields only: `Id`, `Name`, `Created`, `State`, `Image`, `Config.{Tty,Labels,Image,Hostname}` |
| `GET /containers/{id}/logs` | streamed pass-through |
| `GET /events` | streamed pass-through |
| otherwise | `403 { "message": "not permitted by the container-logs grant" }` |

An optional `/v1.NN` prefix is accepted and forwarded.
