# ADR 0004: Capability contracts — a `provides` role alongside `consumes`

- **Status:** Proposed (August 2026)
- **Context:** ADR 0002 defined cross-app integration one-directionally: an app declares
  `consumes: <capability>` and the server reconciles a generic primitive. Since then the
  *other* half of several integrations has appeared as one-off manifest blocks (`auth`,
  `backup`, `push`), with nothing naming the relationship between the two sides. This ADR
  names it. Design only — no behavior ships with this ADR.

## Context

ADR 0002's `consumes` is not app-to-app at all: it is **app-consumes-platform**. The server
grants a privileged primitive (`apps-data`, a read-only mount of every app's data root) or
publishes a feed (`app-registry`, `registry.json` written into the consumer's data root).
Backrest and Homepage are consumers of Hola, not of each other. That model works and is not
changed here.

But backup — the integration ADR 0002 named as Phase 2 — turned out to need a second side.
A file-level restic snapshot of a running Postgres is crash-consistent, not
transaction-consistent, so #121 added a manifest `backup` block: `preHook`/`postHook`
exec-form commands the server runs in the app's own containers around a capture. Four
catalog apps declare it today (`paperless-ngx`, `mealie`, `guacamole`, `postiz`); `immich`,
the most restore-fragile of them, does not.

That block is a genuine second role — "this app supports being backed up consistently" — and
today it is invisible as such:

- The **provider** side is nowhere. `backrest` declares `consumes: apps-data` and nothing
  else. "Backrest is the backup app" lives in prose in this ADR series and in #160, not in
  any data structure, so nothing can ask "is a backup provider installed?"
- The **participant** side is not named. The `backup` block is one of three unrelated-looking
  manifest blocks (`services/core/manifest-backup.ts`, `manifest-push.ts`, the `auth` block)
  with its own coercer and no shared vocabulary. Nothing can answer "which installed apps
  support consistent backup, and which are silently getting crash-consistent copies?"
- The two halves are **not connected**. `RealDeploymentService.capturePreUpgradeSnapshot`
  (`deployment.ts:1637`) runs the hooks for the server's *own* pre-upgrade snapshot. Backrest
  runs restic on its own schedule inside its own container, and the server is not in that
  loop — so the hooks never run for a scheduled backup (#298). The primitive exists, has a
  caller, and still doesn't do the job it was written for.

The same shape has now recurred three times independently — `auth` (this app supports SSO in
mode X), `backup` (this app supports consistent snapshots), `push` (#409: this app accepts
bulk data at these paths). Each was discovered separately and modelled separately. A fourth
(`container-logs`, #245) is queued. The model is real; it has just never been named.

## Decision

### 1. A *contract* is a named, versioned integration with two roles

A **capability contract** has an id and a version (`backup@1`) and defines two sides:

- a **provider** — the app that performs the capability (backrest performs backups);
- **participants** — apps that expose whatever the contract requires of a subject
  (a `pg_dump` pre-hook, an OIDC setup command, a pushable directory).

The contract, not the app, is the coupling point. A participant never names backrest; it
declares that it satisfies `backup@1`. Swapping the provider (restic → Kopia → a
server-native engine) is a catalog change, not a fleet-wide manifest edit.

This is a **separate axis from `consumes`**, not a replacement for it. `consumes` is "the
server grants me a privileged primitive"; a contract is "I speak this protocol." Conflating
them into one `capabilities: []` list was rejected (below) precisely because it would blur a
security boundary with a naming convention.

### 2. Manifests gain exactly one new field: `provides`

```jsonc
// backrest manifest.json
"consumes": "apps-data",      // unchanged: the privileged grant
"provides": ["backup@1"]      // new: the role it fills
```

**Participation is derived, not declared.** An app supports `backup@1` because it has a valid
`backup` block — there is no second `supports: ["backup@1"]` field to keep in sync with it.
This is the same reasoning ADR 0003 used to extend `defaultEnv` in place rather than add a
parallel `paramSpec`: two structures describing one fact drift, and the block is already the
natural unit the coercer and the hook runner operate on. The server derives the participant
list from the finalized manifests it already reads.

So the manifest surface added by this ADR is one optional string-or-array field. Every
existing manifest keeps working untouched, and only provider apps (today: one) change.

### 3. The server owns a contract registry; contracts are server-defined, not open

A new module (`packages/server/src/services/core/contracts.ts`) holds the canonical table.
Each entry declares:

| field | meaning |
| --- | --- |
| `id` / `version` | `backup`, `1` |
| `requires` | primitives a provider must already hold (`backup@1` → `apps-data`) |
| `participantBlock` | manifest block + coercer that constitutes support (`backup` → `coerceManifestBackup`) |
| `broker` | what the server does when the provider asks (run `preHook` for every participant, …) |

Contract ids are a **closed set defined in server code**, like the `consumes` primitives.
The catalog cannot invent a contract, because a contract is a promise about server behavior.
Forward-compat follows ADR 0003's rule: a `provides` entry this build doesn't recognize is
**dropped with a logged warning**, never a hard failure — the catalog and the server release
on separate cadences, and a stale server must not brick an install.

### 4. `provides` grants nothing; it is checked against `consumes`

Declaring `provides: backup@1` does **not** cause the server to inject `apps-data`. A
manifest that provides a contract without the primitives the contract `requires` is rejected
at catalog-coercion time (the `provides` entry is dropped, with a warning). Privilege stays
where ADR 0002 put it: an explicit, auditable `consumes` declaration reviewed when the bundle
is published. `provides` is a role label over privilege already granted, never a way to
acquire it — otherwise a contract definition becomes a second, less visible privilege
channel.

### 5. The server brokers; apps still never talk to each other

ADR 0002's security boundary holds unchanged: **the provider asks the server, the server acts
on participants.** A provider never learns which apps exist, never gets a token for another
app, never execs into another app's containers.

Concretely, for `backup@1`, the provider gets two authenticated endpoints scoped to its own
deployment:

```
POST /api/contracts/backup/prepare    → server runs every participant's preHook
POST /api/contracts/backup/finalize   → server runs every participant's postHook
```

Backrest wires them into its own `onBackupStart` / `onBackupEnd` hooks — a bundle bolt-on,
exactly the ADR 0002 pattern, with the app-specific glue in the bundle and the generic
primitive in the server. This is #298's Option A, generalized: the hook runner
(`capturePreUpgradeSnapshot`'s inner block, lifted out) gets a second caller instead of a
second implementation, and `preHook` failure semantics (fail-closed vs. warn-and-continue)
are decided per call site as they are today.

The provider's credential is a **contract-scoped token** minted for that deployment when it
is installed with `provides`, carrying only the capability for its own contract endpoints —
not an admin key, and not usable for anything else in the API. It reuses the existing
scoped-token machinery the server already uses to self-bootstrap against Authentik.

### 6. Roles are visible in the API and the UI

The server exposes, per deployment, `contracts: { provides: [...], supports: [...] }`, and a
platform-level rollup: for each contract, who provides it and which installed apps
participate. That makes the thing that is invisible today legible:

- "No backup provider installed" is answerable, so the stubbed Backups page (#160) has real
  content before any backup engine exists.
- "Immich does not support `backup@1`" becomes a visible gap in the dashboard rather than a
  fact buried in an issue comment — which is the actual reason it has stayed unfixed.

This also settles #160's open question in favor of **Option A**: the Backups page is a view
over the installed provider (plus the participant rollup), not a second backup engine
competing with it. Hola brokers; it does not back up.

### 7. Existing blocks are re-labelled, not rewritten

`auth`, `backup` and `push` become the participant blocks of `auth@1`, `backup@1` and
`push@1`. Their shapes, coercers and runtime behavior are unchanged — this ADR names what
they already are and gives the next one somewhere to land. `app-registry` and `apps-data`
stay primitives under `consumes`; `container-logs` (#245) lands there too, with a possible
`logs@1` contract later if a collector ever needs a participant side (e.g. per-app log
format declarations).

### Rejected alternatives

- **One flat `capabilities: []` list** covering both grants and contracts. Rejected: a
  privileged server grant and a protocol label have different review requirements, and
  merging them makes it impossible to see at a glance which apps hold cross-app privilege.
- **Naming the provider in the participant manifest** (`"backupProvider": "backrest"`).
  Rejected: couples every stateful app to one catalog app's identity and makes replacing the
  provider an N-manifest migration. The contract exists to be the only shared name.
- **Direct provider→participant execution** (give backrest the ability to exec hooks itself).
  Rejected for the same reason ADR 0002 rejected an app-to-app notification bus: it hands a
  container credentials and reach into other apps' containers, and moves ordering, retry and
  failure handling outside Hola's control. Brokering costs one HTTP round trip and keeps the
  whole thing inside the orchestrator.
- **Catalog-defined contracts** (arbitrary ids matched between manifests, server stays out of
  it). Rejected: a contract is a promise about *server* behavior — matching two strings does
  nothing unless the server implements the broker. Open ids would let a bundle claim a
  capability nothing honors.
- **A redundant `supports` field** alongside the participant block. Rejected per ADR 0003's
  two-structures-drift argument; derive it.

## Consequences

- One new optional manifest field (`provides`) and one new server module (the contract
  table + broker routes). No existing manifest, draft, or deployment record changes shape;
  `FinalizedManifest` gains an optional `provides?: string[]` beside `consumes?: string[]`.
- #121's hook runner gets its second consumer, closing #298 without a bespoke backrest
  endpoint. The hook logic lifts out of `capturePreUpgradeSnapshot` into a shared runner with
  two callers (pre-upgrade snapshot; contract broker).
- #160's architectural question is answered (Option A), and the Backups page has something
  true to render before an engine exists.
- The catalog gains a reason and a place to fix the `immich` hook gap, and manifest CI can
  warn when an app runs a database with no `backup@1` participation.
- Future integrations (monitoring, AV scanning, status pages, log collection) get a shape to
  follow instead of a fourth bespoke block — which is the whole point.
- The security envelope is unchanged: privilege still comes only from `consumes`, still
  read-only, still gated on an explicit manifest declaration reviewed at publish time.
