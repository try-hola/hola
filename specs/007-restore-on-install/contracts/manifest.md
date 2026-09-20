# Contract: the app-side `restore` declaration

**Feature**: `specs/007-restore-on-install` · **Repo**: `try-hola/apps` (sibling PR)

## This is not a capability contract

`restore@1` in an app's `accepts` array names a **participation the app
declares**, read from the bundle `manifest.json`. It is not an entry in
`CONTRACTS` (`packages/shared/src/contracts.ts:146-199`), it brokers nothing
between two parties, and it carries no grant. The server reads the declaration and
acts on it directly, exactly as it already reads `backup`. FR-047 holds.

Sequence 6 is what would introduce a real `restore@1` **contract** — a provider,
a staging grant, a polled queue. Nothing here presumes its shape.

---

## Shape

```jsonc
{
  "accepts": ["backup@1", "restore@1"],

  "restore": [
    {
      "id": "default",
      "discard": ["postgres"],
      "hook": {
        "service": "mealie-postgres",
        "command": ["sh", "-c",
          "psql -v ON_ERROR_STOP=1 -U mealie -d mealie -f /backups/mealie.sql"]
      },
      "requiresEnv": false
    }
  ]
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | `string` | yes | The **backup** participation id this restores. `default` for the legacy singular `backup` block, which `backupParticipations()` normalises to one participation of that name — the form every catalog app currently uses. |
| `discard` | `string[]` | no | Data-root-relative paths removed after the files land and **before any container starts**. |
| `hook` | `AppBackupHook` | no | `{ service, command }` — reused verbatim (`shared/src/index.ts:295-298`), so the schema references the existing `$defs/backupHook`. |
| `requiresEnv` | `boolean` | no (default `false`) | `true` turns the missing-environment-record **warning** into a **refusal**. |

### The three states, and why the middle one already exists

| Declaration | Server behaviour |
|---|---|
| no `restore@1` in `accepts` | Not restorable. Nobody considered it. |
| `restore@1`, **no** `restore` block | Plain file copy back. No discards, no hook. |
| `restore@1` + a `restore` block | Discards and/or hook apply. |

The middle state is **not new**: 12 of the 17 apps that currently declare
`accepts: ["backup@1"]` carry no backup block at all. This feature gives that
existing shape a meaning — "a plain file copy back is all I need", true for every
SQLite and flat-file app — rather than inventing a state authors must adopt.

---

## Why `discard` exists

A file-level tar of a **live** `PGDATA` is read over minutes while the database
writes throughout: page 1 at T+0s, page 100000 at T+180s. That is not a snapshot,
it is a smear across time, and for Postgres a smear is corruption.
`tarGzipDir` concedes as much in its own comment — it suppresses tar's
"file changed as we read it" warning because crash-consistency is the whole of
what it promises.

The `.sql` dump the app's `backup.preHook` already writes is the real payload, and
it is already captured: every hook-declaring app in the catalog mounts
`${HOLA_APP_DATA}/backups:/backups`, inside the data root. So the correct restore
is **discard the smeared `PGDATA`, let the container `initdb` a clean cluster,
load the dump into it** — which is exactly what `discard: ["postgres"]` plus a
one-line `psql` hook expresses.

### Containment

Every `discard` path is resolved through `resolveContainedDir`
(`packages/server/src/services/core/path-containment.ts:30`) — the same guard
push targets already use (`deployment.ts:2952`). A path that resolves outside the
target data root **refuses the restore**; it is not skipped with a warning.

Resolution, not a `startsWith` test. That distinction is the subject of issue
#482 and of spec 006's review: a lexical prefix check is not a containment proof,
and `discard` is app-supplied data that names a directory for deletion — the
highest-consequence place in this feature to get it wrong.

---

## JSON-schema addition (`schemas/manifest.schema.json`)

```jsonc
"restore": {
  "type": "array",
  "items": {
    "type": "object",
    "additionalProperties": false,
    "required": ["id"],
    "properties": {
      "id":          { "type": "string", "minLength": 1 },
      "discard":     { "type": "array", "items": { "type": "string", "minLength": 1 } },
      "hook":        { "$ref": "#/$defs/backupHook" },
      "requiresEnv": { "type": "boolean" }
    }
  }
}
```

Additive only. Every manifest valid today stays valid (FR-028).

---

## Planned catalog changes

All five hook-declaring apps use `pg_dump`, so each restore hook is one `psql`
line. Every one of their Postgres services **already declares a healthcheck**, so
`up -d --wait <service>` has a real readiness signal and this imposes no
migration on the catalog.

| App | Hook service | `discard` | Hook |
|---|---|---|---|
| guacamole | `postgres` | PG data dir | `psql -v ON_ERROR_STOP=1 -U guacamole_user -d guacamole_db -f /backups/guacamole_db.sql` |
| immich | `immich-postgres` | PG data dir | `psql -v ON_ERROR_STOP=1 -U immich -d immich -f /backups/immich.sql` |
| mealie | `mealie-postgres` | `postgres` | `psql -v ON_ERROR_STOP=1 -U mealie -d mealie -f /backups/mealie.sql` |
| paperless-ngx | `db` | PG data dir | `psql -v ON_ERROR_STOP=1 -U paperless -d paperless -f /backups/paperless.sql` |
| postiz | `postiz-postgres` | PG data dir | `psql -v ON_ERROR_STOP=1 -U postiz-user -d postiz-db-local -f /backups/postiz.sql` |

Only mealie's compose was read in full during planning (`discard: ["postgres"]`,
from `${HOLA_APP_DATA}/postgres:/var/lib/postgresql/data`). **Each remaining app's
`discard` path must be read from its own `compose.yaml` at implementation time**,
not assumed from mealie's — the mount point is per-app and getting it wrong either
discards nothing (restoring the smear) or discards the wrong directory.

`-v ON_ERROR_STOP=1` is required on every hook. Without it `psql` reports success
after a failed statement, which under FR-021's fail-closed rule would hand a
partially loaded database to an app that then migrates it — the exact corruption
the fail-closed policy exists to prevent.

The twelve remaining acceptor apps need **no change**: they already declare
`accepts` with no block, which is the plain-file-copy state.

### Sequencing

The platform half is useful without the catalog PR — plain file-copy restores work
for 12 of 17 apps on day one — so the two can land independently. The
database-backed five need both.
