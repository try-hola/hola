# Spec Prompt — Sequence 6

**Source:** Notion Spec Prompts row, https://app.notion.com/p/3e1acfdc54e8816da679c6d4967ed112
**Title:** restore@1 — the provider half: a staging grant, a snapshot index, and a provider-polled restore queue
**Repo** `try-hola/hola` + `try-hola/apps` · **Depends on** Sequence 5 (restore-on-install from a live deployment)

## What this adds

Sequence 5 built every install-side mechanism with a live deployment as the source. This makes the **backup provider** a source, which is what turns restore-on-install into an actual disaster-recovery story: restoring an app that no longer exists on this host.

By the time this lands, everything downstream of "the files are in the staging directory" has been in production for a release. The new surface is narrow: one grant, four endpoints, one poller.

## A sibling contract, not `backup@2`

The provider needs to **write**, and the `apps-data` grant is read-only on every service (`packages/server/src/services/core/compose-mounts.ts:152-153`).

If a new grant kind were attached to `backup@1`, `grantsInclude` (`packages/shared/src/contracts.ts:269-271`) would resolve it from the *table*, not from the install's consent — so **every already-installed backrest that consented to `backup@1` would silently gain write access on its next materialize.** That is precisely what `grantedContracts` exists to prevent (`packages/shared/src/index.ts:2035-2041`: *"a later release of the same app can't quietly widen it"*).

So: a new ref in `CONTRACTS`, `brokered`, `providerKind: 'app'`, `participation: 'declared'`, `acceptorBlock: 'restore'`, with a `restore-staging` provider grant and its own consent row. `assertProviderAllowed` then gives one-restore-provider-per-host for free — it has exactly one call site (`deployment.ts:845`) and is creation-only by design (`:3620-3624`). The token machinery is free too (`packages/server/src/services/auth/contract-tokens.ts:47-51`, plus one line in the capability table at `packages/server/src/middleware/auth.ts:142`).

## The staging grant

The provider must never get write access to a live app's data root. The write target is a directory the platform owns — `HOLA_RESTORE_STAGING_ROOT`, default `/srv/hola/restore` — injected `rw` by a new `injectStagingMount` modelled on `injectReadonlyMount`.

Two deliberate properties:

- **A sibling of the apps root, not a subdirectory.** A subdirectory would be captured by the provider's own backup plan (whose path *is* the apps root), silently doubling storage and creating snapshot-of-a-restore-of-a-snapshot nonsense. A sibling needs no exclude rule.
- **Same filesystem as the apps root**, so the final move is a rename. Fall back to copy + `fsync` when it is not, and say so in the job log.

Net privilege delta: one scratch directory. The provider gains no reach into any app data it did not already have read-only.

## Direction: the server queues, the provider polls

ADR 0004 has exactly one brokered direction — provider → server (`docs/adr/0004-capability-contracts.md:189-199`). The server has never called into an app, and building that would mean learning ConnectRPC, holding a credential for the provider, and crossing a trust boundary it has never crossed.

Invert it instead. This is symmetric with prepare, where the provider **already** polls the server (`packages/server/src/server.ts:1636-1640`), and backrest's bundle already contains exactly that poll loop as a heredoc script reconciled every 30s by `backrest-hola-autowire` (apps#162). A restore poller is a third script and a third clause in machinery that exists.

It also removes an option that looked available: Backrest's hook conditions are snapshot-lifecycle only (`CONDITION_SNAPSHOT_START` / `_END`) — there is no restore-triggered condition. A poller was always required.

**Provider → server** (contract token, capability `contract:restore`):

- `POST /api/contracts/restore/index` — metadata only, no app bytes cross the server. Entries carry `snapshotId`, `takenAt`, `sizeBytes`, `path`, and the `.hola/instance.json` read verbatim out of the snapshot. Replaces the index for that provider deployment; stored at `config/restore-index.json`.
- `GET /api/contracts/restore/requests` — returns `rescan` plus pending requests. `target` is **always** a path the server minted under the staging root; the provider never chooses a destination.
- `POST /api/contracts/restore/requests/:id/claim` — 200 or 409.
- `POST /api/contracts/restore/requests/:id/complete`.

A claimed-but-never-completed request expires on a timer, reusing `expireOpenPrepareIfStale`'s shape (`deployment.ts:2701-2725`) — a provider that dies mid-restore must not wedge an install forever.

`rescan: true` is the disaster-recovery path: on a brand-new host the index is empty, so the server asks the provider to re-enumerate and re-publish. Still provider→server, still no new direction.

**Server → clients:** extend Sequence 5's `GET /api/restore/candidates` with `source: "provider"` alongside the existing `"deployment"`, carrying `confidence: "marker" | "path"`.

## Tier-0 candidates

Any capture predating Sequence 4 has no marker. The app slug is still recoverable from the snapshot path by regex (`packages/server/src/services/core/metrics.ts:236`), which is enough to **offer** a candidate and never enough to auto-select one or skip the version guard. Label them honestly, require an explicit acknowledgement, and refuse the env carry-forward — there is nothing to carry.

## The backrest bolt-on (`try-hola/apps`)

A third heredoc script in `backrest-hooks-init` and a third clause in the `backrest-hola-autowire` reconciler: poll for requests, `ListSnapshots` / `ListSnapshotFiles` to build the index (reading `.hola/instance.json` out of each snapshot), and `Restore` a subtree into the server-supplied target. Backrest's API supports exactly this shape — `RestoreSnapshotRequest { plan_id, repo_id, snapshot_id, path, target }`.

Bump the manifest to `provides: ["backup@1", "restore@1"]`, which triggers the new consent row on upgrade.

## Cases this deliberately cannot serve

- **No provider installed** → no provider candidates. Correct and silent.
- **A fresh host with an empty index** requires the operator to install the provider first and point it at the existing repo, which needs the repo password — an operator-held secret entirely outside Hola. State that plainly in the docs; do not let the UI imply otherwise.
- **Restoring the provider itself** is circular (its own `/config` holds the repo passwords). Out of scope; note it.

## Also worth doing here

`judgeBackupCoverage` (`packages/shared/src/contracts.ts:439-462`) should grow a restore verdict — "quiesced but not restorable" is the honest description of every acceptor app until its `restore` block exists, and the dashboard should stop implying that a green backup badge means a recoverable app.
