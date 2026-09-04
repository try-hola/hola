# ADR 0005: Release channels

- **Status:** Proposed (September 2026)
- **Context:** There is no supported path to run a pre-release version of a catalog app.
  Every bundle pins one version; the only way to try an upstream release candidate today is
  to edit and publish the catalog repository, which ships it to every operator. #428 proposes
  release channels instead — the store lists more than one version per app, tagged with a
  channel, and the operator chooses which channel to follow.

## Context

`remo`'s bundle pins `ghcr.io/get2knowio/remo-web:4.3.4@sha256:…`. If `remo-web` cuts a
`4.4.0-rc.1`, nothing in Hola can deploy it short of merging a catalog change that makes it
the default for everyone. The obvious fix — an `--image`/`--version-override` flag at
install time — is the wrong primitive:

1. **The image pin is not independently meaningful.** It travels with version-specific
   `defaultEnv`, `auth.oidc` wiring, and `upgrade.{breaking,minFromVersion,waypoints,
   preUpgradeBackup}`. Overriding just the image runs the new binary against the old
   version's env contract and migration metadata — exactly when `preUpgradeBackup` matters
   most.
2. **Every bundle pins by digest, not tag.** An override flag can't be a tag substitution;
   it would have to replace the whole reference and drop the `@sha256:…`, silently
   converting a content-addressed deploy into a mutable-tag one.
3. **App stores don't work this way.** Snap (`stable/candidate/beta/edge`), Flatpak
   branches, Debian suites, Helm's `--devel`, Nix channels — in all of them the *store*
   decides what exists per channel and the *operator* chooses which channel to follow. None
   expose "type any image ref here" as the primary mechanism.

Worth naming the two versions explicitly, because the intent gets expressed against the
wrong one: the **bundle version** (`remo 0.10.1`, tracked by `catalog.json`) and the
**upstream image** (`remo-web 4.3.4@sha256:…`, tracked by `compose.yaml`). "Deploy the rc" is
naturally a bundle pre-release — `remo 0.11.0-rc.1`, whose compose pins the matching upstream
tag and whose manifest carries the matching upgrade metadata. Same outcome as an image
override, nothing desynchronized, digest pin intact.

## Decision

### 1. Channel is a catalog-index attribute

A catalog version entry (`catalog.json` → `versions[]`) may carry a `channel?: string`,
absent defaulting to `stable`. It lives beside `refs.oci`/`digest`/`createdAt` — the same
class of listing metadata `mapApp` already reads — **not** in the bundle `manifest.json`.
Per-app metadata (the `auth` block, `defaultEnv`, `upgrade`) still comes solely from the
manifest; a channel is a statement about the *listing*, and a bundle can be re-listed on
another channel (rc → stable) without republishing (`coerceChannel`,
`packages/server/src/services/core/catalog.ts:178`).

A malformed channel value (wrong type, uppercase, empty, too long against
`^[a-z][a-z0-9-]{0,31}$`) drops the entry from every resolution — `getApp`, `getVersions`,
`channels`, `version`, `latest` — with one `warn` log naming the source, app, version and
value (`wellFormedVersions`, `catalog.ts:530`). It is never silently promoted to `stable`: a
typo in the catalog must not turn a pre-release into everyone's default. A version string
repeated within one app keeps the first occurrence; the duplicate is dropped with the same
warn.

### 2. Eligibility: own channel or stable

```
eligible(versionChannel, channel) = versionChannel === channel || versionChannel === 'stable'
```

(`isEligibleOnChannel`, `packages/shared/src/index.ts:205`). `stable` is therefore the floor
every channel includes: an rc deployment is offered the graduated stable release the moment
it's newer, and a stable deployment never sees a pre-release. There is no ordering *among*
non-stable channels — no `beta` includes `rc` hierarchy. "Newest" is never list position; it
is the maximum eligible entry by `compareVersions` (`newestEligibleVersion`,
`packages/shared/src/index.ts:217`), which already ranks a release above a pre-release of the
same number (`1.2.0 > 1.2.0-rc.1`).

A pinned version's eligibility is enforced only when the caller **explicitly** supplied a
channel. An operator who pins a pre-release with no channel at all gets that version, and its
own channel becomes the deployment's implied channel — it is not validated against a default
`stable` and rejected. This is a deliberate reading of the spec's "explicit or the implicit
stable" wording (`getVersionDetail`, `catalog.ts:447`): the default only governs `latest`
resolution, never a pinned-version eligibility check.

### 3. Channel enters at the draft

`CreateDraftRequest.channel?` is validated up front (`INVALID_CHANNEL`) and resolved once, at
draft creation (`createDraft`, `packages/server/src/services/core/draft.ts:453`): the
request's explicit channel, else the pinned version's own channel (from the catalog's
resolution), else `stable`. `Draft.channel` and `FinalizedManifest.channel` carry that one
resolution forward — `createFromDraft` copies it onto the deployment record with no second
catalog lookup, so the deployment's channel can never disagree with the version it actually
installs. `CreateDeploymentFromDraftRequest` gains no channel field; there is exactly one
place a channel is decided.

The web install wizard creates its draft on mount, before any UI choice, so it reads
`?channel=` from the URL for that first draft and treats an in-wizard channel change as
"delete this draft, create a new one on the new channel" — a different channel means a
different resolved version, hence different env/port/security/profile defaults, so recreating
is correct, not a workaround.

### 4. Single-instance guard is per app and published channel, with a recorded reason

The singleton-by-default guard (#246) now asks "does any existing copy of this app already
follow this channel?", not "does any copy exist at all"
(`assertInstanceAllowed`, `packages/server/src/services/core/deployment.ts`):

```
multiInstance                                        → no guard
no existing copy of the app                          → allowed, no reason recorded
no existing copy on this channel, channel published  → allowed, reason 'channel'
otherwise, with override                             → allowed, reason 'operator-override'
otherwise                                            → 409
```

**A channel only counts when the catalog publishes it** (#431). Because `stable` is
eligible on every channel (§2), an invented channel name resolves the newest *stable*
version through the floor — so without this rule `--channel banana`, `--channel c`,
`--channel d`… would each buy another copy of a singleton app, an unlimited
`--allow-multiple` with a nicer label, defeating the guard the global bolt-ons
(`backup` → `apps-data`, `homepage` → `app-registry`) depend on. "Published" means the
catalog lists at least one well-formed version of *that app* on the channel — the same
`channels[]` set the catalog card already reports (`distinctChannels`, `catalog.ts`), now
returned on the version detail as well.

The check is a **draft-time fact**, not a create-time catalog call: `getDraftDefaults`
already reads the catalog to resolve the version, so `createDraft` records
`Draft.channelPublished` there and it travels onto the finalized manifest exactly like
`channel` and `multiInstance` (Constitution III — no per-deploy work at create time, and
the fact can never disagree with the version actually pinned).

It **fails closed**: absent means unpublished. That covers the placeholder-defaults
fallback (no bundle / catalog unavailable), install-by-ref (no catalog index to consult)
and pre-#431 manifests. A second copy of a singleton app is never urgent, the override is
always one flag away, and failing open would restore the bypass precisely when the catalog
can't contradict it. A deployment may still *follow* an unpublished channel — it receives
the stable floor's offers, unchanged (spec edge case, `channels.test.ts`) — it just isn't a
free second copy. The 409 for that case names the unpublished channel and points at
`--allow-multiple`; the same-channel 409 keeps pointing at `--channel`.

`channel` takes precedence over `operator-override` even when the override was also
supplied: the reason recorded is the one that actually permitted the install (clarification
Q1). The reason is persisted (`EnhancedDeploymentDetail.instanceReason`) and shown on the
deployment detail — `remo-beta` on `rc` reads as "remo's rc instance," not an unexplained
duplicate the operator has to remember the story behind. A later channel change that happens
to make two copies share a channel does not retroactively revoke the guard or recompute the
reason; the PATCH (§5) only returns an advisory warning.

The **label is derived at read time** and the reason stays the audit fact (#433): the
reason records which install the guard permitted, so it always sits on the copy installed
second — install `rc` first and it lands on the `stable` copy, labelling the wrong one and
leaving the rc copy unexplained. The detail therefore also carries the app's other live
copies (`DeploymentDetail.siblings`, projected from the loaded deployment map — no catalog
call, no job), and the dashboard builds the label from this copy's own channel plus those
siblings, appending the reason only as a secondary "permitted by …" phrase. Both copies read
correctly in either order, and nothing persisted changes.

### 5. Channel is sticky; changing it is a metadata write

Promote and rollback never touch `channel` — an rc deployment that takes a stable release
stays on rc (`resolveUpgradeTarget`, `deployment.ts:2423`, called from the promote route
before `drafts.createDraft`). Explicitly requesting a version outside the deployment's
channel is rejected with `VERSION_NOT_ON_CHANNEL`, naming both channels and the PATCH that
would fix it.

`PATCH /api/deployments/:id { channel }` changes the followed channel directly
(`updateDeployment`, `deployment.ts:1843`): validated, applied to the record, persisted — no
job, no manifest rewrite, no active release required (Constitution III: per-deploy work
belongs in the lifecycle job, never at a metadata-write call site). It can be combined with
an `env`/`systemOverrides` change in one request. It returns an advisory `warnings[]` when
the new channel makes two single-instance copies of the app share a channel; the change still
applies — this is UX, not a second guard.

### 6. Newest-version resolution uses the shared comparator, not a numeric-only parser

`catalog.ts`'s old `pickLatestVersion` matched `/^\d+(\.\d+)*$/` and fell back to **list
position** for anything else — so a single `1.3.0-rc.1` entry flipped an app's default to
"last array element," including the browse-grid version shown to every operator who never
asked for a pre-release. It is deleted; every "newest" resolution (catalog card, `latest`,
update offers) now goes through `newestEligibleVersion`, which never throws and never falls
back to list order.

### Rejected alternatives

- **Operator image override at install time.** Rejected for the three reasons in Context: it
  desynchronizes the image from its env/auth/upgrade metadata, can't express a digest pin as
  a substitution, and isn't how any comparable app store works.
- **Channel as a manifest field.** Rejected: it would require republishing a bundle just to
  graduate rc → stable, and channel is a fact about the listing, not about what one version
  contains — the same reasoning that keeps `refs.oci`/`digest` out of the manifest.
- **A closed channel enum (`stable | rc | beta`).** Rejected: the catalog decides what
  channels exist, the same way Snap/Flatpak/Debian let publishers name their own tracks. The
  platform only reserves `stable` as the floor.
- **Channel resolved on `createFromDraft`.** Rejected: the version is already resolved by
  then (from the draft), so a second resolution point risks disagreeing with what was
  actually pinned. One resolution, at the draft, is the only way to guarantee they match.
- **Deriving channel from a pre-release suffix in the version string.** Rejected: the catalog
  must be able to list `1.3.0-beta.2` on `beta` and a hypothetical `2.0.0` on `rc` explicitly;
  inferring it from the string makes the publishing side implicit and unreviewable.
- **Forking the bundle as a second catalog app** (`remo` and `remo-beta` as distinct catalog
  entries) instead of a channel. Rejected: `remo-beta` is a *deployment name*, never a second
  catalog app — forking the bundle throws away the curation (shared manifest, shared upgrade
  metadata, shared review) the channel model exists to preserve.

## Consequences

- `pickLatestVersion`'s numeric-only, list-position-fallback behavior is gone. An app whose
  version strings are non-numeric (e.g. `main`, `edge`) is now resolved by
  `compareVersions`' string-fallback ordering instead of list position — a behavior change,
  accepted, and covered by `catalog-channels.test.ts`. No catalog app relies on the old
  fallback today.
- The per-app-and-channel guard costs a wire field and a fail-closed default: an operator
  installing a second copy on a channel the catalog hasn't published yet (a channel they
  intend to pre-follow, or any install while the catalog is unreachable) must pass
  `--allow-multiple`, and the copy is then labelled `operator-override` rather than by its
  channel. Accepted: the alternative is a guard any typo can walk through. If the catalog
  later publishes that channel, existing records are not recomputed — `instanceReason` is
  a fact about why the install was permitted, not a live derivation (§4's "no retroactive
  revocation" cuts both ways).
- Two new wire fields ride on existing types rather than a new endpoint: `channel`/
  `channels`/`latestVersionChannel`/`instanceReason` on the catalog, draft, and deployment
  responses (all optional in the TypeScript types so existing typed fixtures keep compiling;
  the server always emits them — see `data-model.md`). `MockCatalogService` stays empty per
  Constitution II; channel-aware tests inject their own stub catalog.
- New error codes: `INVALID_CHANNEL` (400), `NO_VERSION_ON_CHANNEL` (404,
  `BundleUnavailableError`), `VERSION_NOT_ON_CHANNEL` (400, `ValidationError`). Each message
  names the channel(s) involved and the corrective action (SC-005).
- try-hola/apps (the catalog repository) still has to do the actual publishing work before
  any real pre-release bundle appears — this ADR and #418/#003-release-channels only build
  the platform side. In dependency order: (1) `bin/push-oci-package.sh` must stop moving
  `:latest` unconditionally for a pre-release version (a guard already exists in this repo's
  `cli-release.yml` to copy); (2) `build-and-publish.yml` currently only publishes on merge to
  `main`, so a pre-release bundle needs a path that doesn't require merging to main first;
  (3) `build-catalog.sh` needs to emit multiple `versions[]` entries with the `channel`
  marker; (4) `version-bump.yml`/`tag-release.yml` are stale (wrong package layout, no
  pre-release bump) and need fixing or removal. Until these land, this feature is exercised
  by the automated suite and by custom catalog sources, not by the public catalog.
- Relation to the open catalog-governance question (PRD §12.2, "Catalog source of truth &
  governance"): this ADR settles **what the catalog offers** — a channel is however the
  catalog chooses to tag a version — and leaves **who reviews it** exactly as open as before.
  A partial answer, not a new question.
- Follow-up filed, not built here: clone-with-data (`hola install <app> --channel <c> --from
  <deployment>`), seeding a channel deployment from an existing one's data rather than
  starting empty — [try-hola/hola#429](https://github.com/try-hola/hola/issues/429). A
  channel deployment from the catalog tests "does the rc boot, route, and authenticate," not
  "does the rc migrate my data" — the two are not substitutes and the second is real
  follow-on work (secrets, outbound side effects, disk/IO cost, absolute-URL breakage covered
  in the filed issue).
- Blue/green promotion between two deployments remains explicitly out of scope: a channel
  deployment is a rehearsal that ends in discard, not a cutover path, and should not be
  conflated with the deferred change-drafts/blue-green work.
