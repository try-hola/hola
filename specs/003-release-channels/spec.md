# Feature Specification: Release Channels

**Feature Branch**: `003-release-channels`

**Created**: 2026-09-03

**Status**: Draft

**Input**: User description: "Release channels (GitHub issue #428): offer pre-release app versions through the catalog instead of ad-hoc image overrides. Catalog `versions[]` entries carry a `channel` (default `stable`, e.g. `rc`); each deployment records a `channel` (default `stable`) that governs which catalog versions it is offered on upgrade; `hola install <app> --channel rc --as <name>` creates a channel-differentiated second deployment of a single-instance app with a recorded reason (implying allowMultiple) so the dashboard shows it as the app's rc instance; dashboard + CLI surface the channel; ADR 0005 documents the channel model. Out of scope: try-hola/apps publishing prerequisites (other repo) and the `--from` clone-with-data flow (follow-up issue)."

**Source issue**: [try-hola/hola#428](https://github.com/try-hola/hola/issues/428)

## Executive Summary

Today an operator has no supported way to run a pre-release version of a catalog
app. Every bundle pins one version, so trying an upstream release candidate means
editing the catalog repository and publishing it to everyone. Letting the operator
type an arbitrary image reference at install time is the wrong fix: the image pin
travels with version-specific environment defaults, auth wiring and upgrade
metadata, and bundles pin by digest, so an override silently desynchronises those.

This feature introduces **release channels**. The catalog may list more than one
version of an app, each tagged with a channel (`stable` by default, `rc` for
release candidates). Each deployment records which channel it follows, and that
channel decides which versions the deployment is offered on upgrade. An operator
can stand up a channel-differentiated second copy of a single-instance app (for
example `remo-beta` following `rc` beside `remo` on `stable`) without the blunt
"allow multiple" override, and the dashboard shows why the second copy exists.
The store decides what exists per channel; the operator chooses which channel to
follow. Nothing on the `stable` channel changes for operators who never opt in.

## Scope

**In scope (this repository):**

- Channel marker on catalog version entries, defaulting to `stable` when absent.
- Pre-release-aware version ordering wherever a "newest version" is chosen.
- Per-deployment channel, recorded at install, defaulting to `stable`.
- Channel-aware upgrade offering and upgrade target validation.
- Channel-aware single-instance guard with a recorded reason for the second copy.
- CLI and dashboard surfaces for choosing and seeing a channel.
- Architecture decision record 0005 documenting the channel model.
- A follow-up issue for the clone-with-data (`--from`) rehearsal flow.

**Out of scope:**

- Changes to the catalog publishing pipeline in `try-hola/apps` (the `:latest`
  guard, publishing pre-release bundles from a pull request, emitting multiple
  `versions[]` entries, stale release workflows). Those are prerequisites in
  another repository and are tracked there.
- Seeding a channel deployment from an existing deployment's data (`--from`).
  Filed as a follow-up; this feature's channel deployments start empty.
- Blue/green promotion between two deployments. A channel deployment is a
  rehearsal that ends in discard, not a cutover path.
- Renaming or re-hosting an existing deployment.
- Any change to bundle `manifest.json`; the channel is a catalog-index attribute,
  not a manifest attribute.

## Clarifications

### Session 2026-09-04

- Q: `stable` is eligible on every channel (FR-003), so `--channel <anything-well-formed>` resolved a stable version and counted as channel-differentiated — an unlimited bypass of the single-instance guard ([#431](https://github.com/try-hola/hola/issues/431)). Which channels differentiate a second copy? → A: Only a **published** channel: one the catalog lists at least one well-formed version of that app on. An unpublished channel may still be *followed* (it receives the stable floor's offers, unchanged), but a second copy of a single-instance app on it needs the operator override, which is then recorded as `operator-override`. FR-015 amended.
- Q: What happens when the channel's published-ness cannot be established at install time (catalog unreachable so the draft fell back to placeholder defaults, an install-by-ref draft, a deployment record written before this change)? → A: **Fail closed** — treat the channel as unpublished. A second copy of a singleton app is never urgent, and the operator override is always available; the alternative (fail open) restores the bypass exactly when the catalog can't contradict it. The fact is decided once, at draft creation, from the catalog read that already resolved the version, and carried on the finalized manifest like `channel` and `multiInstance` — no catalog call at deployment-create time.

### Session 2026-09-03

- Q: When an operator passes both the allow-multiple override and a channel that no existing copy follows, which instance reason is recorded? → A: The reason that actually permitted the install, with the channel difference taking precedence; `operator-override` is recorded only when the override was necessary. A first (or multi-instance) copy records no reason.
- Q: After an rc deployment upgrades to a stable version, does it stay on `rc`? → A: Yes. The channel is sticky and only an explicit channel change moves it; the deployment keeps being offered rc-eligible versions.
- Q: How is an app with no `stable` version (only non-stable entries) presented and installed? → A: It is still listed, with no version shown and its available channels shown. A default install (implicit `stable`) is rejected with a message naming the channels that do have versions; the install flow's channel choice lists only channels with versions.
- Q: Should the update offer include the offered version's channel as well as the deployment's channel? → A: Yes. The offer carries both so clients can render `1.3.0-rc.2 (rc)` without a further lookup.
- Q: If an operator pins a pre-release version without naming a channel for an app already installed on `stable`, is that a channel copy? → A: Yes. The implied channel counts for the per-app-and-channel guard, so the install is permitted; the distinct-name rule still applies, so with the default name the existing subdomain-conflict rejection tells the operator to choose a name.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Stable operators are unaffected by pre-release entries (Priority: P1)

An operator browsing and installing apps from the catalog must never be handed a
pre-release version unless they asked for one. When the catalog publishes an
`rc` entry beside the stable entry, the catalog card, the default install, the
"latest" alias and the upgrade offering for every existing deployment continue to
resolve to the newest **stable** version.

**Why this priority**: This is the safety property that makes channels usable at
all. If a single pre-release entry could become anyone's default, the catalog
could not publish one. Today a pre-release-suffixed version string also breaks
the newest-version resolution for the whole app, so this story fixes a latent
bug as well.

**Independent Test**: Serve a catalog where an app lists `1.2.0` (stable) and
`1.3.0-rc.1` (rc). Browse, install with no channel, check for updates on a
stable deployment of `1.1.0`. Every surface reports `1.2.0`.

**Acceptance Scenarios**:

1. **Given** an app with versions `1.2.0` (stable) and `1.3.0-rc.1` (rc), **When** the catalog list is viewed, **Then** the app's displayed version is `1.2.0`.
2. **Given** the same app, **When** an operator installs it without naming a channel or version, **Then** the deployment runs `1.2.0` and records channel `stable`.
3. **Given** a stable deployment of that app at `1.1.0`, **When** an update check runs, **Then** the offered update is `1.2.0` and `1.3.0-rc.1` is not mentioned.
4. **Given** an app whose version entries carry no channel field at all, **When** any of the above happens, **Then** behaviour is identical to today (every entry is treated as `stable`).
5. **Given** an app whose newest stable version has a pre-release-style suffix nowhere but whose rc entry does, **When** the newest version is resolved, **Then** ordering is by version precedence (a release outranks a pre-release of the same number) rather than by list position.

---

### User Story 2 - Install a pre-release beside the stable copy (Priority: P1)

An operator running `remo` on `stable` wants to try `remo 0.11.0-rc.1`. They
install the app again on the `rc` channel under a distinct name (for example
`remo-beta`). Because the two copies are on different channels, the platform
allows the second install of a single-instance app without the "allow multiple"
override, records that the second copy exists because it follows `rc`, and the
dashboard shows it as remo's rc instance rather than an unexplained duplicate.

**Why this priority**: This is the headline capability from the issue: a
supported path to a pre-release that keeps the digest pin, the version-specific
environment defaults and the upgrade metadata together.

**Independent Test**: With `remo` installed on `stable`, run the install on
channel `rc` with a distinct name. The deployment is created at the newest `rc`
version, its record shows channel `rc` and the reason for the second instance,
and the deployments list distinguishes the two.

**Acceptance Scenarios**:

1. **Given** a single-instance app installed on `stable`, **When** the operator installs it on channel `rc` with a distinct name, **Then** the install succeeds without the "allow multiple" override, runs the newest `rc`-eligible version, and records channel `rc`.
2. **Given** the resulting rc deployment, **When** the operator views the deployments list or the deployment's detail, **Then** the channel is visible as a badge and the detail explains the deployment is the app's `rc` instance.
3. **Given** a single-instance app already installed on `rc`, **When** the operator installs it on `rc` again, **Then** the install is rejected with the existing single-instance message (the override still works).
4. **Given** an app with no `rc` version in the catalog, **When** the operator installs it on channel `rc`, **Then** the install is rejected with a message naming the channel and stating no version is available on it.
5. **Given** an operator who pins a specific pre-release version without naming a channel, **When** the install proceeds, **Then** the deployment records that version's channel and the operator is told which channel the deployment now follows.
6. **Given** an operator who pins a version that is not eligible on the requested channel, **When** the install is attempted, **Then** it is rejected with a message naming the version, the requested channel and the version's actual channel.
7. **Given** a second-copy install on channel `rc` whose chosen name collides with an existing subdomain, **When** the install is attempted, **Then** the existing subdomain-conflict rejection applies unchanged.

---

### User Story 3 - A channel deployment is offered the right upgrades (Priority: P2)

A deployment following `rc` should be offered newer `rc` builds as they appear,
and should also be offered the stable release once the pre-release graduates
(the stable channel is the floor every other channel includes). A deployment
following `stable` is never offered a pre-release. Explicitly upgrading to a
version outside the deployment's channel is refused with a hint to change
channel first.

**Why this priority**: Without this, a channel deployment is a one-shot install
rather than something that tracks a channel over time, and a stable deployment
could be pushed onto a pre-release by a typo.

**Independent Test**: Create an rc deployment at `1.3.0-rc.1`; publish
`1.3.0-rc.2`, then `1.3.0`. Each update check offers the newest eligible version.
A stable deployment at `1.2.0` is offered nothing until `1.3.0` appears.

**Acceptance Scenarios**:

1. **Given** an rc deployment at `1.3.0-rc.1` and catalog entries `1.3.0-rc.2` (rc), **When** an update check runs, **Then** `1.3.0-rc.2` is offered.
2. **Given** an rc deployment at `1.3.0-rc.2` and a new `1.3.0` (stable), **When** an update check runs, **Then** `1.3.0` is offered, and after upgrading to it the deployment still follows `rc`.
3. **Given** a stable deployment at `1.2.0` and only `1.3.0-rc.2` newer, **When** an update check runs, **Then** no update is offered.
4. **Given** a stable deployment, **When** an operator explicitly requests an upgrade to an `rc` version, **Then** the request is rejected with a message naming the deployment's channel, the target version's channel, and how to switch channel.
5. **Given** an rc deployment, **When** the operator explicitly requests an upgrade to a stable version newer than the installed one, **Then** it is allowed.
6. **Given** an upgrade across channel-tagged versions, **When** the upgrade proceeds, **Then** the same upgrade-path checks, pre-upgrade backup behaviour and rollback behaviour apply exactly as for stable-to-stable upgrades.

---

### User Story 4 - Change the channel a deployment follows (Priority: P3)

An operator may move an existing deployment onto a different channel, for
example putting a throwaway instance onto `rc`, or returning an rc instance to
`stable` once the release graduated. Changing the channel never changes the
running version by itself; it only changes what the deployment is offered next.

**Why this priority**: Useful but not required for the core flow, since the rc
copy can simply be discarded. Included because the attribute exists and the
edit surface already exists.

**Independent Test**: Switch a stable deployment to `rc`, run an update check
and see the rc build offered; switch back and see it withdrawn.

**Acceptance Scenarios**:

1. **Given** a stable deployment, **When** the operator changes its channel to `rc`, **Then** the deployment's record shows `rc`, the running version is unchanged, and the next update check offers rc-eligible versions.
2. **Given** an rc deployment running a pre-release, **When** the operator changes its channel to `stable`, **Then** the change is accepted and the next update check offers only stable versions newer than the installed one (never a downgrade).
3. **Given** a channel change that would make a second single-instance copy share a channel with another copy of the same app, **When** the change is attempted, **Then** it is accepted with a warning (it does not retroactively violate the guard) and the recorded reason for the second copy is preserved.
4. **Given** a channel name that is not well-formed, **When** the change is attempted, **Then** it is rejected with a message describing the accepted form.

---

### User Story 5 - See what channels the catalog offers (Priority: P3)

Before choosing a channel, an operator wants to know which channels an app has
versions on. The catalog exposes the channel of every version, the app's version
list shows it, and the dashboard's install flow offers a channel choice only when
the app has a non-stable version.

**Why this priority**: Discoverability. Without it the rc path is only usable by
someone who already knows an rc exists.

**Independent Test**: Query an app's versions and see the channel on each entry;
open the install flow for an app with an rc and see the channel choice; open it
for an app with only stable versions and see no such choice.

**Acceptance Scenarios**:

1. **Given** an app with versions on `stable` and `rc`, **When** its version list is requested, **Then** every entry carries its channel and entries without one are reported as `stable`.
2. **Given** the same app, **When** the operator opens the dashboard install flow, **Then** a channel choice is shown defaulting to `stable` and the resulting deployment follows the chosen channel.
3. **Given** an app with only stable versions, **When** the operator opens the install flow, **Then** no channel choice is shown.
4. **Given** a single-instance app installed on `stable` that has an rc version, **When** the operator views it in the catalog, **Then** an affordance to install its rc copy is available alongside the existing manage action.

---

### Edge Cases

- **Malformed channel name on a catalog entry** (uppercase, spaces, empty
  string, non-string): the entry is excluded from every channel and a diagnostic
  is logged naming the app, version and value. It must never be silently
  promoted to `stable`.
- **Pre-release version string on a `stable` entry**: allowed (the catalog is
  authoritative); ordering uses version precedence, so it is only chosen when it
  is genuinely the newest stable.
- **Deployment records written before this feature** carry no channel; they are
  read as `stable` and no migration is required.
- **A version listed twice with different channels**: the first occurrence wins
  and a diagnostic is logged.
- **Channel changes while an upgrade job is queued**: the queued job's target
  was validated at enqueue time and proceeds; the new channel applies to the next
  offering.
- **Multi-instance apps** (manifest opts in): channels add nothing to the
  instance guard; every install is allowed as today, and each copy still records
  its channel.
- **Custom catalog sources** each carry their own version list; channel
  eligibility is evaluated against the deployment's own source, as upgrades are
  today.
- **`latest` alias on a non-stable channel** resolves to the newest version
  eligible on that channel (which may be a stable version newer than any rc).
- **An app with only non-stable versions**: listed without a version; a default
  install is rejected naming the channels that have versions; the install flow's
  channel choice lists only those channels.
- **Override supplied but not needed** (channel differs anyway): the recorded
  instance reason is `channel`, not `operator-override`.
- **Unknown channel names** (not `stable` or `rc`) are accepted when well-formed;
  the catalog decides what channels exist. A deployment on a channel with no
  versions simply receives the stable floor's offers.
- **An unpublished channel as a second copy** (#431): a well-formed channel the
  catalog publishes no version of the app on is still installable and followable,
  but it does not differentiate a second copy of a single-instance app — otherwise
  any invented name would be an unlimited operator override with a nicer label.
  The second install is rejected naming the unpublished channel, and the operator
  override still forces it (recording `operator-override`). Fail-closed: when the
  channel's published-ness cannot be established at install time (the catalog was
  unavailable and the draft fell back to placeholder defaults, an install-by-ref
  draft, or a record written before #431), it is treated as unpublished.

## Requirements *(mandatory)*

### Functional Requirements

**Catalog and version resolution**

- **FR-001**: Each catalog version entry MAY carry a channel. An absent channel MUST be treated as `stable`.
- **FR-002**: A channel name MUST be a lowercase identifier of 1 to 32 characters, starting with a letter and containing only letters, digits and hyphens. Entries with any other value MUST be excluded from offering on every channel and reported in the server log with app, version and value.
- **FR-003**: A version is **eligible** on channel C when its own channel is C or `stable`. Consequently `stable` is eligible everywhere and a `stable` deployment is offered only `stable` versions.
- **FR-004**: Wherever the platform resolves a "newest" version (catalog card version, the `latest` alias, the update offering), it MUST choose the newest eligible version by version precedence, where a release outranks a pre-release of the same number, and MUST NOT fall back to list position because a version string carries a pre-release suffix.
- **FR-005** *(amended 2026-09-04, [#431](https://github.com/try-hola/hola/issues/431))*: The app version list MUST report the channel of every version, and the version detail MUST report the resolved version's channel and the channels the app has well-formed versions on (the same set as FR-006), so the install path can record whether the channel it resolved is published.
- **FR-006**: The app summary shown in the catalog list MUST additionally report the set of channels the app has well-formed versions on, so clients can decide whether to show a channel choice. An app with no `stable` version is still listed, with no version shown and its channels reported.

**Deployments**

- **FR-007**: Every deployment MUST record the channel it follows. Records without one MUST be read as `stable`.
- **FR-008**: At install, the channel is determined in this order: an explicit channel from the request; otherwise the channel of an explicitly pinned version; otherwise `stable`.
- **FR-009**: At install, the installed version MUST be eligible on the deployment's channel. A channel (explicit or the implicit `stable`) with no eligible versions, or a pinned version not eligible on the explicit channel, MUST be rejected before any draft is finalised, with a message naming the channel(s) involved and, when other channels have versions, listing them.
- **FR-010**: When a pinned version implies a non-stable channel, the response MUST state the channel the deployment will follow.
- **FR-011**: The update offering for a deployment MUST consider only versions eligible on the deployment's channel and MUST report both the deployment's channel and the offered version's channel alongside the offer.
- **FR-012**: An explicit upgrade to a version not eligible on the deployment's channel MUST be rejected with a message naming both channels and how to change the deployment's channel. Same-version and downward moves keep today's behaviour.
- **FR-013**: Operators MUST be able to change a deployment's channel through the existing deployment-edit surface. A channel change MUST NOT alter the running version, and no upgrade (including an rc deployment taking a stable version) MUST ever change the channel implicitly: the channel is sticky.
- **FR-014**: Upgrade-path checks, pre-upgrade backup, rollback and auth provisioning MUST behave identically for channel-tagged versions and untagged versions.

**Single-instance guard**

- **FR-015** *(amended 2026-09-04, [#431](https://github.com/try-hola/hola/issues/431))*: The single-instance guard MUST be evaluated per app **and channel**: a second copy of a single-instance app is permitted without the operator override when no existing copy of that app follows the channel resolved by FR-008 (explicit or implied by a pinned version) **and that channel is published for the app** — the catalog lists at least one well-formed version on it. A channel that is not published (or whose published-ness cannot be established) MUST NOT differentiate a second copy; the operator override remains available and the rejection MUST say the channel has no versions published for the app. A deployment may still *follow* an unpublished channel (FR-003's stable floor still applies).
- **FR-016** *(amended 2026-09-04, [#431](https://github.com/try-hola/hola/issues/431))*: A second copy of a single-instance app MUST record the **instance reason** that permitted it: `channel` when FR-015's channel rule is what permitted it — no existing copy followed its channel *and* that channel is published (this takes precedence even if the override was also supplied) — otherwise `operator-override`. First copies and copies of multi-instance apps record no reason. The reason MUST be exposed on the deployment detail.
- **FR-017**: A second copy still MUST have a distinct name and subdomain; all existing subdomain validation applies unchanged.
- **FR-018**: The operator override remains available and keeps its current meaning; a copy created with it records the override reason.

**Command line**

- **FR-019**: The install command MUST accept a channel option, MUST accept `--as <name>` as an alias of the existing name option, and MUST print the channel the deployment follows.
- **FR-020**: The upgrade command MUST honour the deployment's channel when no explicit version is given, and MUST surface the channel-mismatch rejection when one is.
- **FR-021**: The deployments listing MUST show each deployment's channel when it is not `stable`, and the catalog listing MUST indicate which non-stable channels an app offers. (No command lists an app's individual versions today; if one is added it MUST show each version's channel.)

**Dashboard**

- **FR-022**: The deployments list and the deployment detail MUST show a channel badge for non-stable deployments; the detail MUST show the channel and, for a second copy, the reason it exists.
- **FR-023**: The install flow MUST offer a channel choice only when the app has a non-stable version, listing only channels that have versions, defaulting to `stable` when it has versions and to the first listed channel otherwise, and MUST pass the choice through to the install.
- **FR-024**: The catalog view MUST offer an "install on `<channel>`" affordance for an installed single-instance app that has versions on a channel none of its copies follow.
- **FR-025**: The deployment edit surface MUST allow changing the channel with the same validation as the server.

**Documentation and follow-ups**

- **FR-026**: An architecture decision record numbered 0005 MUST document the channel model: the two versions (bundle vs upstream image), why an image override was rejected, channel eligibility, the per-channel single-instance rule, and the relationship to the open catalog-governance question.
- **FR-027**: A GitHub issue MUST be filed for the clone-with-data (`--from`) rehearsal flow, carrying the design considerations from the source issue (secrets, outbound side effects, disk and IO cost, absolute-URL breakage, rehearsal-not-cutover).
- **FR-028**: Operator documentation MUST describe how to install and follow a channel, and what a channel deployment does and does not test.

### Key Entities

- **Catalog version entry**: one version of one app as listed by a catalog source. Attributes: version string, channel (default `stable`), bundle reference. Belongs to one app within one source.
- **Channel**: a label naming a release track. `stable` is the default and the floor; every other channel includes `stable`. The catalog defines which channels exist by tagging versions.
- **Deployment**: an installed copy of an app. Gains a followed channel (default `stable`) and, when it is a second copy of a single-instance app, an instance reason (`channel` or `operator-override`).
- **Update offer**: the newest version eligible on a deployment's channel that is newer than the installed version, together with the deployment's channel and the offered version's channel.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With a catalog that lists a pre-release entry for an app, 100% of stable-channel surfaces (catalog card, default install, `latest`, update offers) resolve to the newest stable version in the automated suite.
- **SC-002**: An operator can go from "remo is installed on stable" to "remo-beta is running the rc" with a single install command or a single dashboard install flow, without using the allow-multiple override.
- **SC-003**: The dashboard distinguishes a channel copy from its stable sibling at a glance (badge on the list, channel and reason on the detail) so an operator can tell which copy to remove afterwards without opening logs or files.
- **SC-004**: Existing deployments and existing catalog data behave identically before and after the change: zero test changes are needed for pre-existing stable-only fixtures beyond adding channel-aware assertions.
- **SC-005**: Every rejection introduced by this feature (no version on channel, version not eligible, cross-channel upgrade, malformed channel) names the channel(s) involved and the corrective action in its message.
- **SC-006**: All package quality gates pass, and channel behaviour is covered by automated tests for catalog parsing, version resolution, update offering, the instance guard, the CLI install path and the dashboard surfaces.

## Assumptions

- The catalog repository will publish pre-release bundles with a `channel` marker on the `versions[]` entry once its own prerequisites land; until then this feature is exercised by tests and by custom catalog sources. Nothing here depends on the catalog repository changing first.
- Channel eligibility is "own channel or stable". Channels are not ordered among themselves (no `beta` includes `rc` hierarchy); that can be added later without changing the data shape.
- Channel names other than `stable` and `rc` are accepted when well-formed. The platform does not maintain a closed list.
- The per-app-and-channel instance rule applies only to single-instance apps; apps that opt into multiple instances are unaffected.
- Changing a deployment's channel is an ordinary metadata edit and does not require a job.
- The bundle manifest is unchanged; a version's channel comes solely from the catalog index. If the same version appears in different catalog sources with different channels, each source is authoritative for its own deployments.
- The follow-up clone flow and the catalog repository prerequisites are tracked as separate issues and are not gates for merging this feature.
- Registry feeds consumed by other apps (the installed-apps registry) need no channel field for this feature; the deployment name already distinguishes copies.
