# Data Model: Beta Channel Support for Catalog Apps (Operator Model)

**Feature**: `005-beta-channel-ux` · **Date**: 2026-09-08

## Enrolment setting (system settings)

```
SystemSettings.channels?: {
  showPrerelease?: boolean      # default false; gates dashboard discovery only
}
```

- Persisted in the existing system-settings document (file-backed `RealConfigService`); Mock mirrors default and merge.
- PATCH merge: `channels` is deep-merged like `docker`/`tls`/`notifications`.
- Validation: `showPrerelease` must be boolean when present → otherwise `ValidationError` (400).
- Wire: `GetSettingsResponse.channels?`, `PatchSettingsRequest = Partial<GetSettingsResponse>`.

## Deployment record (server-side, `EnhancedDeploymentDetail`)

| Field | Type | Written | Read as |
|---|---|---|---|
| `channel` | `string` (existing) | draft → create; PATCH | followed channel (track); `undefined` → `stable` |
| `multiInstance` | `boolean?` (**new**) | create, from the finalized manifest, only when `true` | absent → single-instance |
| `instanceReason` | `'channel' \| 'operator-override'?` (existing) | create | audit fact; dashboard shows only the override as a muted note |
| `metadata.createdAt` | ISO string (existing) | create | tie-break for "oldest live copy" in the conflict |

No migration; no new persistence besides `multiInstance`.

## Derived-on-read fields (list item, detail, update check)

```
versionChannel?: string     # catalog channel of the version the copy currently runs;
                            # absent when the version is not listed or the catalog is unreachable
multiInstance?: boolean     # projected from the record
```

Derivation (`enrichUpdateInfo`, Real): entries = catalog `getVersions(app, source).items` memoized per `${source}::${app}`; `versionChannel = entries.find(v => v.version === item.version)?.channel`; `latestVersion`/`latestVersionChannel`/`updateAvailable` from `newestEligibleVersion(entries, channel)` as today.

### Pill selection (shared helper, web)

```
pillFor({ channel, versionChannel }):
  versionChannel && versionChannel !== 'stable'  → { channel: versionChannel, kind: 'build' }
  channel && channel !== 'stable'                → { channel, kind: 'follows' }
  otherwise                                      → null
```

### Leaving-note condition (web + CLI)

```
leavingNote = versionChannel !== undefined && versionChannel !== 'stable'
            → "Stays on <version> until a stable release at or above it is published."
versionChannel undefined and previous channel non-stable
            → "Stays on <version> until a stable release at or above it is published." (generic; no channel word)
```

## Already-installed conflict (409)

```
{
  error: {
    code: 'CONFLICT',
    message: string,                         # surface-neutral; names the existing copy
    details: {
      code: 'ALREADY_INSTALLED',
      existing: { id: string; name: string; channel: string },
      channelPublished: boolean
    }
  }
}
```

`existing` selection: the live copy of the app whose followed channel equals the requested channel; else the live copy with the smallest `metadata.createdAt`.

## Deployments list request

```
GetDeploymentsRequest = PageRequest & { status?: DeploymentStatus | 'all'; prerelease?: boolean }
```

`prerelease: true` → filter (status, q) → enrich all → keep `channel !== 'stable' || (versionChannel && versionChannel !== 'stable')` → paginate.

## State transitions (followed channel)

```
stable ──Join c (enrolled, c published)──▶ c
c      ──Leave c (any enrolment)────────▶ stable
```

Both are metadata writes (`PATCH { channel }`, no job). The running build never changes on a track change. An update offer exists only when `newestEligibleVersion(entries, channel) > version`.

## SDK error

```
class HolaApiError extends Error {
  status: number; code?: string; details?: unknown; requestId?: string
}
```
