# Feature Specification: restore@1 — the provider half

**Feature Branch**: `008-restore-provider`

**Created**: 2026-09-21

**Status**: Draft

**Input**: Notion Spec Prompts Sequence 6 — "restore@1 — the provider half: a staging grant, a snapshot index, and a provider-polled restore queue" (`https://app.notion.com/p/3e1acfdc54e8816da679c6d4967ed112`), prompt of record archived at `specs/008-restore-provider/prompt.md`. Closes try-hola/hola#486 and try-hola/hola#484.

## Context

Spec 007 (shipped 2026-09-20) built every install-side restore mechanism — candidate discovery, version-skew refusal, configuration carry-forward, the empty-root assertion, discard paths, the marker rewrite, the reload hook, fail-closed disposition — with exactly one possible source: **another live deployment of the same app on this host**. That is a clone. It is not disaster recovery, because it cannot restore an app that no longer exists here, which is the only case that matters after a host is lost.

This feature adds the missing source. A backup provider that already holds captures of this host's apps becomes able to serve them back. Everything downstream of *"the captured files are sitting in a directory the server owns"* already shipped and has been exercised on real containers; what is new is how files get into that directory when they are not on this host to begin with.

The new surface is deliberately narrow: one capability contract gains a provider side, one new privilege, four provider-facing endpoints, one poller in the provider's bundle, and one new candidate origin.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Restore an app that no longer exists on this host (Priority: P1)

An operator has lost a host, or is migrating to a new one. They install Hola, install the backup provider, and point it at their existing repository. Installing an app now offers, alongside any live siblings, the captures the provider holds. The operator picks one, and the app comes up with its data — without the app ever having existed on this host.

**Why this priority**: This is the entire point of the feature. Without it, spec 007 is a clone button and the platform has no recovery story. Every other story in this spec exists to make this one safe.

**Independent Test**: On a host where app X has never been installed, with a provider holding a capture of X, install X selecting the provider-held capture; assert the app starts and its data is the captured data. Fully testable with no live sibling deployment of X anywhere on the host.

**Acceptance Scenarios**:

1. **Given** a consented restore provider holding a capture of app X, and no deployment of X on this host, **When** the operator installs X and selects that capture, **Then** the install completes and X's data root contains the captured data, with the app's declared discard paths applied and its reload hook run.
2. **Given** the same, **When** the restore is under way, **Then** no bytes of the captured data pass through the Hola server's own API — the provider writes them directly into the directory the server nominated.
3. **Given** a provider-held capture whose recorded app version is newer than the version being installed, **When** the operator selects it, **Then** the install is refused before any container starts, with the same refusal vocabulary spec 007 established for live sources.
4. **Given** no restore provider is installed, **When** the operator installs any app, **Then** no provider-held candidates are offered and nothing in the interface suggests any are missing.

---

### User Story 2 - The provider earns write access explicitly, and only to a scratch directory (Priority: P1)

An operator already running the backup provider upgrades it to a release that can also serve restores. Before the provider gains any ability to write anywhere, the operator is shown a new consent row naming exactly what it is being granted. Declining leaves the provider doing precisely what it did before.

**Why this priority**: The provider currently holds a read-only view of every app's data on the host. Writing is a categorically larger privilege, and the platform has never granted an app a writable bind mount. If this privilege can be acquired by upgrading rather than by consenting, the consent model is decorative.

**Independent Test**: Upgrade a provider install whose manifest gains the restore provider role; assert no writable mount appears in its materialised compose until consent is recorded, and that it appears immediately after.

**Acceptance Scenarios**:

1. **Given** an installed provider consented only to the backup role, **When** its manifest is upgraded to also declare the restore provider role, **Then** the operator is shown a new, separate consent row, and the provider's materialised compose gains no writable mount until that consent is recorded.
2. **Given** consent is recorded, **When** the provider is materialised, **Then** it receives a writable mount of the platform-owned staging root and nothing else new — in particular no writable access to any app's data root.
3. **Given** the provider holds the restore role, **When** a second app declaring the same provider role is installed, **Then** the second install is refused, exactly as a second backup provider already is.
4. **Given** an operator declines the new consent, **When** the provider runs, **Then** it continues to perform backups unchanged and simply serves no restores.

---

### User Story 3 - The server asks; the provider answers; a dead provider wedges nothing (Priority: P1)

The server never calls into an app. When a restore is needed the server records a request and waits; the provider, polling on its own schedule, discovers it, claims it, does the work, and reports completion. If the provider dies mid-restore, the request expires and the install fails honestly instead of hanging forever.

**Why this priority**: The direction of the call is an architectural commitment, not an implementation detail. Reversing it would mean the server holding credentials for apps and reaching into them — a trust boundary the platform has never crossed. And an unbounded wait is indistinguishable to an operator from a hung platform.

**Independent Test**: Drive the request lifecycle directly — create a request, poll it, claim it, complete it — and separately assert that a claimed request left uncompleted past its deadline expires and fails its install.

**Acceptance Scenarios**:

1. **Given** a pending restore request, **When** the provider polls, **Then** it receives the request including a destination path the server chose, and the provider never supplies or influences that path.
2. **Given** a pending request, **When** two providers attempt to claim it, **Then** exactly one succeeds and the other is told it is already claimed.
3. **Given** a claimed request whose provider never reports completion, **When** the deadline passes, **Then** the request is expired, the install it belongs to fails with a reason naming the provider, and nothing is left holding the install open.
4. **Given** a request the provider reports as failed, **When** the server observes that, **Then** the install fails without starting the app, matching spec 007's fail-closed disposition.

---

### User Story 4 - The dashboard stops implying a green backup badge means a recoverable app (Priority: P2)

An operator looking at backup coverage today sees apps marked as quiesced — captured consistently, with hooks — and reasonably concludes they can be restored. For most apps that is not yet true, because being captured well and being restorable are different declarations. This story makes the interface say which is which.

**Why this priority**: The dishonesty here is pre-existing and this feature makes it worse, because once restoring is genuinely possible the badge's implied promise becomes actionable. It is P2 rather than P1 because no data is lost by the current wording — only trust.

**Independent Test**: Evaluate coverage for apps in each declaration state and assert the reported restore verdict differs from the backup verdict where the declarations differ.

**Acceptance Scenarios**:

1. **Given** an app that is captured with hooks but declares nothing about being restored, **When** its coverage is reported, **Then** it reads as captured-but-not-restorable rather than simply covered.
2. **Given** an app that declares how it is restored, **When** its coverage is reported, **Then** the restore verdict reflects that declaration.
3. **Given** an app with two stateful parts where only one declares restore handling, **When** its coverage is reported, **Then** the verdict is partial rather than complete.

---

### User Story 5 - A capture from before install identity existed can still be offered, honestly (Priority: P2)

Captures taken before app data roots became self-describing carry no identity record. They are still real data an operator may desperately want. The platform offers them, labels their identity as inferred rather than known, refuses to guess on the operator's behalf, and never lets an inferred identity satisfy a safety check.

**Why this priority**: These captures are exactly the ones an operator reaches for in a genuine disaster, so silently hiding them is a failure. But an inferred identity is a guess, and a guess that is allowed to skip the version guard can destroy the data it was meant to recover.

**Independent Test**: Publish an index entry with no identity record and assert it is offered, marked as inferred, never auto-selected, never default, and that selecting it requires an explicit acknowledgement and refuses configuration carry-forward.

**Acceptance Scenarios**:

1. **Given** an index entry with no identity record, **When** candidates are listed for an app, **Then** it may appear, marked as having an inferred identity.
2. **Given** such a candidate, **When** the operator does not explicitly acknowledge the inference, **Then** it cannot be selected.
3. **Given** such a candidate, **When** it is selected, **Then** no configuration is carried forward — there is none recorded to carry — and the operator is told so.
4. **Given** a single candidate that is inference-identified, **When** a default selection would otherwise be made, **Then** no default is made.

---

### Edge Cases

- **The provider is asked to restore itself.** Circular: the provider's own configuration holds the repository credentials that make the capture readable. Out of scope, and must be refused rather than half-attempted.
- **A brand-new host with an empty index.** The server can ask the provider to re-enumerate, but nothing can be offered until an operator has installed the provider and supplied the repository password — a secret Hola never holds.
- **The staging root and the apps root are on different filesystems.** The final handoff cannot be a rename; it must fall back to a copy, and the slower path must be visible in the job log rather than silently taken.
- **The provider publishes an index naming an app this catalog has never heard of.** Offer nothing for it; do not error.
- **The provider claims a request and the server restarts.** The claim must survive, and the deadline must still be enforced after the restart rather than being lost with an in-memory timer.
- **Two installs of the same app request a restore at once.** Each gets its own destination directory; neither can observe or overwrite the other's.
- **The provider writes more than expected into the destination**, or writes nothing. The server must judge the destination before using it, and must not treat an empty destination as a successful restore.
- **An operator revokes the restore consent while a request is in flight.** The in-flight request must not be servable afterwards.
- **A capture's recorded app is present but its version is unknown.** Spec 007's unknown-version acknowledgement applies unchanged; provider origin does not weaken it.
- **The index is stale — a snapshot it names has been pruned from the repository.** The restore fails at claim or execution time and the install fails honestly; the index is a cache, never a promise.

## Clarifications

### Session 2026-09-21

Five questions, answered by the pipeline rather than the operator (unattended run). Each answer takes the
option that reuses a shape already shipped in spec 004 or spec 007, and fails closed where the two conflict.

- **Q: Promoting `restore@1` makes it a contract every app is measured against, but only five catalog apps
  declare it — the other thirteen, the backup provider included, do not. Should an app that accepts `backup@1`
  with no restore declaration report as an acceptor of `restore@1` anyway?**
  → **A: No. It reports as unaffiliated, and acceptance is never derived from the backup declaration.**
  Deriving acceptance from an adjacent declaration is exactly what the platform's contract architecture already
  refuses to do, and it would opt thirteen apps into a restore contract on their authors' behalf. The honest
  statement operators actually need — "this app is captured well and still cannot be restored" — is the job of
  the restore coverage verdict (FR-053, FR-053a), not of a fabricated acceptor role.

- **Q: The one existing broker keeps a single record per host because only one capture can be in flight at a
  time. Restore requests are concurrent and each has its own destination. Where does request state live?**
  → **A: Its own store, following the existing broker store's shape but keyed by request.**
  Same persistence pattern — one small record under the server's own configuration directory, read-modify-write,
  no new storage technology — but the existing store's defining property, one open operation per host, is the
  one property that does not transfer. Existing broker reporting is extended with optional fields only, so the
  backup contract's reporting is byte-identical to today.

- **Q: A provider-served restore happens inside the deploy job, so the job must wait for a provider that may
  never answer. How does it wait, and for how long?**
  → **A: It polls the persisted request record, bounded by a deadline stored on the request; default thirty
  minutes, operator-overridable.**
  An awaited in-memory handle dies with a server restart while the record does not, and the record is what
  expiry already has to consult anyway. Thirty minutes follows the existing capture timeout's precedent and its
  reasoning: a repository restore of a large app data root is slow, and cutting it off early turns a slow
  recovery into a failed one.

- **Q: What is the published index scoped to, and what becomes of it when the provider that published it goes
  away?**
  → **A: Scoped to the publishing provider install, and discarded when that install is removed or its restore
  consent is revoked.**
  One provider per host makes the distinction almost always invisible, which is precisely why it must be
  explicit: an index outliving its publisher would offer captures that nothing on the host can serve.

- **Q: A provider holds many captures of one installation taken at different times, where a live source offers
  exactly one. How are they presented?**
  → **A: As many candidates within one lineage, newest first — the existing grouping already does this and
  needs no change. The candidate identifier does change.**
  Grouping already sorts newest-first within a lineage and offers a default only when a single lineage matches.
  What does not survive is identifying a candidate by a local deployment: a provider-held capture has no
  deployment on this host, so the identifier — and therefore the default selection — must become
  origin-independent (FR-043a).

## Requirements *(mandatory)*

### Functional Requirements

#### Promoting `restore@1` from a participation marker to a brokered contract

- **FR-001**: `restore@1` MUST become an entry in the platform's capability-contract registry, with a brokered shape, an app-filled provider role, declared acceptor participation, and the existing `restore` manifest block as its acceptor block.
- **FR-002**: The participation-marker mechanism introduced by spec 007 — the marker list, the marker predicate, the exported marker reference, and the manifest-coercion carve-out that short-circuits ref resolution for `accepts` — MUST be deleted in the same change that adds the registry entry.
- **FR-003**: The system MUST NOT leave the coercion carve-out in place alongside the registry entry. The carve-out resolves `restore@1` before the registry is ever consulted, so a registry entry added without deleting it changes nothing observable; a test MUST fail if the carve-out survives.
- **FR-004**: Spec 007's requirement that `restore@1` is not a capability contract (007 FR-047) is **deliberately superseded** by this feature. The specification MUST record that the supersession is safe because the condition spec 007 named for it — that a provider guard and grant machinery would act on a contract definition — is now satisfied rather than violated: this feature supplies exactly that guard and that machinery.
- **FR-005**: An app that declares `restore@1` in its accepted contracts with no accompanying block MUST continue to mean "restorable by a plain file copy, nothing to discard and no reload needed", unchanged from spec 007.
- **FR-006**: Every app that already declares `restore@1` MUST keep working with no manifest change, and MUST begin appearing in the platform's contract rollup as an acceptor of `restore@1`, which it does not today.
- **FR-006a**: An app that accepts `backup@1` without declaring `restore@1` MUST report as unaffiliated for `restore@1` in the contract rollup. Acceptance MUST NOT be derived from any adjacent declaration, block or heuristic. Today that is thirteen of the eighteen catalog apps, the provider itself among them, and reporting them as acceptors would opt them into a contract their authors never declared.
- **FR-007**: The platform MUST continue to perform restores from a live deployment on this host with no provider involved, exactly as spec 007 shipped. The provider role names one way a capture reaches the staging directory; it MUST NOT become a precondition for restoring at all.
- **FR-008**: Filling the `restore@1` provider role MUST be subject to the existing one-provider-per-host guard, refusing a second install that declares it.
- **FR-009**: The contract-scoped token minted for a provider MUST cover the restore capability through the existing generic token machinery, with no per-contract special-casing.

#### The staging grant

- **FR-010**: The platform MUST define a new provider privilege distinct from the existing read-only data grant, whose sole effect is a writable mount of a platform-owned staging root.
- **FR-011**: The staging root MUST be a directory the platform owns and nominates. The provider MUST NOT receive write access to any app's data root, and MUST NOT gain any read access it did not already hold.
- **FR-012**: The staging root MUST be a sibling of the apps root, not a descendant of it, so that a provider whose backup plan targets the apps root does not capture its own restore output.
- **FR-013**: The staging root's location MUST be operator-overridable, with a documented default, following the same pattern as the apps root.
- **FR-014**: An already-installed provider whose manifest is upgraded to declare the restore provider role MUST NOT receive the staging mount until the operator consents to the new grant. This MUST be verified by a test that materialises an upgraded-but-unconsented provider and asserts no writable mount is present.
- **FR-015**: The specification MUST record why this is a separate contract rather than an additional grant on `backup@1`: consent is recorded per contract reference, while a grant's privilege is resolved live from the registry, so attaching a write privilege to `backup@1` would widen every already-consented provider on its next materialisation with no new consent event.
- **FR-016**: The consent row for the staging grant MUST describe the privilege in operator-facing terms, matching the plainness of the existing grant descriptions.
- **FR-017**: ~~Revoking or~~ **[AMENDED 2026-09-21 — see Addendum A]** Absence of the staging consent MUST leave the provider's backup behaviour entirely unchanged. Consent is re-derived on every read, so a provider without it serves no restores while continuing to back up normally. *Revocation as a distinct operator action does not exist on this platform (Addendum A); the original clause assumed a mechanism that has never been built, for any contract.*
- **FR-018**: Because a writable mount granted to an app is a new privileged cross-app primitive, this feature MUST be accompanied by an architecture decision record documenting it, per the constitution's requirement that new capabilities crossing app boundaries be introduced as ADRs.

#### Naming: two different things currently called restore staging

- **FR-019**: Spec 007 already stages a capture in a per-deployment directory under the server's own data directory, which is never mounted into any container. The new provider-facing staging root is different infrastructure. The two MUST be named distinguishably in code, configuration and documentation, and no code path may treat one as the other.
- **FR-020**: The system MUST state, in documentation, who creates the provider-facing staging root, what ownership and permissions it carries, and that it is expected to exist before a provider can serve a restore.

#### The request queue — the server queues, the provider polls

- **FR-021**: All communication for this feature MUST be initiated by the provider. The server MUST NOT call into the provider, preserving the single brokered direction the platform's contract architecture already establishes.
- **FR-022**: The provider MUST be able to publish an index of the captures it holds. The index MUST be metadata only; no captured application bytes may traverse the server's API.
- **FR-023**: Each index entry MUST carry enough to judge a candidate: an identifier for the capture, when it was taken, its size, its location within the provider's repository, and the app-identity record found inside the capture when one is present.
- **FR-024**: Publishing an index MUST replace the previously published index for that provider install rather than merging into it, so a capture deleted from the repository stops being offered.
- **FR-025**: The published index MUST be persisted so it survives a server restart.
- **FR-025a**: The published index MUST be scoped to the provider install that published it, and MUST be discarded when that install is removed ~~or its restore consent is revoked~~ **[AMENDED 2026-09-21 — see Addendum A]**, so no index can outlive the only thing able to serve from it. A provider whose consent is absent is treated as serving nothing on every read, so a retained index for it offers no selectable candidate.
- **FR-026**: The provider MUST be able to poll for pending restore requests and receive, for each, the destination the server has chosen.
- **FR-027**: The destination for every request MUST be minted by the server beneath the staging root. A destination supplied, suggested, or modified by the provider MUST be rejected.
- **FR-028**: Each request MUST be claimable exactly once. A claim attempt on an already-claimed request MUST be refused distinguishably from a failure.
- **FR-029**: The provider MUST be able to report a request as completed or as failed, and a reported failure MUST fail the install without starting the app.
- **FR-030**: A claimed request that is never reported MUST expire after a bounded interval, failing its install with a reason that names the provider as unresponsive.
- **FR-031**: Expiry MUST survive a server restart — it MUST NOT depend solely on an in-flight timer — and MUST be re-evaluated whenever the request state is next examined.
- **FR-031a**: Restore request state MUST live in its own persisted store, following the existing broker store's pattern — one small record under the server's own configuration directory — but keyed so that several requests may be open at once. The existing broker store's single-open-operation-per-host property MUST NOT be assumed, as it does not hold here.
- **FR-031b**: The install waiting on a restore MUST observe the request's outcome by consulting the persisted request record, never by holding an in-memory handle that a restart would lose.
- **FR-031c**: The wait MUST be bounded by a deadline persisted on the request, with a documented default of thirty minutes and an operator override, following the precedent and the reasoning of the platform's existing capture timeout.
- **FR-031d**: Reporting of broker activity MUST accommodate a request-queue contract without altering what is reported for the existing capture contract, whose output MUST remain unchanged.
- **FR-032**: Each provider-facing endpoint MUST require the restore capability explicitly. The specification MUST enumerate the capability required per endpoint rather than assuming a single blanket rule, because a contract-scoped caller is denied by default even for reads.
- **FR-033**: A caller holding only the backup capability MUST NOT be able to reach any restore endpoint, and vice versa.
- **FR-034**: When the server holds no index for a provider — a freshly installed provider on a new host — it MUST be able to signal, in the poll response, that the provider should re-enumerate and publish afresh. This signal MUST NOT be a call into the provider.
- **FR-035**: Concurrent restore requests MUST each receive a distinct destination directory, and no request may observe or disturb another's.
- **FR-036**: The server MUST judge the destination before using its contents, and MUST NOT treat an empty or absent destination as a successful restore.
- **FR-037**: The server MUST clean up a request's destination directory whether the restore succeeded or failed, and a failure to clean up MUST NOT mask the restore's own outcome.
- **FR-038**: **[AMENDED 2026-09-21 — see Addendum A]** Consent absent at any point between a request being created and being completed MUST render the request unservable. Consent MUST be re-checked at claim and at completion, not only at creation — the original clause said "revoked", which named an operator action this platform does not offer; the testable property is that every step re-derives consent rather than trusting the step before it.

#### Moving the captured files into place

- **FR-039**: Once a restore is reported complete, the captured files MUST reach the app's data root through the sequence spec 007 already established, with the provider-staged directory standing in for the locally-captured copy.
- **FR-040**: Where the staging root and the apps root share a filesystem, the handoff SHOULD be a rename. Where they do not, it MUST fall back to a copy, and the job log MUST say which path was taken.
- **FR-041**: A provider's repository reproduces absolute paths, so the payload inside a completed destination is NOT guaranteed to be root-relative the way spec 007's own archives are. The system MUST locate the app data root within the delivered tree rather than assuming it sits at the top, and MUST refuse rather than guess when it cannot identify it unambiguously. This requirement closes the trap recorded in issue #486, which spec 007 deliberately left to this feature.
- **FR-042**: Everything spec 007 does after the files land — discard paths, the install-identity marker rewrite, pending credential placement, the service-scoped start, the fail-closed reload hook — MUST apply unchanged to a provider-sourced restore. No second restore path may be built.

#### Candidates from a provider

- **FR-043**: The existing restore-candidates surface MUST gain the notion that a candidate has an origin, distinguishing a live deployment on this host from a capture held by a provider. This is a new concept rather than a new value of an existing one; the candidate shape has no origin field today.
- **FR-043a**: A candidate MUST be identified by an origin-independent identifier, and the default selection MUST be expressed in terms of it. A provider-held capture has no deployment on this host, so identifying candidates by local deployment — as the surface does today — cannot express one.
- **FR-043b**: Several captures of the same installation MUST appear as several candidates within one lineage, ordered newest first, reusing the existing lineage grouping unchanged. A default MUST be offered only when exactly one lineage matches, exactly as today.
- **FR-044**: A candidate MUST also carry how confidently its app identity is known: read from an identity record inside the capture, or inferred from its location.
- **FR-045**: A client that does not understand the new origin information MUST continue to function, and MUST NOT present a provider-held capture as though it were a live deployment on this host.
- **FR-046**: Provider-held candidates MUST be subject to every eligibility rule spec 007 applies to live candidates — version skew, required acknowledgements, and refusal vocabulary — with no relaxation on account of their origin.
- **FR-047**: When no provider is installed, or a provider is installed without the restore role, the candidates surface MUST behave exactly as it does today.

#### Captures with no identity record

- **FR-048**: A capture carrying no identity record MUST still be offerable, and MUST be labelled as having an inferred identity.
- **FR-049**: The rule for inferring identity from a capture's location MUST be stated explicitly, including what shape of path it assumes and what happens when the path does not match that shape.
- **FR-050**: An inferred identity names the **installation** as it was directoried on the lost host, which is not the same fact as the catalog app it was an install of. The system MUST NOT treat an inferred identity as an app identity, MUST NOT auto-select on it, MUST NOT make it a default, and MUST NOT let it satisfy any check that a known identity would satisfy.
- **FR-051**: Selecting a capture with an inferred identity MUST require an explicit operator acknowledgement, expressed through the same acknowledgement mechanism spec 007 established.
- **FR-052**: A capture with no identity record carries no recorded configuration, so configuration carry-forward MUST be refused for it, and the operator MUST be told that is why.
- **FR-052a**: A candidate whose identity is inferred MUST NOT be offered as the default selection even when its lineage is the only one matching. The existing single-lineage default MUST be suppressed in that case rather than applied.

#### Honest coverage reporting

- **FR-053**: The platform's coverage judgement MUST report a restore verdict distinct from its backup verdict, so that an app captured consistently but declaring nothing about restoration does not read as recoverable.
- **FR-054**: An app with several stateful parts of which only some declare restore handling MUST report a partial restore verdict rather than a complete one.
- **FR-055**: Coverage reporting MUST remain a pure judgement over declarations, with no per-app special-casing.
- **FR-053a**: The restore verdict MUST use its own vocabulary rather than reusing the capture verdict's words. The capture vocabulary describes whether an app is quiesced while being read, which says nothing about whether it can be put back; an app declaring restoration by plain file copy is fully restorable and is not "partially" anything.

#### Retiring the fabricated restore surface

- **FR-056**: The existing endpoint that claims to start a backup restore but fabricates an identifier and creates no work, together with its request and response types and the interface affordance that invokes it, MUST be removed. Shipping a real restore while a fake one still answers is how a system acquires two restore surfaces, and an operator invoking the fake one today is simply lied to. This closes issue #484.
- **FR-057**: Removing it MUST NOT leave an interface element that appears actionable but does nothing.

#### The provider's side of the arrangement (catalog)

- **FR-058**: The catalog's manifest schema and its independent manifest validator both encode, in separate places, that nothing may declare `restore@1` as provided. Both MUST be updated together, along with the prose in each stating that no provider exists, or catalog validation fails.
- **FR-059**: The provider app's manifest MUST declare the restore provider role, which is what surfaces the new consent row on upgrade.
- **FR-060**: The provider's bundle MUST gain the ability to poll for restore requests, build and publish an index by enumerating its repository and reading the identity record out of each capture, and deliver a capture into the destination the server nominated.
- **FR-061**: The restore poller is **new continuously-running machinery**, not an extension of anything that already polls the server. The specification MUST record that the provider's existing reconciliation loop reconciles the provider's own local configuration rather than polling Hola, and that the provider's existing server-polling script is invoked once per capture by the provider rather than running continuously — so neither is a loop a restore poller can simply join.
- **FR-062**: The specification MUST record why a poller is required at all rather than the provider being driven by its own hook system: the provider's hook conditions are capture-lifecycle only and there is no restore-triggered condition to hang work on.
- **FR-063**: All catalog-side work MUST be **prepared and stopped**, with the diff reported for the repository owner to submit. No pull request may be opened against the catalog repository.

#### Boundaries and documentation

- **FR-064**: Restoring the provider itself MUST be out of scope and MUST be noted as circular, because the provider's own configuration holds the credentials that make its captures readable.
- **FR-065**: Documentation MUST state plainly that recovering onto a fresh host requires the operator to install the provider and supply the repository password, a secret the platform never holds, and the interface MUST NOT imply otherwise.
- **FR-066**: Deferred work arising from this feature MUST become tracked issues, never inline markers in the code.

### Key Entities

- **Restore contract (`restore@1`)**: the capability, now brokered, naming a two-sided relationship — an acceptor app that declares how it wants to be restored, and at most one provider app per host that can supply captures of it.
- **Staging grant**: the privilege a restore provider consents to — a writable mount of one platform-owned scratch directory, and nothing else.
- **Restore staging root**: the platform-owned directory, sibling to the apps root, beneath which the server mints one destination per request.
- **Snapshot index**: the provider's published, metadata-only statement of what captures it holds; a cache the server keeps, never a promise that a capture still exists.
- **Index entry**: one capture — its identifier, when taken, its size, where it lives in the provider's repository, and the identity record found inside it when there is one.
- **Restore request**: one unit of work the server has queued and is waiting on — its destination, its claim state, its deadline, and the install it belongs to.
- **Candidate origin**: whether a restore candidate is a live deployment on this host or a capture held by a provider.
- **Identity confidence**: whether a candidate's app identity was read from a record inside the capture or inferred from where the capture sits.
- **Restore coverage verdict**: the judgement, separate from backup coverage, of how completely an app has declared the way it is restored.
- **Restore request store**: the persisted record of every open request — its destination, claim state and deadline — keyed so several may be open at once, unlike the single-record capture broker it is modelled on.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can bring an app back on a host where it has never been installed, from a capture held by a provider, without any live deployment of that app existing anywhere on the host.
- **SC-002**: No captured application data passes through the platform's own API during a restore; the only thing the platform receives about a capture is its description.
- **SC-003**: A provider upgraded to declare the restore role holds no new privilege of any kind until an operator consents, verified by inspecting what the provider is actually given.
- **SC-004**: The privilege a consenting provider gains is exactly one writable scratch directory; it gains no writable access to any app's data and no additional readable access.
- **SC-005**: The platform makes no outbound call to any app for any part of this feature.
- **SC-006**: A restore whose provider stops responding fails its install within a bounded time, with a message naming the provider, rather than remaining open indefinitely — including across a restart of the platform.
- **SC-007**: A restore that fails for any reason never leaves a started app; the install fails instead.
- **SC-008**: Every rule spec 007 applies to a restore from a live deployment applies identically to a restore from a provider, with a single shared sequence rather than two.
- **SC-009**: A capture with no identity record is offered, is visibly marked as inferred, and cannot be selected without an explicit acknowledgement or be chosen by default.
- **SC-010**: An inferred identity never satisfies a check that a known identity would satisfy.
- **SC-011**: An app that is captured consistently but declares nothing about being restored is reported as not restorable, distinguishably from one that is.
- **SC-012**: No endpoint remains that claims to perform a restore without performing one.
- **SC-013**: The platform behaves exactly as it does today when no provider is installed — same candidates, same interface, no suggestion that anything is missing.
- **SC-014**: Every app that declares `restore@1` today keeps working without a manifest change and appears as an acceptor in the platform's contract reporting, which it does not today.
- **SC-015**: An app that is captured but has declared nothing about restoration is never reported as participating in restoration — it is reported as not participating, and separately as not restorable.
- **SC-016**: Several restores can be in flight at once, each against its own destination, and reporting for the capture contract is unchanged by their existence.
- **SC-017**: Many captures of one installation are offered as one family ordered newest first, and a family whose identity is inferred is never pre-selected.

## Assumptions

Decisions taken where the prompt of record did not settle the matter, or settled it on a premise the code does not support. Each is a considered default, recorded so it can be revisited.

- **`restore@1` is promoted rather than a second reference being minted.** Minting a sibling reference for the provider side would leave two names for one relationship and require every acceptor app to declare both. The acceptor's declaration already means "here is how I want to be restored", which is exactly the acceptor half of this contract. Spec 007 made it a marker precisely because no provider existed yet; one exists now.
- **The provider role is filled by an app, not by the platform.** The platform performing a restore from a live local deployment is not filling the provider role — it is restoring without a provider, which remains supported. The provider role specifically means supplying a capture from outside this host.
- **The provider's restore poller is a new component in the provider's bundle**, rather than a clause added to the provider's existing reconciliation loop. That loop's subject is the provider's own local configuration and its cadence is a reconciliation cadence; folding a request poll into it would couple two unrelated failure modes, so that a failure to read local configuration would also stall restores.
- **The fabricated restore endpoint is deleted rather than implemented.** Implementing it would mean a second restore surface with different semantics from the one this feature builds. Whether the unused job type it references survives is a design decision for planning; the requirement is that no fabricated endpoint does.
- **An inferred identity is derived from the installation directory name**, which on this platform is a slug followed by a short hexadecimal suffix. The recovered slug is the installation's name, not the catalog app's identifier — an install named for its purpose does not carry its app's name — which is why FR-050 forbids treating it as an app identity.
- **Request expiry is bounded by a deadline persisted with the request**, not by an in-memory timer alone, because a platform restart must not lose the deadline.
- **The index is authoritative only about what the provider believed it held at publication time.** A capture pruned from the repository afterwards fails at execution; the index is not re-validated on every read.
- **Ownership and permissions of the staging root follow the apps root's existing arrangement**, including the expectation that provisioning tooling creates it rather than the server doing so at runtime.

## Addendum A — a mechanism this spec assumed and the platform does not have

*Added 2026-09-21, after implementation and adversarial review independently confirmed it.*

Three requirements above (FR-017, FR-025a, FR-038) were written against **per-grant consent revocation** — an
operator withdrawing a privilege from an installed app. **No such mechanism exists anywhere on this platform,
for any contract.** Consent is recorded once at install and is removed only by uninstalling the app; this is
equally true of `backup@1`, which has shipped for some time. The assumption was not checked before the
requirements were written, and neither the clarify pass nor the analyze pass caught it, because every artifact
consistently described the same non-existent mechanism.

**What was built instead, and why it is safe.** Consent is re-derived from the deployment record on every read
rather than cached at request creation. A provider whose consent is absent — for whatever reason — therefore
serves nothing, at every step: it cannot be found as the provider, cannot claim, and cannot complete. That is
the behaviour the three requirements were reaching for; what is missing is only the operator's ability to
*cause* it deliberately without uninstalling.

**What this feature does not do.** It does not add revocation. Adding it would change consent semantics for
every existing contract and every installed app, which is out of proportion to this slice and belongs to a
decision about the consent model as a whole. It is filed as a tracked issue.

**What a reader should take from this.** The amended requirements are the honest ones: absence of consent,
re-derived at every step, rather than revocation as an event. The strikethroughs are left in place so the
original assumption and its correction are both visible.

## Dependencies

- **Spec 007 (restore-on-install), shipped.** Every mechanism from the empty-root assertion through the fail-closed reload hook is reused unchanged. This feature adds a source; it does not add a second sequence.
- **Spec 006 (install identity), shipped.** The identity record inside a capture is what makes a candidate's app identity knowable rather than inferred. Captures predating it are the inference case FR-048 through FR-052 govern.
- **The existing capability-contract machinery.** Provider guard, consent recording, contract-scoped tokens and the coverage rollup are all reused; the token machinery in particular is already generic over contracts and needs no change.
- **The provider app in the catalog.** Without a provider bundle able to poll, index and deliver, the platform half has no counterpart. The catalog work is prepared here and submitted separately by the repository owner.

## Scope

**In scope**: promoting `restore@1` to a brokered contract and retiring the marker machinery; the staging grant, its consent row and its writable mount; the staging root; the four provider-facing endpoints and the request lifecycle including claim, completion, failure and expiry; the persisted snapshot index; provider-sourced candidates with origin and identity confidence; inference-identified captures and their acknowledgement; locating the app data root within a delivered tree; the restore coverage verdict; removal of the fabricated restore endpoint and its affordance; the architecture decision record; documentation; and preparation of the catalog diff.

**Out of scope**: any call from the platform into an app; any capture passing through the platform's API; restoring the provider itself; restoring to anywhere other than a fresh install's empty data root; scheduled or unattended restores; any second restore sequence; and opening a pull request against the catalog repository.
