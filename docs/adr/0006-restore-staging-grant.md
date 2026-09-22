# ADR 0006: The restore-staging grant — the platform's first writable cross-app mount

- **Status:** Accepted (September 2026, spec 008 — `restore@1`, the provider half).
- **Context:** Spec 007 built restore-on-install with exactly one possible source: a live
  sibling deployment on this host. That is a clone, not disaster recovery — it cannot restore
  an app that no longer exists here, which is the only case that matters after a host is lost.
  Spec 008 adds a second source: a backup provider holding captures taken elsewhere. Making
  that work requires the provider to write bytes somewhere the platform will later move into a
  fresh install's data root — and the platform has never granted an app write access to
  anything before.

## Context

Every cross-app privilege the platform has granted so far is **read-only**: `apps-data`
(ADR 0004 §4) gives a trusted provider a read-only, identity-mapped view of every app's data
root, so it can back files up. `container-logs@1` (ADR 0004 §12) gives a trusted collector
read-only access to container logs via a redacting proxy, never the raw socket. Constitution
Principle V states the rule plainly: *"Privileged primitives MUST default to least privilege:
`apps-data` is a read-only mount."*

A restore provider cannot do its job read-only. Delivering a capture means writing files
somewhere the server can find them. Three shapes were available:

1. **Stream the capture through the server's own API.** Rejected: every restored byte would
   pass through the platform, making it a bottleneck and a memory risk for multi-gigabyte data
   roots, and directly contradicting FR-022/SC-002 ("no captured application data passes
   through the platform's own API").
2. **Grant the provider write access to the target app's own data root, or to the apps root
   itself.** Rejected as strictly more privilege than the job needs. A provider that can write
   into any app's data root, unscoped, could as easily overwrite a *running* app's files as
   land a restore's payload into an empty one.
3. **Grant a writable mount of one platform-owned scratch directory, and move the file into
   place server-side, after the platform's own checks have run.** The privilege granted is
   exactly "write into a shared scratch area"; everything downstream of that — the payload
   post-condition, the discard paths, the marker rewrite — remains code the platform runs, not
   code the provider is trusted to run correctly.

Shape 3 is what this ADR documents.

## Decision

### 1. A new grant kind, not a widened `apps-data`

`ProviderGrantKind` gains `'restore-staging'` (`packages/shared/src/contracts.ts`), attached to
a **new** contract — `restore@1`, promoted from spec 007's participation marker to a real,
brokered, app-provided contract — rather than as a second privilege bolted onto `backup@1`.

This is not a stylistic choice. `grantsInclude(refs, kind)` resolves a consented ref's grant
**kind** by looking the ref up **live** in the current `CONTRACTS` table, while consent itself
is recorded per **ref** in `deployment.grantedContracts`. If `restore-staging` were added as a
second grant on the existing `backup@1` entry, every install that had **ever** consented to
`backup@1` — on a version of the app that only performed backups, months ago — would satisfy
`grantsInclude(granted, 'restore-staging')` on its very next materialisation, with no new
consent event: no wizard row shown, no CLI `--grant` flag passed, no audit trail entry written.
That is exactly the widening `grantedContracts`'s own doc comment exists to forbid — *"a later
release of the same app can't quietly widen it"* — except a **platform** table change alone
would trigger it, which is a strictly worse version of the same failure. A new contract ref
cannot do this by construction: the app must newly declare `provides: ["restore@1"]` (a
reviewed manifest change) **and** the operator must newly consent to it (a new
`grantedContracts` entry) before the mount can ever appear.

### 2. What the grant mounts, and nothing else

One writable, identity-mapped bind mount of the **restore staging root** — a directory the
platform owns and nominates, `HOLA_RESTORE_STAGING_ROOT`, defaulting to `/srv/hola/restore` —
injected into every service of the consenting provider's compose by a **new**, separate
function, `injectWritableMount` (`packages/server/src/services/core/compose-mounts.ts`), beside
the existing `injectReadonlyMount`.

`injectWritableMount` is deliberately its own function, not a read/write flag on
`injectReadonlyMount`: parameterising a security-relevant mount helper with a boolean makes one
function mean two things at the exact boundary where that is least acceptable — a stray `true`
at a call site would silently hand out a writable mount. A separate, identically-shaped
function is greppable, auditable, and cannot be invoked by accident.

The staging root is a **sibling** of the apps root (`HOLA_APPS_BIND_ROOT`), never a descendant
of it — a provider whose own backup plan targets the apps root must not capture its own
restore output as a new "snapshot". It follows the apps root's own pattern exactly: an
operator-overridable environment variable, a hardcoded default, and **no `mkdir`/`ensureDir`
call anywhere in the server** — it is provisioned externally, the same assumption every other
bind root in this codebase already makes.

### 3. What it explicitly does NOT grant

| NOT granted | Why it matters |
|---|---|
| Write access to any app's data root | Only the platform, in the shared application phase (spec 007, unchanged), moves a delivered capture from staging into a target root — after the post-condition and discard checks have run |
| Write access to the apps root itself | `restore-staging` and `apps-data` are two separate refs with two separate privileges |
| Any new **read** access | A provider holding only `restore@1` and not `backup@1` gets a writable staging mount and no read access to any app's data at all |
| Reach into another app's containers | No exec, no network join beyond the provider's own compose project — the same boundary `container-logs@1`'s sidecar already respects |
| The Docker socket, or anything privileged at the container-runtime level | Out of scope for both existing grants and this one |

### 4. Consent, and its absence, verified by inspection

`materializeCompose`'s three grant branches (`apps-data`, `container-logs`, `restore-staging`)
share one `readActiveGrantedContracts` read. An install whose manifest declares
`provides: ["restore@1"]` but whose persisted `grantedContracts` does not include it — the
exact shape of an **upgraded-but-unconsented** provider — takes none of the three branches: no
writable mount, full stop. This is verified by materialising such a deployment over the
real-filesystem harness and asserting the rendered compose carries no `restore-staging` mount,
then materialising the same deployment WITH consent recorded and confirming the mount now
appears — so the test discriminates rather than being vacuously true (spec 008 quickstart
scenario 10).

## Consequences

- **The platform now has exactly one writable cross-app primitive**, scoped to a single
  operator-owned directory that no app's own data lives under. This is a genuine widening of
  the platform's privilege surface, which is why it is recorded here rather than folded silently
  into an existing grant.
- **`grantsInclude`'s live-resolution property was the sharp edge** for any *future* change to
  an existing contract's `providerGrant` — this feature routed around the risk (a new ref) rather
  than fixing the underlying mechanism (research.md R22 #1). **Closed since, by #496**:
  `grantsInclude` is gone, the privilege *kinds* a consented ref implies are frozen onto the
  deployment record as `grantedPrivileges` at consent time, and materialisation resolves
  `resolveGrantKinds` — the live table's kind for each consented ref **intersected with** that
  recorded set. A kind newly attached to an already-consented ref is therefore absent from the
  recorded set and is dropped with a warning naming the deployment, the ref and both kinds; a
  kind removed from the table stops resolving. §1's reasoning for minting a new ref still
  stands on its own merits (a reviewed manifest change plus a fresh consent row), but it is no
  longer the *only* thing standing between a table edit and a retroactive widening.
- **Everything downstream of the mount stays server-code, not provider-trusted code.** The
  provider's only actions are: write files under its request's destination, then report
  completion. Locating the app root inside the delivered tree, moving it into place, applying
  discard paths, and starting the app are all platform logic unchanged from spec 007's
  already-shipped, already-tested application phase.

## Related

- ADR 0002 — cross-app integration primitives (`consumes`, generic reconciliation).
- ADR 0004 — capability contracts (`provides`/`accepts`, `apps-data`, `container-logs@1`,
  brokered vs. provisioned shape).
- `specs/008-restore-provider/` — spec, plan, research (R3, R6, R21), data-model (§2),
  `contracts/grant.md`.
