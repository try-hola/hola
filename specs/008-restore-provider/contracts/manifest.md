# Contract: the app-side declarations

**Feature**: `specs/008-restore-provider` · **Repo**: `try-hola/apps` (catalog, prepared here, submitted
separately — FR-063)

---

## 1. The acceptor side — `accepts` + `restore` block — UNCHANGED from spec 007

Say this plainly, because the promotion in §0 changes what `restore@1` **resolves to** server-side without
changing one byte of what an app author writes. Every catalog manifest that already declares
`accepts: ["restore@1"]`, with or without a `restore` block, keeps validating and keeps working with **no
manifest edit** (FR-006).

```jsonc
{
  "accepts": ["backup@1", "restore@1"],
  "restore": [
    {
      "id": "default",
      "discard": ["postgres"],
      "hook": {
        "service": "mealie-postgres",
        "command": ["sh", "-c", "psql -v ON_ERROR_STOP=1 -U mealie -d mealie -f /backups/mealie.sql"]
      },
      "requiresEnv": false
    }
  ]
}
```

The shape, the three declaration states, the `discard`/containment rules, and the JSON-schema fragment for
`restore` are all exactly spec 007's `contracts/manifest.md` — reproduced here only as a pointer, not
duplicated, because duplicating a schema fragment across two spec directories is how the two drift:

> See `specs/007-restore-on-install/contracts/manifest.md` §"Shape" through §"JSON-schema addition" verbatim.
> Nothing in this feature adds a field, changes a default, or touches `resolveContainedDir`'s containment rule.

**What DID change, and why it's invisible to the schema**: before this feature, `restore@1` in `accepts` was
read past a carve-out that resolved it *before* the contract table was ever consulted (spec 007's
`isParticipationMarker`, deleted — data-model.md §9a). After, the identical string resolves through
`parseContractRef` into a real `CONTRACTS` row. The manifest byte `"restore@1"` never changes; what changes is
purely how the server, internally, decides what that byte means. This is exactly the shape of change a
manifest-schema diff cannot show and a catalog CI run cannot catch — it is why FR-003's regression test must
exercise the coercion path, not merely assert the schema still validates.

---

## 0. The provider side — `provides: ["restore@1"]` — NEW

A restore provider (the `backrest` catalog app, upgraded) declares the role that fills `restore@1`'s provider
slot:

```jsonc
{
  "provides": ["backup@1", "restore@1"],
  "accepts": ["backup@1"]
}
```

**This is what surfaces the new consent row (FR-059).** `providerGrantsFor(provides)` (`shared/contracts.ts`,
unchanged, fully generic — data-model.md §1's table) picks up the new `restore@1` entry's `providerGrant`
automatically the moment `provides` names it; no wizard code changes to render the row (contracts/grant.md has
the copy). Declaring `provides` alone grants nothing — the operator's consent, recorded separately per
`grantedContracts`, is what actually produces the writable mount (data-model.md §2c).

**One provider per host, for free.** Because `restore@1`'s `providerKind` is `'app'` (data-model.md §1),
`assertProviderAllowed` already refuses a second install declaring `provides: ["restore@1"]` — the identical
guard `backup@1` gets, with no new code (FR-008).

Nothing else in a provider's manifest changes: it declares no new `consumes`, no new compose service of its
own in the bundle — the writable staging mount and the four broker endpoints are entirely server-injected and
server-hosted respectively (data-model.md §2c, contracts/api.md).

---

## 2. The provider's bundle-side work (FR-060, FR-061, FR-062) — described, not built here

Everything below is catalog-repo work: the bundle's own scripts, prepared as a diff and stopped (FR-063), not
committed or PR'd from this repository.

- **A new, continuously-running poller** — not an extension of `backrest-hola-autowire`'s existing 30s
  reconciliation loop (which reconciles Backrest's own local config via `GetConfig`/`SetConfig` and never
  contacts the Hola server at all), and not an extension of `backup-prepare.sh` (invoked once per snapshot by
  Backrest itself, not a loop). Both are confirmed, not assumed (`research.md` R16) — the prompt of record's
  claim that an existing loop could be joined does not hold against the actual bundle.
- **Why a poller is required rather than a hook-triggered script**: Backrest's hook conditions are
  snapshot-lifecycle only (`CONDITION_SNAPSHOT_START`/`_END`); there is no restore-triggered condition to hang
  work on (FR-062). The provider has no event to react to — it must ask.
- The poller's three jobs, each a thin wrapper over the four endpoints in `contracts/api.md`: enumerate the
  repository and publish an index (§1) on its own schedule; poll for pending requests (§2) and claim one (§3);
  deliver the claimed capture's bytes into the server-nominated `destination` and report completion or failure
  (§4).
- Reading the identity record out of each capture (to populate `RestoreIndexEntry.identity`,
  data-model.md §3a) is the provider's own read of whatever `.hola/instance.json`-shaped file the capture
  contains — the server never reaches into the provider's repository to look.

---

## 3. The three catalog gates that must change together (FR-058)

Both files live in `try-hola/apps`, not in this repository — described here at the level spec 007's own
`contracts/manifest.md` described `schemas/manifest.schema.json` at, without a local path to read.

| # | Gate | Today (before this feature) | Required change |
|---|---|---|---|
| 1 | `$defs/appProvidedContractRef` — the enum `schemas/manifest.schema.json` uses to validate every entry of a manifest's `provides` array | Does **not** include `restore@1` — only `backup@1`/`push@1`/`container-logs@1` (whichever subset the catalog's independent copy of the contract table currently lists as app-providable) | Add `restore@1` to the enum, so a bundle manifest declaring `provides: ["restore@1"]` validates |
| 2 | The `CONTRACTS`-equivalent table in `bin/validate-manifest.mjs` — its own copy of contract metadata used for catalog CI, keyed the same way `DATABASE_IMAGE_FAMILIES` warns of drift with this repo's copy | Restore's row (if one exists at all) carries `appProvided: false` or is absent from the table entirely | Flip (or add) `appProvided: true` for `restore`, so the validator's own reasoning about who may declare `provides: ["restore@1"]` agrees with the schema |
| 3 | Prose in **both** files — a comment or doc string stating that nothing in the catalog provides `restore@1` (the true statement spec 007 shipped and this feature ends) | States "no provider exists for `restore@1`" | Updated to describe the provider role and point at the manifest shape in §0 above |

**All three must change together, or the catalog ships an inconsistency this repo's own twin-list precedent
(`DATABASE_IMAGE_FAMILIES`, `shared/contracts.ts:394-405`) already warns about**: a schema that accepts
`provides: ["restore@1"]` while the validator's own table still calls it non-providable would pass one gate and
warn or fail at the other, depending on which check runs first — exactly the kind of two-source-of-truth drift
that produced the `pgautoupgrade` miss the `DATABASE_IMAGE_FAMILIES` comment documents. Catalog CI failing to
enforce this is the reason FR-058 states it as a single requirement covering all three, not three independent
ones.

---

## 4. Sequencing (mirrors spec 007's manifest.md)

The platform half (this feature) is complete and testable with **no** catalog PR merged — the four broker
routes, the staging grant, and provider-origin candidate plumbing all have unit/real-filesystem coverage that
fabricates a provider's requests and index entries directly (quickstart.md), exactly as spec 007's platform
half needed no catalog change to be useful for local-deployment restores. The catalog diff (this section, and
§2's bundle work) is what makes a *real* backrest installation able to fill the role; until it merges, an
operator sees the consent row and the writable mount (both driven by the manifest declaration alone) but no
provider ever calls the four endpoints, so no candidates ever appear from it — indistinguishable, from the
platform's point of view, from "no restore provider installed" (FR-047).
