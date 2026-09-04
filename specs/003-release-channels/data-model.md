# Data Model: Release Channels

**Feature**: `003-release-channels` · **Date**: 2026-09-03

## Channel (value)

| Rule | Value |
|---|---|
| Grammar | `^[a-z][a-z0-9-]{0,31}$` |
| Default | `stable` (when absent on a catalog entry, a draft, or a deployment record) |
| Reserved | `stable` — the floor every channel includes |
| Ordering | none between channels; eligibility is the only relation |

**Eligibility**: version on channel `v` is eligible for a deployment on channel `c` iff
`v === c || v === 'stable'`.

**Newest eligible**: among eligible entries, the maximum by `compareVersions`
(`1.3.0 > 1.3.0-rc.2 > 1.3.0-rc.1 > 1.2.0`).

## Catalog version entry (remote `catalog.json`, server-private type)

```
versions[]:
  version:   string        # existing
  channel?:  string        # NEW — optional; absent ⇒ 'stable'
  createdAt?, digest?, sizeBytes?, refs?.oci   # existing
```

**Coercion** (`coerceChannel`): absent → `'stable'`; valid string → itself; anything else →
entry **dropped** from `getApp.versions`, `getVersions`, `channels`, `version` and `latest`
resolution, with one `warn` log `{ source, appId, version, channel }`. A version string that
appears twice: first occurrence wins, later ones dropped with a `warn`.

## Wire types (`@hola/shared`)

### `CatalogApp` (list + `getApp`)
| Field | Change |
|---|---|
| `version?` | semantics: newest **stable** version; absent when no stable version |
| `channels?: string[]` | NEW — distinct channels with ≥1 well-formed version, `stable` first then alphabetical; server always emits |

### `CatalogAppVersion` (`GET /versions`)
| Field | Change |
|---|---|
| `channel?: string` | NEW — optional in the type; the server always emits it (`stable` when the entry had none); consumers read absent as `stable` |

### `GetCatalogAppVersionDetailResponse`
| Field | Change |
|---|---|
| `channel?: string` | NEW — channel of the resolved version (server always emits) |

### `CreateDraftRequest` / `Draft`
| Field | Change |
|---|---|
| `channel?: string` | NEW on request — explicit channel; validated (`INVALID_CHANNEL`) |
| `Draft.channel?: string` | NEW — resolved: request.channel ?? detail.channel ?? `stable`; always written by the server |

### `FinalizedManifest` (server, staged to disk)
| Field | Change |
|---|---|
| `channel?: string` | NEW — copied from the draft |

### `EnhancedDeploymentDetail` (persisted `metadata.json`)
| Field | Change |
|---|---|
| `channel?: string` | NEW — always written for new records; read as `?? 'stable'` |
| `instanceReason?: 'channel' \| 'operator-override'` | NEW — only on second copies of single-instance apps |

### `DeploymentListItem` / `DeploymentDetail`
| Field | Change |
|---|---|
| `channel?: string` | NEW — optional in the type so existing typed fixtures compile (SC-004); the server always emits it; clients read absent as `stable` |
| `latestVersionChannel?: string` | NEW — channel of `latestVersion` when present |
| `instanceReason?` | NEW on `DeploymentDetail` only |

### `GetDeploymentUpdateCheckResponse`
| Field | Change |
|---|---|
| `channel?: string` | NEW — the deployment's channel the offer was computed for (server always emits) |
| `latestVersionChannel?: string` | NEW |

### `CreateDeploymentFromDraftResponse`
| Field | Change |
|---|---|
| `channel?: string` | NEW — so the CLI can print the followed channel (server always emits) |

### `PatchDeploymentRequest` / `PatchDeploymentResponse`
| Field | Change |
|---|---|
| `channel?: string` (request) | NEW — validated; sets the followed channel; no job |
| `warnings?: string[]` (response) | NEW — e.g. "another single-instance copy of `<app>` already follows `<channel>`" |

## Instance reason (derivation)

Evaluated in `assertInstanceAllowed(appId, multiInstance, allowMultiple, channel)`:

```
if multiInstance                         → undefined
existing = deployments where app == appId
if existing is empty                     → undefined
if none of existing has (channel ?? 'stable') == channel → 'channel'
if allowMultiple                         → 'operator-override'
else                                     → ConflictError (409)
```

`'channel'` takes precedence over `'operator-override'` (clarification Q1).

## State and transitions

| State | Transition | Effect |
|---|---|---|
| Deployment `channel` | set at create from the finalized manifest | immutable except via PATCH |
| Deployment `channel` | PATCH `{ channel }` | validate → write → persist; running version untouched; offers recomputed on next list/detail |
| Deployment `channel` | promote/rollback | **never changes** (sticky) |
| `instanceReason` | set at create | never changes (a later channel change that causes overlap only returns a warning) |
| Catalog entry `channel` | catalog refresh | re-coerced every fetch; a re-listed version moves channels without a bundle change |

## Error codes

| Code | HTTP | Raised by | Message must name |
|---|---|---|---|
| `INVALID_CHANNEL` | 400 | draft create, deployment PATCH | the accepted grammar |
| `NO_VERSION_ON_CHANNEL` | 404 (`BundleUnavailableError`) | `getVersionDetail` (`latest`) | app, requested channel, channels that have versions |
| `VERSION_NOT_ON_CHANNEL` | 400 (`ValidationError`) | `getVersionDetail` (pinned), `resolveUpgradeTarget` | version, requested channel, the version's channel; on upgrade also how to change the deployment channel |
| (existing) single-instance `ConflictError` | 409 | `assertInstanceAllowed` | now also mentions `--channel` as the supported route to a second copy |
