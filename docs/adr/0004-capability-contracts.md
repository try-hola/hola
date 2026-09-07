# ADR 0004: Capability contracts — `provides` / `accepts`

- **Status:** Accepted (August 2026; amended 2026-09-04 by spec 004)
- **Context:** ADR 0002 defined cross-app integration one-directionally: an app declares
  `consumes: <capability>` and the server reconciles a generic primitive. Since then the
  *other* half of several integrations has appeared as one-off manifest blocks (`auth`,
  `backup`, `push`), with nothing naming the relationship between the two sides. This ADR
  names it, and names the two shapes a contract can take. Design only — no behavior ships
  with this ADR.

## Context

ADR 0002's `consumes` is not app-to-app at all: it is **app-consumes-platform**. The server
grants a privileged primitive (`apps-data`, a read-only mount of every app's data root) or
publishes a feed (`app-registry`, `registry.json` written into the consumer's data root).
Backrest and Homepage are consumers of Hola, not of each other.

But backup — the integration ADR 0002 named as Phase 2 — turned out to need a second side.
A file-level restic snapshot of a running Postgres is crash-consistent, not
transaction-consistent, so #121 added a manifest `backup` block: `preHook`/`postHook`
exec-form commands the server runs in the app's own containers around a capture. Four
catalog apps declare it today (`paperless-ngx`, `mealie`, `guacamole`, `postiz`); `immich`,
the most restore-fragile of them, does not.

That block is a genuine second role — "this app can be backed up consistently" — and today
it is invisible as such:

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
- **acceptors** — apps that opt in to being a subject of it, exposing whatever the contract
  requires (a `pg_dump` pre-hook, an OIDC setup command, a pushable directory).

The contract, not the app, is the coupling point. An acceptor never names backrest; it
declares that it accepts `backup@1`. Swapping the provider (restic → Kopia → a server-native
engine) is a catalog change, not a fleet-wide manifest edit.

This is a **separate axis from `consumes`**, not a replacement for it. `consumes` is "the
server grants me a platform primitive"; a contract is "I fill a role in a two-sided
integration." Conflating them into one `capabilities: []` list was rejected (below): a
privileged grant and a role declaration have different review requirements.

### 2. Both roles are declared explicitly in the manifest

```jsonc
// backrest manifest.json
"provides": ["backup@1"]

// paperless-ngx manifest.json
"accepts": ["backup@1"],
"backup": { "preHook": { … }, "postHook": { … } }   // unchanged: *how* it participates
```

An earlier draft of this ADR derived acceptance from the presence of the typed block — no
`accepts` field, on the grounds that two structures describing one fact drift (ADR 0003's
argument for extending `defaultEnv` in place). **That was wrong, for a reason specific to
this axis:** the block and the acceptance are *not* the same fact.

- The block says **how** an app participates. Acceptance says **whether** it does.
- Plenty of apps accept `backup@1` and need **no hooks at all** — a SQLite or flat-file app
  is fine with a crash-consistent file copy. Under derived acceptance those apps are
  indistinguishable from apps nobody ever considered, because both have no `backup` block.
  The "which apps are covered?" view — the entire reason the Immich gap stayed invisible —
  would still be unanswerable.
- Acceptance is an **assertion by the bundle author**: "I have thought about backup for this
  app, and this manifest makes it safe." That is a claim worth writing down and reviewing,
  and it is worth being able to *withhold* — an app whose data can't be captured safely at
  all should be able to stay silent, and be reported as uncovered rather than assumed fine.

So a contract's participant requirements are checked **against the declaration**: `accepts:
["backup@1"]` on an app whose compose runs a database image, with no `backup` block, is a
manifest-CI error in try-hola/apps. The server's own check is narrower (a declared block must
be well-formed); publish-time CI is where "you accepted this and didn't do the work" is
caught, because only the catalog repo can see the compose and the manifest together.

Manifests therefore gain two optional fields, `provides` and `accepts`. Existing manifests
keep working — an app that declares neither is simply reported as filling no role, which is
the honest answer.

### 3. The server owns a contract registry; contracts are server-defined, not open

A new module (`packages/server/src/services/core/contracts.ts`) holds the canonical table.
Each entry declares:

| field | meaning |
| --- | --- |
| `id` / `version` | `backup`, `1` |
| `shape` | `brokered` or `provisioned` (§5) |
| `providerGrant` | what the server injects for the provider (`backup@1` → the read-only apps-data mount) |
| `acceptorBlock` | manifest block that carries the acceptor's details, if any (`backup` → `coerceManifestBackup`) |
| `broker` | for brokered contracts: what the server does when the provider asks |
| `unavailable` | what the provider must do when the server can't be reached (§6) |

Contract ids are a **closed set defined in server code**, like the `consumes` primitives.
The catalog cannot invent a contract, because a contract is a promise about server behavior —
matching two strings does nothing unless the server implements the middle. Forward-compat
follows ADR 0003's rule: a `provides`/`accepts` entry this build doesn't recognize is
**dropped with a logged warning**, never a hard failure — the catalog and the server release
on separate cadences, and a stale server must not brick an install.

### 4. Privilege attaches to the provider role, gated by operator consent at install

A provider needs privilege the contract defines — `backup@1`'s provider needs read access to
every app's data. Two ways to grant it:

- **(a)** keep the separate `consumes: apps-data` declaration and require the two to agree;
- **(b)** derive the grant from the contract definition and gate it on **explicit operator
  consent at install time**.

We choose **(b)**. Under (a) the privilege is visible only in a manifest line reviewed once,
at publish time, by whoever merged the bundle — the operator installing it sees nothing. It
also lets the two declarations disagree, which is a check to write and a failure mode to
explain. Under (b) there is one source of truth (the contract says what its provider gets),
and the person who actually bears the risk is asked.

Hola already has the mechanism: the `security` block surfaces elevated container permissions
for explicit consent in the install wizard (`AppSecurityConfig`). Installing an app that
declares `provides: backup@1` shows the same kind of consent step — *"Backrest will be able
to read the data of every installed app"* — and the grant is injected only on acceptance.
This is the "operator approval flow for privileged capabilities" ADR 0002 deferred.

Consequently `apps-data` stops being an independently declarable primitive. It becomes the
provider grant of `backup@1` (and, later, of whatever other contract needs it), which is the
only context in which handing an app every app's data was ever justifiable. `app-registry`
stays a plain `consumes` primitive: it is a published feed, not a two-sided integration, and
nothing provides it but the platform.

### 5. Two shapes: broker the control plane, provision the data plane

**Not every contract should route through the server.** Brokering — the provider asks Hola,
Hola acts on acceptors — is right when the exchange is a low-volume command or event with a
request/response shape. It is wrong when the exchange is continuous or latency-sensitive:
log streaming, metrics scraping, an app calling another app's API in a loop. Proxying that
through the orchestrator makes Hola a bottleneck and a single point of failure for traffic it
has no reason to see.

Hola already implements both shapes; only one of them has ever been written down:

| | **Brokered** | **Provisioned** |
| --- | --- | --- |
| Server's role | executes on the acceptor's behalf, per request | sets up a scoped connection, then steps out |
| Traffic | control plane, bursty, low volume | data plane, continuous |
| Credentials held by apps | none | scoped, server-issued, revoked on uninstall |
| Existing example | #121 hooks around the pre-upgrade snapshot | **auth/OIDC** — provision an Authentik client, inject env, join networks; the app then talks to the IdP directly forever. Also Traefik routing. |
| This ADR's example | `backup@1` | a future `database@1`, `smtp@1`, `object-store@1`, `logs@1` |

The rule: **broker if the interaction is an operation; provision if it is a connection.** A
contract declares its shape in the registry (§3), and the choice is made per contract at
design time, not per call.

What holds in **both** shapes is the actual invariant, and it is the one thing this ADR
refuses to relax:

> **No app ever gets ambient reach into another app.** Every cross-app access is explicit
> (declared in a manifest), scoped (to one contract, one peer, one direction), server-issued,
> and revoked on uninstall.

Brokering is one way to honor that invariant; provisioning is another. Naming both is what
keeps the model from constraining future integrations — a Postgres-as-a-service or an SMTP
relay contract falls out as a provisioned contract rather than needing an exception. ADR
0002's rejection of an *app-to-app notification bus* stands unchanged: what is rejected is
apps discovering and calling each other on their own initiative, not the server deliberately
wiring two apps together.

### 6. Brokered contracts inherit the server's availability, and must say what that means

For `backup@1`, the provider gets endpoints scoped to its own deployment:

```
POST /api/contracts/backup/prepare    → server runs every acceptor's preHook
POST /api/contracts/backup/finalize   → server runs every acceptor's postHook
```

Backrest wires them into its own `onBackupStart` / `onBackupEnd` hooks — a bundle bolt-on,
the ADR 0002 pattern, with app-specific glue in the bundle and the generic primitive in the
server. This is #298's Option A, generalized: the hook runner (lifted out of
`capturePreUpgradeSnapshot`) gets a second caller instead of a second implementation.

Which means a brokered backup is only as available as the server. If Hola is down, mid-
upgrade, or slow when Backrest's cron fires, the hooks don't run. Each brokered contract must
therefore declare its `unavailable` behavior; for `backup@1` it is **fail-closed** — skip the
snapshot and surface it, rather than silently capturing inconsistent files, because a backup
believed good and isn't is worse than a backup known missing.

Long-running acceptor work (a large `pg_dump`) must not be bounded by an HTTP request:
`prepare` enqueues through the existing job system and returns a handle the provider polls,
with a per-contract timeout after which `finalize` runs regardless.

The provider's credential is a **contract-scoped token** minted for that deployment at
install, carrying only the capability for its own contract endpoints — not an admin key, not
usable elsewhere in the API. It reuses the scoped-token machinery the server already uses to
self-bootstrap against Authentik, and is revoked when the app is uninstalled.

### 7. Roles are visible in the API and the UI

The server exposes, per deployment, `contracts: { provides: [...], accepts: [...] }`, and a
platform-level rollup: for each contract, who provides it and which installed apps accept it.
That makes the thing that is invisible today legible:

- "No backup provider installed" is answerable, so the stubbed Backups page (#160) has real
  content before any backup engine exists.
- "Immich does not accept `backup@1`" becomes a visible gap in the dashboard rather than a
  fact buried in an issue comment — which is the actual reason it has stayed unfixed.

This also settles #160's open question in favor of **Option A**: the Backups page is a view
over the installed provider plus the acceptor rollup, not a second backup engine competing
with it. Hola brokers; it does not back up.

### 8. Existing blocks are re-labelled; backrest is re-cut

`auth`, `backup` and `push` become the acceptor blocks of `auth@1`, `backup@1` and `push@1` —
shapes, coercers and runtime behavior unchanged. What changes is that each acceptor now also
declares the contract, and `auth@1` is documented as **provisioned** (it always was).

`backrest` is re-cut rather than preserved: it drops `consumes: apps-data`, gains
`provides: ["backup@1"]`, gains the contract-scoped token and the `onBackupStart` bolt-on, and
its apps-data mount now arrives as the contract's provider grant behind an install-time
consent step. Since `apps-data` ceases to be independently declarable, the server must
tolerate an already-installed backrest whose stored manifest still declares it (treat a bare
`consumes: apps-data` as `provides: backup@1` for one release, warn, and drop the shim after).

`container-logs` (#245) is re-examined under §5 before it is built: a collector scraping every
container continuously is a **provisioned** contract, not a brokered one — the server grants
the log source and stays out of the stream. §12 below carries this out.

### 9. Acceptor participation is a list

Backup exposed a gap the model didn't answer: an app with **two** stateful services (its own
database plus a workflow engine's) can only name one in a singular `backup` block, so the
second is copied live on every capture — while the app still reads as fully "accepted." Spec
004 (#426) rules that **acceptor participation is a list**, as a property of the contract
model itself, not a one-off fix to `backup@1`:

```jsonc
"accepts": ["backup@1"],
"backup": [
  { "id": "app-db",       "preHook": { … }, "postHook": { … } },
  { "id": "temporal-db",  "preHook": { … }, "postHook": { … } }
]
```

Each participation carries a stable `id` (unique within the app) and its own hooks. The
existing singular object (`{ preHook?, postHook? }`) remains valid and is normalised to a
one-element list whose id is `default` — every published manifest and every on-disk release
manifest keeps working with byte-identical behavior (ADR 0003). `backupParticipations()`
(`@hola/shared/contracts`) is the one reader of either shape; the publish-time coercer
(`coerceManifestBackup`) always emits the canonical array. A duplicate id, a missing id in the
plural form, or a participation with neither hook is dropped with a logged warning, first
occurrence wins — never a failed catalog load.

`push@1` already conformed (`AppPushTarget[]`). `auth@1` is the deliberate exception: an app
has **one identity**, so its acceptor block stays a single object by nature, not by omission.

**Ordering, failure and cleanup.** The broker's prepare runs participations **in declaration
order within an app, and apps in ascending deployment id** — a stable, documented order shared
by the broker and the server's own pre-upgrade snapshot. Pre-hooks run sequentially and
**fail-closed**: the first failure stops the prepare outright (no later pre-hook — in that app
or a later one — ever starts), and the prepare fails naming the participation. Cleanup then
runs the post-hook of every participation that was **started** (succeeded or failed) in the
same forward order, and never one that never started. Finalize runs every eligible
participation's post-hook regardless of individual failures and reports one result per
participation (`{ deploymentId, participationId, ok, output? }`), so an app that failed one of
three participations is distinguishable from one that failed all three.

### 10. One provider per contract per host

Nothing previously said what two installed apps both declaring `provides: ["backup@1"]` means.
Spec 004 (clarification) rules that **a contract has at most one provider per host**, enforced
**at install, before any deployment or job is created**: `assertProviderAllowed` runs
immediately after the existing single-instance guard (`assertInstanceAllowed`) and before the
consent check, scanning exactly the same live deployment set the instance guard counts — so the
two guards can never disagree about what "installed" means. A conflicting install is rejected
(`PROVIDER_EXISTS`) naming the existing provider deployment and the corrective action
("uninstall it first"); no deployment or job is created for the rejected install. A stopped or
failed provider still counts — it holds the grant — and uninstall is the only hand-over. The
provider's own upgrade, rollback or restart never trips the guard: those paths never call
`createFromDraft`, so a provider cannot "see itself" as a second install.

Records from before this rule existed (two live providers of one contract) are not
auto-removed: the rollup flags the contract (`providerConflict: true`) and the dashboard
renders a warning on the provider panel.

**Known limit, accepted:** a channel rehearsal copy of a provider (spec 003, ADR 0005) is
refused by this guard exactly like any other second provider — a provider app cannot currently
be trialled on a pre-release channel alongside its stable copy. This is a real gap for the
handful of contracts with a provider role, not a general problem with channels; revisit if an
operator actually needs to rehearse a provider upgrade this way.

### 11. Participation mode: declared vs. implicit

Every contract definition now carries a **participation mode**: `declared` (an app opts in via
`accepts`, and the block is the reviewable artifact §2 describes) or `implicit` (every
installed, non-provider deployment is a subject **by virtue of running**, with nothing to
declare). `auth@1`, `backup@1` and `push@1` are `declared`. `container-logs@1` (§12) is the
first `implicit` contract: a log collector reads every container's logs whether or not the
container's author ever considered it, so there is no "accept" question to ask.

The rollup and its clients must not misread an implicit contract's subjects as uncovered:

- for a `declared` contract, the buckets are unchanged (`providers` / `acceptors` /
  `unaffiliated`, as §7 describes);
- for an `implicit` contract, every non-provider install lands in `acceptors` (with no
  `hooks`/`coverage` — neither concept applies) and `unaffiliated` is **always empty**. The
  rollup entry exposes `participation` so a client renders the right label without knowing the
  ref.

A manifest `accepts` naming an implicit contract is meaningless and is dropped with a logged
warning at coercion — the same treatment §2's rollup gives a platform-provided `provides`.

### 12. `container-logs@1`: the first app-provided provisioned contract

A log collector (#245) that tails every container continuously is exactly the case §5 predicts
for a **provisioned** contract: brokering it through the server would make Hola the data plane
for every log line on the host. `container-logs@1` (`provisioned`, provider kind `app`,
participation `implicit`) is added to the table with a new provider grant kind,
`container-logs`, disclosed at install the same way `apps-data` is:

> *"Read the logs of every container on this host — this app can read whatever every installed
> app writes to its logs, which routinely includes tokens, request paths and personal data, and
> can see which containers exist and how they are labelled. It cannot start, stop or reach into
> them."*

**The log-source mechanism.** FR-023's envelope — read container logs, enumerate containers and
their labels; never start/stop/create/exec/delete a container, copy files out of one, or read
its environment variables — rules out every off-the-shelf option:

- **a read-only bind of `/var/run/docker.sock`** — the `:ro` mode bit restricts the filesystem
  node the bind mount exposes, not the protocol spoken over it once opened; the Docker API
  behind the socket is fully writable regardless;
- **a read-only mount of the Docker log directory** (`/var/lib/docker/containers`) — kernel-
  enforced read-only, but every container's `config.v2.json` lives right next to its log file
  with the container's full `Config.Env`, so it leaks every other app's secrets to the
  collector; it is also only useful with the `json-file` log driver;
- **an off-the-shelf path-prefix proxy** (e.g. `tecnativa/docker-socket-proxy`) — its
  `CONTAINERS=1` flag opens every GET under `/containers/`, including `/containers/{id}/archive`
  (file exfiltration) and the unredacted inspect (full environment); none of them can rewrite a
  response body, which redacting inspect requires.

The chosen mechanism is a **platform-managed, redacting Docker API proxy** (`hola-docker-proxy`,
`packages/server/src/docker-proxy.ts` with its pure decision/redaction logic in
`src/lib/docker-proxy.ts`), run from the **server's own image** — no new published artefact,
since the image is already pulled on every host and already has the socket-group access the
server itself needs. On consent, materialisation injects the sidecar into the provider's compose
(read-only socket bind, no published ports, and only the provider project's own networks — never the external `hola` network) and points every *other* service at it via
`DOCKER_HOST=tcp://hola-docker-proxy:2375`. The proxy forwards `GET /containers/json`,
`GET /containers/{id}/logs` and `GET /events` unchanged; rebuilds `GET /containers/{id}/json`
from an explicit field allowlist (`Id`, `Name`, `Created`, `State`, `Image`,
`Config.{Tty,Labels,Image,Hostname}` — dropping `Config.Env`, `Config.Cmd`, `Config.Entrypoint`,
`HostConfig`, `Mounts`, `NetworkSettings`); and denies everything else, including any non-`GET`
verb, with `403`. The allowlist is chosen against the fields real collectors (Alloy, Promtail,
Vector) actually read (TTY and labels for formatting, name/image for grouping); extending it is
a one-line, reviewed change, not a redesign.

Revocation follows the existing path: nothing the grant issues persists beyond the compose
project, so `docker compose down` on uninstall removes the sidecar and its env. A provisioned
contract needs no broker credential: `mintContractEnv` mints only for a granted contract whose
`shape` is `brokered`, so a provider of only `container-logs@1` gets no `HOLA_CONTRACT_TOKEN`.

The compose validator's bind-source rule is unchanged and pinned by test for the socket, the
log directory, and their parents; a new `RESERVED_SERVICE_NAME` rule rejects a user-authored
service named `hola-docker-proxy`, so the platform's injection is the only path to the name.

### 13. Platform container labels

Every app container gains three reserved-namespace labels, applied by `applyPlatformDefaults`
alongside the other platform defaults (post-validation, every service, every deployment):

| key | value |
| --- | --- |
| `sh.hola.app` | the Hola app id (`deployment.app`) |
| `sh.hola.deployment` | the deployment id |
| `sh.hola.name` | the deployment's display name |

These exist so a `container-logs@1` collector (or any future consumer of `docker inspect`) can
group logs by app with **no per-app configuration** — the whole reason the grant is worth
holding. Labels merge into whichever form the app declared (list or map), preserving every
other user label; a user-authored value under the `sh.hola.` prefix is overwritten, since the
platform is the source of truth for who's who.

### Rejected alternatives

- **One flat `capabilities: []` list** covering both grants and roles. Rejected: a privileged
  server grant and a role declaration have different review requirements, and merging them
  makes it impossible to see at a glance which apps hold cross-app privilege.
- **Derived acceptance** (no `accepts` field; infer it from the typed block). Rejected in §2:
  it cannot distinguish "reviewed, needs no hooks" from "nobody looked," which is exactly the
  question the model exists to answer.
- **Naming the provider in the acceptor manifest** (`"backupProvider": "backrest"`). Rejected:
  couples every stateful app to one catalog app's identity and makes replacing the provider an
  N-manifest migration. The contract exists to be the only shared name.
- **Brokering everything**, as a universal rule. Rejected in §5: it turns the orchestrator into
  a data-plane proxy for contracts that are continuous rather than transactional, and it
  contradicts how auth already works.
- **Direct provider→acceptor execution** (give backrest the ability to exec hooks itself).
  Rejected for the reason ADR 0002 rejected an app-to-app bus: it hands a container reach into
  other apps' containers and moves ordering, retry and failure handling outside Hola's control.
- **Catalog-defined contracts** (arbitrary ids matched between manifests, server stays out).
  Rejected: a contract is a promise about *server* behavior; open ids would let a bundle claim
  a capability nothing honors.

## Consequences

- Two new optional manifest fields (`provides`, `accepts`) and one new server module (the
  contract table + broker routes). `FinalizedManifest` gains `provides?: string[]` and
  `accepts?: string[]` beside `consumes?: string[]`.
- **Manifest churn is expected and wanted**: every app that participates in a contract states
  it. That is the point — the declaration is the reviewable artifact, and the rollup is only
  as trustworthy as the fact that silence means "not covered."
- `apps-data` is no longer independently declarable; it becomes `backup@1`'s provider grant
  behind install-time operator consent, with a one-release compatibility shim for installed
  backrest deployments.
- #121's hook runner gets its second consumer, closing #298 without a bespoke backrest
  endpoint. The hook logic lifts out of `capturePreUpgradeSnapshot` into a shared runner with
  two callers (pre-upgrade snapshot; contract broker), plus job-backed execution for long hooks.
- #160's architectural question is answered (Option A), and the Backups page has something
  true to render before an engine exists.
- The catalog gains a reason and a place to fix the `immich` gap, and manifest CI gains a real
  check: accepts a contract without meeting its requirements → error; runs a database and
  accepts nothing → warning.
- **Cost, accepted:** a new contract requires a server release, so the catalog cannot add one
  on its own. That is the price of the server being the only thing that can honor a promise
  about cross-app behavior. It bounds how fast the vocabulary can grow, not how fast apps can
  adopt existing contracts.
- The security envelope tightens rather than loosens: privilege is now tied to a named role,
  disclosed to the operator at install, and revoked on uninstall — instead of an invisible
  manifest line reviewed once at publish time.
