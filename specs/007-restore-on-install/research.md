# Research: Restore-on-Install from a Live Deployment

**Feature**: `specs/007-restore-on-install` · **Date**: 2026-09-20 · **Baseline**: `ca3d3f4` (post-spec-006)

Every line number in this document was verified by a read-only sweep of the
working tree at `ca3d3f4`. The prompt of record was written before spec 006
merged (`921c790`), so several of its anchors have moved — and three of its
claims are wrong in *shape*, not merely in position. Those are called out
individually below, because a plan that silently inherits them produces code that
guards against conditions this codebase cannot produce.

---

## R1 — Where the restore choice enters: `CreateDraftRequest`, and nowhere else

**Decision.** `CreateDraftRequest` gains `restoreFrom?: RestoreChoice`. It is not
patchable and not supplied at finalize.

**Rationale.** This is forced by three existing properties, not chosen:

| Property | Where | Consequence |
|---|---|---|
| `PatchDraftRequest` is closed to four fields | `shared/src/index.ts:1339` | A patch route for the restore choice would mean widening a deliberately narrow type |
| `updateDraft` re-hardens `appEnv` against the stored spec on every patch | `draft.ts:694-696` | Env seeded by a *patch* would be reverted by the next patch |
| `finalizeDraft` freezes `appEnv` into the checksummed `canonicalSpec` | `draft.ts:886-908` | A post-finalize env overlay breaks the property that the checksum describes what is deployed |

The restore choice determines `appEnv`. `appEnv` is only ever legitimately
established at draft creation. Therefore the restore choice is only ever
legitimately established at draft creation.

**Alternatives considered.** (a) A patch field — rejected: `updateDraft`'s
re-hardening would silently undo it, which is the worst kind of bug, one that
works in a unit test and fails in the wizard. (b) A finalize body — rejected:
finalize takes no body today and adding one to carry a value that must be
reflected in the checksummed spec is a contradiction. (c) A separate
"restore plan" resource joined at create-deployment time — rejected as a second
lifecycle for one boolean-plus-id, with its own orphan-cleanup problem.

---

## R2 — Only the catalog draft path accepts a restore choice; install-by-ref refuses it

**Decision.** `restoreFrom` is honoured on the catalog path. On the
install-by-ref path it is **rejected with an error**, never ignored.

**Rationale.** `resolvePlatformTokens` seeds `appEnv` at **two** call sites:
`draft.ts:473` (catalog) and `draft.ts:606` (install-by-ref). The prompt named
only the first. Honouring the choice on one path and silently dropping it on the
other is precisely the silent-empty-restore failure the spec exists to prevent
(spec §"The failure this exists to prevent"): the operator asks for their data,
the install succeeds, and the data is not there.

Install-by-ref is excluded rather than supported because a candidate's version
skew is judged against catalog upgrade metadata (`checkUpgradePath`, R15), and
the install-by-ref path deliberately has no catalog index to consult — `draft.ts`
already fails closed there for channel resolution (`channel: STABLE_CHANNEL`,
`channelPublished: false`, `:634-635`), for the same reason. Rather than invent a
weaker version check for one path, this feature declines the path.

**Alternatives considered.** Supporting install-by-ref with the version check
skipped — rejected: it would make the *least* inspectable install path the *only*
one that restores data without a skew check. Silently ignoring `restoreFrom`
there — rejected outright; fail closed.

---

## R3 — The choice reaches the deploy job on the deployment record, not in the job payload

**Decision.** Persist the restore choice on the deployment record (spec FR-010).
Add no new job-payload key.

**This corrects the prompt.** The prompt states the lifecycle payload is
`{ releaseId, action, deploymentId }`. It is not:

```ts
// deployment.ts:1186-1197 (maybeStartJob)
deploymentId,                          // :1192 — a sibling Job field
payload: { releaseId, action: 'deploy' } // :1193 — two keys, not three
```

`deploymentId` has never been a payload key. Extra payload keys do exist — the
rollback path sets `restoreData` and `targetReleaseId` at `:1541-1549` — so the
prompt's *instinct* (that a payload key was available) was reachable, just not by
the route it described.

**Rationale for the record over a payload key**, which is the substantive
decision:

1. **A payload does not survive a retry.** The record does. If the deploy job is
   re-run, a payload-borne choice is either lost or replayed depending on how the
   job was re-created — neither is a defensible answer to "should this install
   restore?".
2. **FR-012 is a fact about the deployment, not about one job.** "The restore
   applies to the first deploy only" is history. History belongs on the record
   that persists, next to the `restoredAt` marker that records consumption.
3. **It matches `channel`'s route exactly** (`deployment.ts:1028`), which is the
   precedent the prompt correctly identified even while misdescribing the payload.

Rollback's `restoreData` is a genuinely different case and stays a payload key:
it is a property of *that rollback invocation*, chosen at the moment the operator
clicks rollback, and is meaningless outside it.

---

## R4 — `lineageId` becomes a persisted deployment-record field

**Decision.** Add `lineageId` to the deployment record. Set it to the deployment's
own id on a fresh install and to the candidate's lineage on a restore. Change
`writeInstanceMarkers` to read it.

**Rationale.** The shipped code already specifies this change, in the file that
will perform it:

```ts
// deployment.ts:3366-3374, inside writeInstanceMarkers
// Derived, not persisted ...: it always equals `deploymentId` today, so it
// needs no storage of its own — Sequence 5 (restore-on-install) is
// what forces a `lineageId` onto the deployment record, at which
// point this expression becomes `deployment.lineageId ?? deployment.id`.
lineageId: deployment.id,
```

The `?? deployment.id` fallback is what makes this a zero-migration change: every
deployment record written before this feature has no `lineageId`, reads as
`undefined`, and falls back to exactly the value it has always had. **No backfill
is required, and no identity record already on disk is wrong.** Spec 006 wrote
the field into every record precisely so that captures taken before this feature
would already carry it.

---

## R5 — Candidate discovery: deployments plus their identity records, restricted to settled states

**Decision.** A candidate is an existing deployment of the same app, other than
the one being created, that (a) is in a settled state — running or stopped —, and
(b) has a data root holding app data. Describe it from its identity record, with
the live deployment record as the per-field fallback.

**Rationale.**

- **"Holds app data"** is already a solved question with a subtle answer:
  `dirHasContents(appRoot, [INSTALL_MARKERS_DIR])` (`snapshot-fs.ts`, used at
  `deployment.ts:2513`). The marker directory must be excluded or *every*
  materialised install looks like it has data — spec 006's own review caught this
  as a data-loss path. Candidate discovery reuses the identical call rather than
  re-deriving the rule.
- **Settled states only** (spec FR-004a). A deployment mid-deploy, mid-promote or
  mid-rollback is being written by the platform itself; its data root may be
  mid-replacement by `restoreTarGzInto`, which `rm -rf`s the destination before
  extracting. An `error`-state deployment may hold a partially restored tree
  (FR-022a deliberately leaves it in place). Capturing either produces a corrupt
  source silently.
- **Identity record first, deployment record as fallback** (FR-003). For *this*
  slice both are present and the deployment record would suffice — but `lineageId`
  exists only in the identity record for installs that predate R4, and reading the
  record here is what makes the same code path work unchanged when Sequence 6
  replaces "a live deployment" with "an archive".

**Alternatives considered.** Deriving candidates purely from deployment records —
rejected: loses `lineageId` for pre-R4 installs and builds a discovery path
Sequence 6 would have to rewrite. Offering error-state deployments with a warning
— rejected: a partial tree is not a thing to warn about, it is a thing to exclude.

---

## R6 — Candidates are served by a new platform API read route

**Decision.** A new read route, keyed by app, that does not require a draft.

**Rationale.** FR-047's prohibition is on *capability-contract* endpoints — the
`/api/contracts/...` broker surface governed by ADR 0004. It is not a prohibition
on ordinary platform API routes, and reading it as one would leave the feature
with no way to show the operator anything.

The route is forced rather than chosen:

- **A field on the draft-creation response is circular.** The restore choice is
  the wizard's *first* step (FR-038) and is an input to draft creation (R1). The
  client would need a draft in order to learn what to put in the draft request.
- **`--restore-list` must work without creating a draft at all** (FR-043).
  Creating and discarding a draft to answer a read-only question is a side effect
  in a listing command.

**Alternatives considered.** Extending the catalog app-detail response — rejected:
candidates are a fact about *this host's deployments*, not about the catalog, and
`RealCatalogService` fetches a remote index (Constitution II). Putting it on the
deployments list with a filter — rejected: the answer needs per-candidate derived
fields (carriesEnv, version skew, warnings) that do not belong on a generic list.

---

## R7 — Capture staging: under the target, deleted in `finally`, with no separate extraction

**Decision.** Tar the source's data root to a staging file under the **target**
deployment's own directory, distinct from the pre-upgrade snapshot store, and
delete it in a `finally` regardless of outcome. Extract straight into the target
data root — there is no intermediate extracted copy.

**Rationale.** The disk arithmetic is the decision. An app data root can be tens
of gigabytes, and a naive stage-then-move design holds three copies at once (the
archive, the extracted staging tree, the final data root). It does not have to:

```ts
// snapshot-fs.ts
tarGzipDir:      tar -czf <dest> ... -C <srcDir> .   // contents, ROOT-RELATIVE
restoreTarGzInto: rm -rf destDir; mkdir -p destDir; tar -xzf <src> -C <destDir>
```

Because the archive is root-relative and the extractor targets a directory, the
payload can be extracted **directly into the target data root**. Peak additional
cost is one compressed archive (SC-013).

**Under the target, not the source**, for three reasons: it is deleted with the
target on uninstall if anything ever leaks; it does not enter the *source's*
`pruneSnapshots` retention, where it would either be pruned mid-restore or
displace a real pre-upgrade snapshot; and a failed restore's staging file is
found next to the failed install an operator is inspecting, not next to a healthy
unrelated app.

**Note the ordering hazard this creates and R8 resolves**: `restoreTarGzInto`
`rm -rf`s its destination. The destination is the app data root, which
`materializeCompose` has already populated with `.hola/instance.json`. That is
survivable *only* because FR-018 rewrites the marker afterwards — and is exactly
why FR-019 must move the OIDC file write to after the restore.

---

## R8 — Placement in `runLifecycleJob`, and the exact order

**Decision.** Insert into the `deploy / start / rollback` branch
(`deployment.ts:3780-3821`), **after** the cancellation check at `:3813` and
**before** `composeUp` at `:3815`.

Current branch, verified:

| Line | Call |
|---|---|
| 3789-3793 | rollback `restoreData` branch (`composeDown`, `restoreAppDataSnapshot`) |
| 3796 | `provisionAuth` |
| 3797 | `materializeCompose` (creates the app root, writes `.hola/instance.json`) |
| **3800** | `writeOidcCredentialsFile` ← **moves** |
| 3805 | `resolveRegistryAuth` |
| 3807 | `composePull` |
| 3813 | `ctx.isCancelled()` |
| **←** | **restore inserts here** |
| 3815 | `composeUp` |
| 3818 | `completeAuthWiring` |

Ordering within the restore, each step justified:

1. **Assert the target root holds no app data** (FR-014) — `dirHasContents(appRoot,
   [INSTALL_MARKERS_DIR])`, the same ignore-list as R5. Refuse if it does.
2. **Re-resolve the candidate and re-check it is settled** — it may have been
   deleted or started a lifecycle action since the draft was created (spec Edge
   Cases).
3. **Quiesce and capture the source** (R14, FR-015).
4. **Extract into the target root** (R7). This `rm -rf`s the root, destroying the
   marker written at `:3797`.
5. **Assert the payload is present** (FR-016, R9).
6. **Apply `discard` paths** (R13, FR-017).
7. **Rewrite `.hola/instance.json`** (FR-018) — restores the marker step 4
   destroyed, *and* corrects it to describe the new install rather than the source.
8. **Write the OIDC credentials file** (FR-019) — after step 4, not before.
9. **Start only the hook services and wait** (FR-020, R12).
10. **Run restore hooks fail-closed** (FR-021).

Then `composeUp` at `:3815` starts everything else unchanged.

**Why after the pull rather than before it.** Pulling first means a restore is not
attempted at all for an install that cannot get its images — the cheaper failure
happens first, and the expensive capture of a live source is not wasted. It also
puts the restore after the cancellation check, so a cancelled install has not
quiesced somebody else's database.

**Why inside the job and not at create time.** Constitution III. The capture runs
`pg_dump` in a live container and tars tens of gigabytes; it is exactly the
"slow, side-effectful, failure-prone" work the principle exists to keep out of
request handlers.

---

## R9 — FR-016 is a post-condition, not a subtree search

**Decision.** Assert after extraction that the target data root holds app data
(ignoring the marker directory). Do **not** search for a nested payload directory.

**This corrects the prompt.** The prompt lists as trap (c):

> The subtree must be located, not assumed. A restore recreates the absolute path
> structure under the target, so the payload is at `<staging><candidate.path>`,
> not at `<staging>`.

That is a true and important statement **about a provider's archive tool** —
restic, borg and tar-with-absolute-paths all reproduce the source's absolute path
under the restore target. It is not true of this codebase's own helpers, which
use `-C <dir> .` on the way in and `-C <dir>` on the way out (R7) and are
therefore root-relative in both directions.

Writing a subtree search into this slice would be code defending against a layout
this slice cannot produce — untestable except by constructing an archive the
system never creates, and a maintenance liability that reads as a mystery to the
next person.

Stating the requirement as the **outcome** ("the payload must actually be there")
rather than the mechanism gives the same protection against the real failure —
an empty-looking restore that reports success — and holds unchanged when
Sequence 6 introduces an archive shape where the subtree question is live. The
trap is recorded here so Sequence 6 inherits it rather than rediscovering it.

---

## R10 — `writeOidcCredentialsFile` moves to after the restore

**Decision.** Move the call from `:3800` to inside the restore sequence, after
extraction (R8 step 8). When no restore is requested, it must run exactly where
it runs today.

**Rationale.** `writeOidcCredentialsFile` (`:3673-3700`) writes the provisioned
OIDC credentials into the app's data root, so a bundle sidecar can render the
app's SSO config before first boot. `restoreTarGzInto` `rm -rf`s that data root.
Written before the restore, the file is destroyed by it, the sidecar finds
nothing, and the app boots without SSO — reporting no error at any layer. Immich's
`immich-oidc-init` bolt-on is the concrete instance; the shape is general.

**Implementation constraint.** The no-restore path must not change (FR-023).
Moving the call unconditionally would reorder it relative to `composePull` for
every install on the host, which is a behaviour change outside this feature's
remit. The call site therefore becomes conditional on whether a restore is being
performed.

---

## R11 — The instance marker is rewritten after the restore

**Decision.** Call the existing marker writer again, after extraction and
discards, before any container starts.

**Rationale.** Two independent reasons, either sufficient:

1. **The restore destroys it.** Step 4 `rm -rf`s the data root including
   `.hola/`. Without a rewrite the new install has no identity record at all.
2. **The restored tree carries the source's record.** The archive contains the
   *source's* `.hola/instance.json` — its `deploymentId`, its `name`, its `host`.
   Extracted verbatim, the new install claims to be the old one. Every capture
   taken afterwards inherits the lie, and a restore chain compounds it.

The rewrite is not new code: `writeInstanceMarkers(deployment, appRoot, host)`
already exists (`:3322`) and already computes every field correctly — including
`lineageId`, which after R4 reads the carried lineage rather than the new id,
which is exactly the behaviour SC-007 asserts.

---

## R12 — `composeUp` gains a service list and a wait; the timeout is parameterised

**Decision.** Widen `composeUp` to accept `{ services?: string[]; wait?: boolean;
timeoutMs?: number }`. Implement in the interface (`docker.ts:67`), Real
(`:231-269`) and Mock (`:722-725`). Rely on the service's own healthcheck.

**This is genuinely new work.** There is **no `--wait` anywhere in `docker.ts`
today** — verified by search. The current Real implementation is:

```
docker compose -f <file> -p <project> up -d          // :247
```

with a 5-minute `execAsync` timeout at `:248`, and `profiles` travelling via the
`COMPOSE_PROFILES` environment variable (`withComposeProfiles`, `:192-195`) rather
than a CLI flag. The prompt's `{ services?: string[]; wait?: boolean }` is correct
in intent; it is not a small change.

**The timeout must be parameterised, and this is not optional.** `--wait` blocks
until every named service is healthy. A Postgres restore starts a *freshly
initdb'd* cluster (R13) — on a slow disk, with a large `shared_buffers`, or under
`pgautoupgrade`, that can approach or exceed five minutes. Inheriting the existing
5-minute cap would turn a slow-but-correct restore into a failed install, which
under FR-022 means the operator loses the whole install. The restore's wait
therefore passes its own, larger timeout.

**Why the app's healthcheck rather than a poll.** A bespoke readiness poll would
need per-app knowledge of what "ready" means for that datastore — the exact
per-app branching Constitution V forbids. Compose's `--wait` consumes the
healthcheck the app already declares. The catalog survey confirms this costs
nothing: **all five** hook-declaring apps already declare a healthcheck on their
Postgres service. An app whose hook service declares none is a declaration bug,
surfaced as a refusal (FR-020) rather than papered over with a timer.

**Mock behaviour matters** (Constitution IV). `MockDockerService.composeUp` must
accept and record the new options and continue returning success. A mock that
ignores `services` would let every test pass while the real path started the wrong
containers.

---

## R13 — `discard` paths, and why they exist

**Decision.** `discard` is a list of data-root-relative paths removed after
extraction and before any container starts. Every path is resolved through
`resolveContainedDir` (`path-containment.ts:30`), exactly as push targets already
are (`deployment.ts:2952`).

**Rationale — why discarding is *required*, not a convenience.** A file-level tar
of a **live** `PGDATA` is read over a window of minutes. Page 1 is read at
T+0s and page 100000 at T+180s, with the database writing throughout. The result
is not a snapshot; it is a smear across time, which for Postgres is corruption.
`tarGzipDir` says as much in its own comment — it suppresses tar's
"file changed as we read it" warning because crash-consistency is all it promises.

The `.sql` dump written by the app's `preHook` is the real payload, and the
catalog survey confirms it is captured: **all five** hook apps mount
`${HOLA_APP_DATA}/backups:/backups`, inside the data root. So the correct restore
is: discard the smeared `PGDATA`, let the container `initdb` a clean cluster, and
load the dump into it.

**Containment.** A discard path is app-supplied data that names a filesystem path
for deletion. `resolveContainedDir` resolves it and confines it to the data root;
a path that resolves outside is refused (FR-017). This is the same guard push
targets use, and the reason spec 006's review and issue #482 both landed on
resolution rather than a `startsWith` test: lexical prefix checks are not
containment proofs.

---

## R14 — Quiescing and restore hooks both reuse the existing fail-closed policy

**Decision.** Capture-side quiescing reuses `runPreHooksFailClosed`
(`:2684-2701`) and `runPostHooks` (`:2709-2724`) with `BackupParticipant`
(`:112-117`) unchanged. Restore-side hooks reuse the same policy.

**Rationale.** The policy is already correct and already reviewed: hooks run in
declaration order; a failure propagates; cleanup runs the `postHook` of every
**started** participation only. That started-only rule is not incidental — it is
the same rule the contract broker's prepare/finalize applies, and it exists so a
cleanup never runs against a participation whose pre-hook never ran.

For restore hooks, fail-closed is the whole point (FR-021). A half-loaded database
handed to an app that then runs its own migrations is a corruption the operator
will not detect until much later.

**Alternatives considered.** A best-effort restore hook with a warning — rejected
against spec §"The failure this exists to prevent": a warning in a job log is not
a thing an operator reads before trusting their data.

---

## R15 — Version skew: three rules, only one of which `checkUpgradePath` can express

**Decision.** Judge each candidate with three rules, in order:

| Relationship (candidate → target) | Outcome | Source of the rule |
|---|---|---|
| Candidate version **unknown** | Allow **only** with an acknowledgement code | This feature (R16) |
| Candidate **newer** than target | **Refuse** always | **This feature** |
| Candidate older, path guarded | **Refuse**, surface `suggestedVersion` | `checkUpgradePath` |
| Candidate equal, or older with a clean path | Allow | `checkUpgradePath` |

**This corrects the prompt.** The prompt delegates all four rows to
`checkUpgradePath`. It cannot carry two of them:

```ts
// shared/src/index.ts:423-460
if (!meta || !fromVersion || !toVersion) return { ok: true };   // unknown ⇒ OK
if (!isNewerVersion(toVersion, fromVersion)) return { ok: true }; // downgrade ⇒ OK
```

A candidate newer than the target is, in `checkUpgradePath`'s terms, a
*downgrade* — and downgrades pass through deliberately, because the function was
written to guard **promotes**, where rollback is a legitimate operation the
caller owns. Restoring newer data into an older release is not a rollback: there
is no release to roll back to, and the data may use a schema the older binary
cannot read. The rule must therefore be stated independently, and the spec's
FR-029 does.

The same is true of the unknown-version row: `checkUpgradePath` returns `ok` when
either version or the metadata is missing. The prompt noticed this ("since
`checkUpgradePath` returns ok for unknown versions") and reached the right
conclusion — an explicit acknowledgement — without noticing that the newer-than
row has the identical problem.

`checkUpgradePath` is reused verbatim for the two rows it *does* express. Its only
two production call sites today are `deployment.ts:1104` and `:3178`, both on the
promote path; this adds a third, on a different axis, with the candidate's version
as `from` and the install's version as `to`.

---

## R16 — Acknowledgements are codes, modelled on `grants`

**Decision.** The restore choice carries `acknowledge?: string[]`. The server
computes which codes the chosen candidate requires and refuses the create when
one is absent.

**Rationale.** The platform already has exactly this pattern, one type away:

```ts
// shared/src/index.ts:2257-2289, CreateDeploymentFromDraftRequest
// Capability contract grants the operator consents to (ADR 0004 §4) ... The
// server intersects this with what the manifest actually declares in `provides`
// ... and REJECTS the install when a declared grant is missing: an app whose job
// is acting on other apps' data, installed without the access to do it, fails
// silently at the worst possible moment. Client-supplied — the wizard's consent
// checkboxes, the CLI's `--grant`.
grants?: string[];
```

The reasoning transfers without modification: a risk the operator did not
acknowledge must fail the install loudly, at create time, not silently at run
time. Reusing the shape means the wizard's checkbox and the CLI's flag are the
same mechanics operators already know, and FR-046's non-interactive equivalent is
buildable rather than merely mandated.

*(Note the correct type name: there is no `CreateDeploymentRequest` in this
codebase. It is `CreateDeploymentFromDraftRequest`.)*

Two codes are defined (see data-model.md): one for an unverifiable version
relationship, one for configuration that cannot be carried.

---

## R17 — Carrying configuration: the three-case merge, reading from the sibling record

**Decision.** Seed the draft's `appEnv` from the candidate's environment record
using `mergeUpgradeAppEnv` (`upgrade-env.ts:35-44`) unchanged.

Its three cases are exactly the rule this feature needs:

```ts
if (hasOwnProperty(carriedAppEnv, entry.key)) return { ...entry, value: carried };  // carried wins
if (entry.generate && !entry.value)  return { ...entry, value: generateSecretValue(entry.generate) }; // mint
return entry;                                                                       // ride through
```

Its only production call site today is `server.ts:1295` (the upgrade path); this
adds a second.

**Where the record is read from — and the correction this forces.** The prompt
says the environment record is read from "the candidate's `.hola/env.json`",
inside the data root. Spec 006 shipped it **outside** the data root:

```ts
// deployment.ts:2474-2475
private envRecordDirFor(deploymentId: string): string {
  return `${this.appsBindRoot()}/${INSTALL_ENV_ROOT_DIR}/${deploymentId}`;
}
```

For this slice that is convenient rather than limiting — the source is a live
deployment on the same host, so the server reads the record directly from the
apps root. But it means a **captured data root alone does not carry
configuration**, which is a fact Sequence 6 must confront and this document
records so it is not rediscovered late.

**Deriving severity rather than asking the catalog** (FR-033). When the record is
absent, the keys that matter are computable: an `AppEnvVar` (`:903-958`) with
`isSecret: true` **and** a `generate` recipe is a value the *platform* invented,
which restored data may depend on and which will be minted fresh. Naming those
keys is strictly better than a manifest field an app author would have to
remember to set, and it cannot go stale.

---

## R18 — The manifest `restore` block reuses `AppBackupHook` verbatim

**Decision.** A per-participation `restore` block keyed by backup participation
id, reusing `AppBackupHook` (`:295-298`, `{ service, command }`) for the hook.

**Rationale.** A second hook format would be a second thing to validate, document
and get wrong, for no expressive gain — a restore hook is a command run in a named
service, which is what `AppBackupHook` already is. The catalog schema already
carries `$defs/backupHook`, so the schema change references an existing definition.

**Keying by participation id** follows spec 004's cardinality model: an app with
two stateful services declares two backup participations, and each needs its own
restore. `backupParticipations()` already normalises the legacy singular block to
one participation named `default`, so the five catalog apps that use the singular
form (all of them — the survey found no plural declarations in the catalog) map
cleanly without a migration.

**`accepts: ["restore@1"]` with no block** is the meaningful third state. The
survey shows **12 of 17** acceptor apps already declare `accepts` with no backup
block — so this state exists in the catalog today and this feature gives it
meaning rather than introducing it.

*(`restore@1` here names a participation the app declares, not a capability
contract the platform brokers. `CONTRACTS` (`contracts.ts:146-199`) gains no
entry — see R19 and FR-047.)*

---

## R19 — The pre-existing dead `restore` surface is not touched

**Decision.** Leave it entirely alone. File a follow-up issue noting the adjacency.

**What exists.** A complete restore API stub, unrelated to this feature:

| Thing | Where | State |
|---|---|---|
| `POST /api/backups/:id/restore` | `server.ts:1663-1668` | Parses the body, **discards it**, returns `{ jobId: crypto.randomUUID() }` — no job is ever created |
| `RestoreBackupRequest` / `RestoreBackupResponse` | `shared/src/index.ts:1720-1721` | Declared, used only by the stub |
| `JobType` includes `'restore'` | `shared/src/index.ts:587` | Never produced by any real job |
| `Backups.tsx`, `useBackupsApi.ts`, `BackupCoverage.tsx` | `packages/web` | A full UI talking to the fake endpoint |

This is scaffolding from a pre-`backup@1` design, superseded by the hook and
snapshot machinery. Open issue **#160** ("Implement real Backups and Notifications
(currently empty stubs)") already tracks it.

**Why not touch it.** There is no actual collision: this feature adds a different
route (candidates, keyed by app), different types (`RestoreChoice`,
`RestoreCandidate`), and **no new job type at all** — it rides the existing deploy
job. Deleting the stub would remove an operator-visible page, which is a product
decision outside this feature's scope boundary and squarely inside #160's.

**Why record it anyway.** The vocabulary is adjacent enough that an implementer
reaching for "the restore request type" could plausibly find `RestoreBackupRequest`
and wire this feature into a dead endpoint. Naming it here is cheaper than
discovering it in review.

---

## R20 — A failed restore leaves everything in place

**Decision.** The deployment stays in `error` state and its data root is left
untouched. Nothing is deleted automatically. Such a deployment is excluded from
future candidacy (R5).

**Rationale.** This is what a failed deploy already does — the `catch` in
`runLifecycleJob` sets `status = 'error'` and persists. Matching it means no new
failure semantics to learn. More importantly, automatic cleanup would delete the
single most useful artifact for diagnosing the failure, and deleting an operator's
data root unprompted is a destructive action the platform does not take on its own.
The existing uninstall path already removes both the data root and the sibling env
record (`removeAppData`, `:4271-4304`) when the operator decides.

---

## R21 — Wizard: a first step that re-creates the draft

**Decision.** Insert a restore step at index 0 of `steps`
(`InstallWizard.tsx:29-36`), before Configuration. Changing the choice deletes and
re-creates the draft.

**Rationale.** Forced by R1: Configuration renders `appEnv`, and `appEnv` is
seeded by the restore choice at draft creation. A restore step *after*
Configuration would display env the choice is about to invalidate.

Re-creating the draft is the established pattern, not a workaround — `switchChannel`
(`:507-549`) already deletes the draft and re-creates it on a channel change,
deliberately resetting consent. The same reasoning applies with more force here:
a restore changes which secrets the install will use.

Carried values render as ordinary `appEnv` rows through the same masking the
wizard already applies to every minted secret (minting at `:449-454`; the
mask/reveal UI at `:1187-1372`). They are deliberately **not** a privileged
visual class — an operator reviewing configuration should not have to learn a
second widget to see a carried key.

---

## R22 — CLI: four flags, mirroring `--grant`, defaulting to no restore

**Decision.** `--restore-from <id>`, `--restore-from latest`, `--no-restore`,
`--restore-list`, plus an acknowledgement flag (R16). Parsing mirrors
`parseGrants` (`install.ts:82-93`).

**The default is the decision.** With no flag, no restore happens (FR-044). A
candidate existing is not consent to use it; silence must never overwrite an
operator's install decision with a guess. `--no-restore` exists to make the
intent explicit in a script, not because it changes the default.

Refusal hints are built from structured `details`, never from message text —
`deploy-flow.ts:137-155` already establishes this, with the comment explaining
why: the server's message is deliberately surface-neutral and contains none of
the CLI's flags.

---

## R23 — Deferred work (issues, never inline TODOs)

Repository hard rule. Each of these becomes a filed issue during implementation:

1. **The dead `/api/backups/:id/restore` stub and its UI** (R19) — note the
   adjacency to this feature's vocabulary; points at #160.
2. **`install-markers.test.ts:704` carries a stale line-number comment** — it
   cites `~:3410`/`~:3414` for the restore-before-materialize ordering; the real
   lines are `:3793`/`:3797`. The ordering claim is still true. A trivial fix,
   but it is evidence that line-number comments rot, so the issue should propose
   the comment cite symbols instead.
3. **Sequence 6 inherits the subtree trap** (R9) — record that a provider archive
   reproduces absolute paths and that FR-016's post-condition assertion is what
   generalises, so Sequence 6's author does not have to re-derive it.
4. **`composeUp`'s 5-minute default timeout** (R12) — now that one caller
   parameterises it, the other call sites' inherited default deserves a
   deliberate second look rather than remaining an accident.
