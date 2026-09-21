# Research: restore@1 — the provider half

Phase 0 decisions for `specs/008-restore-provider`. Every anchor below was verified against `main@03290b8`
by two read-only sweeps (`anchors-008.md`, `seams-008.md`) rather than taken from the prompt of record, which
predates spec 007's merge and is wrong in shape in six places.

---

## R1 — `restore@1` is promoted, not duplicated

**Decision.** Add `restore@1` to `CONTRACTS` as `brokered` / `providerKind: 'app'` /
`participation: 'declared'` / `acceptorBlock: 'restore'`, and delete the participation-marker machinery.

**Rationale.** An acceptor's `restore` block already means "here is how I want to be put back" — that is
precisely the acceptor half of a two-sided contract. Spec 007 made it a marker because no provider existed;
the code comment at `services/core/contracts.ts:34-44` names the condition under which that stops being true:
giving it a contract definition "would be a lie the provider guard and the grant machinery would both act
on." This feature supplies exactly that guard and that machinery, so the statement becomes false and the
marker becomes the lie.

**Alternatives considered.** *Mint a sibling ref* (`restore-serve@1`) — rejected: two names for one
relationship, and every acceptor would have to declare both or the rollup would answer two different
questions about one fact. *Extend `backup@1` to version 2* — rejected under R3.

**Consequence.** Spec 007's FR-047 is deliberately superseded. This is the only place this feature reverses a
shipped decision, and it is recorded as such in spec FR-004.

---

## R2 — The carve-out must die in the same change, and a test must prove it

**Decision.** Delete `PARTICIPATION_MARKERS`, `RESTORE_PARTICIPATION_REF`, `isParticipationMarker`
(`shared/contracts.ts:241-252`) and the `coerceRefs` carve-out (`server/services/core/contracts.ts:45-48`).
Add a regression test that fails if the carve-out survives.

**Rationale.** The carve-out `continue`s before `parseContractRef` is ever called, for `accepts` only. A
`CONTRACTS` entry added while it stands is **dead code**: it compiles, every test passes, CI is green, and
nothing about the system's behaviour changes. That is not a hypothetical — it is verbatim the failure that
made spec 007 ship inert (`574d89b`), found only by a live catalog fetch on a VM after 1,133 unit tests, an
adversarial review and a full CI gate all missed it.

**Alternatives considered.** *Keep the carve-out and let it fall through* — rejected: it would need to consult
`CONTRACTS` to know whether to short-circuit, at which point it is the code it was bypassing. *Leave the
marker list empty but present* — rejected as a dead concept that invites reuse.

---

## R3 — A sibling contract, not a new grant on `backup@1`

**Decision.** A new contract ref with its own `providerGrant`.

**Rationale, verified.** `grantsInclude` (`shared/contracts.ts:305-307`) takes the install's recorded consent
refs and then resolves each ref's grant *kind* **live from the table**. Consent is therefore recorded per
**ref**, never per grant kind. Adding a write kind to `backup@1` would mean every install that ever consented
to `backup@1` satisfies the new kind on its next materialisation — no upgrade, no consent event, no audit
trail. That is exactly the widening `grantedContracts` exists to prevent
(`shared/index.ts:2206-2212`: *"a later release of the same app can't quietly widen it"*). A new ref cannot do
this, because the app must newly declare it and the operator must newly consent to it.

**Alternatives considered.** *`backup@2`* — rejected: bumping the version changes the **acceptor's**
obligations, which is what a version bump means here, and seventeen acceptors would be forced to re-declare
for a change that is entirely on the provider's side.

**Note for whoever reads this next.** The live-resolution property is a real sharp edge for *any* future
change to an existing contract's `providerGrant`, not just this one. It is worth an issue of its own.

---

## R4 — The provider role is filled by an app; the platform's own restore stays provider-free

**Decision.** `providerKind: 'app'`. The platform restoring from a live local deployment (spec 007) is **not**
filling the provider role.

**Rationale.** `providerKind` answers "who performs this for others", and for a snapshot held outside this
host the answer is an app. Spec 007's local path has no second party at all — the platform reads one of its
own deployments — so it is not brokering anything. Keeping it provider-free means installing a provider is
never a precondition for restoring (spec FR-007), and `assertProviderAllowed` gives one-restore-provider-
per-host for free (`deployment.ts:1103`, its only call site, creation-only by design at `:4530-4532`).

---

## R5 — Acceptance is never derived from `backup@1`

**Decision.** An app accepting `backup@1` without declaring `restore@1` reports **unaffiliated** for
`restore@1`.

**Rationale.** ADR 0004 §2 refuses to derive acceptance from an adjacent block; deriving it from an adjacent
*contract* is the same error one step further out. Today that would opt thirteen of eighteen catalog apps —
the provider itself among them — into a contract their authors never declared. The honest sentence operators
need ("captured well, still not restorable") is the coverage verdict's job (R14), not a fabricated role's.

**Consequence.** Promoting the ref makes `restore@1` appear in the rollup for the first time, with five
acceptors and thirteen unaffiliated. That is the correct answer and it will look like a regression to anyone
who expects parity with `backup@1`. Say so in the PR.

---

## R6 — The staging root is a sibling of the apps root, and the server does not create it

**Decision.** `HOLA_RESTORE_STAGING_ROOT`, default `/srv/hola/restore`, read exactly as `appsBindRoot()` reads
`HOLA_APPS_BIND_ROOT` (`deployment.ts:138-139`, `:2635-2636`) — env override, hardcoded default, trailing
slashes trimmed. Provisioned externally.

**Rationale.** A sibling, not a descendant: the provider's own backup plan targets the apps root, so a staging
directory inside it would be captured by the provider, doubling storage and producing
snapshots-of-restores-of-snapshots. A sibling needs no exclude rule and no coordination with the provider's
configuration. Externally provisioned because that is what every existing bind root does — the server reads
and uses these paths and has never `mkdir`'d one, and starting now would be a behaviour change with no
precedent to follow.

**Alternatives considered.** *Under the server's own data root* — rejected: it is not bind-mounted into any
container and would have to become so, which is a larger blast radius than a new sibling. *Inside the app's
own data root* — rejected: the target root must be empty when the restore sequence begins, which is spec 007's
load-bearing property.

---

## R7 — "Restore staging" already means something else; rename spec 007's

**Decision.** The provider-facing directory is the **restore staging root**. Spec 007's per-deployment
tar directory (`deployments/<id>/restore-staging` under the server's own `holaDir`,
`deployment.ts:4038-4039`) is renamed **capture staging**.

**Rationale.** Two different things cannot share a name in a feature whose whole job is moving data between
them. Spec 007's is server-process-local, holds a tar.gz, is never bind-mounted, and is deleted in a
`finally`. The new one is a host directory bind-mounted read-write into a foreign container. The rename is one
identifier and its tests; the confusion it prevents is permanent.

---

## R8 — Acquisition and application: where the seam actually falls

**Decision.** Split `performRestoreOnInstall` into **acquisition** (steps 1-4, origin-specific) and
**application** (steps 5-10, origin-agnostic). Application begins after the payload has landed in
`targetAppRoot` — the post-condition check (`dirHasContents`, `deployment.ts:4080`) — not at the landing step
itself.

**Rationale, from the seam sweep.** Everything from the post-condition check (`deployment.ts:4080`) onward —
discard paths, instance-marker rewrite, pending OIDC credentials, service-scoped
`composeUp({ services, wait: true })`, fail-closed reload hook — is already written against "a payload that
has landed", and runs unchanged for any origin. Landing the payload — step 4, local's
`restoreTarGzInto(stagingPath, targetAppRoot)` at `:4073` — is **not** shared: a provider delivers an
already-extracted tree that must be searched and moved (R9), not a tar.gz sitting at `stagingPath` ready to
extract, so step 4 has two real implementations, one per origin. Everything upstream of step 4
(`:3953-4053`) is bound to a local deployment and **cannot** be reused either: `getRestoreSource`
(`:838-843`) is an in-memory registry lookup, `CandidateSource.deployment` is a non-optional
`EnhancedDeploymentDetail`, the quiesce hooks `docker compose exec` into the source's own containers, and the
capture path derives `sourceAppRoot` from `appRootFor(sourceDeployment.id)`.

This is the right place for the split on its own merits, not merely a convenient one: acquisition is *"obtain
a capture and land it in `targetAppRoot`"*, which genuinely differs by origin down to its last step, and
application is *"make this host's app be that capture"*, which genuinely does not.

**Alternatives considered.** *Conditionals threaded through all ten steps* — rejected: steps 1–3 have no
provider behaviour at all, so the result is `if (local)` around three quarters of the function. *A second
sequence for providers* — rejected by spec FR-042; it is how the two paths drift apart.

---

## R9 — The provider path must locate the app root inside the delivered tree

**Decision.** After a provider reports completion, search the delivered tree for the app data root rather than
assuming it sits at the top, and refuse rather than guess when it cannot be identified unambiguously.

**Rationale.** Spec 007's step-5 comment states the reason and defers it by name: this codebase's own archives
are root-relative (`tar -C <dir> .` in, `-C <dir>` out), *"unlike a provider archive tool, which reproduces the
source's absolute path under the target"*. A restic or borg restore of `/srv/hola/apps/wiki-1a2b3c4d` into
`<staging>/<request>` produces `<staging>/<request>/srv/hola/apps/wiki-1a2b3c4d`. Spec 007 was right to
implement its own FR-016 as a post-condition and wrong to generalise that to every origin — which is exactly
what issue #486 says, and why this feature closes it.

**Failing closed matters here.** A tree containing two plausible app roots must refuse, not pick. The cost of
refusing is an operator retrying; the cost of picking wrong is restoring the wrong app's data over an install.

---

## R10 — The request store is its own, keyed by request

**Decision.** New `restore-broker-state.ts`, modelled on `backup-broker-state.ts`, keyed by request id.

**Rationale.** The persistence pattern transfers exactly — one small JSON record under the server's config
directory, read-modify-write through `StorageService`, a missing or unparseable file reading as empty, and the
fail-closed rule that an unparseable timestamp counts as expired. What does **not** transfer is the property
that store is built around and documents in its header: *"One record, not one per provider: a contract has one
provider per host, so 'the open prepare' is unambiguous."* Several restores can be in flight here, each with
its own destination (spec FR-035).

**Alternatives considered.** *Generalise `BackupBrokerStateStore` per contract ref* — rejected for now: it
would rewrite a store that shipped three weeks ago to serve a second shape it was explicitly not designed for,
and the only shared code is ~20 lines of read/update. Worth revisiting if a third brokered contract appears.

---

## R11 — Expiry is persisted, and evaluated both proactively and on a timer

**Decision.** A deadline stored on the request. Evaluated whenever the request is next examined **and** by an
armed timer, mirroring `expireOpenPrepareIfStale` (`deployment.ts:3092`, called proactively at `:2969` and via
an `unref()`'d `setTimeout` at `:3075`).

**Rationale.** A server restart disarms every timer but loses no record. The existing store solved this exact
problem with a dual guard and documented why; copying the pattern costs nothing and copying only half of it
reintroduces a bug the codebase already fixed.

---

## R12 — The waiting install polls the record

**Decision.** The deploy job observes the request's outcome by reading the persisted record on an interval,
bounded by the request's deadline. Default 30 minutes, env-overridable.

**Rationale.** An awaited in-memory promise dies with a restart while the record does not, and the record must
exist anyway for expiry. 30 minutes follows `DEFAULT_PREPARE_TIMEOUT_MS` and its reasoning verbatim: the
timeout is set against the thing it must not interrupt — a repository operation over a large app data root —
because cutting it off early turns a slow recovery into a failed one, which is strictly worse than waiting.

**Note.** The provider's own shipped hook script uses a 1800s backstop for the symmetric wait in the other
direction, so 30 minutes is also the number the ecosystem already expects.

---

## R13 — The index is per publishing provider, and is a cache

**Decision.** `config/restore-index.json`, keyed by publishing provider deployment id, replaced wholesale on
publish, discarded when that provider is uninstalled or its restore consent is revoked.

**Rationale.** Replacement rather than merge is what makes a capture deleted from the repository stop being
offered. Keying by the publisher — invisible today, since there is one provider per host — is what makes
uninstall cleanup unambiguous rather than a guess. The index is never re-validated on read: a capture pruned
after publication fails at execution, and the install fails honestly. Promising otherwise would require the
server to call the provider, which R15 forbids.

---

## R14 — Restore coverage gets its own vocabulary

**Decision.** A `judgeRestoreCoverage` beside `judgeBackupCoverage` (`shared/contracts.ts:475-498`), pure, with
its own state enum rather than reusing `'quiesced' | 'partial' | 'as-is' | 'uncovered'`.

**Rationale.** The capture vocabulary describes *how an app is read while running* — "quiesced" means a
pre-hook dumps its database before the copy. None of that says anything about putting data back. Worse,
`'as-is'` in the capture sense means "no hooks, copied live" (a weaker guarantee), while an app declaring
restoration by plain file copy is **fully** restorable (a complete one). Reusing the words would invert the
meaning of the one state both vocabularies share.

---

## R15 — One direction, preserved

**Decision.** Every call is provider-initiated. The server records a request and waits.

**Rationale.** ADR 0004 §5 (`docs/adr/0004-capability-contracts.md:152`) states brokering as *"the provider
asks Hola, Hola acts on acceptors"*, and §6 illustrates it with `backup@1`'s prepare/finalize plus "a handle
the provider polls". The server has never called into an app. Building that would mean speaking the provider's
protocol, holding a credential for it, and reaching across a trust boundary — for a feature that does not need
it. Inverting the queue costs one poll loop in the provider's bundle.

**Corollary.** The `rescan` signal for a fresh host rides in the poll **response**. It is a flag the provider
reads, not a call the server makes.

---

## R16 — The provider's poller is new machinery, and the prompt was wrong about this

**Decision.** A new continuously-running component in the provider's bundle, not a clause in the existing
reconciler.

**Rationale, verified in the catalog.** `backrest-hola-autowire` (apps#162) is a persistent `yq` container
whose 30s loop reconciles **Backrest's own local config** through `GetConfig`/`SetConfig` on `backrest:9898`.
It never contacts the Hola server. The component that *does* — `backup-prepare.sh`, written by
`backrest-hooks-init` (apps#144, **not** #162 as the prompt states) — is invoked once per snapshot by Backrest
itself and is not a loop. So there is no existing poll of the Hola server for a restore poller to join.

A poller is nonetheless required, and the prompt is right about why: Backrest's hook conditions are
snapshot-lifecycle only (`CONDITION_SNAPSHOT_START` / `_END`). There is no restore-triggered condition, so
nothing on the provider's side can be driven by the provider's own event system.

**Alternatives considered.** *A third clause in the reconciler's 30s loop* — rejected: that loop's subject is
local configuration, and a failure to read it (which it already handles by warning and retrying) would also
stall every restore. Two unrelated failure modes should not share a process.

---

## R17 — Capability rows are per route, not one line

**Decision.** Each of the four provider endpoints gets its own row in `middleware/auth.ts`'s capability map.

**Rationale.** The `backup@1` precedent needed **two** rows for two routes — a POST rule and a separate, more
specific GET rule for the status poll — with a comment explaining that a contract-scoped principal is closed
by default, so even reads need naming. The prompt's "one line in the capability table" undercounts by at least
a factor of two. A missed row is a 403 at runtime that no unit test building principals directly will catch.

---

## R18 — The candidate identifier stops being a deployment id

**Decision.** `RestoreCandidate` gains an origin-independent identifier; `source` and `confidence` are new
fields, not new values of an existing enum.

**Rationale.** Today `deploymentId` *is* the candidate id and is copied directly into `defaultCandidateId`
(`restore-candidates.ts:147`). A provider-held capture has no deployment on this host, so the field cannot be
populated and the default cannot be expressed. `groupIntoLineages` itself needs no change — it already sorts
newest-first within a lineage and defaults only when one lineage matches, which is exactly the shape many
captures of one installation want.

**Blast radius: 12+ non-test call sites**, and one is a **user-facing contract** — `--restore-from <id>` is
typed by operators and `--restore-list` prints `Default: <id>`. The identifier's format is therefore public
surface, not internal plumbing, and must stay copy-pasteable.

---

## R19 — Inferred identity names an installation, not an app

**Decision.** Derive a tier-0 capture's identity from the installation directory name, and forbid it from
satisfying any check a known identity would.

**Rationale.** The prompt cites `metrics.ts:236` as the precedent for recovering an app slug from a path. That
function does the **opposite**: `templateMetricPath` matches id-shaped segments (`DEPLOY_ID_RE`, `slug-8hex`)
and **replaces** them with `:id` to bound metric label cardinality. It discards the slug; it never returns one.

More importantly, what the path actually carries is the **installation's** directory name. Deployment ids are
`<slug>-<8hex>` where the slug comes from the install's name or subdomain, not from the catalog app id — an
install named `my-wiki` of app `dokuwiki` yields `my-wiki`. So inference recovers a name that is *often* the
app id and *sometimes* silently is not, which is the worst possible property for a value used to decide what
data to restore over what install.

**Consequence.** Offer it, label it, require an acknowledgement, never default to it even as the only lineage,
and never let it skip the version guard.

---

## R19a — What a markerless capture matches, when the route is already scoped to one app

**Decision.** A capture whose identity record names an app that *differs* from the queried app is excluded
outright. A capture with **no** identity at all is offered for every app queried, with the candidate's `app`
populated from the route's own scope rather than read off the capture, and its lineage keyed by the recovered
installation name.

**Rationale.** This gap is not addressed by the spec and was found while writing the data model — FR-048 says a
markerless capture must still be offerable, FR-050 forbids treating its recovered name as an app identity, and
the candidates route is already scoped to one app. Those three together have exactly one consistent reading:
the platform cannot rule a markerless capture *in*, so it must not claim a match; but neither can it rule the
capture *out*, and hiding it is the failure that matters in a disaster. Offering it while refusing to assert
what it is discharges both.

**Accepted cost.** A host holding many markerless captures will see a long list on every install. That is a
usability problem; hiding recoverable data from an operator mid-recovery is a correctness one. FR-051's
acknowledgement and FR-052a's no-default rule are what keep the long list honest rather than a set of guesses
presented as matches.

**Alternative considered.** *Filter by the recovered installation name matching the app id* — rejected: an
install named for its purpose (`my-wiki` of app `dokuwiki`) would be filtered out of the one list it needed to
appear in, and the filter would be right often enough to be trusted and wrong exactly when it costs most.

---

## R20 — Delete the fabricated restore surface

**Decision.** Remove `POST /api/backups/:id/restore`, `RestoreBackupRequest`/`RestoreBackupResponse`, and the
interface affordance that calls it. Closes #484.

**Rationale.** It fabricates a job id and creates no job — an operator who clicks it today is told a restore
started when nothing did. Spec 007 deferred it to #160 on the grounds that a different feature owned it. That
reasoning expires here: shipping a working restore while a fake one still answers is how a codebase acquires
two restore surfaces with different semantics, and the fake one is the more discoverable of the two.

**Open.** Whether `JobType 'restore'` survives is left to implementation — this feature's requests are not
jobs, so it is probably dead too, but nothing depends on the answer.

---

## R21 — The staging mount needs a new injector

**Decision.** A writable-mount injector beside `injectReadonlyMount` in `compose-mounts.ts`.

**Rationale.** `injectReadonlyMount` (`:152-153`) hardcodes `:ro` and identity-maps `hostPath:hostPath` across
**every** service. There is no writable variant and no per-path variant; parameterising it would make one
function mean two things at the security boundary where that is least acceptable. A separate function with its
own name is greppable, auditable, and impossible to invoke by accident.

---

## R22 — Follow-ups this run will file rather than build

Deferred work becomes issues, never inline markers (repository hard rule). Filed as tasks:

1. **`grantsInclude` resolves grant kinds live from the table**, so changing any existing contract's
   `providerGrant` retroactively widens every install that already consented to that ref. This feature routes
   around it (R3) rather than fixing it; the sharp edge remains for the next change.
2. **`BackupBrokerStateStore` and `restore-broker-state.ts` share ~20 lines** of read/update and two distinct
   shapes. A third brokered contract should trigger a generalisation; two should not.
3. **`brokerActivity()`'s Real override is hardcoded to one key** and must be rewritten rather than extended
   for a second contract — worth a look at whether the rollup's activity shape should be per-contract-defined.
4. **Restoring the provider itself is circular** and out of scope. Worth an issue so the limitation is tracked
   rather than remembered.
