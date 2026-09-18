# API contract changes

## `GET /api/settings`, `PATCH /api/settings`

- Response gains `channels?: { showPrerelease?: boolean }` (GET, PATCH, and the GET error fallback all project it).
- PATCH accepts `{ channels: { showPrerelease: boolean } }`; deep-merged.
- PATCH with a non-boolean `showPrerelease` → `400 VALIDATION_ERROR`, message `Validation failed: Show pre-release channels must be a boolean`. (Side effect: every settings validation failure is now a 400 instead of a 500.)

## `GET /api/deployments`

- New query `prerelease=true`: keeps only rows whose followed channel or running-build channel is non-stable; applied before pagination; `total` reflects the filtered count.
- List items gain `versionChannel?: string` and `multiInstance?: boolean`.

## `GET /api/deployments/:id`

- Gains `versionChannel?: string` and `multiInstance?: boolean`. `siblings`, `instanceReason`, `channel`, `latestVersionChannel` unchanged.

## `GET /api/deployments/:id/update-check`

- Gains `versionChannel?: string` (the running version's channel; `latestVersionChannel` is still the target's).

## `PATCH /api/deployments/:id { channel }`

- Unchanged (ADR 0005 §5). Used by Join/Leave and `hola channel`.

## `POST /api/deployments` (create from draft) — conflict

```
409
{ "error": { "code": "CONFLICT",
             "message": "'gitea' is already installed as 'gitea' and follows 'stable'. This app is single-instance.",
             "details": { "code": "ALREADY_INSTALLED",
                          "existing": { "id": "dep_…", "name": "gitea", "channel": "stable" },
                          "channelPublished": true } } }
```

Unpublished-channel variant message: `'<app>' is already installed as '<name>'. Channel '<c>' has no versions published for this app, so it does not count as a separate channel.` with `channelPublished: false`. No message contains `--allow-multiple`, `--channel` or "install another".

## Error-code reference (`@hola/shared/docs/api-explorer` → `API_ERROR_CODES`)

| code | status | details |
|---|---|---|
| `VALIDATION_ERROR` | 400 | — |
| `INVALID_CHANNEL` | 400 | — |
| `NOT_FOUND` | 404 | — |
| `NO_VERSION_ON_CHANNEL` | 404 | — |
| `CONFLICT` | 409 | `details.code` ∈ `PROVIDER_EXISTS { contract, existing{id,name} }`, `ALREADY_INSTALLED { existing{id,name,channel}, channelPublished }` |
| `VERSION_NOT_ON_CHANNEL` | 409 | — |
| `DRAFT_VALIDATION_FAILED` | 422 | `issues[]` |
| `PROMOTE_VALIDATION_FAILED` | 422 | `issues[]` |
