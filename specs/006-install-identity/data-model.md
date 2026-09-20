# Data Model: Install Identity — Self-Describing App Data Roots

**Feature**: `specs/006-install-identity` · **Date**: 2026-09-20

Two JSON documents written per install. Neither is read by anything in this
feature (spec FR-018); this file defines them so that Sequence 5 and Sequence 6,
and any human holding a capture, have an authoritative shape.

**Locations** — two, and the split is load-bearing. `<apps-bind-root>` is
`$HOLA_APPS_BIND_ROOT` or `/srv/hola/apps` (`DEFAULT_APPS_BIND_ROOT` /
`appsBindRoot()` / `appRootFor()` / `envRecordDirFor()` in `deployment.ts`):

| Record | Path | Why there |
| --- | --- | --- |
| Identity | `<apps-bind-root>/<deploymentId>/.hola/instance.json` | Carries no secret. Inside the data root, so a copy of the folder alone is self-describing. |
| Environment | `<apps-bind-root>/.hola/<deploymentId>/env.json` | Carries secrets. A **sibling** of every data root, never inside one: `${HOLA_APP_DATA}` resolves to the data root and is bind-mounted into the app's own containers, so a record inside it is readable by the app — and by the end users of any app that serves or browses its own data directory (#478). Still under the apps bind root, which the `apps-data` grant identity-mounts read-only in its entirety, so a consented provider still captures it. |

`.hola` is reserved at both levels and can never be a deployment id, which is
`<app-slug>-<8 hex>`.

---

## Entity: Install Identity Record

**Path**: `<apps-bind-root>/<deploymentId>/.hola/instance.json` · **Mode**:
`0644` · **Carries no secret** — which is why it is the record that stays inside
the app-visible data root.

Written on every materialization of an install that has a data root.

| Field | Type | Required | Source expression | Notes |
| --- | --- | --- | --- | --- |
| `schema` | `number` | yes | literal `1` | Shape version of *this record*. Bump on any breaking shape change. |
| `writtenBy` | `string` | yes | `getHolaVersion()` | Platform build that wrote the record (`HOLA_VERSION` env → server `package.json` → `'unknown'`). Spec FR-003. |
| `writtenAt` | `string` (ISO 8601) | yes | `new Date().toISOString()` | Time of this write, not of install. |
| `deploymentId` | `string` | yes | `deployment.id` | Format `<app-slug>-<8 hex>` (`deployment.ts:135-139`). Equals the containing directory name. |
| `lineageId` | `string` | yes | `deployment.id` at first install | See *Lineage* below. Never null in a record this feature writes. |
| `app` | `string` | yes | `deployment.app` | Catalog app id. |
| `appVersion` | `string \| null` | yes | `manifest?.version ?? deployment.version ?? null` | The version being materialized. Refreshed by every upgrade (spec FR-006). |
| `channel` | `string \| null` | yes | `deployment.channel ?? manifest?.channel ?? null` | Followed release channel. Open string — no enum (ADR 0005). **Deployment-first**, unlike `appVersion`/`source`: spec 005's Join/Leave is a metadata-only `PATCH { channel }` that mints no manifest, so `manifest.channel` is only a draft-time seed and goes stale. The manifest is the fallback for pre-#428 records with no `channel`. |
| `source` | `string \| null` | yes | `manifest?.source ?? deployment.metadata.source ?? null` | Catalog source id. **On `metadata`, not top-level.** |
| `name` | `string` | yes | `deployment.name` | Operator-chosen display name. |
| `subdomain` | `string \| null` | yes | `deployment.subdomain ?? null` | DNS label. |
| `host` | `string` | yes | `rule.host` | Public host. Only available at the write site (research R3). |
| `accepts` | `string[]` | yes | `manifest?.accepts ?? []` | Versioned contract refs verbatim, e.g. `["backup@1"]` (ADR 0004). Empty array, never null. |
| `participations` | `object` | yes | see below | Backup participation ids keyed by contract ref. `{}` when none. |

### `participations`

Keyed by versioned contract ref so a reader knows which contract version an id
belongs to (spec FR-004, research R6):

```json
"participations": { "backup@1": ["app-db", "temporal-db"] }
```

- Key: `BACKUP_CONTRACT_REF` (`'backup@1'`, `shared/src/contracts.ts:206`).
- Value: `backupParticipations(manifest.backup).map(p => p.id)`
  (`shared/src/contracts.ts:311-340`). A legacy singular `backup` block normalises
  to one participation named `default`, so the shape is identical for old and new
  manifests.
- The key is **absent** when the manifest declares no backup block — not present
  with an empty array.

### Example

```json
{
  "schema": 1,
  "writtenBy": "0.11.0-rc.8",
  "writtenAt": "2026-09-20T14:02:11.418Z",
  "deploymentId": "postiz-3f9a2c7b",
  "lineageId": "postiz-3f9a2c7b",
  "app": "postiz",
  "appVersion": "2.1.0",
  "channel": "stable",
  "source": "hola",
  "name": "Postiz",
  "subdomain": "postiz",
  "host": "postiz.hola.get2know.io",
  "accepts": ["backup@1"],
  "participations": { "backup@1": ["app-db", "temporal-db"] }
}
```

---

## Entity: Install Environment Record

**Path**: `<apps-bind-root>/.hola/<deploymentId>/env.json` · **Mode**: `0600`,
in a `0700` directory (both levels of the reserved tree are `0700`) ·
**Carries secrets by design.** Deliberately **outside** the app's own data root
— see the Locations table above and the 2026-09-20 placement clarification in
`spec.md`.

| Field | Type | Required | Source expression | Notes |
| --- | --- | --- | --- | --- |
| `schema` | `number` | yes | literal `1` | Independent of the identity record's schema. |
| `writtenAt` | `string` (ISO 8601) | yes | `new Date().toISOString()` | |
| `deploymentId` | `string` | yes | `deployment.id` | The link back to the data root. Not redundant with the path: the record's parent directory is named for the install, but the record no longer sits *inside* that install's data folder, so this is what pairs the two in a capture. |
| `env` | `Record<string, string>` | yes | `appEnvOf(manifest)` — same flattening as `readActiveAppEnv`, from the manifest already read | The install's own resolved app environment. `{}` when the manifest declares none. |

**What `env` contains.** Manifest `defaultEnv` values merged with operator input,
flattened to `key → value` with `value ?? ''`. Exactly what
`appEnvOf` returns for the active release's manifest.

**What `env` deliberately excludes.** Provisioned auth environment (OIDC client id
and secret, issuer, redirect URI) is a *separate* source merged by the caller at
`deployment.ts:1687` — it is not part of `readActiveAppEnv`'s output. It is
excluded on purpose: those values are re-provisioned against the identity provider
on any future install, so capturing them buys nothing and widens the record.

### Example

```json
{
  "schema": 1,
  "writtenAt": "2026-09-20T14:02:11.421Z",
  "deploymentId": "n8n-91c4de07",
  "env": {
    "N8N_ENCRYPTION_KEY": "4f3c…",
    "GENERIC_TIMEZONE": "America/New_York",
    "DB_POSTGRESDB_PASSWORD": "s3cr…"
  }
}
```

This record is the whole reason the feature exists: restoring `n8n`'s data beside
a *freshly generated* `N8N_ENCRYPTION_KEY` yields an app that starts cleanly and
cannot decrypt a single stored credential, with no error naming the cause.

---

## Entity: Lineage Identifier

Not a document — a field on the identity record, with its own rules.

| Rule | Statement |
| --- | --- |
| Default | Equals the install's own `deploymentId` at first install (spec FR-008). |
| Stability | Unchanged by upgrade, restart, promote, rollback, reconfiguration (FR-009). |
| Writer | The platform only. Not settable by operator, app, manifest, or request (FR-010). |
| Absence | A record without one degrades to path-based inference — a legible gap, not an error (spec US3 scenario 3). |
| Future | Sequence 5 copies a source candidate's lineage forward on restore-on-install, so captures across reinstalls of one conceptual instance share it. **Not implemented here.** |

**Where it is persisted in this feature: nowhere but the record itself.** Because
it always equals `deploymentId` today, it needs no storage — it is derived at write
time. Sequence 5 is what forces it into the deployment record, at which point the
derivation becomes `deployment.lineageId ?? deployment.id`. Writing it now means
captures taken before Sequence 5 ships already carry the field.

---

## Lifecycle

| Event | Effect on both records |
| --- | --- |
| Install (first deploy) | Created. `lineageId === deploymentId`. |
| Upgrade | Rewritten; `appVersion` and `writtenAt` change. |
| Restart / start / stop | Rewritten unchanged except `writtenAt` (materialize runs). |
| Reconfigure | Rewritten; `env` reflects new values. |
| Promote | Rewritten for the promoted release. |
| Rollback (containers only) | Rewritten for the target release. |
| Rollback (data-aware) | Data root is wiped and replaced from the pre-upgrade archive — which contains *older* records — then materialize rewrites both for the release being brought up (`restoreAppDataSnapshot` before `materializeCompose` in `runLifecycleJob`). |
| Uninstall | **Both locations removed**, independently, by `removeAppData`: the whole data root (identity record with it) *and* `<apps-bind-root>/.hola/<deploymentId>/` (the environment record). The second is not conditional on the first — an install whose data root was deleted by hand must still lose its environment record, or a directory of secrets is orphaned with nothing left that knows the id needed to find it. |
| App with no `${HOLA_APP_DATA}` | Neither record created; neither directory either (FR-015). |
| Pre-upgrade snapshot | The archive tars the data root only, so it carries the identity record and **never** the environment record — which is why `data.tar.gz`, written world-readable under the process umask, holds no secrets (#478 item 2). |
| Write failure | Neither record updated; one warning naming the install; **deploy proceeds** (FR-016). |

## Invariants

1. `instance.json`'s `deploymentId` equals the name of the directory two levels
   up from it. `env.json`'s equals the name of the directory **one** level up —
   its locations differ, so the derivation does too.
2. `env.json` is never at any path under `<apps-bind-root>/<deploymentId>/`. This
   is the invariant that keeps secrets out of every app's own mount, and out of
   the pre-upgrade snapshot archive (#478); it has a dedicated test that sweeps
   the whole data root rather than checking one path.
3. `lineageId` is non-empty in every record this feature writes.
4. `instance.json` contains no secret; `env.json` may contain nothing but.
5. Both records are complete when observed — never half-written (FR-019, R7).
6. Both records exist, or neither does. A partial pair means a write failed
   between them; a reader must tolerate it. The identity record is written
   first, so a half-pair is the identity record alone.
7. Neither location outlives an uninstall.
8. Neither record is read by any Hola code path in this feature.
