# Feature Specification: Restore-on-Install from a Live Deployment

**Feature Branch**: `007-restore-on-install`

**Created**: 2026-09-20

**Status**: Draft

**Input**: User description: "Restore-on-install from a live deployment — the whole install-side machinery, with no backup provider involved. During an app install, detect existing captures of that app and offer to restore one immediately. The restore source in this slice is another LIVE deployment on the same host, captured with the backup broker's pre-hooks run first. At install time the data root is empty and no container is running, so a restore never overwrites anything, never races a live process, and lands inside a job that already owns the ordering. Zero provider work, zero new grants, zero new trust boundary. Closes #429."

**Source issues**: closes [`try-hola/hola#429`](https://github.com/try-hola/hola/issues/429) (Clone-with-data rehearsal: `hola install <app> --channel <c> --from <deployment>`). **Prompt of record**: Notion Spec Prompts row "Restore-on-install from a live deployment — the whole install-side machinery, with no backup provider involved" (Sequence 5, Status Ready, fetched 2026-09-20) — [page](https://app.notion.com/p/3e1acfdc54e8817fb3a4ef062b9b7576).

**Depends on**: Sequence 4 / spec [006-install-identity](../006-install-identity/spec.md), shipped on `main` as `921c790`. Every app data root now carries an install identity record, and every install carries an environment record. This feature is that feature's first reader.

**Blocks / excluded**: Sequence 6 (`restore@1` — the provider half: a staging grant, a snapshot index, a provider-polled restore queue). Restoring an app that **no longer exists on this host** is Sequence 6's job and is explicitly out of scope here.

## Executive Summary

Hola can take a backup. It cannot put one back.

`backup@1` quiesces every accepting app and lets a provider copy its data root;
spec 006 made each of those copies self-describing. What no operator can do today
is the other direction — take a copy of an app's data and end up with a working
app running on it. The only restore path that exists is an internal one:
`rollback` can put back a snapshot **the platform itself took**, of **the same
deployment**, taken **minutes earlier**. That is a safety net for an upgrade, not
a restore route.

This feature builds the restore route, and it builds it at **install time**.

That timing is not a UX convenience, it is the entire reason the design is small.
Restoring into a *running* app is a hard problem: the data root is full, a
database process holds files open, and a half-applied restore leaves an app in a
state no one can reason about. At install time every one of those problems is
absent by construction — `createFromDraft` mints a brand-new deployment id, the
data root does not exist until the deploy job creates it, and no container has
ever started. A restore at install time therefore **cannot overwrite anything,
cannot race a live process, and needs no stop/start choreography**. It slots into
a lifecycle job that already owns the ordering.

**This slice deliberately contains no backup provider.** The restore source is
another *live deployment on the same host*: the server quiesces it with the
backup broker's existing pre-hooks, tars its data root, and lays that down into
the new install. Every one of those parts is already in production — the
pre-upgrade snapshot capture, the fail-closed pre-hook runner, and a restore
helper that already accepts an arbitrary target deployment id. So this feature
adds **zero provider work, zero new grants, and zero new trust boundary**: the
server is both the reader and the writer, exactly as it is for a rollback.

The payoff is sequencing. Every genuinely subtle part of restore lives on the
install side — where in the job the files land, what must be rewritten
afterwards, what refuses and when, how carried configuration reaches the wizard.
Shipping those against a source that needs no contract negotiation means Sequence
6 arrives with only one new job: *put the files in a staging directory*. It faces
machinery that has been in production for a release.

And it closes #429 outright. "Install a copy of this app with its data, so I can
rehearse an upgrade" is the same mechanism pointed at a different intent.

### The failure this exists to prevent

An operator who restores data and gets back a running-but-**empty** app is the
worst outcome in this feature, worse than a loud failure, because it is silent.
They see a healthy container at the right address, assume the restore worked, and
discover weeks later that it did not. Two requirements follow from that and
govern the whole design:

1. **A restore that cannot succeed refuses before any container starts.** There
   is no partial-success state worth starting an app in.
2. **A restore that carries data must carry the configuration that data was
   written under**, or say loudly which values it could not carry. Data encrypted
   with a key the platform generated is unreadable beside a freshly generated
   one, and nothing in the running app reports that as an error.

## Scope

### In scope

- Discovering restore **candidates** for an app being installed: other
  deployments of the same app that exist on this host and carry a data root.
- A **restore choice on the draft**, seeding the new install's app environment
  from the candidate's recorded environment.
- Executing the restore **inside the deploy job**, between image pull and
  container start, in a fixed order.
- An app-declared **restore participation** in the catalog: per-participation
  restore hooks, paths to discard before start, and whether carried configuration
  is mandatory.
- **Refusals and warnings**: version skew, missing carried configuration, address
  divergence, ambiguous candidates.
- **Install wizard** step and **CLI** flags to make the choice.
- Closing #429 (clone-with-data) as a consequence of the above.

### Out of scope (deliberately)

- Any **backup provider** involvement: no new contract, no new grant, no new
  contract endpoint, no staging grant, no snapshot index, no provider-polled
  restore queue. All of that is Sequence 6.
- Restoring an app that **no longer exists** on this host. The candidate in this
  slice is a live deployment; there is no archive to read from.
- **Scheduled or repeated** restores, restore of a *running* app, and any restore
  path outside install.
- Cross-host restore, or restoring an app onto a **different app**.
- A manifest field describing whether an app makes outbound calls. No existing
  declaration captures it and #429 reached the same conclusion; the acknowledgement
  in this feature is unconditional instead.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An operator installs an app and gets their data back (Priority: P1)

An operator is reinstalling an app — they are moving it, they broke it, or they
are rebuilding the host. They start an ordinary install. Before they configure
anything, the installer tells them it found an existing copy of this app on the
host and offers to restore from it. They accept, finish the install, and the app
comes up already holding its data.

**Why this priority**: This is the feature. Everything else in the spec either
makes this safe or makes it reachable from another surface. Without it there is
no restore route in the product at all.

**Independent Test**: Install an app, put recognisable data in it, install a
second copy choosing the first as the restore source, and confirm the second copy
serves that data on first boot. Fully testable with two installs of one app and
no backup provider anywhere.

**Acceptance Scenarios**:

1. **Given** one installed, running copy of an app that holds data, **When** the
   operator begins installing that same app, **Then** the installer presents that
   copy as a restore candidate, identified by the name the operator gave it, its
   address, its app version, and when it was captured.
2. **Given** the operator selects that candidate, **When** the install completes,
   **Then** the new install's data root holds the candidate's data and the app
   serves it without any further operator action.
3. **Given** the operator selects no candidate, **When** the install completes,
   **Then** the install behaves exactly as an install does today — an empty data
   root, first-run state, no restore step in the record.
4. **Given** an app being installed for which no other copy exists on the host,
   **When** the operator begins the install, **Then** the installer states plainly
   that there is nothing to restore from and does not block progress.
5. **Given** a candidate is selected, **When** the restore runs, **Then** the
   source deployment is quiesced first and is left running and unchanged
   afterwards — a restore reads the source, it never alters it.

---

### User Story 2 - The restored app can read the data it was given (Priority: P1)

The operator restores an app whose stored data is encrypted or signed with a
value the platform generated at its original install — an encryption key, a
secret key, stored third-party tokens. The restored install comes up using
**those** values, not freshly minted ones, so the data is actually readable.

**Why this priority**: Equal-first with US1 because US1 without it is the silent
failure this feature exists to prevent. An app that starts cleanly, shows its
records and cannot decrypt a single stored credential is indistinguishable from
success until the operator needs one.

**Independent Test**: Restore an app that stores something encrypted under a
generated key, then read that stored item back through the app. Confirm the
install's configuration values match the source's, and that the wizard showed
them as ordinary configuration the operator could review.

**Acceptance Scenarios**:

1. **Given** a candidate whose environment record exists, **When** the operator
   chooses to carry configuration forward, **Then** the new install's
   configuration values are the candidate's values, and they are visible in the
   install's configuration step as ordinary (masked) fields.
2. **Given** a carried configuration set, **When** the app's current release
   declares a configuration key the candidate never had, **Then** that key is
   freshly generated if the app knows how to generate it, and otherwise surfaced
   to the operator by name rather than silently defaulted.
3. **Given** a candidate whose environment record cannot be found, **When** the
   operator selects it, **Then** the installer states that configuration cannot be
   carried, names every generated secret the app will therefore mint fresh, and
   requires the operator to acknowledge that before proceeding.
4. **Given** the operator chooses **not** to carry configuration from a candidate
   that has it, **When** the install proceeds, **Then** fresh values are minted and
   the same named warning is shown — declining is allowed, doing it unaware is not.
5. **Given** a restore has been chosen, **When** the operator reaches the final
   confirmation, **Then** they are told in plain words that the app will resume
   with the data **and credentials** it had when the source was captured, and that
   scheduled jobs, webhooks and integrations may fire against real systems as soon
   as it starts.

---

### User Story 3 - A restore that cannot be right refuses before the app starts (Priority: P1)

The operator picks a candidate that cannot be safely restored into this install —
it was captured on a newer version of the app, it needs a version hop the app's
own upgrade rules forbid, its configuration is missing and the app declares it
mandatory, or a restore hook fails partway. In every case the install stops with
a specific reason and the app never starts.

**Why this priority**: Also P1. The absence of this is the failure mode that makes
US1 dangerous rather than useful. A wrong restore that proceeds produces an app
that looks fine and is not.

**Independent Test**: Drive each refusal condition against a real install and
confirm (a) the install fails, (b) the failure names the specific reason, and (c)
no app container ever started.

**Acceptance Scenarios**:

1. **Given** a candidate captured at a version **newer** than the version being
   installed, **When** the operator selects it, **Then** the restore is refused
   with a reason naming both versions — data written by a newer release is not
   something an older release can be trusted to read.
2. **Given** a candidate captured at an older version whose path to the target
   version is guarded by the app's own upgrade rules, **When** the operator selects
   it, **Then** the restore is refused and the operator is told which version to
   install and restore into first, before promoting to the one they wanted.
3. **Given** a candidate whose recorded version is unknown, **When** the operator
   selects it, **Then** the restore proceeds only behind an explicit acknowledgement
   that the version relationship could not be checked.
4. **Given** an app that declares carried configuration mandatory, **When** the
   selected candidate has no environment record, **Then** the restore is refused
   outright rather than warned about.
5. **Given** a selected candidate and an app that declares restore hooks, **When**
   any restore hook fails, **Then** the whole install fails, the failure names the
   hook, and the app's own services are never started.
6. **Given** any restore failure at all, **When** the operator looks at the result,
   **Then** they see a failed install — never a successful install holding an
   empty or half-restored data root.
7. **Given** a restore was requested, **When** the deploy job begins the restore,
   **Then** it first verifies the target data root is empty of app data and aborts
   if it is not — a restore never writes over existing data, in any circumstance.

---

### User Story 4 - An app says how it wants to be restored (Priority: P2)

A catalog app declares what a restore into it means: which captured paths are
worthless or actively harmful and must be discarded before anything starts, which
command reloads its real payload, and whether it can be restored at all without
its original configuration. Apps that need none of this say so explicitly.

**Why this priority**: P2 because the platform half can ship and be exercised with
plain file-copy apps first. But it is what makes restore *correct* for the
database-backed apps that most need it, so it is not optional for long.

**Independent Test**: Restore a database-backed app whose declaration discards the
captured database directory and loads a dump, and confirm the resulting app holds
the dumped data rather than the smeared directory. Separately confirm an app
declaring participation with no detail restores by plain file copy.

**Acceptance Scenarios**:

1. **Given** an app whose declaration lists paths to discard, **When** a restore
   lands its files, **Then** those paths are removed before any of the app's
   containers start, and the app starts against the remaining files.
2. **Given** an app whose declaration names a restore hook, **When** the files are
   in place and the discards applied, **Then** the hook's service is started on its
   own and the hook is run against it before any other service starts.
3. **Given** a declared restore hook whose service does not become healthy, **When**
   the restore runs, **Then** the install fails rather than running the hook against
   a service that is not ready.
4. **Given** a discard path that points outside the app's own data root, **When**
   the restore runs, **Then** it is refused — a declaration can never reach outside
   the data root it is restoring into.
5. **Given** an app that declares it participates in restore but supplies no
   detail, **When** it is restored, **Then** its files are copied back as-is and no
   hook runs — a meaningfully different state from an app that declares nothing.

---

### User Story 5 - Clone an app with its data, from the command line (Priority: P2)

An operator wants a second copy of a running app holding the same data — to
rehearse an upgrade against real data, to test a configuration change, or to keep
a spare. They run one install command naming the existing deployment as the
source and get a second, independent copy.

**Why this priority**: P2 because it is the same machinery as US1 reached from a
different surface. It is listed separately because it is the outcome #429 asks
for, and because a non-interactive surface has its own hard rule about defaults.

**Independent Test**: From the CLI, install a second copy of a running app naming
the first as the restore source, and confirm the second is independently
addressable and holds the first's data while the first keeps running untouched.

**Acceptance Scenarios**:

1. **Given** a running deployment of an app, **When** the operator installs that
   app naming that deployment as the restore source, **Then** a second independent
   deployment is created holding the source's data, and the source is unchanged
   and still running.
2. **Given** several candidates for an app, **When** the operator asks to list
   them, **Then** each is listed with enough detail to choose — its identifier,
   name, address, version, whether it carries configuration, and any warning that
   would apply.
3. **Given** several candidates, **When** the operator asks for the most recent
   one rather than naming an identifier, **Then** the most recently captured
   candidate is used.
4. **Given** an install run with no restore flag at all, **When** it completes,
   **Then** **no restore happened** — silence never means "guess". A candidate
   existing is not consent to use it.
5. **Given** any restore refusal, **When** it reaches the command line, **Then**
   the operator is shown a specific, actionable hint derived from structured
   failure detail, not a re-printed server message.

---

### Edge Cases

- **Several copies of the same app, from different histories.** Candidates that
  share a lineage are one story; candidates from unrelated installs are not. The
  installer groups by lineage, offers the most recent within a lineage as the
  default, and requires an explicit pick when two unrelated lineages both match.
- **A candidate whose data root is empty.** An app installed and never used has
  nothing to restore. It is not offered as a candidate.
- **A candidate that is the app being installed's own future self.** A restore
  candidate is always another, existing deployment; an install can never name
  itself.
- **A candidate that is stopped rather than running.** Still a valid source: its
  files are at rest, which is the easiest possible capture. Its quiescing hooks
  simply have nothing to run against, which must not be an error.
- **A candidate that is deleted between choosing it and the deploy job running.**
  The job re-resolves the candidate and fails the install with a clear reason
  rather than restoring a stale or partial copy.
- **A candidate that starts its own lifecycle action after being chosen.** The same
  re-resolution applies: the job re-checks that the source is settled and fails the
  install rather than capturing a data root the platform is mid-way through
  rewriting.
- **A previous restore of this app that failed.** Its data root holds a partial
  tree, so it is never offered as a source, even though the deployment and its
  files are deliberately left in place for the operator to inspect.
- **The app's address changes.** Absolute URLs baked into restored data point at
  the old address. The installer defaults the new install's name and address from
  the candidate's and warns when the operator changes them anyway.
- **A restore into an app with SSO provisioned.** The provisioned credentials file
  the platform writes into the data root must survive the restore. A restore that
  replaces the whole data root after that file is written silently destroys it,
  and the app boots without SSO.
- **A restored tree carrying the source install's identity record.** Left in
  place, the new install claims to be the old one, and every later capture
  compounds the error.
- **An app whose restore hook service has no health signal.** There is no way to
  know when it is ready. The app must declare one; the restore refuses rather than
  guessing with a timer.
- **A capture taken before install identity shipped.** It has no environment
  record. This is the ordinary "cannot carry configuration" path, not an error.
- **A restore requested on an action that is not a first install** (a restart, a
  promote, a rollback). The restore runs once, at the install that requested it,
  and never again on any later action for that deployment.

## Clarifications

### Session 2026-09-20

- **Q: Where is the capture staged during a restore, and when is it cleaned up?
  An app data root can be tens of gigabytes.** → **A:** Under the **target**
  deployment's own directory, in a dedicated restore-staging area separate from
  the pre-upgrade snapshot store, and deleted in a `finally` whether the restore
  succeeds or fails. It is staged under the target rather than the source so it
  disappears with the install that requested it and never enters the source's
  snapshot retention. **There is no separate extraction step**: the platform's own
  capture helper archives the data root's *contents* relative to the root, and its
  restore helper extracts straight into the destination, so the peak cost is one
  compressed archive plus the extracted data root — not the three simultaneous
  copies a stage-then-move design would need.

- **Q: How does the candidate list reach the install wizard and the CLI —
  a new read route, or a field on an existing response?** → **A:** A **new
  ordinary platform API read route**, keyed by app. The scope ban in FR-047 is on
  *capability-contract* endpoints, not on platform API routes. A field on the
  draft-creation response is circular: the restore choice is made **before** the
  draft exists and determines how the draft is created, so the client would need a
  draft in order to learn what to put in the draft request. The CLI's
  list-candidates flag likewise must work without creating a draft at all. The
  route is therefore forced, not chosen.

- **Q: After a restore fails mid-way, what happens to the target deployment
  record and its partially written data root?** → **A:** Both are **left in
  place**, the deployment in its error state, exactly as a failed deploy behaves
  today. The platform does not delete an operator's data root on its own; the
  evidence of the failure is the most useful thing present, and the existing
  uninstall path already removes it when the operator decides to. The safety rule
  this forces is stated as a requirement: such a deployment MUST NOT itself be
  offered as a restore candidate, because its data root holds a partial tree.

- **Q: May a deployment with a lifecycle job in flight be used as a restore
  source?** → **A:** **No — refuse, fail-closed.** A source that is mid-deploy,
  mid-promote or mid-rollback is being written by the platform itself and its data
  root may be mid-replacement. Only a deployment in a settled state (running or
  stopped) may be a source; anything in flight, or in an error state, is excluded
  from candidacy rather than captured optimistically.

- **Q: How are the "unknown version" and "configuration could not be carried"
  acknowledgements represented, so the non-interactive equivalent FR-046 demands
  is actually buildable?** → **A:** As an **explicit list of acknowledgement
  codes on the restore choice**, mirroring the existing consent array the platform
  already uses for privileged capability grants at install. The server computes
  which acknowledgements the chosen candidate requires and refuses the create when
  a required code is absent — the same shape, and the same failure, as a missing
  grant consent. The wizard's checkboxes and the CLI's flags both supply codes, so
  a scripted install acknowledges deliberately or fails closed, and neither surface
  needs to parse prose.

## Requirements *(mandatory)*

### Functional Requirements

#### Candidate discovery

- **FR-001**: The system MUST be able to list, for a given app, the restore
  candidates available on this host, through a dedicated read route that does
  **not** require a draft to exist. A candidate is an existing deployment of the
  same app, other than the one being created, whose data root exists and holds app
  data.
- **FR-002**: Each candidate MUST be described with: its deployment identifier,
  its lineage identifier, the operator-given name, the address it was served at,
  the app version its data was written under, whether its configuration can be
  carried, and the time the description was last written.
- **FR-003**: The system MUST source a candidate's description from the install
  identity record in its data root, falling back to the live deployment record for
  any field the record does not carry. A candidate whose identity record is absent
  or unreadable MUST still be offered, described from the deployment record alone,
  and marked as carrying no lineage.
- **FR-004**: A deployment whose data root is empty of app data MUST NOT be offered
  as a candidate.
- **FR-004a**: Only a deployment in a **settled** state — running or stopped — MUST
  be offered as a candidate. A deployment with a lifecycle action in flight, or in
  an error state, MUST be excluded: the platform itself may be mid-write to its
  data root, and an install whose own restore failed holds a partial tree.
- **FR-005**: Candidates MUST be grouped by lineage and ordered most-recent-first
  within a lineage.
- **FR-006**: Candidate discovery MUST NOT require any backup provider, contract
  grant, or contract endpoint.

#### Entering the restore choice

- **FR-007**: The restore choice MUST enter the install at **draft creation**,
  carrying the chosen candidate's identifier and whether to carry its
  configuration forward. It MUST NOT be settable by patching an existing draft, and
  it MUST NOT be supplied at finalize.
- **FR-008**: When a restore choice names a candidate and configuration is to be
  carried, the draft's app environment MUST be seeded from the candidate's recorded
  environment at draft creation, using the platform's existing three-case rule: a
  carried value wins; a key the app newly declares with a generation recipe is
  freshly minted; any other new key rides through to be surfaced to the operator
  by name.
- **FR-009**: The restore choice MUST ride onto the finalized release description
  **outside** the checksummed canonical specification, and MUST NOT alter that
  checksum's meaning.
- **FR-010**: The restore choice MUST be persisted on the deployment record at
  creation, because the deploy job's payload carries only the release, the action
  and the deployment identifier, and reads everything else from the record.
- **FR-011**: A deployment record MUST carry a lineage identifier. For an install
  with no restore it is the deployment's own identifier; for a restore it is the
  candidate's lineage identifier, carried forward. The install identity record MUST
  read the persisted lineage in preference to deriving it.
- **FR-012**: The restore choice MUST apply to the **first** deploy of that
  deployment only. Any later action on the same deployment (restart, promote,
  rollback) MUST NOT re-run the restore.

#### Executing the restore

- **FR-013**: The restore MUST execute inside the deploy job, **after** images are
  pulled and **before** any of the app's containers are started.
- **FR-013a**: Before capturing anything, the restore MUST **re-resolve the chosen
  candidate** and re-check that it still exists and is still in a settled state.
  A candidate deleted, or one that started a lifecycle action, between the draft
  being created and the deploy job running MUST fail the install with a specific
  reason rather than being captured optimistically.
- **FR-014**: Before writing anything, the restore MUST verify the target data root
  contains no app data, ignoring the platform's own reserved marker directory, and
  MUST abort the install if it does.
- **FR-015**: The restore MUST quiesce the source deployment using the same
  fail-closed pre-hook policy the platform already uses before a pre-upgrade
  capture, capture its data root, and leave the source running and unmodified.
- **FR-016**: The restore MUST verify the payload it landed is the app's data-root
  contents, and MUST fail rather than proceed if the target root is empty or holds
  only the platform's own marker directory after the restore. It MUST NOT infer
  success from the capture or extraction step reporting no error.

  > *Correction to the prompt of record, made during clarification.* The prompt
  > required the restore to "locate the subtree, because a restore recreates the
  > absolute path structure under the target, so the payload is at
  > `<staging><candidate path>`". That is true of a provider's archive tool, which
  > stores absolute paths — and therefore a real trap for **Sequence 6**. It is not
  > true of the platform's own capture helper, which archives a directory's
  > *contents* relative to that directory and extracts them straight into the
  > destination. Writing a subtree search into this slice would be code guarding
  > against a layout this slice cannot produce. The requirement is therefore stated
  > as the outcome — *the payload must actually be there* — which holds under either
  > archive shape and survives Sequence 6 unchanged.

- **FR-016a**: The capture MUST be staged under the **target** deployment's own
  directory, in a staging area distinct from the pre-upgrade snapshot store, and
  MUST be deleted whether the restore succeeds or fails. It MUST NOT be written
  under the source deployment, and MUST NOT participate in snapshot retention.
- **FR-017**: After the files land, the restore MUST remove every path the app's
  restore declaration marks for discard, before any container starts. Each discard
  path MUST be resolved and confined to the target data root; a path that resolves
  outside it MUST be refused.
- **FR-018**: After the files land and discards are applied, the restore MUST
  rewrite the install identity record so it describes the **new** install. The
  source install's record MUST NOT survive into the restored tree.
- **FR-019**: The provisioned SSO credentials file MUST be written **after** the
  restore has laid down its files, not before. Writing it before a whole-data-root
  restore destroys it, and the app boots without SSO with no error reported.
- **FR-020**: When the app declares restore hooks, the system MUST be able to start
  a **named subset** of the app's services and wait for them to become healthy,
  before starting the rest. It MUST rely on the service's own declared health
  signal rather than a fixed wait.
- **FR-021**: Restore hooks MUST run fail-closed: a hook that fails, or a hook
  service that never becomes healthy, MUST fail the install. A partially loaded
  data set MUST never be handed to an app that will then start against it.
- **FR-022**: A failed restore MUST fail the install. The system MUST NOT fall back
  to starting the app with an empty or partially restored data root.
- **FR-022a**: A failed restore MUST leave its deployment record and data root in
  place, in the error state, exactly as a failed deploy does today. The system MUST
  NOT delete either automatically; removing them stays the operator's decision,
  through the existing uninstall path.
- **FR-023**: When no restore was requested, the deploy job's behaviour MUST be
  byte-for-byte what it is today.

#### The app's restore declaration

- **FR-024**: An app MUST be able to declare, per backup participation, how it is
  restored: paths to discard, a restore hook, and whether carried configuration is
  mandatory.
- **FR-025**: An app declaring that it accepts restore **without** supplying any
  detail MUST be treated as "a plain file copy back is sufficient" — a state
  meaningfully distinct from an app that declares nothing at all.
- **FR-026**: The restore declaration MUST reuse the existing hook shape the backup
  declaration already uses; it MUST NOT introduce a second, parallel hook format.
- **FR-027**: A restore hook MUST be keyed to a backup participation, so an app
  with two stateful services restores each correctly.
- **FR-028**: The catalog schema MUST accept the restore declaration, and existing
  app declarations MUST remain valid unchanged.

#### Refusals and warnings

- **FR-029**: A candidate captured at a version **newer** than the version being
  installed MUST be refused.
- **FR-030**: A candidate captured at an older version whose upgrade path to the
  target is guarded by the app's own upgrade rules MUST be refused, and the refusal
  MUST name the version the operator should install and restore into first.
- **FR-031**: A candidate captured at the same version, or at an older version with
  a clear upgrade path, MUST be allowed.
- **FR-032**: A candidate whose version is unknown MUST be allowed only behind an
  explicit operator acknowledgement, because an unknown version cannot be checked
  against the app's upgrade rules.
- **FR-033**: When configuration cannot be carried, the system MUST derive the
  severity itself rather than asking the app: every configuration key the app
  declares that is both a secret **and** has a generation recipe is a
  platform-invented value the restored data may depend on. The system MUST warn,
  naming those keys.
- **FR-034**: When configuration cannot be carried and the app's restore
  declaration marks carried configuration mandatory, the system MUST refuse rather
  than warn.
- **FR-035**: The new install's name and address MUST default from the candidate's
  recorded address. When the operator sets a different address, the system MUST warn
  that absolute addresses stored inside the restored data will not be rewritten.
- **FR-036**: When candidates from two or more distinct lineages match, the system
  MUST require an explicit choice rather than defaulting.
- **FR-037**: Every restore-side refusal MUST carry a structured, machine-readable
  reason code alongside its human message, so non-interactive surfaces can build
  their own guidance without parsing prose.
- **FR-037a**: Every acknowledgement this feature requires MUST be represented as a
  **code supplied on the restore choice**, in the same shape the platform already
  uses for privileged grant consent at install. The system MUST compute which
  acknowledgement codes the chosen candidate requires and MUST refuse the create
  when a required code is absent — the same failure as a missing grant consent.

#### Install wizard

- **FR-038**: The install wizard MUST present the restore choice as its **first**
  step, before configuration — because configuration renders the app environment
  and the app environment is seeded by the restore choice.
- **FR-039**: Changing the restore choice MUST re-create the draft, following the
  existing pattern used when the operator changes release channel mid-install.
- **FR-040**: Carried configuration values MUST reach the wizard as ordinary
  configuration fields, masked by the same component that masks every other
  generated secret. They MUST NOT be presented as a separate or privileged class.
- **FR-041**: When a restore is chosen, the final confirmation step MUST show an
  unconditional acknowledgement stating that the app will resume with the data and
  credentials it had when the source was captured, and that scheduled jobs,
  webhooks and integrations may fire against real systems as soon as it starts.
- **FR-042**: When no candidate exists for the app, the wizard MUST say so and MUST
  NOT obstruct the install.

#### Command line

- **FR-043**: The CLI MUST let an operator name a restore source by identifier,
  ask for the most recent candidate, explicitly decline a restore, and list the
  candidates for an app.
- **FR-044**: With no restore flag given, the CLI MUST perform **no restore**.
  Silence MUST NOT be interpreted as consent to restore.
- **FR-045**: The CLI MUST build its guidance for a restore refusal from the
  structured reason code and detail, never from the server's message text.
- **FR-046**: Every acknowledgement the wizard requires (unknown version, uncarried
  configuration) MUST have an explicit non-interactive equivalent that supplies the
  same acknowledgement code, so a scripted install either acknowledges deliberately
  or fails closed. Neither surface may infer an acknowledgement from silence.

#### Scope boundaries

- **FR-047**: This feature MUST NOT define a new capability contract, a new grant,
  or a new contract endpoint, and MUST NOT require any backup provider to be
  installed.
- **FR-048**: This feature MUST NOT restore from anything other than a live
  deployment present on this host.

### Key Entities

- **Restore candidate**: An existing deployment of the same app on this host that
  holds data and can serve as a restore source. Described by deployment identifier,
  lineage identifier, operator-given name, address, app version, whether
  configuration can be carried, and when its description was written. Derived — it
  is not stored anywhere; it is computed from deployments and their identity
  records on demand.
- **Restore choice**: The operator's decision, made once at draft creation: which
  candidate, whether to carry its configuration, and which acknowledgement codes
  they are supplying. Rides the draft through finalize, lands on the deployment
  record, and is consumed exactly once by the first deploy.
- **Acknowledgement code**: A named risk the operator must accept for a specific
  restore to be allowed — an unverifiable version relationship, or configuration
  that cannot be carried. Computed by the system from the candidate, supplied by
  the operator, and refused when required and absent. Modelled on the existing
  privileged-grant consent, not invented anew.
- **Lineage identifier**: The identity of an *app instance* across reinstalls,
  distinct from a deployment identifier which identifies one install. A fresh
  install is its own lineage; a restored install inherits the source's. Written
  only by the platform; never operator-visible as a concept to set.
- **Restore declaration**: What an app says about being restored into — discard
  paths, a restore hook per backup participation, and whether carried configuration
  is mandatory. Lives in the app's manifest alongside the backup declaration.
- **Restore refusal**: A structured reason a restore cannot proceed, carrying a
  machine-readable code, a human message, and where applicable the version the
  operator should use instead.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can restore an app's data during its install with **no
  backup provider installed on the host** and **no new grant consented**.
- **SC-002**: A restored app serves the source's data on first boot, with zero
  manual steps between the install completing and the data being visible.
- **SC-003**: 100% of restores that carry configuration produce an install whose
  configuration values match the source's — so data encrypted under a
  platform-generated value remains readable.
- **SC-004**: 100% of restore failures result in a **failed install**. No restore
  failure produces a running app with an empty or partially restored data root.
- **SC-005**: Every refusal names its specific cause, and every version-skew
  refusal that has an actionable next step names that version.
- **SC-006**: A restore never modifies the source deployment: after a restore, the
  source's data, status and address are unchanged and it is still running if it was
  running before.
- **SC-007**: A restored install's identity record describes the **new** install,
  and its lineage identifier equals the source's — verifiable by reading the
  record after the install.
- **SC-008**: A restored install with SSO provisioned boots with its SSO
  configuration intact.
- **SC-009**: An install run with no restore flag and no restore choice produces a
  deployment indistinguishable from one produced before this feature shipped.
- **SC-010**: An app with two stateful services can restore both correctly from one
  capture.
- **SC-011**: Issue #429 is closed: an operator can create a second copy of a
  running app holding its data in a single command.
- **SC-012**: A scripted, non-interactive install can never perform a restore it
  was not explicitly told to perform, and can never satisfy an acknowledgement it
  did not explicitly supply.
- **SC-013**: A restore's peak additional disk cost is one compressed archive of
  the source's data root, released whether the restore succeeds or fails — no
  restore leaves staged bytes behind.

## Assumptions

- **Restore source is a live deployment.** The candidate is another deployment on
  the same host, discoverable through the platform's own records. No archive
  format, catalogue of snapshots, or external storage is read.
- **The capture mechanism is the one that already exists.** Quiescing the source
  and capturing its data root reuses the platform's pre-upgrade capture path and
  its fail-closed pre-hook policy verbatim; no second capture mechanism is built.
- **Install identity has shipped.** Spec 006 is on `main`, so every app data root
  carries an identity record, and every install has an environment record. Copies
  installed before it will gain both on their next deploy, so candidates predating
  it are handled as the "no carried configuration" path rather than as an error.
- **The environment record lives beside the data root, not inside it.** Spec 006's
  final placement puts it under a reserved sibling directory at the apps root
  (`<apps root>/<reserved>/<deployment id>/`), deliberately outside the mount an
  app's own containers receive. For *this* feature that is convenient rather than
  limiting: the source is on the same host, so the server reads the record
  directly. It does mean a captured data root alone does not carry configuration —
  a fact Sequence 6 must confront, and this spec records it rather than assuming
  the prompt's original placement.
- **Lineage becomes a persisted field.** Spec 006 derives lineage as "the
  deployment's own id" and states in the shipped code that this feature is what
  forces it onto the deployment record. This spec does that.
- **The restore hook contract is the backup hook contract.** The shape an app uses
  to declare a quiescing hook is reused verbatim for a restore hook; no second hook
  format is introduced.
- **Health signals come from the app.** Waiting for a restore hook's service uses
  the service's own declared health check. An app whose hook service declares none
  is a declaration bug, surfaced as a refusal rather than worked around with a
  timer.
- **Address rewriting is not attempted.** Absolute addresses stored inside restored
  data are warned about, never rewritten — rewriting them would require per-app
  knowledge of where they are stored, which violates the platform's generic-primitive
  rule.
- **Two live copies of one app are permitted.** Installing a second copy of an app
  already relies on the existing same-app install rules; this feature does not
  change them, and a clone-with-data install obeys whatever those rules already say.
- **No new operator concept is introduced for lineage.** Operators pick a candidate
  by its name and address. Lineage is how the system groups and orders candidates,
  not a thing the operator names or manages.

## Dependencies

- **Spec 006 (install identity)** — shipped on `main` (`921c790`). Supplies the
  identity record this feature reads, the environment record it carries forward,
  and the lineage field it promotes to the deployment record.
- **The backup broker's pre-hook machinery** — in production since the `backup@1`
  work. Reused unchanged to quiesce the source.
- **The pre-upgrade capture and restore helpers** — in production since the
  data-aware rollback work. The restore helper already accepts an arbitrary target
  deployment, which is what makes a cross-deployment restore possible without new
  file-handling code.
- **The app upgrade-path rules** — reused to judge version skew per candidate.
  Note that these rules deliberately pass through on a downgrade, so "the candidate
  is newer than the target" is a rule **this** feature must state on its own; it is
  not something the existing check reports.
- **A sibling change in the catalog repository (`try-hola/apps`)** — the restore
  declaration on acceptor apps and the schema that validates it. The platform half
  is useful without it (plain file-copy restores work), so the two can land
  independently, but the database-backed apps need both.
