# CLAUDE.md

Guidance for working in this repository.

## What Hola is

Hola is a self-hosted app-deployment platform: a browsable **catalog** of apps that
install as **Docker Compose** stacks, orchestrated by a server and routed by
**Traefik**. Apps become reachable at `<app>.<HOLA_BASE_DOMAIN>`. Optional **SSO**
(Authentik) auto-provisions per-app auth on install.

## Monorepo layout (Bun workspaces, `packages/*`)

- **`server`** — the orchestrator API (Bun). Owns the deploy lifecycle, catalog,
  drafts, Traefik routing, and the auth provisioner. Most logic lives here.
- **`web`** — the SPA dashboard (Vite/React). Single origin: nginx serves it and
  proxies `/api` to the server.
- **`shared`** — types + the compose validator (`@hola/shared/compose-validate`)
  shared across packages.
- **`sdk`** / **`cli`** — typed client and CLI against the server API. The CLI is
  the only thing released as a binary (`cli-release.yml`, on `cli-v*` tags).
- **`compose`** — the production Docker Compose stack (Traefik + web + server,
  plus an optional Authentik profile) and `scripts/install.sh`.

## Commands

- `bun run typecheck` · `bun run lint` · `bun run build` — across all packages.
  Web's `typecheck` invokes **all three** of its TS projects explicitly
  (`tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.test.json`); a bare
  `tsc --noEmit` there checks **nothing** (see F13 below).
- `bun run test` — server, web AND cli suites (`test:server` / `test:web` /
  `test:cli` run one each). The CLI was missing from this gate until #505: it is
  the only package released as a binary, so it was the one with no CI coverage.
- **Integration tests** (`*.it.ts`) are **excluded** from the default suite and
  **gated on a reachable Docker daemon** (`describe.skipIf(!dockerOk)`). Run via
  `bun run test:integration`. Some boot real Authentik (slow: image pull +
  migrations).
- Always run typecheck + lint + test + build before opening a PR. Note: CI's
  typecheck has caught issues the local run missed after a lint auto-fix — re-run
  typecheck after lint fixes.

## Architecture notes that matter

- **Traefik-only ingress.** Apps have **no host ports**; the server emits Traefik
  file-provider config (`/data/runtime/traefik/dynamic.yml`) and joins each app's
  ingress service to the external `hola` network. The compose **validator rejects
  host ports** and requires pinned image tags.
- **Compose policy is enforced twice (F02).** The validator refuses
  privilege-bearing service keys (host/foreign namespaces, `devices`, `cap_add`,
  `group_add`, widening `security_opt`, `env_file`, `extends`, `volumes_from`,
  `userns_mode`, `sysctls`, `cgroup_parent`, `runtime`, file-backed top-level
  `secrets`/`configs`) and requires bind sources to be **literal** paths under
  `${HOLA_APP_DATA}` — containment is proved against literal segments, so an
  interpolated suffix is unprovable and refused. `privileged` only WARNS: two
  shipped catalog apps (gitea, running-man) run dind sidecars. Then
  `materializeCompose` → `assertResolvedMountsContained` re-checks the
  configuration Compose actually resolved (`composeConfig`) against the app's
  data root plus the platform's own granted mounts, before `composePull`, and
  fails the deploy rather than creating containers. The platform's own
  injections (`hola-docker-proxy`, apps-data, restore-staging) are added
  **after** validation, so validator rules never apply to them — the
  deploy-time gate allows them only when the matching grant was consented to.
- **Deploy lifecycle is async.** `createFromDraft`/`promote`/`rollback` enqueue a
  job; the actual `docker compose up` runs later in `RealDeploymentService.runLifecycleJob`.
  Per-deploy work (auth provisioning, env injection) belongs there, not at create time.
- **Services use a Real/Mock pair** registered in `services/simple-factory.ts`
  (test/dev → Mock, production → Real). Follow that convention for new services.
- **Catalog → deploy.** The **only** catalog is the remote one at
  [`try-hola/apps`](https://github.com/try-hola/apps) (the default
  `HOLA_CATALOG_URL`). There is **no bundled/built-in catalog** in this repo —
  `RealCatalogService` fetches the remote `catalog.json`; app compose/manifest
  live in OCI bundles pulled via `oras`. Per-app metadata (incl. the `auth`
  block) comes from the bundle `manifest.json`, not `catalog.json`. The catalog
  is empty when `HOLA_CATALOG_URL` is unset/unreachable (no fake-app fallback).
  `MockCatalogService` (test env) is an empty catalog; tests inject their own
  stub when they need catalog data.
- **Cross-app integration (ADR 0002).** An app declares capabilities in its
  manifest `consumes` array and the server reconciles a generic primitive at
  deploy time — never per-app/format-specific logic. `app-registry` → the server
  writes `registry.json` (installed apps) into the app's data root on app-set
  change (a bundle bolt-on renders it, e.g. Homepage's dashboard). `apps-data` →
  the server injects a **read-only** identity mount of the apps root
  (`materializeCompose` → `compose-mounts.ts`), granting a trusted app (e.g. the
  `backrest` backup app) read access to all app data. `apps-data` is **no longer
  requestable this way** (see F06 below) — ADR 0004 §4 made it the provider grant
  of `backup@1`, and a manifest still declaring it is refused at install;
  `app-registry`, which publishes a feed into the app's own data root and grants
  nothing cross-app, is unaffected.
- **Capability contracts (ADR 0004; cardinality + container-logs in spec 004).**
  A contract names a two-sided integration: a **provider** performs it
  (`provides`), **acceptors** opt in to being a subject (`accepts`). Acceptor
  participation is a **list** — an app with two stateful services declares two
  participations, each with its own `id` and hooks (`backupParticipations()` in
  `@hola/shared/contracts` is the one reader; a legacy singular `backup` block
  normalises to one participation named `default`). A contract has **one
  provider per host**, enforced at `createFromDraft` before any state is
  created (`assertProviderAllowed`); a second install providing an
  already-provided contract is refused (`PROVIDER_EXISTS`), and a legacy pair
  is flagged (`providerConflict`) rather than auto-resolved. Every contract
  declares a **participation mode** — `declared` (`auth@1`, `backup@1`,
  `push@1`) or `implicit` (`container-logs@1`: every non-provider install is a
  subject by virtue of running, nothing to accept). `container-logs@1` is the
  first app-provided **provisioned** contract: on consent, materialisation
  injects a redacting Docker-API proxy sidecar (`hola-docker-proxy`, run from
  the server's own image) plus `DOCKER_HOST` into the provider's compose,
  exposing container list/logs/events and a field-redacted inspect only — never
  the raw socket. Every app container also carries `sh.hola.app`,
  `sh.hola.deployment`, `sh.hola.name` labels (`applyPlatformDefaults`) so a
  collector groups logs by app with no per-app configuration. **Consent freezes
  the privilege, not just the ref (#496).** `createFromDraft` records both the
  consented refs (`grantedContracts`) and the `ProviderGrantKind`s they implied
  at consent time (`grantedPrivileges`); materialisation grants
  `resolveGrantKinds` — the live table's kind for each consented ref
  **intersected with** the recorded set — so changing a shipped contract's
  `providerGrant` cannot widen an existing install (the new kind is dropped and
  warned about, naming the deployment, the ref and both kinds). A record
  carrying refs but no privileges is pre-#496 and is backfilled once from
  today's table, then held. A privilege reaches a container by exactly two
  routes — consented (`grantedPrivileges`) or migrated-legacy
  (`legacyGrantedPrivileges`, F06); a manifest alone is never one of them.
- **The legacy apps-data declaration is not a self-service grant (F06).**
  `materializeCompose` had a compatibility branch honouring ADR 0002's
  `consumes: apps-data` straight off the active manifest, so **any** bundle —
  including one installed today — could take a read-only identity mount of the
  whole apps root from one manifest line, with nothing shown to the operator but
  a server-side `warn`. That root holds every app's data root *and* the sibling
  `.hola/<id>/` environment records, which carry secrets (#478), so this was
  cross-app credential access on self-declaration. The shim's own comment named
  the condition for its deletion ("once the catalog has shipped `provides:
  backup@1`"), which the catalog now meets — but deleting it outright would
  silently un-mount a backup app installed *before* that, and a backup that
  quietly stops covering things is the failure the contract model exists to
  prevent. So the behaviour is kept and the **self-service** removed, in three
  parts. (1) `createFromDraft` **refuses** a new install whose finalized manifest
  declares the capability (`LEGACY_CAPABILITY_REFUSED`), naming `backup@1` —
  refused rather than silently unmounted for the same reason
  `GRANT_CONSENT_REQUIRED` refuses: an app that asks for cross-app data and is
  quietly given none looks healthy and protects nothing. (2) A **one-shot
  migration** (`migrateLegacyAppsDataGrants`, shaped after #496's backfill) runs
  at the first rehydration after the upgrade — the deployments in the map at that
  instant *are* the pre-existing ones — and stamps each qualifying record with
  `legacyGrantedPrivileges: ['apps-data']`. It is fenced by a persisted marker
  (`config/legacy-apps-data-migration.json`) written **before** any record is
  touched: the fence, not the per-record condition, is what stops a `promote`
  onto a legacy-declaring release from being stamped on a later boot (`promote`
  has no consent step of its own), and marker-first is the fail-closed order — a
  crash costs an install its mount (loud, recoverable) rather than handing out
  privilege. (3) Materialisation grants the legacy route only on `stamp ∩ what
  the active release still declares`, so it **decays**: once the app runs a
  release declaring `provides` instead, consent is the only way back in. The
  privilege is surfaced for the first time as
  `DeploymentContracts.legacyGranted`, rendered as its own "Legacy grants" row on
  the detail page — deliberately never folded into "Grants", because nobody
  consented to it.
- **Auth/SSO (Authentik).** `ProvisionerService` (`services/core/provisioner.ts`)
  provisions per-app auth at deploy time for three modes declared in the app
  manifest's `auth` block: `native-oidc` (env injection and/or a post-deploy setup
  command for CLI/DB-configured apps like Gitea), `forward-auth` (Traefik gate via
  Authentik's embedded outpost), and `native-ldap` (per-app bind accounts). The
  interface is platform-agnostic (an Authelia+LLDAP backend is tracked in #88). The
  server self-bootstraps a least-privilege scoped token from an admin bootstrap
  token. Authentik is the **default** — `hola init` always sets
  `HOLA_AUTH_MODE=authentik` (a compose profile); `none` remains an internal
  dev/test mode, not an install-time choice.
- **Secret-read authorization (F03).** Every unmatched GET names no capability —
  the operator model is "if you hold a key to this host, you may read it"
  (`authorizeRequest`) — but the env-bearing reads used to carry each app's
  database password in plaintext, so the read-only set an authenticated
  non-admin OIDC user gets was in practice full credential access. Reading
  configuration and reading credentials are now separate grants: `read:secrets`
  (held by `*`/admin, absent from `READONLY_CAPABILITIES`) gates the secret
  VALUES, enforced where the response is shaped rather than as a route
  capability, so the configuration view stays readable while the credentials do
  not. Three surfaces go through it — `GET /api/deployments/:id/config`,
  `GET /api/drafts/:id`, `GET /api/settings`'s `systemEnv` — via
  `canReadSecrets(req)` + `redactSecretEnvValues`, which blanks the value and
  sets `valueRedacted: true` (a genuinely empty secret is otherwise
  indistinguishable). The check is `principalHasCapability`, decided from the
  principal alone and deliberately NOT `AuthService.hasCapability`: both
  implementations blanket-allow when auth is off, which would make the rule
  unobservable in exactly the configurations a test can construct. `valueRedacted`
  is also a WRITE-side instruction — the merge reads it as "no new value
  supplied" and keeps the stored secret (`hardenAppEnv`/`mergeAppEnv`;
  `restoreWithheldEnvValues` for the full-replace `systemEnv` PATCH) — because
  the read and the write are the same rows, so redacting an editable surface
  would otherwise turn the next save into a secret-wiping write.
- **Cookie mutations prove same-origin intent (F04).** Apps live at
  `<app>.<HOLA_BASE_DOMAIN>` and the dashboard at `HOLA_DOMAIN`, which are
  **same-site, not same-origin** — so `SameSite=Strict` on the admin-key
  session cookie never stopped a compromised app page from posting to the API
  with the operator's cookie attached, and a `text/plain` POST is CORS-simple
  (no preflight, no response header that can stop the mutation executing). The
  rule keys on **how the request authenticated**, never on "is this a
  mutation": `resolveCredential` (middleware/auth.ts) is the one place the
  credential's `source` is decided — `header` (`Authorization`/`X-API-Key`),
  `cookie`, or dev-only `query` — and `createOriginGuardMiddleware`
  (middleware/origin-guard.ts, ahead of the auth middleware so it also covers
  the public `POST /api/auth/logout`) refuses a **mutating** request whose
  source is `cookie` unless `Sec-Fetch-Site` is `same-origin`/`none`, `Origin`
  is present AND names a trusted host, and the `Content-Type` is
  `application/json` or `multipart/form-data` (the draft upload route). Trusted
  = `HOLA_DOMAIN` ∪ `HOLA_TRUSTED_ORIGINS` ∪ **the request's own `Host`** — the
  last makes the rule work unconfigured without failing open, because comparing
  `Origin` to the `Host` it was addressed to *is* the same-origin check and a
  sibling app's origin never equals the dashboard's host. Header-authenticated
  callers (CLI, SDK, contract-broker `curl` from catalog containers) pass
  through untouched and are never asked for an `Origin`; reads are out of scope
  (SSE is a cookie-authenticated `GET`). The cookie is `__Host-hola_session`:
  the prefix (which requires `Secure`, `Path=/`, no `Domain`) is what stops a
  sibling subdomain *setting* it, since cookies scope by domain, not origin. The
  pre-F04 name is never read, only expired. There is deliberately **no CSRF
  token** — it would duplicate a check the browser already makes unforgeably and
  would not address the cookie's value being the reusable admin key itself
  (opaque server-side sessions, #525).
- **Bundles are not claimed verified unless they were (F05).** `verifySignature`
  used to run `cosign version` and return `{ verified: true }` — it never
  checked a signature, identity, key or digest, and its one admission was a
  **debug** line. The failure mode was **inverted**: cosign *absent* →
  `verified: false` → `required` failed closed; cosign *present* →
  `verified: true` → `required` passed having verified nothing. Installing
  cosign, exactly the remediation an operator performs when `required` starts
  failing, is what converted a safe error into a false pass, so the posture
  degraded the more diligent the operator was. A boolean also cannot express
  "nothing was checked", and that conflation *was* the bug: the outcome is now a
  three-state verdict (`bundle-signature.ts`) — `verified` (a signature over
  **this manifest digest** matched the configured trust root), `unsigned` (a
  determinate negative: no signature the trust root accepts), `unverifiable` (no
  trust root, no resolvable digest, cosign missing, registry unreachable — never
  success). Verification is pinned to `<repo>@sha256:…`, never the mutable tag.
  There is deliberately **no default trust root** (`HOLA_SIGNATURE_TRUST_KEY`, or
  `HOLA_SIGNATURE_TRUST_IDENTITY` + `_ISSUER`): a hardcoded key or identity would
  look like verification while proving nothing about who signed. The gate now
  runs on the **cache hit** as well as the fresh pull — the old placement meant
  tightening the policy on a host with a warm cache enforced nothing (the cache
  path was never "trusts file presence": it re-resolves the remote digest and
  re-pulls when stale; the gap was that policy was never *evaluated*). Provenance
  follows the `.oras-digest` precedent — `.signature-verdict.json` beside the
  bundle, **only ever a `verified` verdict**, reused only while both the bundle's
  digest and the trust material's fingerprint (the key's **content**, so an
  in-place rotation invalidates it) are unchanged; a negative is re-evaluated
  every pull and can never go stale into a false refusal. Policy meaning:
  `none` = nothing attempted, `optional` (default) = report and warn but never
  block, `required` = only `verified` installs. Said plainly: **the only catalog
  signs nothing**, so `optional` today gates exactly like `none` and `required`
  refuses every install — the honest fail-closed outcome, not a startup refusal
  (the setting only affects pulls, and taking the host down would remove
  start/stop/logs/backup for apps already installed; `required` is also
  satisfiable in principle, so refusing to boot would forbid the correct
  configuration too). The stock image still ships **without** cosign: no longer
  because it is harmful, but because there is nothing signed for it to check.
  An unrecognised `HOLA_SIGNATURE_POLICY` resolves to `required`, not the
  default — it used to be a blind cast that behaved as `optional`, so a typo
  downgraded the host silently. The one other place the product *said*
  "verified" was the catalog-source badge — `CatalogSourceTrust = 'verified' |
  'custom'` is a provenance label ("Hola's own catalog") that predates any
  signature work, so the dashboard now renders it as **first-party** (wire value
  unchanged). Catalog signing is #527; surfacing the verdict beyond the server
  log is #528.
- **Destructive transitions prove they are safe, and one deployment runs one
  operation at a time (F09 + F10).** These are one fix, not two. F09's gaps were
  each a destructive step taken without the proof it needed: the data-aware
  rollback **discarded `composeDown`'s result entirely** and then wiped the data
  root (the comment directly above it asserted the invariant the code did not
  enforce); uninstall logged `compose down reported a failure … continuing with
  teardown` and went on to remove the storage tree and the app data root; and
  `restoreTarGzInto` was `rm -rf dest` → `mkdir` → `tar -xzf`, destroying the
  destination **before** anything proved the archive extracts. But a
  point-in-time check is worth nothing while a second job can act on the same
  deployment: adding the missing `composeDown().success` check only moves the
  window, because a concurrent `start` can bring the containers back up between
  the check and the wipe. So F10 is the other half. **Serialization lives in the
  job queue**, partitioned by `deploymentId` (`DeploymentLocks` in `jobs.ts`):
  `tick()` skips — rather than waits on — a job whose deployment is busy, so one
  app's work never overlaps while other apps keep running in parallel up to
  `maxConcurrency`. A global lock would pass a naive serialization test and
  destroy fleet throughput, which is why `work for a DIFFERENT deployment still
  runs in parallel` is a test on both sides of the fix. Work that **bypasses the
  queue** — `deleteDeployment`'s in-line teardown, `promote`'s pre-upgrade
  capture, which runs the app's `backup@1` preHooks in its live containers —
  takes the same lock through `jobService.runExclusive`. **Queue vs reject is
  per-action, deliberately:** `start`/`stop`/`restart` name no release and
  destroy nothing, so they queue; `promote`/`rollback`/`delete` are decided
  against a release pointer or a data set the in-flight job is about to change,
  so they refuse with `409 DEPLOYMENT_BUSY` (`details.code`, same shape as
  `PROVIDER_EXISTS`/`ALREADY_INSTALLED`) rather than silently re-aiming. Restore
  is now **staged**: extract into a platform-owned scratch dir, assert non-empty,
  rename the original aside, land the new tree, and only then drop the original —
  failure at any point leaves the data exactly as it was. That scratch dir is
  deliberately **not** `HOLA_RESTORE_STAGING_ROOT` (spec 008): that one is a
  *writable mount handed to a catalog container*, and putting the single
  surviving copy of an operator's data root inside a third-party app's mount
  mid-swap is the opposite of the isolation it exists to provide. Since
  teardown now refuses, **force removal is a separate explicit operation** —
  `DELETE /api/deployments/:id?force=true`, `hola uninstall --force`, and a
  "Force remove" the dashboard offers *only after* a stop-failure refusal — or a
  wedged container would have converted a data-loss bug into an unremovable
  deployment. Force skips the busy check and does **not** wait for the lock (a
  stuck job holds it forever, which is the situation force exists for).
- **A snapshot that was never taken is now a refusal, not a log line (#524).**
  Two *individually defensible* best-effort behaviours composed into silent data
  loss: `promote` warned-and-continued when an explicitly requested
  `snapshot: true` capture failed (fail-closed applied only to the packager's
  `preUpgradeBackup: required`), and `restoreAppDataSnapshot` then found nothing,
  restored nothing, and let the job report **`completed`**. The operator asks for
  a snapshot and silently gets none; later asks for a data-aware rollback,
  silently gets none, **and is told it succeeded.** Both halves are closed: a
  requested snapshot that fails now fails the promote (operator-visible change —
  `snapshot: true` is *this operator's* instruction for *this* upgrade, not the
  packager's default for everyone), and a rollback with no snapshot for its
  target fails the job. "No app data to capture" is a third, legitimate outcome
  and is now **recorded** (`meta.json` with `empty: true`) rather than being
  indistinguishable from "never captured" — the two have opposite correct
  behaviours at restore time. The intermittent CI failure this was diagnosed
  from had a **different** root cause in the same neighbourhood, and it is fixed
  too: `rollback()` enqueued the job **before** `promoteRelease` moved the
  pointer, and `runLifecycleJob` resolves the release to materialize from that
  pointer — a footrace the job won under CI load, re-materializing and re-marking
  the release being rolled *away from*. The promote now happens first (matching
  `createFromDraft`/`promote`), and a second, independent guard in
  `runLifecycleJob` refuses when a job's recorded target release is no longer the
  active one, so reverting the ordering yields a failed job rather than a lie.
- **Startup recovery reconciles before it resumes (F11).** `ensureStarted` did
  the two halves of crash recovery in the wrong order: it re-enqueued every
  `pending` job first — and `enqueue` calls `tick()` **synchronously**, so those
  jobs were dispatched and wrote themselves `running` on the spot — then asked
  the DB for "everything still `running`" and failed the whole set as restart
  orphans. The set it got back contained the jobs it had just resumed, so an
  install that was proceeding normally was reported `failed` with `Interrupted
  by server restart` while its executor ran, and kept that error onto the row
  when it later completed. Both snapshots are now taken **before** anything is
  scheduled, which is what makes "still `running`" mean "left running by the
  process that died"; `started` is raised in the same synchronous step as the
  first `enqueue`, so nothing dispatches into a half-reconciled table and a
  resumed executor re-entering `ensureStarted` short-circuits instead of
  deadlocking on the promise it is running inside. The boolean guard was also
  set only *after* the awaits, so every concurrent caller on a cold service ran
  recovery again — three entry points racing resumed the same job three times —
  and is now one shared in-flight promise (the `ensureLoaded`/`loadPromise`
  pattern from `deployment.ts`). That promise is **not** cached past settlement:
  only `db.initialize()` can reject it (recovery itself warns and continues, as
  before — housekeeping must not make the queue unusable for new work), and the
  next caller retries rather than inheriting a permanently rejected promise.
  Resumed jobs go through the same `enqueue(id, deploymentId)` as fresh ones, so
  F10's per-deployment partition applies unchanged. Completion now clears the
  `error` column on the same write as the status (`markCompleted`), stating the
  invariant "a completed job carries no failure reason" rather than patching the
  one case that broke it. The deployment-side half — a record left `installing`
  by the crash, which only `runLifecycleJob` ever clears — is **not** here: the
  job service sits below the deployment service and cannot reach a deployment
  record. That is #542.
- **The backup API is reads only, because that is all this host can do (F12).**
  `POST /api/backups` answered 200 with a freshly minted `jobId`/`backupId` and
  `DELETE /api/backups/:id` with `{ ok: true }`, neither having called a
  service — no job, no archive, no deletion. The `jobId` was the sharp end: it
  named a job `GET /api/jobs/:id` has never heard of, so polling automation
  waits forever on a backup that was never started, which is strictly worse
  than an error. There was nothing to route them to and there will not be in
  this shape — Hola **brokers** backups rather than performing them, and
  `backup@1` is provider-initiated by design (ADR 0004: the server never calls
  an app), so "command a capture" is not a verb the architecture has. So both
  were **deleted**, not stubbed with a 501: a 501 promises a route that is
  coming, and pointing a documented endpoint at a refusal is how a caller ends
  up writing automation against it anyway. The route, the types
  (`CreateBackupRequest`/`CreateBackupResponse`/`DeleteBackupResponse`), the
  `API_ENDPOINTS` documentation and the client affordances went together —
  `createBackup` in `useBackupsApi` (already wired to nothing, and one import
  from being a button again) and the row's Delete control — following spec
  008's deletion of the equally fictitious backup-restore stub (#504, #484).
  The two **reads** were already honest (a genuinely empty list; an id that can
  never resolve) and are asserted on both sides of the change so the fix cannot
  take them with it. `getRequiredCapability`'s `write:backups` rows survive the
  routes on purpose: they are where this host records that a backup mutation is
  privileged, and without them the generic mutating-method default would guard
  a future real implementation with `write:deployments`. Surfacing the
  provider's own snapshots — with real verbs — is #160.
- **The web typecheck checks files now (F13).** `packages/web`'s `typecheck`
  script ran `tsc --noEmit`, which resolves `tsconfig.json` — a
  **references-only** file with `"files": []`. A bare `tsc` does **not** traverse
  project references (only `tsc -b` does), so the command loaded zero files,
  exited 0, and had done so for the whole life of the package; `vite build`
  transpiles without typechecking, so nothing else covered it. 167 diagnostics
  were standing behind the empty gate. The command is now **explicit per
  project** — `tsc --noEmit -p tsconfig.app.json && … tsconfig.node.json && …
  tsconfig.test.json` — rather than `tsc -b`, because build mode wants
  `composite: true` on every referenced project and composite has historically
  fought `noEmit`, and a second config that *looks* like it checks and does not
  is the same defect in new clothes. The **environment split** is the other half:
  tests lived under `src/__tests__`, inside `tsconfig.app.json`'s `include`, so
  they were typed as browser code with no Node or vitest globals — 63 of the 167
  were just `Cannot find name 'global'`/`'process'`. The application project now
  **excludes** test files and pins `"types": []`, so a stray `process` in a
  component is still an error (it does not exist in a browser, and `@types/node`
  hoisted into the workspace root would otherwise silently supply it); the new
  `tsconfig.test.json` extends it and adds `["node", "vitest/globals"]`.
  Application sources reach the test program only as *imports*, never as root
  files, so the strict browser-only project stays the one that judges them.
  Guarded isomorphic reads that genuinely want Node when it is there go through
  `utils/runtime-env.ts` (`globalThis.process?.env`), which puts the absence in
  the type instead of asserting it away. The app project also pulls `sdk` and
  `shared` **source** in through path mapping, so it catches cross-package type
  errors those packages' own checks cannot — `sdk`'s `me()`/`logs()` returned
  `unknown`, and `shared/src/docs` evaluated a bare `process.env.NODE_ENV` at
  module top level in a barrel the browser bundle imports. The meaningful
  measurement is that the check **fails on a deliberate error**, not that it
  passes.
- **Release channels (ADR 0005).** A catalog `versions[]` entry may carry a
  `channel` (default `stable`) — a catalog-index attribute, not a manifest one.
  A version is eligible on channel `c` iff its own channel is `c` or `stable`
  (`stable` is the floor every channel includes). The channel enters at draft
  creation and rides the finalized manifest onto the deployment; the
  single-instance guard (#246) is per app **and** channel, with the permitting
  reason (`channel` vs `operator-override`) recorded and shown. **Operator
  model (spec 005, ADR 0005 §7).** Discovery of non-stable channels (catalog
  pill, wizard radio, list filter) is gated by a host setting,
  `settings.channels.showPrerelease` (default off), read through one shared
  fail-closed web hook — turning it off never changes what channel an
  installed copy follows. A copy's followed `channel` (the track) and its
  running build's `versionChannel` (derived on read, not persisted) are
  distinct facts shown together; Join/Leave are just the existing `PATCH
  { channel }` behind a confirm dialog (Join requires enrolment, Leave never
  does). A same-app conflict at install time returns a structured
  `ALREADY_INSTALLED` (`details.code`, same `CONFLICT` top-level shape as
  `PROVIDER_EXISTS`) so the wizard/CLI render a choice instead of a
  surface-neutral message the caller has to parse.
- **Restore-on-install (spec 007).** At install, an operator may name an
  existing deployment of the same app on this host as a restore source
  (`CreateDraftRequest.restoreFrom`, catalog path only — install-by-ref
  refuses it, `RESTORE_NOT_SUPPORTED`, since there's no catalog upgrade
  metadata to judge the candidate's version against). The choice is resolved
  and validated once at draft creation (seeding `appEnv` via the existing
  `mergeUpgradeAppEnv` three-case rule when configuration is carried) and
  re-validated at `createFromDraft`, because the candidate may have changed
  since. The restore itself runs inside `runLifecycleJob`, after
  `composePull` and before `composeUp` — never at create time (Constitution
  III): assert the target data root is empty, quiesce and capture the source
  with the existing `backup@1` pre/post hooks, extract into the target
  (root-relative, no intermediate copy), assert the payload landed (a
  post-condition, not a subtree search — this codebase's archives are
  root-relative on both ends), apply the app's declared `discard` paths,
  rewrite the install-identity marker, write pending OIDC credentials (moved
  here from its usual pre-restore position so extraction can't destroy it),
  start only the declared hook's service with `composeUp({ services, wait:
  true })`, and run the restore hook fail-closed. A failed restore fails the
  whole install — no partial-success start. An app declares how it wants to
  be restored per **backup participation** (`restore` block in the bundle
  manifest, reusing `AppBackupHook` verbatim — no second hook format): no
  `restore@1` in `accepts` means not offered; `accepts: ["restore@1"]` with no
  block means a plain file copy is sufficient; a block adds `discard` paths
  (a live database's file-level copy is a smear across the capture window,
  not a snapshot) and a reload hook. `hola install --restore-from <id|latest>`,
  with `--restore-list` reading the same candidates route with no draft
  created; the non-interactive default is always **no restore** — a candidate
  existing is never itself consent to use it. Spec 007 shipped `restore@1` as
  a participation marker with no provider, grant or broker endpoint
  (`CONTRACTS` unchanged) — **superseded by spec 008** below, which promotes
  it to a real, brokered contract now that a provider role and its grant
  machinery exist to act on one.
- **restore@1, the provider half (spec 008).** `restore@1` is a real,
  brokered, app-provided `CONTRACTS` entry (`providerKind: 'app'`): the
  acceptor side is unchanged from spec 007 (the `restore` block, byte-for-byte
  the same manifests), and a new provider side lets a backup provider (e.g.
  Backrest) serve captures of apps that no longer exist on this host — the
  actual disaster-recovery case a local-only restore can't cover. The
  provider consents to a **new, sibling privilege** — `restore-staging`, a
  writable mount of ONE platform-owned scratch directory
  (`HOLA_RESTORE_STAGING_ROOT`, sibling of the apps root, never a descendant)
  — deliberately a new contract ref rather than a second grant bolted onto
  `backup@1`, because a grant's *kind* resolves live from `CONTRACTS` while
  consent is recorded per *ref*: widening an existing ref's grant would
  silently re-privilege every already-consented install (ADR 0006). All
  communication is provider-initiated (the server never calls an app): the
  provider publishes a metadata-only snapshot index
  (`POST /api/contracts/restore/index`, replaced wholesale each publish,
  discarded on uninstall or consent revocation) and polls
  (`GET .../requests`) for restore requests the server queues — each with a
  server-minted destination under the staging root, claimable exactly once
  (`POST .../requests/:id/claim`) and reported complete or failed
  (`POST .../requests/:id/complete`); a claimed-but-unreported request expires
  on a persisted deadline (default 30 min), failing the install rather than
  hanging. `performRestoreOnInstall` splits into **acquisition** (steps 1-4,
  origin-specific: the local path is unchanged; the provider path creates and
  awaits the request, then must LOCATE the app root inside the delivered
  tree — a repository restore tool reproduces absolute paths, unlike this
  codebase's own root-relative archives, so a bounded search refuses
  (`RESTORE_SOURCE_UNLOCATABLE`) rather than guesses on zero or multiple
  matches — and rename-or-copy it into place) and **application** (steps
  5-10, origin-agnostic, reused verbatim from spec 007 — no second restore
  sequence). Candidates gain an origin-independent `candidateId` (a local
  deployment id, or `<providerDeploymentId>:<captureId>`), a `source`
  (`'deployment' | 'provider'`) and a `confidence` (`'marker'` from a read
  identity record, `'path'` inferred from the capture's location) — an
  inferred identity names the **installation** directory, never a catalog app
  id, requires its own acknowledgement, carries no configuration to restore,
  and is never auto-selected even as the only candidate. Restore coverage
  (`judgeRestoreCoverage`) is reported with its **own** vocabulary
  (`'undeclared' | 'copy-back' | 'incomplete' | 'restorable'`), independent of
  and never derived from backup coverage.

## Conventions

- **Branch + PR for changes** (don't push to `main`). PRs squash-merge; CI runs on
  PRs targeting `main` only. For stacked work, rebase each branch onto `main` after
  the parent merges (the repo squashes, so stacked branches need `git rebase --onto`).
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- PR bodies end with: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
- Versions across published packages are kept in sync (`web` is intentionally
  `0.0.0`/unversioned).

## Disposable-VM testing (Proxmox)

For end-to-end testing you can drive a **throwaway Proxmox VM** from inside the
devcontainer. VM lifecycle goes through the Proxmox REST API (the `bin/vm-*`
helpers); an optional `proxmox` MCP server is wired in `.mcp.json` but the scripts
cover everything. Use them like this:

- **Lifecycle** — prefer the `bin/` helpers (they also work for CI and have a
  `--dry-run` mode): `bin/vm-create` → `bin/vm-wait-ssh` → run tests →
  `bin/vm-destroy`. `bin/vm-test` runs the whole create→test→teardown loop.
- **SSH for on-VM work** — for setup/installs/CLI bootstrap/tests use `bin/vm-ssh
  -- <cmd>` (and `bin/vm-wait-ssh`). `vm-create` injects an ephemeral per-VM key
  via cloud-init and `vm-wait-ssh` writes a `~/.ssh/config` alias.
- **UI testing is headless** — `bin/vm-web-check` drives Chromium (Playwright)
  from the container against the dashboard URL (login + render assertions +
  screenshots). No in-VM desktop or VNC.
- **Full e2e (CLI + browser)** — the **`vm-e2e` skill** (`.claude/skills/vm-e2e/`)
  runs the whole loop: create VM → `hola bootstrap --host hola-vm-<id>` (the CLI's
  own SSH installer) → verify the stack → `bin/vm-web-check` →
  snapshot-on-fail / destroy-on-pass. Prefer it over hand-stitching the steps.
- **Deterministic regression suites** — `bin/vm-e2e-suite` asserts the whole
  single-app product flow on a `mode=none` VM. `bin/vm-catalog-test` installs
  **every** catalog app on one Authentik VM and verifies each comes up, using the
  shared per-app test in `bin/lib/app-test.sh` (the single source of truth for
  install→verify→[restart→stop]→uninstall). Both emit terse PASS/FAIL to stdout and
  capture per-app detail under `logs/` for drill-down.
- **Snapshot, don't lose a failure** — `bin/vm-snapshot` (or `bin/vm-test
  --keep-on-fail`) before destroying when a run fails and you want to inspect it.
- **Destroy is confirmed** — `bin/vm-destroy` requires interactive `yes` (or
  `--yes`/`FORCE=1`); every state change is audited to `logs/vm-actions.log`.
- **Secrets** come from `.devcontainer/mcp.env` (gitignored) or host env — never
  hard-code them; use a least-privilege Proxmox API token. Run `bin/mcp-setup`
  first to scaffold/validate the env and confirm the servers connect.

Full guide: `docs/MCP_VM_TESTING.md`.

## Where to read more

- `docs/MCP_VM_TESTING.md` — disposable-VM (Proxmox) e2e testing workflow.
- `docs/ARCHITECTURE.md` — system design and deployment lifecycle.
- `docs/OPERATIONS.md` — install, recovery, backup, SSO.
- `packages/compose/README.md` — the production stack, catalog, and Authentik setup.
- `docs/adr/` — architecture decision records (e.g. authentication).

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
`specs/008-restore-provider/plan.md`
<!-- SPECKIT END -->
