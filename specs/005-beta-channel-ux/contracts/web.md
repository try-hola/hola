# Dashboard contract

## Shared

- `hooks/usePrereleaseEnrolment.ts` — `usePrereleaseEnrolment(): boolean`; `false` while loading/errored.
- `components/ui/ChannelPill.tsx` — `<ChannelPill channel kind="follows"|"build"|"published" />` + `pillFor({ channel, versionChannel })`. Titles: `Follows the <c> channel` / `Running a <c> build` / `Also published on <c>`.
- `components/ui/ConfirmDialog.tsx` — `{ open, title, body, confirmLabel, busy?, error?, onConfirm, onCancel, danger? }`; the upgrade dialog migrates to it.

## Settings (`pages/Settings.tsx`)

- Exported `PrereleaseCard`: heading "Pre-release apps"; switch labelled "Show pre-release channels (beta, rc)"; explainer "Pre-release versions may be unstable. You can join or leave a channel per app at any time."; when ≥1 deployment follows a non-stable channel: "<N> installed apps currently follow a pre-release channel" (visible in both states). Toggle → `updateSettings({ channels: { showPrerelease } })`.

## Catalog (`pages/Catalog.tsx`)

- No per-channel "Install on <c>" links; no "<c> available" text.
- Enrolled and app has non-stable channels → `ChannelPill kind="published"` beside the version.
- Installed: `Installed ✓` · `Manage`; `+ Another` only when the installed copy reports `multiInstance`.
- Action row `flex-wrap`; links `whitespace-nowrap flex-none`. No-stable app → primary Install routes to its only channel (unchanged).

## Install wizard (`pages/InstallWizard.tsx`)

- Channel radio group (RadioGroup) near the top of the summary step: `Stable (recommended)` / `<c> — pre-release`; shown when `(enrolled && availableChannels.length > 1) || ?channel=` present; change → `switchChannel`.
- Note (gated on `followedChannel !== 'stable'`): "This copy follows the <c> channel: it receives <c> releases as well as stable ones, and starts with empty data. Give it a distinct name so it gets its own address."
- Conflict panel (`details.code === 'ALREADY_INSTALLED'`): "**<name>** is already installed and follows **<channel>**." Actions:
  - `Switch <name> to <c> instead` — only when `existing.channel !== followedChannel`; PATCH channel → remove draft (best-effort) → navigate to `/deployments/<id>`; on failure show error, keep panel.
  - `Open <name>` — link.
  - `Install a separate <c> copy` (or `Install another copy (operator override)` when channels equal) — only when `channelPublished`; sets `allowMultiple` state and re-finalizes.

## Deployment detail (`pages/DeploymentDetail.tsx`)

- Overview: **Channel block** replaces the Details `Channel`/`Instance` facts and the Configuration-tab "Release channel" card.
  - `Follows: <channel>` · `Running <version>, a <versionChannel> build` (or `Running <version>`).
  - Siblings: `<name> (<channel>) is also installed` per sibling; muted `installed with operator override` when `instanceReason === 'operator-override'`. Never "permitted by channel".
  - Actions: `Join <c>` per published non-stable channel not followed (enrolled only); `Leave <c>` when followed channel non-stable (always). Each opens `ConfirmDialog`:
    - Join body: "This copy will receive <c> releases as well as stable ones. You can leave the channel at any time."
    - Leave body: "This copy will receive only stable releases." + when `versionChannel` non-stable or unknown-after-non-stable: "Stays on <version> until a stable release at or above it is published."
  - Secondary link (enrolled, per published non-stable channel not followed): `Try <c> in a separate copy →` → `/catalog/<app>/install?channel=<c>`.
  - Warnings from the PATCH → existing `TransientNotice`.
- Header upgrade button and confirm label: `Upgrade to <v> (<latestVersionChannel>)` when non-stable.

## Deployments list (`pages/Deployments.tsx`)

- Pill via `pillFor` → `ChannelPill`.
- Filter row gains a `Pre-release` chip (independent boolean, ANDed with status, resets page) when enrolled or any visible row is non-stable; sends `prerelease=true`.
