# Feature Specification: Contract Cardinality and the Container-Logs Contract

**Feature Branch**: `004-contract-cardinality`

**Created**: 2026-09-04

**Status**: Draft

**Input**: User description: "Capability contracts round 2: plural participation and the container-logs contract. Make backup@1 acceptor participation plural (list of {id, preHook, postHook}) with the singular form coerced to a one-element list, back-compat per ADR 0003; define a fail-closed ordering/cleanup policy for N hooks per app; report prepare/finalize results per participation; settle provider cardinality and enforce it in code and the rollup; carry partial-coverage structure through the API so the dashboard renders 'partial' distinct from quiesced/as-is (postiz is the acceptance test); add container-logs@1 as a provisioned, app-provided contract with a new provider grant kind, granted only on operator consent and revoked on uninstall; decide whether container-logs@1 has an acceptor side and stop the rollup rendering 'unaffiliated' as 'uncovered' for it; label every app container with its Hola app id and deployment id; amend ADR 0004 and ADR 0002. Constraints: no per-app special cases, no broken published manifests, the contract vocabulary stays closed, the volume validator is not weakened (with a pinning test), the apps-data grant and consent step are reused, catalog-side changes are out of scope except as try-hola/apps issues."

**Source issues**: [try-hola/hola#426](https://github.com/try-hola/hola/issues/426) (plural participation), [try-hola/hola#245](https://github.com/try-hola/hola/issues/245) (container-logs). Prompt of record: Notion Spec Prompts row "Capability contracts, round 2" (Sequence 1, fetched 2026-09-04).

## Executive Summary

ADR 0004 gave Hola a contract model: an app **provides** a capability (Backrest
performs backups) and other apps **accept** it (they expose a pre-hook that dumps
their database before a capture). Two questions the model never answered are now
producing wrong answers for operators.

**Participation is modelled as at most one per app.** An app with two databases
can only name one in its backup block, so the second is copied live on every
snapshot. Because the app declares that it accepts backup, the dashboard's
coverage view calls it fully covered. A wrong "covered" is the one failure the
coverage view was built to prevent. This feature makes participation a list
(each entry with its own id and hooks), defines what happens when one of several
hooks fails, reports results per participation, and teaches the coverage view to
say **partially covered** when a database has no hook: for an app shaped like
`postiz` today, the dashboard must stop calling it covered before the catalog
gains the second hook.

**Provider cardinality is undefined.** Two installed apps can both declare that
they provide the same contract, and nothing says what that means. This feature
rules that a contract has **one provider per host**, enforced at install.

**Log collection was designed under the wrong model.** The queued
`container-logs` capability was proposed as a platform primitive an app consumes.
Under ADR 0004 it is a **contract**: a collector that tails every container
continuously is a *provisioned* integration whose provider is an app, the first
of that kind. This feature adds `container-logs@1` to the contract table, gives
it a new provider grant that the operator must consent to at install, and settles
the modelling consequence: every running app is a subject of log collection
whether or not it says so, so the contract has **implicit** acceptors and the
rollup must never present them as uncovered. To make collected logs group by app,
every app container gains platform labels naming its app and deployment.

## Scope

**In scope (this repository):**

- Plural acceptor participation for `backup@1`, with the singular manifest form
  still accepted and normalised, and one ruling recorded for all contracts.
- Ordering, failure and cleanup policy for a multi-participation prepare, and
  per-participation reporting from the broker.
- Provider cardinality: one provider per contract per host, enforced at install
  and reflected in the rollup.
- Partial-coverage state carried through the API and rendered in the dashboard,
  derived from a generic recogniser of database services.
- `container-logs@1` in the contract table as a provisioned, app-provided contract
  with a new provider grant kind, its own consent wording, injection on consent,
  and revocation on uninstall.
- Per-contract participation mode (`declared` vs `implicit`) so the rollup and
  its consumers cannot misread implicit subjects as uncovered.
- Platform labels on every app container naming the Hola app id, deployment id
  and deployment name.
- A test pinning that user-authored docker-socket and log-directory mounts remain
  rejected by the compose validator.
- Amendments to ADR 0004 (cardinality rulings, `container-logs@1`) and ADR 0002
  (why `container-logs` is not a fourth `consumes` primitive).
- Follow-up issues filed against `try-hola/apps` for the catalog-side work.

**Out of scope:**

- Catalog-side changes in `try-hola/apps`: the manifest JSON schema, the
  manifest validator's per-database warning, the second `postiz` hook, and the
  log-collector bundle itself (try-hola/apps#30). Filed as issues, not built here.
- A plural shape for the `auth` block. An app has one identity; `auth@1` remains
  a single participation by nature and the ruling records why.
- Log retention, storage limits or query surfaces. Those live in the collector
  app; the platform grants the source and steps out.
- Any change to how the pre-upgrade snapshot itself is captured, beyond running
  every participation's hooks around it.
- A second provider of the same contract by operator override.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An app with two databases is backed up consistently (Priority: P1)

A bundle author whose app runs two database services declares two backup
participations, one per database. When the backup provider asks Hola to prepare,
both databases are dumped, in the order declared, before the capture; both dumps
are cleaned up afterwards; and if either dump fails the provider is told the
capture must not proceed and told *which* participation failed.

**Why this priority**: This is the live defect. Today the second database is
copied live and the app is partly unrestorable while the dashboard says it is
fine.

**Independent Test**: With a stub manifest declaring two participations against
two services, trigger the broker's prepare and finalize and assert the hook
execution order, the cleanup coverage on failure, and the per-participation
result entries.

**Acceptance Scenarios**:

1. **Given** a running app whose manifest declares participations `app-db` then
   `temporal-db`, **When** the provider calls prepare, **Then** the `app-db`
   pre-hook runs before the `temporal-db` pre-hook, and the prepare succeeds
   only when both succeed.
2. **Given** the same app, **When** the `temporal-db` pre-hook fails,
   **Then** the prepare fails, the `app-db` post-hook still runs, and the failure
   names the app and the participation `temporal-db`.
3. **Given** the same app, **When** the provider calls finalize, **Then** every
   participation's post-hook runs and the response lists one result per
   participation, each carrying the deployment id and participation id.
4. **Given** an app whose manifest still uses the singular `backup` block,
   **When** it is installed and a prepare runs, **Then** it behaves exactly as
   before this feature, reported as the single participation `default`.

---

### User Story 2 - The dashboard tells the truth about partial coverage (Priority: P1)

An operator opens the Backups page or an app's detail and sees that an app
which accepts backup but has a database with no hook is **partially covered**,
visually distinct from both "quiesced" and "covered as-is", with the numbers
behind the judgement ("1 of 2 databases quiesced").

**Why this priority**: The coverage view exists to make the invisible gap
visible. Its current answer for a two-database app with one hook is wrong in
the dangerous direction.

**Independent Test**: Feed the coverage components a rollup entry shaped like
`postiz` today (accepts backup, one participation, two recognised database
services) and assert the partial state renders and the covered count excludes it
from "fully covered".

**Acceptance Scenarios**:

1. **Given** an app that accepts backup with two recognised database services and
   one participation, **When** the Backups page renders, **Then** the app is
   shown as partially covered with "1 of 2" and is not counted as fully covered.
2. **Given** an app that accepts backup with two recognised database services
   and two participations targeting both, **When** the page renders, **Then** it
   is shown as quiesced.
3. **Given** an app that accepts backup, declares no hooks and runs no recognised
   database service, **When** the page renders, **Then** it is shown as covered
   as-is, unchanged from today.
4. **Given** an app that accepts backup, declares no hooks and runs one
   recognised database service, **When** the page renders, **Then** it is shown
   as partially covered with "0 of 1", not as-is.
5. **Given** an app that does not accept backup, **When** the page renders,
   **Then** it is shown as not covered, unchanged from today.

---

### User Story 3 - A second provider of the same contract is refused (Priority: P2)

An operator who already runs a backup provider tries to install a second app that
also provides backup. The install is refused before anything is created, naming
the existing provider and telling the operator to uninstall it first.

**Why this priority**: The provider grant is the most privileged thing on the
host and the broker assumes one caller per contract. Leaving the case undefined
while the API implies it is supported is the gap to close; the enforcement itself
is a small guard.

**Independent Test**: With one live deployment providing `backup@1`, attempt to
create a second deployment from a draft whose manifest provides `backup@1` and
assert the rejection; then remove the first and assert the second is accepted.

**Acceptance Scenarios**:

1. **Given** a live deployment providing `backup@1`, **When** a second install
   providing `backup@1` is requested with consent, **Then** it is rejected with a
   message naming the existing provider deployment and the corrective action, and
   no deployment or job is created.
2. **Given** the first provider has been uninstalled, **When** the same install
   is requested, **Then** it succeeds.
3. **Given** two providers of one contract recorded before this rule existed,
   **When** the rollup is read, **Then** both are listed and the rollup flags the
   contract as having more than one provider, and the dashboard shows that
   warning.
4. **Given** the provider being upgraded or rolled back, **When** its own new
   release is deployed, **Then** the guard does not count the deployment against
   itself.

---

### User Story 4 - A trusted collector is granted container logs on consent (Priority: P2)

An operator installs a log collector app from the catalog. The install wizard
shows a binding consent step explaining that the app will be able to read the
logs of every container on the host, including whatever those apps log. On
consent the platform gives the collector's containers a log source that permits
reading logs and discovering containers and nothing else. Uninstalling the
collector removes the access.

**Why this priority**: This is the second half of the prompt and the first
app-provided provisioned contract; it depends on the cardinality ruling but not on
the backup work.

**Independent Test**: With a stub manifest providing `container-logs@1`, create a
deployment with and without the grant and assert the materialised compose gains
the log source only when granted; assert the validator still rejects a
user-authored socket or log-directory mount.

**Acceptance Scenarios**:

1. **Given** a manifest providing `container-logs@1`, **When** the install wizard
   loads the draft, **Then** the consent step lists the container-logs grant
   with its own label and risk text, and the install cannot proceed until it is
   acknowledged.
2. **Given** consent was given, **When** the deployment is materialised,
   **Then** the collector's services carry the log source, and the operator can
   see the grant on the deployment detail.
3. **Given** consent was not given (API or CLI without the grant), **When** the
   install is requested, **Then** it is refused with the existing consent-required
   error naming `container-logs@1`.
4. **Given** a user-authored compose that mounts the docker socket or the docker
   log directory, **When** it is validated, **Then** it is rejected, and a test
   pins this for both paths.
5. **Given** the collector is uninstalled, **When** removal completes, **Then** no
   credential or access it held remains.

---

### User Story 5 - Collected logs group by app without per-app configuration (Priority: P2)

A collector that enumerates containers finds, on every app container, labels
naming the Hola app id, the deployment id and the deployment name, so it can
index logs by app with no per-app configuration.

**Why this priority**: Without it the grant yields an undifferentiated stream and
is not worth the privilege.

**Independent Test**: Materialise a compose for a deployment and assert every
service carries the platform labels with the expected values and that
user-authored labels are preserved.

**Acceptance Scenarios**:

1. **Given** any app deployment, **When** its compose is materialised, **Then**
   every service carries the platform labels for app id, deployment id and
   deployment name.
2. **Given** a service that already declares its own labels, **When** the compose
   is materialised, **Then** the user's labels are preserved and the platform
   labels are added; a user-authored value under the platform namespace is
   overwritten by the platform's.

---

### User Story 6 - The rollup tells log-collection subjects apart from uncovered apps (Priority: P3)

An operator viewing the contract rollup for `container-logs@1` sees the provider
and every other installed app listed as a subject of collection. No app is shown
as "not covered" merely because it did not declare anything, because for this
contract there is nothing to declare.

**Why this priority**: It is the modelling consequence the prompt singled out; it
must land with the contract, but nothing else in this feature depends on it.

**Independent Test**: Build the rollup with a granted collector and three other
installs and assert all three appear as acceptors of `container-logs@1` and none
as unaffiliated; assert a manifest declaring `accepts: ["container-logs@1"]` is
dropped with a warning.

**Acceptance Scenarios**:

1. **Given** installed apps A, B and a collector providing `container-logs@1`,
   **When** the rollup is read, **Then** the contract's acceptors are A and B and
   its unaffiliated list is empty, and the contract reports its participation
   mode as implicit.
2. **Given** a manifest declaring `accepts: ["container-logs@1"]`, **When** it is
   coerced, **Then** the acceptance is dropped with a logged warning and the app
   is still listed as a subject.
3. **Given** the `backup@1` rollup, **When** it is read, **Then** its buckets are
   unchanged by this feature (declared participation, unaffiliated apps still
   listed as such).

---

### Edge Cases

- **Duplicate participation ids within one app**: the first occurrence is kept,
  later duplicates are dropped with a logged warning naming the app and id.
- **A participation with neither hook**: dropped with a warning; a participation
  must do something. An app whose every participation is dropped is treated as
  declaring no hooks.
- **A participation whose id is missing or malformed** in the plural form: the
  participation is dropped with a warning; the singular form never carries an id
  and always receives `default`.
- **Two participations targeting the same service**: allowed (two dumps from one
  database container is legitimate); coverage counts the service as quiesced.
- **A hook whose service is not a recognised database** (a `redis` flush, an
  application-level quiesce): allowed and run; it does not change the count of
  recognised database services, which is what coverage is measured against.
- **A recognised database service that is behind an unselected profile**: not
  running, not counted; coverage is measured against the services the deployment
  actually runs.
- **The pre-hook of participation 2 fails after participation 1 succeeded**:
  participation 1's post-hook and participation 2's post-hook both run (the
  failed dump may be partial and needs cleaning), participation 3's hooks never
  start, the prepare fails naming participation 2.
- **A post-hook fails during finalize**: reported per participation with `ok:
  false`; finalize keeps running the remaining post-hooks and returns overall
  `ok: false`. Never fails the upgrade (unchanged).
- **The pre-upgrade snapshot** (the server's own caller of the hook runner)
  follows the same ordering and cleanup rules, reading the outgoing release's
  participations as it reads its block today.
- **The provider guard and the provider itself**: upgrades, rollbacks and
  restarts of the sole provider never trip the guard; only a *different*
  deployment counts.
- **A stopped provider**: still the provider (it holds the grant); a second
  install is still refused. Uninstall is the way to hand over.
- **A channel rehearsal copy of the provider** (spec 003): refused by the guard
  like any second provider; recorded in the ADR as a known limit, revisited if a
  real need appears.
- **Records from before this feature with two providers**: both remain; the
  rollup flags the contract and the dashboard warns; nothing is auto-removed.
- **Implicit contract with no provider installed**: every install is listed as an
  acceptor with no provider; the UI's empty-provider state applies exactly as the
  Backups page's "no provider installed" does.
- **An app that provides `container-logs@1` and is itself a running container**:
  it is a subject of its own collection; listed under providers only (the
  existing both-roles de-duplication applies).
- **Grant consented at install, manifest later drops `provides` on upgrade**: the
  grant is re-derived at every materialise from declared ∩ consented, as today,
  so the log source disappears with the declaration.
- **A user-authored compose mounting the docker socket, the docker log directory,
  or a parent of either**: rejected by the existing bind-source rule; pinned by
  test for the socket, the log directory and a parent path.
- **A compose service with no `labels` key, a list-form `labels`, or a map-form
  `labels`**: platform labels are merged into whichever form is present without
  changing the form.

## Clarifications

### Session 2026-09-04

- Q: Does `container-logs@1` have an acceptor side? → A: **No declared side; participation is implicit.** The contract table gains a per-contract participation mode, `declared` (backup, auth, push) or `implicit` (container-logs). For an implicit contract every installed non-provider deployment is a subject and the rollup lists it as an acceptor, leaving `unaffiliated` empty; a manifest `accepts` naming an implicit contract is dropped with a warning, the way `provides` on a platform-provided contract is.
- Q: What do two installs both providing the same contract mean? → A: **One provider per contract per host, enforced at install, no override.** A second install providing a contract a live deployment already provides is rejected before creation, naming the existing provider and the corrective action. Records that predate the rule are surfaced as a warning in the rollup and dashboard, not auto-removed. A channel rehearsal copy of a provider is refused like any other second provider; the ADR records this as a known limit.
- Q: What is partial coverage measured against, given the manifest cannot say how many databases an app has and catalog changes are out of scope? → A: **A generic recogniser of database services from image references.** The platform keeps a closed, documented list of database image families whose live file copy is unsafe; coverage per app is the count of recognised database services targeted by a participation over the count recognised. An app that accepts backup with no hooks and no recognised database is covered as-is. The rule is keyed on image family only, never app id, and matches the check the catalog's own CI applies.
- Q: Which existing deployments does the provider guard count when refusing a second provider? → A: **Exactly the set the single-instance guard counts today** (live, non-removed deployments of the host), evaluated in the same place, so the two guards can never disagree about what "installed" means. A failed or stopped provider still counts; uninstall is the hand-over.
- Q: What makes a participation "target" a recognised database service for the coverage count? → A: **The service named by its pre-hook.** The pre-hook is the quiesce; a post-hook-only participation is cleanup and counts toward nothing. Two participations whose pre-hooks name the same service count that service once.
- Q: Which of the provider's services receive the container-logs source on consent? → A: **Every service of the provider deployment**, mirroring how the apps-data mount is injected into every service today. No per-service targeting; a bundle that wants to confine it runs a single collector service.

## Requirements *(mandatory)*

### Functional Requirements

**Plural participation**

- **FR-001**: The `backup` acceptor block MUST accept either the existing singular form (`{ preHook?, postHook? }`) or a list of participations, each carrying a stable `id` and its own `preHook` and/or `postHook`. Manifest reading MUST normalise both to one internal shape: a list of participations. The singular form MUST become a one-element list whose participation id is `default`.
- **FR-002**: Every published manifest using the singular form MUST keep working with no change in behaviour: same hooks, same order, same failure handling, one result entry.
- **FR-003**: Within an app, participation ids MUST be unique; a duplicate MUST be dropped with a logged warning naming the app and id, keeping the first. A participation with a missing or malformed id (plural form) or with no hooks MUST be dropped with a warning. Dropping MUST never fail the catalog load or the install.
- **FR-004**: The ruling MUST be recorded as a property of the contract model: acceptor participation is a list. `push@1` already conforms; `backup@1` is brought into conformance by this feature; `auth@1` is documented as a single participation by nature (one identity per app) and its block is unchanged.

**Ordering, failure and cleanup**

- **FR-005**: The broker's prepare MUST run participations in declaration order within an app, and apps in a stable, documented order (ascending deployment id). Pre-hooks MUST run sequentially; no two hooks run concurrently.
- **FR-006**: The prepare MUST remain fail-closed: the first failing pre-hook stops the prepare, no further pre-hooks start, and the prepare fails. One failed participation of N fails the whole prepare.
- **FR-007**: On a failed prepare, cleanup MUST run the post-hook of every participation whose pre-hook was started (succeeded or failed), across all apps reached, and MUST NOT run post-hooks for participations whose pre-hook never started. Cleanup failures are logged and do not mask the original failure.
- **FR-008**: The broker's finalize MUST run every participation's post-hook for every eligible app regardless of individual failures, and MUST report overall failure if any post-hook failed.
- **FR-009**: The server's own pre-upgrade snapshot MUST apply the same ordering and cleanup rules to the outgoing release's participations, keeping its existing failure semantics (fail-closed when the target release requires the snapshot, best-effort otherwise; post-hooks always run).

**Per-participation reporting**

- **FR-010**: The finalize response MUST carry one result per participation, each identifying the deployment id, the participation id and success, with output when present. An app that failed one of three participations MUST be distinguishable from one that failed all three.
- **FR-011**: The prepare's failure MUST identify the failing participation by deployment id and participation id, both in the job's failure message and in the job's log entries, and the prepare response MUST list the participations that will run (deployment id and participation id), not only the deployment ids.

**Provider cardinality**

- **FR-012**: A contract MUST have at most one provider per host. Creating a deployment whose manifest provides a contract that another existing deployment already provides MUST be rejected before any deployment or job is created, with a message naming the contract, the existing provider deployment, and the corrective action (uninstall it first). "Existing" is exactly the set of deployments the single-instance guard counts today, evaluated in the same place; a stopped or failed provider still counts. The rejection MUST NOT count the deployment being upgraded, rolled back or restarted against itself.
- **FR-013**: The rollup MUST continue to list every provider it finds and MUST flag a contract whose provider count exceeds one; the dashboard MUST render that flag as a warning on the provider panel. No automatic removal or demotion occurs.
- **FR-014**: The cardinality rule applies uniformly to every app-provided contract, including `container-logs@1`.

**Coverage**

- **FR-015**: The platform MUST recognise database services by a closed, documented list of image families whose live file copy is unsafe (relational and document databases; the exact list is a platform constant, not app data). Recognition MUST key on the image family only and MUST NOT reference any app id.
- **FR-016**: For each deployment accepting `backup@1`, the platform MUST compute and expose: the participations declared (ids and target services), the recognised database services the deployment runs, and a derived coverage state. A participation targets the service named by its pre-hook; a post-hook-only participation targets nothing, and a service named by several pre-hooks counts once. The states: `quiesced` when every recognised database service is targeted by at least one participation (including the case of no recognised databases with at least one participation), `partial` when at least one recognised database service is not targeted (including zero participations with at least one recognised database), `as-is` when the app accepts, declares no participations and runs no recognised database. Deployments that do not accept remain `uncovered`.
- **FR-017**: The per-deployment contract summary and every rollup participant MUST carry the counts (targeted, recognised) and the derived state, so the dashboard, the CLI and any client render the same judgement without recomputing it.
- **FR-018**: The Backups page and the app detail MUST render `partial` as its own state, visually distinct from `quiesced` and `as-is`, showing the counts ("1 of 2 databases quiesced"), and MUST NOT count a partial app as fully covered in the page summary. Existing renderings of `quiesced`, `as-is` and `uncovered` are unchanged.
- **FR-019**: A deployment shaped like `postiz` today (accepts backup, one participation, two recognised database services) MUST render as `partial`. This is the acceptance test for this group.

**The container-logs contract**

- **FR-020**: The contract table MUST gain `container-logs@1`: shape `provisioned`, provider kind `app`, participation mode `implicit`, no acceptor block, and a provider grant of a new kind distinct from `apps-data`, with its own consent label and risk text stating that the app can read the logs of every container on the host and that logs routinely contain tokens, request paths and personal data. The table remains a closed set; unknown refs keep degrading to "does not participate" with a warning.
- **FR-021**: The install wizard's existing binding consent step MUST list the container-logs grant when the app provides the contract, using the grant's own wording, and the install MUST be refused without it through the existing consent-required error. The CLI's existing grant option MUST accept the ref. No new consent mechanism is built.
- **FR-022**: On consent, materialisation MUST inject the log source into every service of the provider deployment after validation, the way the apps-data mount is injected into every service today. Without consent nothing is injected.
- **FR-023**: The log source granted MUST permit reading container logs and enumerating containers with their labels, and MUST NOT permit starting, stopping, creating, executing into or deleting containers, copying files out of containers, or reading container environment variables. The design MUST choose the mechanism during planning and record in ADR 0004 why a read-only bind of the docker socket and a read-only mount of the docker log directory do not meet this envelope.
- **FR-024**: Whatever the grant issues (credentials, sidecars, mounts) MUST leave with the deployment: uninstall MUST revoke any credential and remove any injected component, following the same path the backup provider's grant and token use today.
- **FR-025**: The compose validator's bind-source rule MUST NOT be weakened. A test MUST pin that a user-authored mount of the docker socket, of the docker log directory and of a parent path of either is rejected, and that the platform's post-validation injection is the only path.
- **FR-026**: A provisioned contract MUST NOT receive broker credentials it cannot use: if a contract token is minted for a provider of only provisioned contracts, it MUST carry no broker capability.

**Implicit participation**

- **FR-027**: Every contract definition MUST declare a participation mode, `declared` or `implicit`. For `implicit` contracts the rollup MUST list every installed deployment that is not the provider as an acceptor and MUST leave `unaffiliated` empty; the rollup entry MUST expose the mode so clients can label subjects correctly.
- **FR-028**: A manifest `accepts` naming an `implicit` contract MUST be dropped with a logged warning at coercion. The rollup semantics for `declared` contracts MUST be unchanged.
- **FR-029**: The dashboard MUST NOT render an implicit contract's subjects with the "not covered" treatment; a subject's coverage for an implicit contract is determined by the presence of a running, granted provider.

**Container labels**

- **FR-030**: Materialisation MUST add platform labels to every service of every app deployment, under a reserved namespace, carrying the app id, the deployment id and the deployment name. Labels MUST be applied post-validation with the other platform defaults, MUST preserve user-authored labels in either list or map form, and a user-authored value under the reserved namespace MUST be overwritten by the platform's.
- **FR-031**: The label keys MUST be documented in the ADR and the architecture notes so a collector bundle can rely on them.

**Documentation and follow-ups**

- **FR-032**: ADR 0004 MUST be amended with: the acceptor-cardinality ruling (participation is a list; `auth` is a single participation by nature), the provider-cardinality ruling (one per host, enforced at install; the channel-rehearsal limit), the participation mode (`declared`/`implicit`) and its rollup semantics, `container-logs@1` as the first app-provided provisioned contract with the log-source argument, and the container label keys.
- **FR-033**: ADR 0002 MUST record that `container-logs` was considered as a third `consumes` primitive and is instead a contract under ADR 0004, with a pointer, so the design is not re-derived.
- **FR-034**: Issues MUST be filed against `try-hola/apps` for: the manifest schema and validator accepting the plural `backup` form and warning per recognised database; and `postiz`'s second participation for `temporal-postgres`. The log-collector bundle issue (try-hola/apps#30) MUST receive a comment pointing at the contract, the grant, and the label keys.
- **FR-035**: Operator and bundle-author documentation in this repository (architecture notes, the compose package README where it describes contracts) MUST describe the plural form, the coverage states, the one-provider rule and the container-logs grant.

### Key Entities

- **Participation**: one unit of an acceptor's involvement in a contract. Attributes: id (unique within the app), pre-hook, post-hook, target service(s). An acceptor has a list of them; a singular manifest block yields one named `default`.
- **Contract definition**: gains a participation mode (`declared` | `implicit`). `container-logs@1` is the fourth entry: provisioned, app-provided, implicit, with a grant of a new kind.
- **Provider grant**: what the server injects for a provider on consent. Kinds: `apps-data` (existing) and the new container-logs kind. Each has a consent label and risk text.
- **Coverage judgement**: per deployment per declared contract: participations declared, recognised database services, targeted count, recognised count, derived state (`quiesced` | `partial` | `as-is` | `uncovered`).
- **Provider guard**: the per-contract, per-host invariant that at most one live deployment provides it, evaluated at deployment creation.
- **Platform labels**: reserved-namespace container labels naming app id, deployment id and deployment name, present on every app container.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the automated suite, a two-participation manifest runs both pre-hooks in declared order, a failure in the second still runs the first's post-hook, and the failure names the participation; a singular manifest behaves byte-for-byte as before, with zero changes needed to pre-existing singular fixtures beyond added assertions.
- **SC-002**: The finalize response and the prepare failure identify participations by id in 100% of failure cases exercised by the suite.
- **SC-003**: A `postiz`-shaped fixture renders as partially covered on the Backups page and the app detail, and the page's covered count excludes it; the three existing states render unchanged.
- **SC-004**: A second install providing an already-provided contract is rejected in the suite with a message naming the existing provider; the same install succeeds after the first is removed; the provider's own upgrade never trips the guard.
- **SC-005**: A manifest providing `container-logs@1` gains the log source only when the grant was consented, in both the API and CLI paths; the validator rejects user-authored socket and log-directory mounts, pinned by tests.
- **SC-006**: Every materialised app compose carries the platform labels on every service; user-authored labels survive.
- **SC-007**: The `container-logs@1` rollup lists every non-provider install as a subject and none as unaffiliated; the `backup@1` rollup buckets are unchanged.
- **SC-008**: ADR 0004 and ADR 0002 are amended as specified, two `try-hola/apps` issues are filed and try-hola/apps#30 is commented, and all package quality gates pass (typecheck, lint, test, build, with typecheck re-run after any lint fix).

## Assumptions

- The catalog will adopt the plural `backup` form and add `postiz`'s second participation on its own cadence; nothing here depends on it landing first. Until it does, `postiz` reads as partial, which is the honest state.
- The database recogniser's image-family list is a platform constant, documented in the ADR and the architecture notes, and extended by pull request; it starts with the relational and document databases the catalog ships today. Caches (for example Redis) are not on the list: a crash-consistent copy of a cache is acceptable.
- Recognition inspects the image reference of each service the deployment runs (respecting selected profiles); it does not inspect the running container.
- The apps-data grant, the consent step, the contract token store and the uninstall revocation path are reused unchanged; the container-logs grant is a second kind flowing through the same machinery.
- The log-source mechanism is chosen in planning against FR-023's envelope. The spec expects that neither a read-only socket bind (mode bits do not restrict the Docker API) nor a read-only mount of the docker log directory (it exposes every container's full configuration, including environment variables) meets it, and that a least-privilege access path does; the ADR records the argument.
- Platform labels use a reverse-DNS namespace owned by Hola; the exact keys are fixed in planning and documented.
- The provider guard evaluates live deployments (any status other than removed) at creation time, in the same place the existing single-instance guard runs; it needs no new persistence.
- A provisioned, app-provided contract needs no broker endpoints; the broker routes stay `backup@1`-only.
- `apps-data` remains the only grant kind attached to `backup@1`; no existing contract changes its grant.
- Deployment records written before this feature need no migration: participation lists are derived from the stored manifest on read, and the coverage judgement is computed on read.
