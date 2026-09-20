# Feature Specification: Install Identity — Self-Describing App Data Roots

**Feature Branch**: `006-install-identity`

**Created**: 2026-09-20

**Status**: Draft

**Input**: User description: "Install identity — make every app data root self-describing, so a backup can be attributed and restored later. backup@1 captures each app's data root, but the captured bytes cannot answer 'which app and which install is this?' or 'what configuration was it running under?'. Write two platform-authored marker records into every app data root unconditionally: an instance record (app, install, version, channel, source, name, subdomain, host, lineage, accepted contracts, backup participation ids) and an environment record (the install's resolved app environment). Follow the registry.json and oidc.json precedents. Nothing reads them yet; no contract change, no catalog change, no UI."

**Source issues**: none. **Prompt of record**: Notion Spec Prompts row "Install identity — make every app data root self-describing, so a backup can be attributed and restored later" (Sequence 4, Status Ready, fetched 2026-09-20) — [page](https://app.notion.com/p/3e1acfdc54e88136b19ff3a02af29f11).

**Blocks**: Sequence 5 (restore-on-install from a live deployment) and Sequence 6 (`restore@1`, the provider half). Neither is in scope here.

## Executive Summary

`backup@1` shipped a working capture path: a provider announces a backup, every
accepting app quiesces, the provider copies each app's data root. What it did not
ship is any way to **read a capture back**.

A captured copy of `/srv/hola/apps/<deployment-id>/` is, today, an anonymous pile
of bytes. Two questions it cannot answer:

1. **Which app, and which install, is this?** The deployment id is not an opaque
   UUID — it is `<app-slug>-<8 hex>` — so the *app slug* is recoverable from the
   path alone. Everything else is not: the app version the data was written by,
   which of two installs of the same app this was, the display name the operator
   gave it, and the address it was served at.
2. **What configuration was that install running under?** This is the sharp edge.
   An install's generated configuration values live under the platform's own data
   volume, **entirely outside the read-only grant the backup provider holds**. The
   provider cannot capture them, and both install surfaces mint fresh ones on every
   new install.

The consequence of (2) is silent and total. An app whose data is encrypted with a
generated key — a workflow automation tool's encryption key, a Git host's secret
key, a social scheduler's stored OAuth tokens, a password vault — restored beside
a *freshly generated* key yields an app that starts cleanly, shows its data, and
cannot decrypt a single stored credential. No error names the cause.

**This is a clock, not a feature backlog item.** A backup taken today carries
whatever the data root happened to contain today, and no later work can
retroactively fix a capture taken without these records. Every day this does not
ship is another day of captures that can never be automatically attributed or
restored.

So: write two small, platform-authored records per install, on every deploy,
unconditionally. One describes the install and goes *inside* its data root,
following two precedents already in the deploy path for exactly this shape of
problem — the app-registry feed and the OIDC credentials file, both
platform-written JSON placed inside an app's data root. The other carries the
install's resolved environment, and therefore its secrets, and goes in a
reserved sibling directory at the apps root instead: still inside the read-only
grant a backup provider holds over the whole apps root, but outside the mount
the app's own containers receive (see the placement clarification below).

Nothing reads them yet, and that is the point: this ships alone, and it has
standalone value even if neither restore feature is ever built — it makes every
app data folder self-describing for support and debugging.

## Scope

**In scope:**

- An **install identity record** written into every app data root that has one,
  carrying the facts needed to attribute a capture to an app, an install, and a
  version.
- A **lineage identifier** on that record, defaulting to the install's own
  identifier, which a later restore can carry forward so every capture of one
  app-instance shares an identifier across any number of reinstalls.
- An **install environment record** carrying the install's resolved app
  environment key/value pairs, with restrictive permissions, written under a
  reserved directory at the apps root rather than inside the app's own data
  root — inside the privileged capture surface, outside the app's own mount.
- Both records refreshed on every materialization, so an upgrade updates the
  recorded version.
- Unit test coverage over record content, the lineage default, the permission
  modes, and the no-data-root case.

**Out of scope (deliberately, and to be resisted during implementation):**

- **Any reader of these records.** No restore logic, no candidate detection, no
  install-time offer. Sequences 5 and 6 are the consumers.
- Any change to the contract vocabulary, the contract table, or any contract's
  shape — including `backup@1`.
- Any catalog change: no manifest field, no schema change, no app bundle change.
- Any user-interface change, any API response change, any CLI change.
- Any change to how generated configuration values are minted at install time.
- Capturing, backing up, or exporting the platform's own data volume.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A captured data folder says what it is (Priority: P1)

An operator (or a support engineer helping one) is holding a copy of one app's
data folder — pulled out of a snapshot, copied off a dying host, or found in a
restic repository — with no access to the host it came from. Today the folder
name tells them the app slug and nothing else. They need to know which install it
was, what version wrote it, what the operator had named it, and where it was
served.

**Why this priority**: This is the attribution floor. Without it every later
capability — automated restore, snapshot indexing, even manual disaster recovery
— has to guess. It is also the half that delivers value with no dependency on
anything else shipping.

**Independent Test**: Install any app that stores data, then read the identity
record from its data folder alone, with the platform stopped, and confirm it
names the app, the install, the version, the channel, the catalog source, the
display name, the subdomain and the host — and that this is enough to identify
the install without consulting any platform state.

**Acceptance Scenarios**:

1. **Given** an app that declares persistent storage, **When** it is installed
   and its deploy completes, **Then** its data root contains an install identity
   record naming the app, the install, the running version, the release channel,
   the catalog source, the display name, the subdomain and the public host.
2. **Given** two installs of the same app on one host, **When** each identity
   record is read, **Then** each names its own install distinctly, so a capture of
   either is attributable to exactly one of them.
3. **Given** an installed app, **When** it is upgraded to a newer version,
   **Then** its identity record reports the newly running version — not the
   version it was first installed at.
4. **Given** an app already installed before this feature existed, **When** its
   next deploy, upgrade, restart or rollback runs, **Then** it gains the identity
   record with no operator action and no migration step.
5. **Given** an identity record, **When** it is read, **Then** it names which
   capability contracts the install accepts and the identifiers of its backup
   participations, so a reader knows which quiesced artefacts to expect beside the
   live data.

---

### User Story 2 - A capture carries the configuration its data was written under (Priority: P1)

The operator is restoring an app whose stored data is encrypted or signed with a
generated value. Restoring the data alone is worse than useless: the app comes up
looking healthy and every stored credential is silently unreadable. They need the
generated configuration to travel with the data it protects.

**Why this priority**: Equal-first with US1 and for a harsher reason. US1's
absence makes a restore *manual*; US2's absence makes a restore *quietly wrong*.
It is also the half that a capture can never be retrofitted with — the values are
minted fresh per install and the old ones are unrecoverable once the platform's
own volume is gone.

**Independent Test**: Install an app that generates configuration values, read
the environment record from a capture of the apps root (the record is a sibling
of the app's data folder, not inside it), and confirm every resolved key/value
pair the install was running under is present and matches what the running
containers hold. Confirm as part of the same test that the record is **not**
reachable from inside the app's own data folder.

**Acceptance Scenarios**:

1. **Given** an app whose install generated configuration values, **When** its
   deploy completes, **Then** an environment record holding the install's
   resolved application environment key/value pairs exists under the apps root,
   named by that install and **outside** the install's own data root.
2. **Given** an environment record, **When** its permissions are inspected,
   **Then** it is readable only by the platform and by a process already
   privileged to read everything under the apps root — never by an ordinary
   reader of the folder, and never by the app whose install it describes.
3. **Given** an install whose environment changes (a reconfiguration), **When**
   the next materialization runs, **Then** the environment record reflects the new
   values.
4. **Given** an environment record and the app's data — which a capture of the
   apps root holds together, though they are not in the same directory — **When**
   both are restored onto a new host, **Then** the record alone supplies every
   generated value needed; no separate copy of the platform's own data volume is
   required.

---

### User Story 3 - An install's lineage survives being reinstalled (Priority: P2)

Over an app's life an operator may uninstall and reinstall it, or restore it onto
a fresh host. Each of those produces a new install identifier and therefore a new
data-folder name, so a series of captures of what is conceptually *one* app
instance looks like a series of unrelated apps.

**Why this priority**: It costs almost nothing to record now and cannot be added
retroactively to captures already taken — the same clock argument as the rest of
this feature — but nothing today consumes it, so it ranks below the two records
themselves.

**Independent Test**: Install an app, note the lineage identifier on its identity
record, then upgrade, restart, promote and roll it back; confirm the lineage
identifier is unchanged throughout and equals the install's own identifier.

**Acceptance Scenarios**:

1. **Given** a newly created install, **When** its identity record is written,
   **Then** its lineage identifier equals its own install identifier.
2. **Given** an install, **When** it is upgraded, restarted, promoted or rolled
   back, **Then** its lineage identifier is unchanged.
3. **Given** a capture whose identity record carries no lineage identifier (taken
   before this feature, or corrupt), **When** a future reader encounters it,
   **Then** the absence is a legible gap that degrades to path-based inference —
   not an error and not a blocked read.

---

### Edge Cases

- **An app that stores no data.** An app whose composition declares no persistent
  storage has no data root and nothing to restore. It MUST gain neither record and
  MUST NOT have a data directory created for it as a side effect.
- **Writing a record fails** (full disk, permission failure, read-only mount).
  These records are bookkeeping; a deploy that would otherwise succeed MUST NOT be
  failed by their absence. The failure MUST be logged at warning level, naming the
  install, so an operator can see that a data root is unattributed.
- **An app that clears or replaces its own data root.** The records are lost until
  the next materialization rewrites them. This is accepted: the platform is the
  only writer and refreshes on every deploy.
- **A name collision inside the data root.** The records live under a reserved
  directory name; an app that happens to use that name would have its content
  overwritten. The reserved name MUST be chosen to be platform-distinctive.
- **An app container running as an unprivileged user.** Such a container can read
  the identity record but cannot read the environment record. This is intended —
  neither record exists for the app's benefit.
- **Concurrent deploys of the same install.** Deploys are serialized per install
  by the existing lifecycle, so the last writer wins and both records stay
  internally consistent with the version that materialized last.
- **A capture running while a deploy rewrites the records.** A backup provider may
  read the data root at the moment a materialization is rewriting both records. A
  reader MUST therefore never observe a half-written record — it sees either the
  previous complete record or the new complete one.
- **A data-aware rollback that wipes and replaces the data root.** Rolling back
  with data restoration replaces the entire data root from a pre-upgrade archive,
  which carries the records as they stood at that earlier version. Because
  materialization runs after the restore, both records are rewritten with the facts
  of the release actually being brought up — a rollback MUST NOT leave a record
  describing the version that was rolled away from.
- **An install that declares storage but never wrote any.** Before this feature
  such an install's data root was empty, and uninstall skipped deleting it. It now
  contains the reserved directory, so uninstall deletes it like any other populated
  root. The end state is identical (no data root either way); only the code path
  differs.
- **Uninstall.** Removing an install removes **both** locations it owns under the
  apps root: its entire data root (taking the identity record with it) *and* its
  environment-record directory, which is not inside that data root. Both are
  removed unconditionally and independently — an install whose data root was
  already deleted by hand must still lose its environment record, or one
  directory of secrets is orphaned for every app ever uninstalled, with nothing
  left that knows the install identifier needed to find it. Nothing is retained,
  and this feature adds no retention of its own.
- **An app that reads its own data directory.** The data root is bind-mounted
  into the app's own containers, so anything inside it is readable by the app and
  — for an app that serves, syncs or browses that directory — by the app's end
  users, who are not the host operator. The identity record carries no secret and
  is unaffected. The environment record does, which is why it is not there.

## Clarifications

### Session 2026-09-20 (post-review amendment — environment record placement)

Raised by `/code-review xhigh` after the first implementation landed, filed as
issue #478, and decided by the operator rather than resolved by default.

- Q: The environment record was written inside the install's own data root
  (`<apps-root>/<install>/.hola/env.json`, mode `0600`). That directory is
  bind-mounted into the app's own containers — `${HOLA_APP_DATA}`, overwhelmingly
  as `/data`. Does an app reading its own data directory therefore read the
  install's secrets? → A: **Yes, and that is not acceptable. The environment
  record moves out of the app-visible mount** to
  `<apps-root>/.hola/<install>/env.json`, mode `0600` in a `0700` directory. The
  identity record carries no secret and stays exactly where it was.

  **Why the original argument missed it.** FR-014's justification reasoned only
  about a *consented `apps-data` provider* reading the apps root. It never
  addressed the app reading the directory it was handed. For an app that serves,
  syncs or browses its own data directory — a file manager, a sync tool, a media
  server with a file browser — the record was exposed to **that app's end users**,
  who are not the host operator. The `0600` mode assumed non-root app containers,
  and many images run as root, so it was no mitigation.

  **Why this location and not the platform's own data volume.** The `apps-data`
  grant identity-mounts the *entire* apps root read-only, so a sibling directory
  at the apps root is still inside what a consented backup provider captures —
  which is the whole point of writing the record at all. Moving it to the
  platform volume would put it back outside every grant and re-create the problem
  the feature exists to solve.

  **Two consequences, both recorded.** (1) FR-014's argument is now actually
  true rather than merely asserted: a consented privileged reader is the only
  reader the placement exposes it to. (2) `capturePreUpgradeSnapshot` tars the
  whole data root into a `data.tar.gz` written under the process umask
  (world-readable `0644`) and retained to the retention bound; with the record
  outside that root, those archives no longer carry secrets (issue #478 item 2).
  And one cost: **SC-003 is narrowed** — a copy of one app's data folder alone no
  longer recovers its generated configuration; a capture of the apps root does.
  Captured in FR-011, FR-012, FR-014, SC-003, the uninstall edge case (both
  locations must be removed) and a new app-reads-its-own-data edge case.

### Session 2026-09-20

Run unattended: the operator was unavailable, so each question below was resolved
by taking the most defensible option and encoding it into the requirements. Every
ruling was checked against the code before being accepted.

- Q: A data-aware rollback wipes the data root and replaces it from a pre-upgrade
  archive that contains these records as they stood at the older version. Does the
  rollback leave stale records behind? → A: **No — materialization rewrites both
  records after the data restore, so they describe the release actually being
  brought up.** Verified in the lifecycle job: the data restore runs before
  materialization, not after. The records are written during materialization, and
  that ordering is what makes this free; moving the write earlier in the lifecycle
  would break it. Captured as FR-006 and an edge case.
- Q: A backup provider can read the data root at the moment a deploy is rewriting
  both records. Must a reader be prevented from observing a partially written
  record? → A: **Yes — a reader MUST see either the previous complete record or
  the new complete one, never a partial one.** A torn record inside a capture is
  precisely the silent-corruption failure this feature exists to prevent, and it
  costs nothing: the platform's standard file-write path is already atomic by
  default (temp file, then rename), so the requirement is met by using it rather
  than by writing bytes directly. Captured as FR-019 and SC-009.
- Q: Does the identity record name the platform build that wrote it, in addition to
  the schema version? → A: **Yes — it carries both.** The schema version tells a
  reader the record's shape; the platform version tells them which build produced
  it, which is the fact actually wanted when a record looks wrong. It is additive,
  introduces no operator-facing concept, and shares this feature's clock property:
  it cannot be added to captures already taken. Captured in FR-003.
- Q: How are the accepted contracts and backup participation identifiers encoded —
  bare identifiers, or versioned contract references? → A: **Versioned contract
  references, exactly as the contract vocabulary spells them (e.g. `backup@1`).** A
  future reader must know which version of a contract a participation identifier
  belongs to in order to interpret it; recording a bare identifier would bake a
  version ambiguity into every capture, and the version is free to record now.
  Captured in FR-004.
- Q: An install that declares storage but never wrote any data used to have an
  empty data root, which uninstall skipped deleting. The reserved directory now
  makes it non-empty. Is that behaviour change acceptable? → A: **Yes.** The end
  state is identical — no data root either way — and only the branch taken inside
  uninstall differs. Installs that declare no storage are unaffected, because they
  receive no records at all (FR-015). Captured as an edge case.

## Requirements *(mandatory)*

### Functional Requirements

**Identity record**

- **FR-001**: The platform MUST write an install identity record into the data
  root of every install that has a data root, during materialization, on every
  deploy.
- **FR-002**: The identity record MUST be written under a reserved,
  platform-distinctive directory inside the data root, so it cannot be confused
  with the app's own content.
- **FR-003**: The identity record MUST carry: a schema version; the version of the
  platform build that wrote it; the install identifier; the lineage identifier; the
  app identifier; the running app version; the followed release channel; the
  catalog source; the operator-chosen display name; the subdomain; the public host;
  and the time it was written. The schema version describes the record's shape; the
  platform version identifies the build that produced it.
- **FR-004**: The identity record MUST carry the capability contracts the install
  accepts and the identifiers of its declared backup participations. Contracts MUST
  be recorded as versioned references in the form the contract vocabulary already
  uses (e.g. `backup@1`), never as bare identifiers, so a reader can tell which
  version of a contract a participation identifier belongs to.
- **FR-005**: The identity record MUST be readable by any process that can read
  the app's data root (it carries no secret).
- **FR-006**: The identity record MUST be rewritten on every materialization, so
  that after an upgrade it reports the version actually running. This MUST hold for
  a data-aware rollback too: where the data root is wiped and replaced from a
  pre-upgrade archive containing older records, the records that survive the
  operation MUST describe the release actually being brought up, not the one rolled
  away from.
- **FR-007**: Every field on the identity record MUST be sourced from state the
  platform already holds for the install or from its finalized manifest. This
  feature MUST NOT introduce a new operator-facing input, manifest field, or
  catalog field to populate it.

**Lineage**

- **FR-008**: The identity record MUST carry a lineage identifier which, for an
  install created normally, equals that install's own identifier.
- **FR-009**: The lineage identifier MUST be stable for the life of the install —
  unchanged by upgrade, restart, promote, rollback, or reconfiguration.
- **FR-010**: The platform MUST be the only writer of the lineage identifier. It
  MUST NOT be settable by an operator, an app, a manifest, or a request.

**Environment record**

- **FR-011**: The platform MUST write an install environment record carrying the
  install's resolved application environment as key/value pairs. It MUST be
  written **outside every app's own data root** — under a reserved directory at
  the apps root, keyed by install — and MUST NOT be placed anywhere the app's
  own containers can reach. It MUST remain inside the apps root, so that the
  same privileged read-only grant that captures app data captures it too.
- **FR-012**: The environment record MUST be written with restrictive
  permissions such that it is readable only by the platform and by a process
  already privileged to read everything under the apps root. Its containing
  directory MUST be equally restricted, so that an unprivileged local reader
  cannot even enumerate which installs have one.
- **FR-013**: The environment record MUST be rewritten on every materialization,
  so it reflects the environment the install is currently running under.
- **FR-014**: The code that writes the environment record MUST carry an inline
  justification for placing resolved configuration values at rest on disk —
  stating that the app's own containers already hold every one of these values;
  that the record is written outside every app's own data root **specifically so
  that the app itself, and the app's end users, cannot read it**; that the only
  reader the placement exposes it to is a consented privileged reader of the
  whole apps root, whose grant consent text already declares it reads secrets
  apps keep on disk; that the incremental exposure is therefore
  at-rest-on-disk versus in-container-environment on a host whose operator has
  already consented to a tool that reads everything; that the placement also
  keeps the record out of the pre-upgrade snapshot archive, which is written
  world-readable and retained; and that the gain is a capture of the apps root
  that is self-sufficient without the operator having separately preserved the
  platform's own data volume.

**Boundaries and failure**

- **FR-015**: An install whose composition declares no persistent storage MUST
  receive neither record, and MUST NOT have a data root created as a side effect
  of this feature.
- **FR-016**: A failure to write either record MUST NOT fail the deploy. It MUST
  be logged at warning level and MUST name the install.
- **FR-017**: Existing installs MUST gain both records on their next
  materialization with no operator action, no migration step, and no reinstall.
- **FR-018**: Nothing in the platform MUST read either record in this feature. No
  API response, user interface, command-line output, contract, or catalog
  artefact may change as a result of it.
- **FR-019**: Neither record may be observable in a partially written state. A
  reader holding the data root open while a materialization rewrites the records
  MUST see either the complete previous record or the complete new one. Both
  records MUST therefore be written through the platform's standard write path,
  which already replaces a file atomically, rather than by writing bytes in place.

### Key Entities

- **Install identity record**: A platform-authored description of one install,
  placed inside that install's data root. Names the app, the install, the version
  and channel it runs, the catalog it came from, how the operator named and
  reached it, which contracts it accepts, and when the description was written.
  Carries no secret. One per install that has a data root.
- **Install environment record**: A platform-authored capture of the resolved
  application environment one install is running under. Placed under a reserved
  directory at the apps root, keyed by install — a *sibling* of that install's
  data root and deliberately **not inside it**, because the data root is
  bind-mounted into the app's own containers. Restricted, directory and file
  both, so only the platform and an already-fully-privileged reader of the whole
  apps root can read it. It names the install it belongs to, since its location
  no longer does. One per install that has a data root.
- **Lineage identifier**: An identifier for the *app instance* as distinct from
  the *install*. Equal to the install identifier at first install; intended to be
  carried forward by a future restore so that captures taken across reinstalls of
  one conceptual instance share it. Platform-written only.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of installs that store data carry both records after their next
  deploy, with zero operator actions and zero migration steps.
- **SC-002**: Given only a copy of one app's data folder and no access to the host
  it came from, an operator can name the app, the specific install, the version,
  the release channel, the catalog source, the display name and the address it was
  served at — for 100% of such copies.
- **SC-003**: Given a capture of the **apps root** — one app's data folder *plus*
  that install's environment record, which is a sibling of the data folder and
  not inside it — 100% of the generated configuration values that install was
  running under are recoverable, so a restore can reproduce the environment its
  data was written under without a separately preserved copy of the platform's
  own data volume. A copy of the data folder **alone** is explicitly **not**
  sufficient: it recovers the install's identity (SC-002) and 0% of its generated
  configuration. This is a deliberate narrowing (see the 2026-09-20 placement
  clarification) — the capture surface that satisfies it is still the single
  read-only grant a backup provider already holds over the whole apps root, and
  still never the platform's own data volume; what changed is that a restore
  must capture at that level rather than per app folder.
- **SC-004**: An install's lineage identifier changes 0 times across upgrade,
  restart, promote, rollback and reconfiguration.
- **SC-005**: 100% of installs that declare no persistent storage receive zero
  records and zero directories from this feature.
- **SC-006**: After an upgrade, the recorded version matches the running version
  within one deploy cycle — measured as 0 records reporting a stale version once
  the deploy has completed.
- **SC-007**: A record-writing failure causes 0 deploy failures, and produces
  exactly 1 warning naming the affected install.
- **SC-008**: 0 API responses, user-interface surfaces, command-line outputs,
  contract definitions or catalog artefacts change as a result of this feature.
- **SC-009**: A reader of the data root observes 0 partially written records, for
  any interleaving of reads against a concurrent materialization.
- **SC-010**: After a data-aware rollback, 0 records describe the release that was
  rolled away from.

## Assumptions

Decisions made where the prompt left a reasonable default; recorded here rather
than blocking.

- **Reserved directory and file names.** `.hola/` is the reserved name, used at
  two levels under the apps root: `<apps-root>/<install>/.hola/instance.json`
  for the identity record (inside the data root, where the app can read it and
  where a copy of the folder carries it), and
  `<apps-root>/.hola/<install>/env.json` for the environment record (a sibling
  of every data root, where no app's mount reaches it). A dot-directory keeps
  both out of the way of an app's own content, is platform-distinctive enough to
  make collision negligible, and can never collide with an install identifier,
  which is `<app-slug>-<8 hex>`.
- **Permissions.** Identity `0644` (no secret; readable by the app and by any
  reader of the folder). Environment `0600` inside a `0700` directory
  (root/platform only — a fully privileged reader such as the consented backup
  provider still reads it; the directory mode stops an unprivileged local reader
  even enumerating which installs have a record).
- **Write site.** Both records are written during compose materialization, inside
  the existing branch that already detects "this app declares persistent storage"
  and creates the data root. Reusing that branch is what makes FR-015 free rather
  than a second condition that could drift — the branch answers "does this
  install have a data root?", which gates both records even though only one of
  them is written inside it.
- **Failure policy.** Warn and continue, following the app-registry feed
  precedent, rather than throw, as the OIDC credentials file does. These records
  are bookkeeping; the OIDC file is a functional dependency of the app booting.
  An unattributed data root is a worse backup, not a broken install.
- **Environment contents.** The record carries the install's resolved *application*
  environment — the values the install actually runs under, from manifest defaults
  and operator input. Values provisioned per-deploy by the auth subsystem are not
  part of that set and are re-provisioned on any future install, so their absence
  costs nothing.
- **Schema version.** Both records carry a schema version field from day one, so a
  future reader can recognise a record written by this version and a later writer
  can change shape without ambiguity. The identity record additionally carries the
  writing platform's version (see FR-003).
- **Atomic replacement.** FR-019 needs no new mechanism: the platform's existing
  file-write path already writes to a temporary file and renames it into place, and
  that behaviour is on by default. Writing the records through that path rather
  than directly is the whole of the implementation.
- **Lineage on restore.** Carrying a lineage identifier *forward* is the future
  consumer's job (Sequence 5). This feature only establishes the default and the
  guarantee that the platform is its sole writer.
- **No back-fill.** Installs are not swept or migrated. FR-017 relies on the fact
  that every install materializes again on its next lifecycle action, which is the
  same mechanism by which the app-registry feed reaches existing installs.

## Dependencies

- The existing per-install data root and the materialization step that creates it.
- The install's finalized manifest and persisted install detail, which already
  carry every field FR-003 and FR-004 require.
- The existing storage service, for directory creation and mode-aware writes.
- No dependency on `backup@1`, on any installed provider, or on the catalog.
