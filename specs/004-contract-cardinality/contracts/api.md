# HTTP contract changes

All changes are additive on the wire except where noted. Types live in `@hola/shared` (`packages/shared/src/index.ts`).

## `POST /api/contracts/backup/prepare` (contract token, `contract:backup`)

Response gains `participations`:

```json
{
  "jobId": "job_…",
  "apps": ["postiz-1a2b", "mealie-3c4d"],
  "participations": [
    { "deploymentId": "mealie-3c4d", "participationId": "default" },
    { "deploymentId": "postiz-1a2b", "participationId": "app-db" },
    { "deploymentId": "postiz-1a2b", "participationId": "temporal-db" }
  ]
}
```

Order = execution order (ascending deployment id, then declaration order). `apps` is the distinct deployment ids in the same order (kept for existing bolt-ons). No `jobId` and empty arrays when nothing has a pre-hook.

Job failure `error` (visible on `GET /api/jobs/:id` and `GET /api/contracts/backup/status/:jobId` via the job record):

```
backup preHook failed for 1 of 3 participation(s): postiz-1a2b/temporal-db
```

## `POST /api/contracts/backup/finalize` (contract token)

```json
{
  "ok": false,
  "results": [
    { "deploymentId": "mealie-3c4d", "participationId": "default", "ok": true },
    { "deploymentId": "postiz-1a2b", "participationId": "app-db", "ok": true },
    { "deploymentId": "postiz-1a2b", "participationId": "temporal-db", "ok": false, "output": "rm: …" }
  ]
}
```

## `GET /api/contracts`

Each rollup item gains `participation` and may gain `providerConflict`; acceptors of `backup@1` gain `coverage`.

```json
{
  "items": [
    {
      "ref": "backup@1", "id": "backup", "version": 1, "shape": "brokered", "providerKind": "app",
      "participation": "declared",
      "summary": "…",
      "providers": [ { "deploymentId": "backrest-9f", "name": "Backrest", "app": "backrest", "status": "running", "granted": true } ],
      "acceptors": [
        {
          "deploymentId": "postiz-1a2b", "name": "Postiz", "app": "postiz", "status": "running",
          "hooks": true,
          "coverage": {
            "state": "partial", "targeted": 1, "recognised": 2,
            "participations": [ { "id": "default", "service": "postiz-postgres" } ],
            "databases": ["postiz-postgres", "temporal-postgres"]
          }
        }
      ],
      "unaffiliated": [ … ]
    },
    {
      "ref": "container-logs@1", "id": "container-logs", "version": 1, "shape": "provisioned", "providerKind": "app",
      "participation": "implicit",
      "summary": "…",
      "providers": [ { "deploymentId": "alloy-77", "name": "Alloy", "app": "grafana-alloy", "status": "running", "granted": true } ],
      "acceptors": [ /* every other install, no hooks/coverage */ ],
      "unaffiliated": []
    }
  ]
}
```

`providerConflict: true` appears on an item whose `providers` has more than one entry (records that predate the guard).

## `GET /api/deployments/:id`

`contracts` gains `coverage`:

```json
"contracts": {
  "accepts": ["backup@1"],
  "hooks": ["backup@1"],
  "coverage": { "backup@1": { "state": "partial", "targeted": 1, "recognised": 2, "participations": [ … ], "databases": [ … ] } }
}
```

## `POST /api/deployments` (create from draft)

New rejection, evaluated after the single-instance guard and before the consent check:

```
409 Conflict
{
  "error": "'grafana-alloy' provides container-logs@1, which 'Alloy' (deployment alloy-77) already provides. A contract has one provider per host; uninstall it first.",
  "code": "PROVIDER_EXISTS",
  "contract": "container-logs@1",
  "existing": { "id": "alloy-77", "name": "Alloy" }
}
```

The existing `GRANT_CONSENT_REQUIRED` (400) now also names `container-logs@1` when a manifest provides it and `grants` omits it.

## Catalog detail (`GET /api/catalog/apps/:id/versions/:v`) and drafts

`backup` is emitted in the canonical plural form (`AppBackupParticipation[]`). Clients reading it must accept either form (`backupParticipations`), because a server built before this feature emits the singular object.

## Compose validation (`POST /api/drafts/:id/validate` and shared validator)

New issue code `RESERVED_SERVICE_NAME` (error) for a user-authored service named `hola-docker-proxy`. `VOLUME_NOT_UNDER_APP_DATA` unchanged and now pinned for `/var/run/docker.sock`, `/var/lib/docker/containers`, `/var/lib/docker`, `/var/run`.

## Contract token

Minted only when the granted set contains a `brokered` contract. A provider of only `container-logs@1` receives no `HOLA_CONTRACT_TOKEN`/`HOLA_API_URL` env.
