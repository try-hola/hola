# Dashboard contract: Release Channels

Package: `packages/web`. All data comes from the wire fields in `contracts/api.md`.

## Catalog page (`pages/Catalog.tsx`)

- Card: when `app.channels` contains a non-stable channel, show a small muted hint
  `rc available` (one hint per non-stable channel, comma-joined) next to the version.
- Installed single-instance app: in addition to the existing manage/"install another"
  actions, show **Install on `<channel>`** for each non-stable channel that no existing
  deployment of that app follows (uses `DeploymentListItem.channel`). Link:
  `/catalog/<id>/install?channel=<c>[&source=…]`. It does **not** set `another=1` —
  the server permits the copy because of the channel.
- Apps with no stable version show no version on the card; the primary install link carries
  `?channel=<first non-stable channel>`.

## Install wizard (`pages/InstallWizard.tsx`)

- Reads `?channel=` and passes `channel` to the draft-creation call on mount.
- When the app has more than one channel with versions (`GetCatalogAppResponse.channels`,
  fetched alongside the draft or via `api.catalog.appById`), render a **Channel** select
  above the instance-name field. Default: `stable` if present, else the first listed
  channel. Changing it: delete the current draft, create a new one with the chosen channel
  (reuse the mount-time creation path and the `creatingDraftRef` guard), reset env edits.
- Only one channel with versions → no select.
- Summary/review step shows `Following channel: <c>` when `c !== 'stable'`.
- For a non-stable install the existing "additional instance" warning is replaced by an
  info note: "This copy follows the `<c>` channel and starts with empty data."
- Errors `NO_VERSION_ON_CHANNEL` / `VERSION_NOT_ON_CHANNEL` render inline with the
  server message.

## Deployments list (`pages/Deployments.tsx`)

- Version cell: when `deployment.channel !== 'stable'` render a pill `<channel>` before
  the version.
- Update pill: keep `latestVersion`; if `latestVersionChannel` is non-stable, render
  `latestVersion (channel)` in the pill title and text.

## Deployment detail (`pages/DeploymentDetail.tsx`)

- Details card facts gain:
  - `Channel` → `deployment.channel` (always).
  - `Instance` (amended 2026-09-04, [#433](https://github.com/try-hola/hola/issues/433)) →
    shown whenever `siblings` is non-empty, regardless of install order:
    `<channel> instance of <app> · also installed: <name> (<channel>), …`. Only when
    `instanceReason` is set, append ` · permitted by channel` /
    ` · permitted by operator override`. Derived from live data — `instanceReason`
    alone can't label the pair, since it always lands on the copy installed second.
  - `Latest` fact appends ` (<latestVersionChannel>)` when non-stable.
- Upgrade dialog: target line shows `<latestVersion> (<latestVersionChannel>)` when
  non-stable.
- Configuration/settings area: a **Channel** select listing the app's channels
  (`api.catalog.appById(app).channels`, falling back to `[current]` if the catalog is
  unavailable). On change → `api.deployments.update(id, { channel })`, then invalidate the
  deployment detail/list/update-check queries. Show returned `warnings` as a transient
  notice. Invalid selection cannot happen (select), but a server `INVALID_CHANNEL` renders
  inline.

## Hooks / API layer

- The draft-creation hook used by the wizard accepts `channel?` and forwards it.
- `useDeploymentDetailApi.updateConfiguration` already sends `PatchDeploymentRequest`;
  the type gains `channel?`. The mutation's `onSuccess` invalidation must cover the list and
  update-check keys so badges update.
- `sdk-adapter.ts` / `utils/api.ts`: no new methods or parameters; every new field rides on
  existing responses.

## Tests (`src/__tests__/pages`)

- `Catalog.test.tsx`: hint rendered for `channels: ['stable','rc']`; "Install on rc" link
  present for an installed app whose deployment is `stable`, absent when a deployment already
  follows `rc`; no version shown for `channels: ['rc']`.
- `InstallWizard.*.test.tsx`: `?channel=rc` reaches draft creation; select renders only with
  >1 channel; changing it deletes and recreates the draft with the new channel; summary line.
- `Deployments.test.tsx`: channel pill for rc row; update pill text with channel.
- `DeploymentDetail.test.tsx`: `Channel`/`Instance` facts; channel select PATCHes and
  invalidates; warnings shown.
