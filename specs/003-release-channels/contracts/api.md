# HTTP contract changes: Release Channels

All routes exist today (`packages/server/src/server.ts`); only payload shapes change.
Types are the `@hola/shared` names in `data-model.md`.

## Catalog

### `GET /api/catalog/apps` · `GET /api/catalog/apps/:id`
Response items gain `channels: string[]`; `version` is the newest **stable** version (absent if none).

```json
{ "id": "remo", "version": "0.10.1", "channels": ["stable", "rc"], "...": "..." }
```

### `GET /api/catalog/apps/:id/versions[?source=]`
Each item gains `channel` (always present). Malformed-channel entries are omitted.

```json
{ "items": [
  { "version": "0.10.1",      "createdAt": "…", "channel": "stable" },
  { "version": "0.11.0-rc.1", "createdAt": "…", "channel": "rc" }
], "total": 2 }
```

### `GET /api/catalog/apps/:id/versions/:version[?source=&channel=]`
`:version` may be `latest`. New optional `channel` query (default `stable`):
- `latest` → newest eligible on `channel`; none → `404 NO_VERSION_ON_CHANNEL`.
- concrete → must be eligible on `channel`; else `400 VERSION_NOT_ON_CHANNEL`.
Response gains `channel` (resolved version's channel).

## Drafts

### `POST /api/drafts`
Request gains `channel?: string`. Invalid → `400 INVALID_CHANNEL`. The draft resolves
`version` on that channel (errors above). `GET /api/drafts/:id` gains `channel`.

## Deployments

### `POST /api/deployments` (create from draft)
No request change. Behaviour:
- deployment `channel` := finalized manifest channel (default `stable`);
- single-instance guard is per app **and** channel; the recorded `instanceReason` is
  `channel` | `operator-override` | absent;
- `409` message now: `'<app>' is already installed on channel '<c>' (deployment <id>). This app is single-instance; pass --channel <name> to run a second copy on another channel the catalog offers, or --allow-multiple (CLI) / "install another" (dashboard) to force one.`
Response gains `channel`.

### `GET /api/deployments` · `GET /api/deployments/:id`
Items gain `channel` (always) and `latestVersionChannel?`. Detail additionally gains
`instanceReason?`. `latestVersion`/`updateAvailable` are computed only over versions
eligible on the item's channel.

### `GET /api/deployments/:id/update-check`
Response gains `channel` and `latestVersionChannel?`. Unchanged otherwise.

### `POST /api/deployments/:id/promote`
- `version` omitted → target = channel-filtered `latestVersion` (unchanged shape).
- `version` given but not eligible on the deployment's channel →
  `400 VERSION_NOT_ON_CHANNEL`, message: `Version <v> is on channel '<vc>'; deployment <id> follows '<c>'. Change the deployment's channel first (dashboard → Channel, or PATCH /api/deployments/<id> {"channel":"<vc>"}), then upgrade.`
- Same-version and downgrade requests keep today's behaviour.
- The draft the route creates is made with `channel: <deployment channel>`.

### `PATCH /api/deployments/:id`
Request gains `channel?: string`.
- invalid → `400 INVALID_CHANNEL`;
- valid → `channel` set, persisted, no job; response `{ "ok": true, "warnings"?: [ "…" ] }`
  where a warning is emitted when the change makes two single-instance copies of the app
  share a channel.
- May be combined with `env`/`removeEnvKeys`/`systemOverrides` in one request; the channel
  write happens even when the env part is a no-op.

## SSE

`deployment_update` events carry only `{ deploymentId, status, uptime, lastUpdated }` and
are unchanged. A channel never changes via SSE; the PATCH path invalidates the detail,
list and update-check queries so badges refresh.

## OpenAPI / api-explorer
`packages/shared/src/docs/api-explorer.ts` schema strings for `GetCatalogAppResponse`,
`GetCatalogAppVersionsResponse`, `GetCatalogAppVersionDetailResponse` (add `channel`),
`CreateDraftRequest` (add `channel?`) are updated. No new endpoints.
