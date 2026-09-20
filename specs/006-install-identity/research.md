# Research: Install Identity — Self-Describing App Data Roots

**Feature**: `specs/006-install-identity` · **Branch**: `006-install-identity` ·
**Date**: 2026-09-20 · **Base**: `main` @ `7e3e5aa` (0.11.0-rc.8)

Every decision below was taken against a read-only sweep of the code at that SHA.
Line references are to that SHA and are the ones the implementation must re-verify
before editing, since this file will age.

---

## R1 — Where the records are written

**Decision.** Both records are written by one private helper on
`RealDeploymentService`, called from inside the existing
`if (content.includes(APP_DATA_TOKEN))` branch in `materializeCompose`
(`packages/server/src/services/core/deployment.ts:1695-1699`), immediately after
`await this.storageService.ensureDir(appRoot)`.

**Rationale.** Three separate constraints all pin the write to this exact site,
and only this site satisfies all three:

1. **It makes FR-015 free.** The branch condition *is* the question "does this app
   have a data root?". An app with no `${HOLA_APP_DATA}` never enters it, so it
   gets no records and no directory without a second condition that could later
   drift out of agreement with the first.
2. **It is the only place the public host exists.** See R3.
3. **It is after the data-restore step of a rollback.** A data-aware rollback
   wipes and replaces the whole data root from a pre-upgrade archive
   (`deployment.ts:3406-3411`), which contains whatever records existed at that
   older release. `materializeCompose` runs *after* that restore (`:3414`), so the
   records are rewritten with the facts of the release actually being brought up.
   Moving the write anywhere earlier in the lifecycle job silently breaks FR-006
   and SC-010 — this is the least obvious of the three constraints and the most
   expensive to rediscover.

**Alternatives considered.**

- *Write after `readActiveAppEnv` (`:1797`), where the app env is already loaded.*
  Rejected: it would need `appRoot` hoisted out of the branch and a second
  "does this app have a data root?" test, re-introducing exactly the drift
  FR-015 avoids.
- *A separate lifecycle step after materialize.* Rejected: more surface, and it
  would run for apps with no data root unless it re-derived the guard.
- *Write at create time.* Rejected outright — Constitution III forbids per-deploy
  work at create time, and the record must reflect the release being materialized,
  which is not known at create.

---

## R2 — Reading the manifest at the write site

**Decision.** The helper calls `this.readActiveManifest(deployment)` itself. We do
**not** hoist a single manifest read to the top of `materializeCompose` and thread
it through.

**Rationale.** No manifest object is in scope at `:1697` — verified. The method
already re-reads the release manifest per-need five times per materialize:
`readActiveIngressService` (`:1645`), `readActiveSecurity` (`:1741`),
`readActiveGrantedContracts` (`:1746`), `readActiveConsumes` (`:1752`),
`readActiveAppEnv` (`:1797`) — each routing through `readReleaseManifest`
(`:2051-2053`), which is a local JSON file read of
`deployments/<id>/releases/<releaseId>/manifest.json`. A sixth read is idiomatic
and costs a file read on a path already in the page cache.

**Alternatives considered.** *Hoist one read and pass it to all six call sites.*
Rejected as out of scope: it is a refactor of five existing call sites in a feature
whose whole value proposition is that it is small and ships alone. It is a
defensible cleanup on its own merits — filed as a follow-up issue rather than done
here.

---

## R3 — The public host

**Decision.** `rule.host` is passed into the helper as a parameter.

**Rationale.** There is no persisted `host` field on the deployment record.
`EnhancedDeploymentDetail` carries `subdomain`, and `DeploymentDetail` carries
`url`, but `url` is a differently-shaped display URL and is not the routing host.
The actual public host is produced by `this.routingService.generateRule(...)` at
`deployment.ts:1644` and lives only in the local `rule` for the duration of
`materializeCompose`. Passing it in keeps the helper honest about its inputs and
avoids the helper re-deriving routing, which would be a second source of truth
for the host.

**Alternatives considered.** *Reconstruct the host from `subdomain` + base domain
inside the helper.* Rejected: duplicates routing logic that already exists in one
place, and would silently diverge the day routing changes.

---

## R4 — Field resolution order

**Decision.** Facts about **the release being materialized** come from the
finalized manifest; facts about **the install** come from the deployment record.
Where a field exists on both, the manifest wins and the deployment is the
fallback (`manifest?.version ?? deployment.version`).

| Fact | Source |
| --- | --- |
| install id, app id, display name, subdomain | `deployment.id` / `.app` / `.name` / `.subdomain` |
| app version, channel, catalog source | manifest `version` / `channel` / `source`, falling back to `deployment.version` / `.channel` / `.metadata.source` |
| public host | `rule.host` (R3) |
| accepted contracts, backup participations | manifest `accepts` / `backup` |
| platform version | `getHolaVersion()` (R5) |

**Rationale.** The manifest is the frozen description of the release that this
materialization is actually bringing up; the deployment record is the mutable
description of the install. For an upgrade, the manifest is the fact that changed —
so taking version/channel from it is what makes FR-006 true. Note `source` is on
`deployment.metadata.source`, **not** top-level (`shared/src/index.ts:2016-2075`);
this is an easy field to get wrong.

**Alternatives considered.** *Take everything from the deployment record.*
Rejected: `accepts` and the backup block do not exist there, and `version` on the
record is not guaranteed to be the materializing release's version.

---

## R5 — Platform version

**Decision.** Use `getHolaVersion()` from
`packages/server/src/services/core/system-monitoring.ts:39`.

**Rationale.** It already resolves `HOLA_VERSION` → server `package.json` version →
`'unknown'`, and `update-check.ts:17` already imports it exactly this way. It is
the canonical runtime answer to "which build am I?".

**Alternatives considered.** *A new constant or a direct `package.json` import.*
Rejected: a second source of truth for the platform version, and it would miss the
`HOLA_VERSION` env override that production containers set.

---

## R6 — Contract reference encoding

**Decision.** The record carries the manifest's `accepts` array verbatim — these
are already `id@version` refs per ADR 0004 — and records backup participation ids
**keyed by their contract ref**, so `backup@1` names the ids rather than the ids
floating free.

**Rationale.** Spec FR-004. A participation id like `app-db` means nothing without
knowing which contract version defines it. `formatContractRef`
(`shared/src/contracts.ts:219-221`) already produces the canonical form and
`BACKUP_CONTRACT_REF` (`:206`) is the existing constant. `backupParticipations()`
(`:311-340`) normalises the legacy singular block to one participation named
`default`, so the record shape is the same for old and new manifests.

**Alternatives considered.** *A flat `backupParticipationIds: string[]`.* Rejected:
bakes a version ambiguity into every capture, permanently, for zero saving. *A new
ref format.* Rejected: the vocabulary is closed and already has one.

---

## R7 — Atomicity needs no new code

**Decision.** Write both records through `this.storageService.writeFile(path,
content, mode)`. Build nothing else.

**Rationale.** `RealStorageService.writeFile` (`storage.ts:177-196`) already writes
to a temp file and renames when `config.atomicWrites` is set, and that defaults to
`true` (`:67`). It also re-asserts the mode with an explicit `fs.chmod` after the
rename, because "writeFile's mode is ignored when the file already exists"
(`:191-195`) — which matters here precisely because these records are **rewritten**
on every deploy, so the second write onward always hits an existing file. FR-019
is therefore satisfied by using the existing primitive.

**This is recorded explicitly so that nobody builds a second atomic-write path.**

---

## R8 — Failure containment

**Decision.** The whole helper body — *including the manifest read* — is wrapped in
one `try/catch` that logs `this.logger.warn` naming the deployment id and returns.

**Rationale.** FR-016. `readActiveManifest` → `readReleaseManifest`
(`:1830-1849`) **throws** a `ServiceError` on a missing or corrupt manifest. If the
catch covered only the two writes, a corrupt manifest would fail the deploy — the
exact outcome FR-016 forbids, arriving by the least obvious route.

The repository has two precedents and they disagree, so the choice is explicit:

| Precedent | Behaviour | Why it differs |
| --- | --- | --- |
| `registry.json` feed (`:3106-3118`) | warn + continue | Bookkeeping. A stale registry is a cosmetic dashboard fault. |
| `writeOidcCredentialsFile` (`:3290-3316`) | throws | A functional dependency — the app cannot boot its SSO without it. |

These records are bookkeeping, so we follow the registry precedent. An
unattributed data root is a worse backup, not a broken install, and failing a
deploy over it would be a strictly larger harm than the one being prevented.

### Amendment (found during implementation, 2026-09-20)

The catch must still enclose the manifest read — but the corrupt-manifest case it
guards is **not reachable through the normal path**, and the requirement is
narrower than first written.

`materializeCompose` reads the active manifest **unguarded** before this feature's
call site: `readActiveIngressService` at `deployment.ts:1702`, against the marker
write at `:1773`. `readReleaseManifest` throws a `ServiceError` on corrupt JSON,
and it does so deliberately — `corrupt-manifest.test.ts:154` pins it as a
**security** property: *"a corrupt manifest fails the deploy instead of shipping
the app with no auth"*, because the previous `catch { return undefined }` made a
corrupt manifest read as "no auth block" and shipped a forward-auth app publicly
reachable with the gate silently absent.

So a globally corrupt manifest fails the deploy long before these records are
written, and **that behaviour is correct and not this feature's to relax.**

What FR-016 actually promises is therefore narrower: *if this feature's own
manifest read fails, that failure must not escape the helper.* The try/catch
around it is **defence-in-depth** — against a manifest that changes between
`:1702` and `:1773`, and against a future refactor that reorders those reads —
rather than a live path. The write-failure half of FR-016 (an unwritable data
root) remains fully live and end-to-end testable.

Quickstart scenario 11 has been corrected to match, and its test brackets the
corruption tightly around the single read this feature owns, so the rest of the
materialize pass sees a good file and the deploy can genuinely succeed.

---

## R9 — Why `env.json` on disk is defensible (the FR-014 argument)

This is the decision most likely to be challenged in review, so the evidence is
recorded here and FR-014 requires the argument to live in the code comment too.

**The objection.** Writing resolved configuration values into the app data root
puts secrets where the backup provider can read them.

**Why it does not survive inspection.**

1. `injectReadonlyMount` (`compose-mounts.ts:152-168`), called from
   `deployment.ts:1751` and `:1763` with `hostPath = appsBindRoot()`,
   identity-mounts the **entire apps bind root** read-only into *every service* of
   a grant-holding deployment. There is no per-app and no per-file exclusion — its
   own doc comment (`:12-13`) says "this exposes every app's data to the consumer".
   So a consented provider can already read Gitea's `app.ini`, every database file,
   and every secret any app writes to disk.
2. The `apps-data` grant's consent text already states this in the words the
   operator agreed to: *"a read-only view of all app data — including database
   files and any secrets apps keep on disk"* (`shared/src/contracts.ts:160-169`).
3. The app's own containers already hold every one of these values as environment
   variables.

**So the incremental exposure is at-rest-on-disk versus in-container-environment,
on a host whose operator has already consented to a tool that reads everything.**

**And the gain is decisive.** Generated secrets live in
`deployments/<id>/runtime/.env` (`deployment.ts:1789-1800`) under the platform's
own data volume, which is outside the `apps-data` grant entirely. Without
`env.json`, a per-app capture is *not self-sufficient*: restoring it requires the
operator to have separately preserved the `hola-data` volume — a manual `tar`
documented at `docs/OPERATIONS.md:290-297` that nobody runs. The failure mode
without it is silent: a restored app starts cleanly with a fresh encryption key
and cannot decrypt a single stored credential.

**On the `0600` mode.** It is about ordinary and unprivileged readers — an app's
own non-root container, a support engineer poking at the folder — not about the
provider. A consented provider running as root reads it regardless, by design.

### Amendment, 2026-09-20 (post-review, issue #478)

**The argument above was sound about the reader it considered, and silent about
the one that mattered.** It reasoned entirely about a consented `apps-data`
provider. It never asked what the *app itself* can read. `${HOLA_APP_DATA}`
resolves to `<apps-bind-root>/<deploymentId>` and is bind-mounted into the app's
own containers, overwhelmingly as `/data`. A record written inside that
directory is therefore readable by the app — and, for an app that serves, syncs
or browses its own data directory (a file manager, a sync tool, a media server
with a file browser), by **that app's end users**, who are not the host
operator and have consented to nothing. The `0600` mitigation assumed non-root
app containers; many images run as root, and an app's own backup or sync feature
typically reads as root regardless.

**The fix is placement, not mode.** `env.json` moves to
`<apps-bind-root>/.hola/<deploymentId>/env.json` — a sibling of every data root,
inside no app's mount. `instance.json` carries no secret and stays exactly where
it was.

**Why up, not out.** Moving the record to the platform's own data volume would
put it back outside every grant, which is precisely the problem the feature
exists to solve (see "the gain is decisive" above). The apps bind root is
identity-mounted **in its entirety**, so a sibling directory at that level is
still inside what a consented provider captures. One read-only grant, no
platform volume — unchanged.

**What the amendment costs, stated honestly.** SC-003 is narrowed: a copy of one
app's data folder alone no longer recovers its generated configuration, because
the record is no longer in that folder. A capture of the **apps root** does. The
spec now says this explicitly rather than quietly weakening the claim.

**What it gains beyond the app-reads-own-data fix.** `capturePreUpgradeSnapshot`
tars the whole data root into `data.tar.gz` under the process umask
(world-readable `0644`), retained to the retention bound — so the previous
placement put generated encryption keys and DB passwords into a world-readable
archive, one per snapshotted upgrade (#478 item 2). With the record outside that
root the problem disappears rather than needing a `chmod` on the archive.

**The numbered argument as it now stands**, and as FR-014 requires the code
comment to carry: (a) the app's containers already hold these values; (b) the
only reader the placement exposes the record to is a consented `apps-data`
grant holder, whose consent text already declares it reads secrets apps keep on
disk; (c) writing it one level *up* is what makes (b) true rather than merely
argued; (d) it also keeps secrets out of the world-readable pre-upgrade archive;
(e) the gain is a self-sufficient capture of the apps root, with no separately
preserved platform volume; (f) the `0600` file and `0700` directory are about
ordinary unprivileged *local* readers, not about the provider.

---

## R10 — Reserved namespace (TWO reserved locations, amended 2026-09-20)

**Decision.** `.hola` is reserved at **two** levels under the apps bind root:

| Reserved path | Holds | Mode |
| --- | --- | --- |
| `<apps-bind-root>/<deploymentId>/.hola/` | `instance.json` | dir default, file `0644` |
| `<apps-bind-root>/.hola/<deploymentId>/` | `env.json` | dir `0700`, file `0600` |

The second was added by the #478 amendment (see R9). Path fragments are defined
as constants once, next to the write helper — not as scattered string literals —
and the second reuses the first's name constant so the reserved word exists in
exactly one place.

**Rationale.** No collision exists: no hits for `.hola`, `hola.json`,
`instance.json` or `lineage` under any app-data-root path in
`packages/server/src`, `packages/shared/src` or `packages/compose`.

**`.hola` can never be mistaken for an install.** A deployment id is
`<app-slug>-<8 hex>` (`newDeploymentId`), and a slug cannot begin with a dot, so
the reserved entry at the apps root can never collide with a real install
directory.

**Nothing enumerates the apps bind root** — verified across
`packages/server/src`, `packages/cli/src` and `packages/shared/src`. Every
`readdir`/`listDir` in the server is over the platform's own data volume
(`deployments/`, `drafts/`, per-deployment `snapshots/`, the log dir) or the
bundle cache; every apps-root path is *constructed* from a known deployment id
(`appRootFor`, `envRecordDirFor`) rather than discovered. The CLI touches the
apps root only as a whole (`teardown` removes it, `update` snapshots it). So no
"every entry here is a deployment" scan exists to exclude the reserved name
from today — but **any future scan MUST skip it**, and the constant's doc
comment says so.

**One confusable to flag for future readers.** `getHolaDataDir()`
(`packages/server/src/config/paths.ts:13`) resolves to `~/.hola` — the *server's
own* home directory. That is an entirely different location from either reserved
path above. The name is now reused across three scopes; the constants exist
partly so a reader greps a distinctive symbol rather than the ambiguous string.

---

## R11 — Test harness

**Decision.** Mode assertions (`0644` / `0600`) use `RealStorageService` against a
real `mkdtemp` directory, with `process.env.HOLA_APPS_BIND_ROOT` pointed at a
second `mkdtemp` directory, then `fs.stat` on the written file masked with `0o777`.

**Rationale.** `MockStorageService.writeFile` (`storage.ts:378-382`) stores content
in an in-memory `Map` and only *logs* the `mode` — it neither retains nor exposes
it, and there is no `stat`/`getMode` accessor. A mode assertion against the Mock
is impossible, and a test that appeared to check it would be checking nothing.

The harness to copy is `packages/server/src/__tests__/deployments/backup-hooks.test.ts:65-95`
(and `push-targets.test.ts:71-92`), which already stand up real
`RealStorageService` / `RealDatabaseService` / `RealLoggingService` /
`RealJobService` / `RealRoutingService` / `RealDraftService` plus
`MockDockerService` and `MockProvisionerService`, then drive
`drafts.createDraft` → `finalizeDraft` → `deployments.createFromDraft` →
`waitForJob` and assert on the resulting files.

**Alternatives considered.** *Teach `MockStorageService` to retain modes.*
Rejected as out of scope — it is a change to a shared test double used by the whole
suite, in a feature that is meant to ship small. Filed as a follow-up issue.

---

## R12 — Follow-up issues (deferred work, not TODOs)

Per the repository's hard rule, deferred work becomes tracked issues. These are to
be filed during implementation and their numbers recorded in `tasks.md`:

1. **Hoist the repeated release-manifest read in `materializeCompose`.** Six
   per-need reads of the same file per materialize (R2). A single read threaded
   through would be cleaner; it touches five existing call sites, so it is its own
   change.
2. **`MockStorageService` discards file modes.** (R11.) Any future test that wants
   to assert a mode is forced onto the real-filesystem harness. Worth fixing so
   mode-sensitive behaviour is cheaply testable.
3. **No operator-facing surface reports that a data root is unattributed.** FR-016
   warns in the server log when a record cannot be written; an operator has no way
   to see it short of reading logs. A health or coverage surface could show it —
   but that is a *reader*, so it is explicitly out of scope here (FR-018) and
   belongs with Sequence 5/6.

---

## Non-decisions (settled in the spec, restated so they are not relitigated)

The spec's `## Clarifications` and `## Assumptions` already fix: the reserved
directory and both file names; the `0644`/`0600` modes; warn-and-continue as the
failure policy; `env.json` carrying the app's own resolved `appEnv` only (not
provisioned auth env, which is re-provisioned on any future install); a schema
version field on both records; the platform version on the identity record; the
lineage default and that the platform is its sole writer; carrying lineage forward
being Sequence 5's job; and no back-fill sweep of existing installs.

## The scope boundary

**Nothing reads these records in this feature** (FR-018, SC-008). No contract
change, no catalog change, no manifest field, no API response change, no CLI
change, no UI change, no restore logic, no candidate detection. Sequences 5 and 6
are the consumers. Any design element that implies a reader is a follow-up issue,
not part of this change.
