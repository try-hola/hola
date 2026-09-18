# Feature Specification: Beta Channel Support for Catalog Apps (Operator Model)

**Feature Branch**: `005-beta-channel-ux`

**Created**: 2026-09-08

**Status**: Draft

**Input**: User description: "Beta channel support for catalog apps — operator model on top of ADR 0005 release channels. Spec 003 shipped the channel mechanism (per-version channel, per-deployment followed channel, channel-filtered update offers, a channel change on a deployment) but no coherent user model. Build a three-layer model: (1) Enrolment — a host-level 'show pre-release channels' setting, default off, that gates discovery only; (2) Track — per installed copy, the followed channel is front-and-centre with Join/Leave actions behind a confirm dialog, and leaving a pre-release channel keeps the copy on its current build until a stable release at or above it ships; (3) Side-by-side copy — a secondary 'try it in a separate copy' action. Running-build channel and followed channel are different facts and both are shown. Channel names stay open strings. The single-instance guard is unchanged. Catalog card, install wizard, deployment detail, deployments list and settings page are reworked accordingly; the server exposes the running build's channel, whether an app is multi-instance, and a structured 'already installed' conflict; the CLI gains a channel command. ADR 0005 is amended and the operations guide documents the flow."

**Source prompt**: local plan file `~/.claude/plans/sunny-shimmying-mitten.md` ("Beta channel support for catalog apps: mental model + change plan"), confirmed 2026-09-08. No GitHub issues are closed by this feature.

## Executive Summary

Spec 003 (ADR 0005) gave Hola a complete release-channel **mechanism**: every catalog
version belongs to a channel (`stable` is the floor every channel includes), every installed
copy follows one channel, update offers are filtered by that channel, and the followed
channel can be changed in place in either direction. What did not ship is a coherent
**operator model**, and the dashboard shows it. On an app card, "+ Another" and "+ Install
on beta" sit side by side with the second wrapping; the channel a copy follows is a select
buried in the Configuration tab; the deployment page prints an "Instance" fact that reads
"rc instance of gitea · also installed: gitea (stable) · permitted by channel"; a conflict
tells dashboard users to "pass --allow-multiple"; and an operator who wants nothing to do
with pre-releases has no way to say so.

The prior art (iOS Beta Updates, Windows Insider rings, Play "You're a beta tester",
Steam's Betas tab, Chrome Beta beside Chrome) separates three questions that Hola's UI
collapses into one:

| Layer | Question it answers | Hola today | Hola after |
|---|---|---|---|
| **1. Enrolment** (host) | "Do I want to see pre-release builds at all?" | Missing; every operator sees beta chrome | A host setting, **off** by default |
| **2. Track** (per installed copy) | "Which channel does *this* copy follow for updates?" | Exists, but hidden in the Configuration tab | Front-and-centre: **Join** / **Leave** on the copy |
| **3. Side-by-side** (advanced) | "Can I rehearse a pre-release without touching prod?" | The *headline* card button | A secondary action on the copy |

This feature makes pre-release installs of **catalog apps** obvious and safe by building
that model into the dashboard and CLI. It does not touch Hola's own release process, does
not add a channel enum, and does not change the single-instance guard.

## Scope

**In scope (this repository):**

- A host-level enrolment setting that hides or reveals pre-release channel choices in the
  dashboard, persisted with the other system settings.
- Join/Leave a channel as the primary per-copy action on the deployment page, with a
  confirmation that states the consequence honestly (including the "stays on the current
  build" state when leaving a pre-release channel).
- The running build's channel exposed alongside the followed channel, on the list, the
  detail and the update check.
- Whether an app allows multiple copies exposed on the list and detail, so the card can
  offer "+ Another" only when it is a real option.
- A structured "already installed" conflict that every surface can render with actions
  (switch the existing copy's channel, open it, or install a separate copy).
- Reworked catalog card, install wizard channel choice and conflict panel, deployment
  detail Channel block, deployments list pill and filter, and a shared channel pill.
- A CLI command to show or change the channel a copy follows, and a CLI hint for the
  structured conflict.
- ADR 0005 amendment recording the operator model; operations documentation; the
  architecture notes in `CLAUDE.md`.

**Out of scope:**

- Hola's own release channels (server/web/CLI pre-releases) — unrelated to catalog apps.
- Any change to channel eligibility, the stable floor, the single-instance guard's rules, or
  the reasons it records (ADR 0005 §2, §4).
- A closed channel vocabulary (ADR 0005 rejected it; names stay open strings).
- Catalog-side changes (`try-hola/apps`).
- A notification when a followed channel publishes a new version; a pre-release pill on the
  Apps launcher tiles. Both become follow-up issues.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An operator who never asked for betas never sees them (Priority: P1)

An operator installs Hola, browses the catalog and installs apps. One catalog app also
publishes a `beta` version. Because the operator has not opted in, nothing on the catalog
card, in the install wizard, or on the deployment page mentions the beta: the card shows a
single Install action, the wizard shows no channel choice, and the copy follows `stable`
like every other.

**Why this priority**: The default experience is the one most operators have. Today every
operator sees "Install on beta" chrome they did not ask for; removing it is the foundation
the other layers sit on.

**Independent Test**: With the enrolment setting off and a catalog stub that lists a
`stable` and a `beta` version for one app, render the catalog, the wizard and the detail
page and assert no channel choice or pre-release text appears; install the app and assert
it follows `stable`.

**Acceptance Scenarios**:

1. **Given** enrolment is off and an app publishes `stable` and `beta`, **When** the operator
   views the catalog, **Then** the card shows one Install action, no per-channel install link,
   no "beta available" text and no channel pill.
2. **Given** enrolment is off, **When** the operator opens the install wizard for that app
   from the card, **Then** no channel choice is shown and the resulting copy follows `stable`.
3. **Given** enrolment is off and the operator opens the wizard via a link that names a
   channel explicitly, **When** the summary step renders, **Then** the channel choice **is**
   shown with that channel pre-selected, and the note beneath it says which channel the copy
   will receive updates from (explicit links keep working; enrolment gates discovery only).
4. **Given** enrolment is off and a copy already follows `beta`, **When** the operator views
   the deployments list and the copy's detail page, **Then** the copy still shows its `beta`
   pill and channel block and still receives `beta` offers (opting out never downgrades an
   existing copy).

---

### User Story 2 - An enrolled operator joins and leaves a channel on the copy they run (Priority: P1)

An operator turns on "Show pre-release channels" in Settings. The catalog card for an app
with a `beta` version now shows a small `beta` pill beside the version. On the deployment
page of their installed copy, a Channel block shows "Follows: stable · Running 1.2.0, a
stable build" and a **Join beta** action. Confirming it moves the copy to the `beta` track;
the page now offers the beta upgrade. Later the operator chooses **Leave beta**. The confirm
dialog says the copy will stay on `1.3.0-beta.1` until a stable release at or above it is
published. After confirming, the block reads "Follows: stable · Running 1.3.0-beta.1, a
beta build" and no downgrade is offered.

**Why this priority**: Joining a channel in place is the primary path the model exists to
make obvious; it is what Play, TestFlight and Steam make one click.

**Independent Test**: With enrolment on, render the detail of a `stable` copy of an app
that publishes `beta`; assert the Join action, confirm it, assert the followed channel
changed and the beta version is offered. Then leave the channel from a copy running a beta
build and assert the honest "stays on" wording and no downgrade offer.

**Acceptance Scenarios**:

1. **Given** enrolment is on and a copy follows `stable` while the catalog publishes `beta`
   for its app, **When** the operator views the Overview tab, **Then** a Channel block shows
   the followed channel, the running build's version and channel, and a **Join beta** action.
2. **Given** the operator chooses Join beta, **When** the confirm dialog opens, **Then** it
   states that the copy will receive `beta` releases as well as stable ones; confirming
   changes the followed channel with no restart, and the page then offers the newest eligible
   beta as an upgrade.
3. **Given** a copy follows `beta` and is running a beta build, **When** the operator chooses
   **Leave beta**, **Then** the confirm dialog states the copy stays on its current build until
   a stable release at or above it is published; after confirming, the block reads "Follows:
   stable" with the running-build line still naming the beta build, and no older stable
   version is offered as an update.
4. **Given** a copy follows `beta` but is running a stable build (it took a stable release
   while on the beta track), **When** the operator views the block, **Then** it reads
   "Follows: beta · Running <version>, a stable build" — the two facts are shown separately.
5. **Given** the header upgrade button offers a version whose channel is not `stable`,
   **When** it renders, **Then** the button and its confirm label name that channel, matching
   the upgrade dialog's title.

---

### User Story 3 - An enrolled operator rehearses a pre-release in a separate copy (Priority: P2)

An enrolled operator would rather not move their production copy. On the deployment page a
secondary link, "Try beta in a separate copy →", opens the install wizard on the `beta`
channel. The wizard's Channel choice shows `beta` pre-selected; the note explains this copy
follows `beta` and starts with empty data. The install succeeds because the guard permits a
second copy on a published channel none of the app's copies follow. Back on each copy's
page, a sentence says the other copy is also installed, with its channel.

**Why this priority**: Side-by-side is the advanced path. It must stay available, but as a
secondary action, not the headline.

**Independent Test**: From the detail of a `stable` copy with enrolment on, follow the
separate-copy link, complete the wizard on `beta`, and assert a second deployment exists
following `beta` with the guard's `channel` reason; assert each copy's page names the other.

**Acceptance Scenarios**:

1. **Given** enrolment is on and the app publishes `beta`, **When** the operator views the
   Channel block of a `stable` copy, **Then** a secondary link offers to try `beta` in a
   separate copy; the link is absent when enrolment is off.
2. **Given** the operator follows the link, **When** the wizard renders, **Then** the Channel
   choice shows `beta` selected and the note says this copy follows `beta` and starts with
   empty data; finalising creates a second copy the guard permits by channel.
3. **Given** two copies of an app exist, **When** the operator views either copy's Channel
   block, **Then** a sentence reads "<other name> (<channel>) is also installed"; a copy that
   was installed with an operator override additionally shows a muted "installed with operator
   override" note, and no copy shows the "permitted by channel" phrase.

---

### User Story 4 - The wizard turns "already installed" into a choice (Priority: P2)

An enrolled operator opens the wizard on the `beta` channel for an app they already run on
`stable` (for example from the catalog card while unaware of the existing copy). Finalising
would conflict. Instead of a sentence about a CLI flag, the wizard shows: "*gitea* is already
installed and follows *stable*." with three actions: **Switch gitea to beta instead**, which
changes the existing copy's channel and opens it; **Open gitea**; and **Install a separate
beta copy**, which re-finalises with the override.

**Why this priority**: The conflict is where the collapsed model hurt most (the "pass
--allow-multiple" message on a dashboard). Turning it into a structured choice is what
makes joining in place the obvious path.

**Independent Test**: Stub the finalize call to return the structured conflict and assert
the three actions render with the right names, that "Switch" issues the channel change and
navigates, and that the separate-copy action is absent when the channel is unpublished.

**Acceptance Scenarios**:

1. **Given** a single-instance app already has a copy following `stable`, **When** the
   operator finalises an install of that app on `beta` without an override, **Then** the
   server refuses with a conflict that names the existing copy (id, name, channel) and
   whether the requested channel is published, and whose message contains no CLI flag names.
2. **Given** that conflict, **When** the wizard renders it, **Then** it shows the sentence
   naming the existing copy and its channel, plus **Switch <name> to <channel> instead**,
   **Open <name>**, and — only when the requested channel is published — **Install a separate
   <channel> copy**.
3. **Given** the operator chooses Switch, **When** the change completes, **Then** the existing
   copy follows the requested channel, the draft is discarded, and the operator lands on the
   copy's page.
4. **Given** the requested channel equals the existing copy's channel (for example both
   `stable`), **When** the panel renders, **Then** the Switch action is absent and the
   separate-copy action reads as an operator override.
5. **Given** the same conflict is returned to the CLI, **When** `hola install` renders it,
   **Then** the CLI prints the server's message followed by its own hint naming the
   `--channel` and `--allow-multiple` options and the existing copy's id.

---

### User Story 5 - The catalog card and deployments list stop shouting about channels (Priority: P2)

With enrolment on, an app card for an installed single-instance app reads "Installed ✓ ·
Manage"; a multi-instance app's card also shows "+ Another". No per-channel install links
appear. The deployments list shows a neutral channel pill on any non-stable row, naming the
running build's channel when known and the followed channel otherwise, and a "Pre-release"
chip in the status filter row.

**Why this priority**: These are the visible symptoms the operator reported (wrapping
buttons, "rc available" text). They are cheap once the model exists.

**Independent Test**: Render the catalog with one single-instance and one multi-instance
installed app and assert the action set on each; render the deployments list with a
non-stable row carrying a running-build channel and assert the pill text and the filter chip.

**Acceptance Scenarios**:

1. **Given** an installed single-instance app, **When** its card renders, **Then** it shows
   "Installed ✓" and "Manage" and no "+ Another"; a multi-instance app's card additionally
   shows "+ Another". Neither shows a per-channel install link or "<channel> available" text,
   regardless of enrolment.
2. **Given** enrolment is on and an app publishes a non-stable channel, **When** its card
   renders, **Then** a small channel pill appears beside the version; with enrolment off it
   does not.
3. **Given** an app publishes no stable version, **When** the operator presses its primary
   Install, **Then** the wizard opens on the app's only channel (unchanged behaviour).
4. **Given** the deployments list renders, **When** a row is non-stable in either fact,
   **Then** its pill names the running build's channel when that is known and non-stable
   (a `stable` track running a beta build, i.e. leaving beta, shows `beta` with a tooltip
   saying it is the build), else the followed channel when non-stable (a `beta` track whose
   build channel is unknown shows `beta` with the "Follows the beta channel" tooltip); a row
   following `stable` and running a stable build shows no pill.
5. **Given** enrolment is on or any row follows a non-stable channel, **When** the list
   renders, **Then** the status filter row includes a "Pre-release" chip that narrows the list
   to rows whose followed or running channel is non-stable.

---

### User Story 6 - Settings shows the enrolment and its consequences (Priority: P2)

Settings gains a "Pre-release apps" card with a toggle "Show pre-release channels (beta,
rc)", a one-line explainer, and — whenever any copy follows a non-stable channel — a line
"N installed apps currently follow a pre-release channel" that stays visible even with the
toggle off, so an operator turning it off understands what is not affected.

**Why this priority**: The toggle is the entry point to every other story; the count line
prevents the "I turned it off, why is there still a beta" confusion.

**Independent Test**: Render Settings with the toggle off and two non-stable copies; assert
the count line; flip the toggle and assert the settings write; assert the line persists.

**Acceptance Scenarios**:

1. **Given** the operator opens Settings, **When** the card renders, **Then** it shows the
   toggle reflecting the persisted setting (off on a fresh host) and the explainer.
2. **Given** the operator flips the toggle, **When** the change saves, **Then** the setting
   persists across reloads and the catalog, wizard, list and detail pages reflect it without
   a server restart.
3. **Given** two copies follow non-stable channels, **When** the card renders with the toggle
   off, **Then** the line "2 installed apps currently follow a pre-release channel" is shown.

---

### User Story 7 - The CLI can show and change the channel a copy follows (Priority: P3)

An operator runs `hola channel <deploymentId>` and sees the followed channel and the running
build's version and channel. Running `hola channel <deploymentId> beta` changes the followed
channel and confirms it; `hola channel <deploymentId> stable` from a copy running a beta
build prints the same "stays on <version> until a stable release at or above it is
published" note the dashboard shows. `hola deployments` keeps showing the followed channel
in its list.

**Why this priority**: The CLI is the only released binary; the model must be reachable
from it, but the dashboard is the primary surface.

**Independent Test**: Unit-test the command against a stubbed client for show, set, and the
leaving-a-pre-release note.

**Acceptance Scenarios**:

1. **Given** a copy id, **When** the operator runs `hola channel <id>`, **Then** the output
   names the followed channel and, when known, the running build's version and channel.
2. **Given** a copy id and a channel, **When** the operator runs `hola channel <id> <channel>`,
   **Then** the followed channel is changed and confirmed; a malformed channel is rejected
   with the server's validation message.
3. **Given** the running build is not eligible on the new channel, **When** the change
   completes, **Then** the CLI prints the "stays on <version>" note.
4. **Given** an operator runs `hola settings prerelease on|off`, **When** the command
   completes, **Then** the enrolment setting is changed and echoed; `hola settings prerelease`
   with no argument prints the current value.

---

### Edge Cases

- **A channel the copy follows that the catalog no longer publishes**: the Channel block
  still shows "Follows: <channel>" and offers Leave; Join is not offered for unpublished
  channels; the separate-copy link is absent.
- **An app publishing more than one non-stable channel** (`beta` and `rc`): the block
  offers one Join action per published non-stable channel the copy does not already follow,
  and the wizard's radio lists every published channel; the catalog pill shows the channels
  as a short comma-separated list.
- **Running build's channel unknown** (the version is no longer listed by the catalog, or
  the catalog is unreachable): the running-build line shows the version alone with no
  channel word, the list pill falls back to the followed channel, and the leaving note is
  generic ("stays on <version> until a stable release at or above it is published").
- **Catalog unreachable while enrolled**: Join/Leave still render from the copy's own
  followed channel and version; Join actions and the separate-copy link require a published
  channel and so are hidden.
- **Two single-instance copies come to share a channel** through a Join (the advisory case
  in ADR 0005 §5): the change applies; the block's sibling sentence names the other copy and
  the advisory warning is shown once, as today.
- **A copy created before this feature** has no stored multi-instance flag: it reads as
  single-instance; the card offers no "+ Another" for it.
- **The setting is written with a non-boolean value**: rejected by the production settings
  service with the settings endpoint's validation error (400).
- **The wizard's Switch action fails** (network, validation): the conflict panel stays,
  shows the failure, and the other two actions remain available.
- **A user deep-links `?channel=<name>` for an unpublished channel with enrolment off**:
  the radio shows that channel selected; finalising a first copy works (a copy may follow
  an unpublished channel, ADR 0005 §4); a second copy is refused with the structured
  conflict whose `channelPublished` is false, so no separate-copy action is offered.
- **CLI `hola install --channel` with enrolment off**: unchanged; the setting never reaches
  the CLI install path.
- **Settings read fails or is slow on a page that gates on enrolment**: the page renders
  as not enrolled (no pill, no radio, no Join, no separate-copy link); Leave and existing
  pills still render because they do not depend on the setting.
- **Several live copies at conflict time** (an earlier operator override): the conflict
  names the copy following the requested channel if any, else the oldest live copy; the
  wizard's Switch acts on that copy.

## Clarifications

### Session 2026-09-08

- Q: When a single-instance app already has several live copies (an earlier operator override), which one does the `ALREADY_INSTALLED` conflict name as `existing`? → A: **The copy that already follows the requested channel if one does, else the oldest live copy.** One copy, deterministic, and it is the copy whose track the wizard's Switch action would change; the message names that copy by name and channel.
- Q: Is the deployments list's "Pre-release" chip a fourth mutually exclusive status, or an independent filter? → A: **An independent toggle combined with the status filter by AND.** "Failed and pre-release" must be expressible; the chip's persistence follows whatever the status filters already do.
- Q: How do the catalog, wizard, list and detail pages learn the enrolment setting, and what does a failed read mean? → A: **One shared read through the existing settings surface, cached for the page session; a failed or pending read means not enrolled.** Enrolment fails closed: a page never shows pre-release chrome on the strength of a missing setting, and every page test stubs one source.

## Requirements *(mandatory)*

### Functional Requirements

**Enrolment (layer 1)**

- **FR-001**: The system MUST persist a host-level boolean enrolment setting, "show
  pre-release channels", defaulting to **off**, alongside the existing system settings and
  readable and writable through the same settings read/update surface. Non-boolean values
  MUST be rejected by the production settings service's validation, surfaced as the settings
  endpoint's validation error (a 400). The test-environment settings service MUST mirror the
  field, its default and its merge behaviour; it keeps its existing permissive validation.
- **FR-002**: With enrolment off, the dashboard MUST NOT present any channel choice, channel
  pill or pre-release text on the catalog, in the install wizard (except when the wizard
  was opened with an explicit channel), or as a Join action or separate-copy link on a
  deployment. Enrolment MUST gate discovery only: explicit channel links, the CLI's
  `--channel` option, and channel changes on existing copies MUST keep working regardless
  of the setting. Pages MUST obtain the setting from one shared read of the settings
  surface; while the read is pending or after it fails, the page MUST behave as not enrolled.
- **FR-003**: A copy already following a non-stable channel MUST keep its pill, its Channel
  block (with Leave) and its channel's update offers when enrolment is off. Turning
  enrolment off MUST NOT change any copy's followed channel.
- **FR-004**: Settings MUST show a "Pre-release apps" card with the toggle, a one-line
  explainer that pre-release versions may be unstable and that a channel can be joined or
  left per app at any time, and — whenever at least one copy follows a non-stable channel —
  a line stating how many installed apps follow a pre-release channel, visible in both toggle
  states.

**Track (layer 2)**

- **FR-005**: The list item, detail and update-check responses MUST carry the running
  build's channel ("version channel") when the catalog lists the running version, and omit
  it when unknown. This is distinct from the followed channel, which is unchanged.
- **FR-006**: The deployment Overview MUST show a Channel block reading "Follows: <channel>"
  with a running-build line beneath ("Running <version>, a <channel> build", or the version
  alone when the channel is unknown). It replaces the Channel and Instance facts in the
  Details list and the Configuration-tab "Release channel" card; the followed channel MUST
  be shown in exactly one place on the page.
- **FR-007**: The block MUST offer one primary action per applicable case: **Join
  <channel>** for each channel the catalog publishes for the app that the copy does not
  already follow (enrolled only; `stable` is never a Join target because it is the floor);
  **Leave <channel>** when the copy follows a non-stable channel (regardless of enrolment).
  Each MUST open a short confirmation dialog stating the consequence before the change is
  made, and the change MUST use the existing followed-channel update (a metadata write,
  no restart).
- **FR-008**: When leaving a non-stable channel while the running build is not eligible on
  the new channel, the confirmation and the block afterwards MUST state that the copy stays
  on its current build until a stable release at or above it is published. The system MUST
  NOT offer an older stable version as an update in that state (existing eligibility rule;
  this requirement pins the presentation).
- **FR-009**: The header upgrade button and its confirm label MUST name the target channel
  when the offered version's channel is not `stable`, consistent with the upgrade dialog.
- **FR-010**: The list, detail and all channel pills MUST show the running build's channel
  when it is known and non-stable, else the followed channel when non-stable, else no pill.
  A pill for a build channel that differs from the followed channel MUST carry a tooltip
  saying it names the build; a pill for the followed channel MUST say "Follows the
  <channel> channel".

**Side-by-side copy (layer 3)**

- **FR-011**: The Channel block MUST offer, enrolled only and only when the app publishes a
  non-stable channel the copy does not follow, a secondary link "Try <channel> in a
  separate copy" that opens the install wizard on that channel. The guard's existing
  `channel` reason permits the install; the guard itself is unchanged.
- **FR-012**: The block MUST replace the Instance fact with a sibling sentence: for each
  other live copy of the app, "<name> (<channel>) is also installed". A copy whose recorded
  reason is operator override MUST additionally show a muted "installed with operator
  override"; the "permitted by channel" phrase MUST NOT be shown.
- **FR-013**: The list item and detail MUST carry whether the app allows multiple copies
  ("multi-instance"), taken from the finalised manifest at creation and persisted on the
  record; a record without the field MUST read as single-instance.

**Catalog card and install wizard**

- **FR-014**: The catalog card MUST NOT show per-channel install links or "<channel>
  available" text. When enrolled and the app publishes at least one non-stable channel, the
  card MUST show a small channel pill beside the version. The installed state MUST read
  "Installed ✓ · Manage" and add "+ Another" only when the installed copy is multi-instance.
  The action row MUST wrap without splitting a link across lines.
- **FR-015**: An app with no stable version MUST keep routing its primary Install to its only
  channel (existing behaviour, pinned by the existing test).
- **FR-016**: The wizard's channel select MUST become a **Channel** radio group near the top
  of the summary step — "Stable (recommended)" and "<channel> — pre-release" per published
  non-stable channel — shown only when (enrolled and more than one channel is available) or
  the wizard was opened with an explicit channel. Changing the selection MUST reuse the
  existing channel-switch behaviour (recreate the draft on the new channel).
- **FR-017**: The wizard's non-stable note MUST render for an implied channel as well as an
  explicit one (gate on the channel the copy will follow, not on the explicit selection) and
  MUST say which channel the copy will receive releases from and that it starts with empty
  data.
- **FR-018**: The server MUST refuse a conflicting single-instance install with a conflict
  (HTTP 409, top-level code `CONFLICT`, as for the existing provider conflict) whose details
  carry the discriminator `ALREADY_INSTALLED`, the existing copy's id, name and followed
  channel, and whether the requested channel is published. When
  several live copies exist, `existing` MUST be the copy already following the requested
  channel if there is one, else the oldest live copy, and the message MUST name it. Both
  conflict messages MUST be surface-neutral: no CLI flag names or dashboard button names.
  The single-instance guard's decision table and recorded reasons are unchanged.
- **FR-019**: The wizard's finalise conflict panel MUST render `ALREADY_INSTALLED`
  structurally (mirroring the existing provider-conflict panel): the sentence "<name> is
  already installed and follows <channel>." and the actions **Switch <name> to <channel>
  instead** (present only when the requested channel differs from the existing copy's;
  changes the existing copy's followed channel, discards the draft, navigates to the copy),
  **Open <name>**, and **Install a separate <channel> copy** (present only when the requested
  channel is published; re-finalises with the override; worded as an operator override when
  the channels are equal). A failed Switch MUST leave the panel and its other actions in
  place with the error shown.
- **FR-020**: The API reference MUST carry an error-code reference (created if none exists)
  documenting `ALREADY_INSTALLED` and its details shape alongside the existing codes.

**Deployments list**

- **FR-021**: The list MUST render its channel pill through the shared pill component per
  FR-010 and MUST include a "Pre-release" chip in the status filter row when enrolled or
  when any row's followed or running channel is non-stable; the chip is an independent
  toggle combined with the selected status by AND, narrowing the list to those rows.
- **FR-022**: A single shared channel pill component MUST be the only rendering of a channel
  name as a pill: it replaces the deployments list's inline pill and is used by the catalog
  card and the deployment detail (which render text today).

**CLI**

- **FR-023**: The CLI MUST gain `hola channel <deploymentId> [channel]`: with no channel it
  prints the followed channel and, when known, the running build's version and channel;
  with a channel it changes the followed channel through the existing update call, echoes
  the result, and prints the "stays on <version>" note when the running build is not
  eligible on the new channel. Validation failures MUST surface the server's message.
- **FR-024**: `hola install` MUST render the `ALREADY_INSTALLED` conflict as the server's
  message followed by a CLI-specific hint built from the details (existing copy id, the
  `--channel` and `--allow-multiple` options). `hola deployments` MUST keep listing the
  followed channel.
- **FR-025**: The CLI MUST gain `hola settings prerelease [on|off]` to read or set the
  enrolment setting through the settings surface; the typed client MUST expose the settings
  read/update calls it needs.

**Documentation and follow-ups**

- **FR-026**: ADR 0005 MUST be amended with a "§7 Operator model" section recording the
  three layers, the enrolment setting and its discovery-only rule, the running-build
  channel as a separate fact, the `ALREADY_INSTALLED` conflict, and the decision that
  enrolment never changes a copy's followed channel.
- **FR-027**: The operations guide MUST gain "Trying pre-release versions of apps": enabling
  enrolment, joining and leaving a channel, a separate copy, what leaving means, and the CLI
  command. The architecture notes' release-channels bullet MUST gain one sentence on
  enrolment and the Join/Leave model.
- **FR-028**: Deferred work MUST be filed as issues in this repository, never left as inline
  markers: at minimum the Apps launcher pre-release pill and the "followed channel published
  a new version" notification.

### Key Entities

- **Enrolment setting**: one host-level boolean under the system settings' channels group;
  default off; gates discovery in the dashboard only.
- **Followed channel** (track): the channel an installed copy takes update offers from;
  existing, unchanged; changed only explicitly.
- **Running-build channel** (version channel): the catalog channel of the version the copy
  currently runs; derived on read from the catalog's version list; absent when unknown.
- **Multi-instance flag**: whether the app's manifest allows several copies; captured at
  creation from the finalised manifest; absent reads as single-instance.
- **Already-installed conflict**: the structured refusal of a conflicting single-instance
  install: code, the existing copy (id, name, followed channel), and whether the requested
  channel is published.
- **Channel pill**: the one shared visual for a channel name, with a tooltip distinguishing
  "follows" from "build".

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With enrolment off, the automated dashboard suite renders the catalog, wizard
  (opened without an explicit channel) and detail pages for an app publishing a non-stable
  channel with **zero** occurrences of a channel choice, channel pill or pre-release text;
  with an explicit channel link the wizard shows the choice.
- **SC-002**: An operator can move a copy onto a pre-release channel from its Overview in
  two interactions (Join, confirm) and back in two (Leave, confirm); the suite asserts both
  transitions and the honest "stays on" wording when the running build is a pre-release.
- **SC-003**: The structured conflict renders three named actions in the wizard when the
  channel is published and two when it is not; the Switch action results in the existing copy
  following the requested channel. Neither conflict message contains the strings
  `--allow-multiple`, `--channel` or "install another".
- **SC-004**: The catalog card for an installed single-instance app renders exactly two
  actions (Installed ✓, Manage) and a multi-instance app exactly three; no card renders a
  per-channel install link.
- **SC-005**: The running-build channel is populated for a copy whose version the catalog
  lists and absent otherwise, on the list, detail and update-check responses, pinned by
  server tests; the multi-instance flag round-trips through persistence.
- **SC-006**: The settings field round-trips through read/update, rejects a non-boolean,
  defaults to off, and the test-environment service mirrors it.
- **SC-007**: `hola channel` show/set and the leaving note, and the install hint, are
  covered by CLI unit tests.
- **SC-008**: ADR 0005 §7, the operations section and the architecture-note sentence exist;
  the follow-up issues are filed; typecheck, lint, test and build pass across packages with
  typecheck re-run after any lint fix.

## Assumptions

- The enrolment setting lives in the existing system settings document under a `channels`
  group and is read by the dashboard once per page load through the existing settings hook;
  no push or live refresh is needed beyond what the settings page already does.
- The running-build channel is derived on read from the same per-channel version list the
  update-offer enrichment already fetches; no new persistence and no catalog call from the
  create path (Constitution III).
- The multi-instance flag is copied from the finalised manifest at creation time, exactly as
  the followed channel and the published flag already are; a record that predates it is
  backfilled once, on read, from its active release manifest (no catalog call) so a
  multi-instance app installed earlier keeps "+ Another"; a record whose manifest cannot be
  read stays absent and reads as single-instance.
- "Published" for Join and the separate-copy link means the catalog currently lists at least
  one well-formed version of the app on that channel — the same set the catalog card
  already reports.
- The count on the Settings card counts installed copies following a non-stable channel
  (live, non-removed) and is worded "installed apps"; two copies of one app count as two.
- The channel pill uses the deployments list's existing neutral styling; it is not colour
  coded per channel (channel names are open strings).
- The Join confirmation wording is "This copy will receive <channel> releases as well as
  stable ones. You can leave the channel at any time." The Leave wording is "This copy will
  receive only stable releases." plus, when applicable, the "stays on <version>" sentence.
- The typed client gains a settings read/update pair so the CLI settings command and the
  dashboard share one surface; `hola settings` is a new command group with `prerelease` as
  its first subcommand.
- Reason wording on the detail page is the only thing that changes about the guard's
  reasons; the recorded values (`channel`, `operator-override`) and the guard's decision
  table are untouched.
- The follow-up issues (launcher pill, channel-publish notification) are filed during
  implementation; if the CLI settings command is dropped for scope reasons, it also becomes
  an issue rather than an inline marker.
