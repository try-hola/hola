# Contract: the `restore-staging` grant

**Feature**: `specs/008-restore-provider`

---

## 1. What it mounts

One writable, identity-mapped bind mount of the **restore staging root**
(`restoreStagingRoot()`, default `/srv/hola/restore`, sibling of the apps root — data-model.md §2b) into every
service of the consenting provider's compose. Injected by the new `injectWritableMount` (data-model.md §2c),
which differs from the platform's one existing mount injector, `injectReadonlyMount`, in exactly one respect:
no `:ro` suffix.

```yaml
# what materializeCompose appends to every service of a consented restore-staging provider
volumes:
  - /srv/hola/restore:/srv/hola/restore   # read-write, identity-mapped — the ONLY thing this grant adds
```

## 2. What it does not mount — the whole point

| NOT granted | Why this matters |
|---|---|
| Write access to any app's data root | The provider never writes into `<appsBindRoot>/<deploymentId>` directly — only the platform, in the application phase (data-model.md §8), moves a delivered capture from staging into a target root, after the platform's own post-condition and discard checks have run |
| Write access to the apps root itself | The provider cannot even see the apps root through this grant — `restore-staging` and `apps-data` are two separate refs with two separate privileges (§4) |
| Any new **read** access | `restore-staging` grants nothing the provider didn't already have; a provider holding only `restore@1` and not `backup@1` gets a writable staging mount and no read access to any app's data at all — it cannot back up a single byte until it also declares and is consented to `backup@1` |
| Reach into another app's containers | No exec, no network join beyond the provider's own compose project (unaffected by this grant — the same boundary `container-logs@1`'s sidecar already respects, ADR 0004 §12) |
| The Docker socket, or anything privileged at the container-runtime level | Out of scope for both existing grants and this one |

SC-004 is exactly this list: "The privilege a consenting provider gains is exactly one writable scratch
directory; it gains no writable access to any app's data and no additional readable access." Verified by
inspection of the materialised compose (quickstart.md), not by trusting the manifest declaration alone.

## 3. Consent row copy

Matching the plainness of the existing rows (`shared/contracts.ts:163-170` for `apps-data`, `:188-196` for
`container-logs`) — short label, one paragraph of risk in an operator's own terms, no jargon, no hedging.

```ts
{
  kind: 'restore-staging',
  label: 'Write into a shared restore staging area',
  risk:
    'This app can write files anywhere under one platform-owned scratch directory, used to stage a capture ' +
    'before Hola moves it into a new install’s data. It cannot write anywhere else on this host — not ' +
    'into any app’s data, not into Hola’s own files, not into the apps directory itself. Grant it ' +
    'only to an app you trust to deliver exactly the files a restore expects.',
}
```

Rendered by the existing, unmodified wizard consent step (`InstallWizard.tsx:1390-1414`) and CLI `--grant`
flow, both of which already iterate `providerGrantsFor(provides)` generically — no UI code changes to show this
row (contracts/manifest.md §0).

## 4. The upgrade-without-consent rule (FR-014, SC-003)

An **already-installed** provider — consented to `backup@1`, running today, with a read-only `apps-data` mount
— whose manifest is upgraded to add `provides: ["restore@1"]` gets:

1. A new consent row, shown the next time its install is touched (the same "declared but not yet consented"
   surfacing `missingGrantConsents` already produces for any provider role).
2. **No writable mount of any kind** until that specific consent is recorded. `grantsInclude(granted,
   'restore-staging')` reads the install's own `grantedContracts` — declared-but-unconsented `provides` entries
   never appear there (data-model.md §1's table: `granted` is deliberately separate from `provides`).
3. Its existing `backup@1` behaviour — the read-only `apps-data` mount, the prepare/finalize broker cycle —
   **entirely unchanged** (FR-017): revoking or never granting `restore-staging` touches nothing about backups.

**The test this claim lives or dies by**: materialise a deployment whose manifest declares
`provides: ["backup@1", "restore@1"]` but whose `grantedContracts` contains only `backup@1`, and assert the
rendered compose carries the `apps-data` read-only mount and **no** `/srv/hola/restore` mount at all —
quickstart.md's highest-value scenario for this file, because a test that materialises a *freshly consented*
provider and finds the mount present would pass even if the `grantsInclude` check were accidentally wired to
`provides` instead of `granted`.

## 5. Why a sibling contract, not a grant added to `backup@1` (FR-015, R3)

The mechanical reason, verified against the code rather than assumed: `grantsInclude(refs, kind)`
(`shared/contracts.ts:305-307`) takes the install's **consented refs** and, for each, resolves that ref's grant
**kind** by looking the ref up **live** in the current `CONTRACTS` table via `parseContractRef`. Consent is
recorded per **ref** (`backup@1`), never per grant **kind**. If `restore-staging` were instead attached as a
second grant on the existing `backup@1` row:

- Every install that has **ever** consented to `backup@1` — potentially months ago, on a version of the app
  that only performed backups — would satisfy `grantsInclude(granted, 'restore-staging')` on its **very next
  materialisation**, the moment the platform's own `CONTRACTS` table changed underneath it.
- No new consent event would exist anywhere: no wizard row was shown, no CLI `--grant` flag was passed, no
  audit trail entry was written. The privilege would simply appear.
- This is exactly the widening `grantedContracts`'s own doc comment exists to forbid — *"a later release of the
  same app can't quietly widen it"* (`shared/index.ts:2206-2212`, spec 004) — except here the widening
  wouldn't even need a new app release; a **platform** change alone would do it, which is a strictly worse
  version of the same failure.

A **new ref** cannot do this by construction: the app must newly declare `provides: ["restore@1"]` (a manifest
change, reviewed and published) **and** the operator must newly consent to it (a new row, a new
`grantedContracts` entry) before `grantsInclude(granted, 'restore-staging')` can ever return `true` for that
install. Two independent gates, not one gate reused. This is also why `backup@2` (bumping the existing
contract's version) was rejected as an alternative (`research.md` R3): a version bump changes the
**acceptor's** obligations by convention in this codebase, and would force all seventeen `backup@1` acceptors
to re-declare for a change that is entirely on the provider's side.

## 6. What SC-004 does NOT claim

Consenting to `restore-staging` does not, by itself, make an app a *usable* restore provider — it only grants
the mount. Actually serving a restore additionally requires: `provides: ["restore@1"]` being the sole
app-level provider on the host (`assertProviderAllowed`, unaffected by this grant), the bundle's poller
actually running and calling the four broker endpoints (contracts/manifest.md §2, catalog-side and out of this
repo's control), and a published index naming a real capture. The grant is necessary and, on its own,
inert — exactly the same relationship `apps-data` has to actually running backups (a provider holding the
grant but never calling `prepare`/`finalize` is the failure `ContractBrokerActivity` exists to surface,
data-model.md §5).
