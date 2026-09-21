# Backrest: becoming the `restore@1` provider (design notes, not implemented)

**Status**: prepared for review only. Nothing in this file is a committed change — it is a
description of the bundle work needed once the catalog diff (`schemas/manifest.schema.json`,
`bin/validate-manifest.mjs`, both uncommitted in this same working tree) lands and merges. Per
the repository's hard rule and Hola spec 008 (`try-hola/hola specs/008-restore-provider`) task
T123, this is a **STOP after preparing** note — no PR, no commit, no issue.

Reference: `try-hola/hola specs/008-restore-provider/contracts/manifest.md` §0 (provider manifest
shape) and §2 (bundle-side work), `research.md` R16 (why a poller, not a hook or a reconciler
clause), and `contracts/api.md` §§1-4 (the four broker endpoints the poller talks to).

---

## 1. Manifest change

`src/backrest/src/manifest.json` currently declares:

```jsonc
{
  "provides": ["backup@1"],
  "accepts": ["backup@1"]
}
```

It gains `restore@1` in `provides` — nothing else about the manifest needs to change (no new
`consumes`, no new bundle-declared compose service; the writable staging mount and the four
broker endpoints are entirely server-injected/server-hosted per manifest.md §0):

```jsonc
{
  "provides": ["backup@1", "restore@1"],
  "accepts": ["backup@1"]
}
```

This is what surfaces the new consent row in the install wizard (FR-059) — `providerGrantsFor`
picks up `restore@1`'s provider grant automatically once `provides` names it. Declaring it
grants nothing by itself; the operator's consent (recorded in `grantedContracts`) is what
produces the writable mount. Backrest's `provides: ["restore@1"]` also gets Backrest the
"one provider per host" guard for free (`assertProviderAllowed`), the same way `backup@1`
already does — no new server code needed for that part.

---

## 2. The new component: a continuously-running poller

**This is new machinery, not an extension of anything that exists today.** Two existing
components look tempting to extend and both are wrong, confirmed against the actual bundle
(`research.md` R16):

- **Not a clause in `backrest-hola-autowire`'s 30s reconciliation loop.** That loop's whole
  subject is Backrest's own local configuration — it calls `GetConfig`/`SetConfig` on
  `backrest:9898` to keep the two backup-contract hooks wired onto every repository. It never
  contacts the Hola server at all today. Its failure mode (can't read Backrest's config, e.g.
  Backrest's own login got turned on) is already handled by warning once and retrying
  indefinitely — and that is exactly the failure mode that must **not** also stall restores.
  The reconciler's subject is local config; a restore poller's subject is the Hola server. Two
  unrelated failure domains sharing one loop means a Backrest-config hiccup silently blocks
  every pending restore, or a Hola-server hiccup gets misreported as a hook-wiring problem. They
  need to fail independently.
- **Not an extension of `backup-prepare.sh`.** That script is invoked *once per snapshot*, by
  Backrest itself, as a `CONDITION_SNAPSHOT_START` Command hook — it is a hook body, not a loop,
  and it only runs when a backup snapshot starts. There is nothing about a snapshot starting
  that has anything to do with an install elsewhere on the host wanting to restore from an
  existing capture.

**Why a poller instead of a hook at all.** Backrest's hook system is snapshot-lifecycle only —
the only conditions available are `CONDITION_SNAPSHOT_START` and `CONDITION_SNAPSHOT_END` (used
today for the backup-prepare/backup-finalize pair). There is no restore-triggered condition to
hang work on: nothing in Backrest fires when the Hola server wants a capture delivered
somewhere. The provider side has no event to react to, so it has to be the one asking — a
poller, not a hook.

So this is a **third, independent long-running process** in the bundle (alongside `backrest`
itself and `backrest-hola-autowire`), added to `src/backrest/src/compose.yaml`. Candidate name:
`backrest-hola-restore-poller`. Shape, by analogy with `backrest-hola-autowire`'s own service
(same stock-image-plus-inline-script pattern, no custom build): a small script running in a loop
against `$HOLA_API_URL` using `$HOLA_CONTRACT_TOKEN` (both already injected into the provider's
compose per manifest.md §0), independent of Backrest's own API and independent of the autowire
reconciler's process, so a failure in one is not a failure in the other.

### The poller's three jobs (each a thin wrapper over `contracts/api.md`)

1. **Publish an index, on its own schedule.** `POST /api/contracts/restore/index` — enumerate
   what the provider's restic repository holds and publish the full list (`entries:
   RestoreIndexEntry[]`) as a wholesale replace, not a merge (api.md §1). This is also how the
   poller answers a `reindex: true` flag it gets back from the requests poll (api.md §2) — a
   freshly installed provider, or one whose index was discarded on a prior
   uninstall/revoke, republishes from scratch. Per capture, the poller reads whatever
   `.hola/instance.json`-shaped identity record the capture itself contains (manifest.md §2's
   closing note) to populate `RestoreIndexEntry.identity` — this is the provider's own read of
   its own repository; the server never reaches into it.
2. **Poll for pending requests and claim one.** `GET /api/contracts/restore/requests` on an
   interval (api.md §2) — lists every `pending` request addressed to this provider's deployment
   id (the provider is never told which app or install it's serving). For a request the poller
   decides to service, `POST /api/contracts/restore/requests/:id/claim` (api.md §3) — this can
   404 (`RESTORE_REQUEST_NOT_FOUND`), 409 already-claimed, or 409 expired; all are "move on,
   don't retry this one" outcomes for the poller.
3. **Deliver the capture, then report completion or failure.** The claimed request carries a
   server-minted `destination` path (never provider-suppliable) — the poller extracts/copies the
   claimed capture's bytes there, then calls `POST
   /api/contracts/restore/requests/:id/complete` with `{ outcome: 'completed' }` on success or
   `{ outcome: 'failed', reason }` on any delivery problem (api.md §4). A reported failure fails
   the waiting install without starting the app, matching spec 007's fail-closed disposition —
   the operator sees a named-provider failure message rather than the install silently
   half-succeeding. If the poller never claims or never completes before the request's
   `deadlineAt`, the install fails on the server side with `RESTORE_PROVIDER_UNRESPONSIVE`
   without the poller doing anything further — expiry is handled server-side, not by the poller
   racing a clock.

### What this note deliberately does NOT do

No script is written here. No compose service is added to `src/backrest/src/compose.yaml`. No
change is made to `backrest-hola-autowire`'s loop or to `backup-prepare.sh`/`backup-finalize.sh`.
This is prose only, describing the shape of the work per T123 — actual implementation is a
follow-up once the catalog diff in `schemas/manifest.schema.json` / `bin/validate-manifest.mjs`
(this same working tree) has merged and the platform half (spec 008) has shipped.
