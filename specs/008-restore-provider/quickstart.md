# Quickstart: verifying restore@1 — the provider half

**Feature**: `specs/008-restore-provider` · **Baseline**: `main@03290b8`
**Builds on**: `specs/007-restore-on-install/quickstart.md` — every scenario there still applies unchanged
(spec 007's own regression suite is this feature's floor, not something it may weaken).

Every scenario below is numbered and individually citable. The **Mode** column:

| Mode | Meaning |
|---|---|
| **U** | Server/shared unit test, `bun --cwd packages/server test` (or `packages/shared`) — mocks or pure functions only |
| **U-fs** | Server unit test needing the **real-filesystem harness** — `RealStorageService` + `mkdtemp` + `HOLA_APPS_BIND_ROOT` + (new) `HOLA_RESTORE_STAGING_ROOT`. Copy `restore-on-install.test.ts:398-441`'s harness and add a second `mkdtemp` root for staging. Required wherever file modes, real mount rendering, or real directory layouts matter — `MockStorageService` discards file modes (#475) and `MockDockerService` starts no containers. |
| **VM** | Disposable VM — real Docker, real containers, a real (fabricated) provider driving the four endpoints via `curl`/a stub script. `bin/vm-e2e-suite` / the `vm-e2e` skill. **Not** in the default suite. |

> **A fabricated provider, not the real catalog bundle.** The catalog diff (contracts/manifest.md §2-3) is
> prepared, not submitted (FR-063), so no VM scenario here depends on a real `backrest` upgrade landing in
> `try-hola/apps`. Every VM scenario drives the four broker endpoints directly — a small script playing the
> provider's role — which is sufficient to prove the platform half end to end and is exactly what a real
> poller would do once it exists.

**Scenarios marked ★ HIGHEST VALUE** are the ones singled out in the plan: each proves a property whose test
could pass for the wrong reason if written carelessly, mirroring spec 007's own "a test that passes either way
tests nothing" standard (its scenario 22).

---

## 0. Prerequisites

```bash
bun install
bun run typecheck && bun run lint && bun run typecheck && bun run test && bun run build
```

Typecheck twice — CLAUDE.md's own note: CI has caught a typecheck regression a lint auto-fix introduced after
the first run.

---

## 1. Contract promotion and the marker's deletion

| # | Scenario | Mode | FR/SC covered |
|---|---|---|---|
| 1 | ★ **The carve-out deletion actually takes effect.** Exercise the real manifest-coercion path (`coerceAccepts`, not a hand-built `DeploymentContracts` fixture) with a bundle manifest declaring `accepts: ["restore@1"]`, and assert it resolves to a real `CONTRACTS` entry with a provider/acceptor shape. Then, as a build-time regression guard, temporarily reintroduce the deleted `isParticipationMarker` carve-out in `coerceRefs` and confirm this exact test **fails** — a test that passes with the carve-out either present or absent tests nothing, which is verbatim the failure mode that shipped spec 007 inert (`574d89b`) past 1,133 passing tests. | U | FR-002, FR-003 |
| 2 | `PARTICIPATION_MARKERS`, `RESTORE_PARTICIPATION_REF`, `isParticipationMarker` no longer exist as exports of `@hola/shared/contracts` (a compile-time check: importing them is a type error). | U | FR-002 |
| 3 | `restore@1` appears in `GET /api/contracts`'s rollup for the first time, with a `providers`/`acceptors`/`unaffiliated` split; before this feature the ref was entirely absent from the rollup response. | U | FR-001, SC-014 |
| 4 | Every catalog manifest fixture that declares `accepts: ["restore@1"]` today (with or without a `restore` block) still resolves identically post-promotion — same `discard`/`hook` behaviour, zero manifest edits (spot-checked against the five hook-declaring apps' fixtures from spec 007). | U | FR-005, FR-006 |
| 5 | An app accepting `backup@1` with no `restore@1` in `accepts` reports `unaffiliated` for `restore@1` in the rollup, never `acceptors` — asserted for a fixture representative of the thirteen catalog apps in exactly this position, including the provider app itself accepting only `backup@1`. Acceptance is never derived: flip only the `backup` block's presence, not `accepts`, and confirm the `restore@1` row is unchanged. | U | FR-006a, SC-014, SC-015 |
| 6 | With zero restore providers installed, an app's local-deployment restore (spec 007's path) completes exactly as it did before this feature shipped — installing a provider is never a precondition. A second app declaring `provides: ["restore@1"]` while one is already installed and consented is refused with the same `PROVIDER_EXISTS`-shaped conflict `backup@1` already gets, via the unmodified `assertProviderAllowed`. | U-fs | FR-007, FR-008, SC-001, SC-013 |
| 7 | A contract-scoped token minted for an app declaring `provides: ["restore@1"]` carries capability `contract:restore`, produced by the same generic `contractCapability(ref)` that mints `contract:backup` — no new branch in `contract-tokens.ts`. | U | FR-009 |

---

## 2. The staging grant

| # | Scenario | Mode | FR/SC covered |
|---|---|---|---|
| 8 | `ProviderGrantKind` includes `'restore-staging'`; `injectWritableMount(compose, { hostPath })` appends `<hostPath>:<hostPath>` (no `:ro`) to every service's `volumes`, deduped, leaving compose with no services unchanged. | U | FR-010 |
| 9 | `restoreStagingRoot()` reads `HOLA_RESTORE_STAGING_ROOT` when set (trailing slashes trimmed), else defaults to `/srv/hola/restore`; the server issues no `mkdir`/`ensureDir` call against it anywhere. | U | FR-011, FR-012, FR-013, FR-020 |
| 10 | ★ **An upgraded-but-unconsented provider gets no writable mount.** Materialise a deployment whose manifest declares `provides: ["backup@1", "restore@1"]` but whose persisted `grantedContracts` contains only `backup@1`, over the real-filesystem harness. Assert the rendered compose carries the `apps-data` read-only mount and **contains no `/srv/hola/restore` volume entry at all**. Then materialise the same deployment WITH `restore-staging` in `grantedContracts` and confirm the mount now appears — proving the assertion is discriminating, not vacuously true. | U-fs | FR-014, SC-003 |
| 11 | A provider consented to `restore-staging` receives the writable staging mount and **nothing else new**: its rendered compose gains no write access to `<appsBindRoot>` itself and no write access to any deployment's own data root (only the pre-existing `apps-data` read-only mount, if separately granted, appears for those). | U-fs | FR-011, SC-004 |
| 12 | **Sibling contract, not a `backup@1` grant.** With `restore@1` present in `CONTRACTS` (post-promotion), a deployment consented **only** to `backup@1` — never to `restore@1` at all — still gets no `restore-staging` mount on materialisation, even though `grantsInclude` resolves grant kinds live from the table. This is the regression `research.md` R3 exists to prevent: a shared-grant design would make this test fail. | U-fs | FR-015 |
| 13 | Declining (or never being asked for) the `restore-staging` consent leaves the provider's `backup@1` behaviour — its `apps-data` mount, its `prepare`/`finalize` broker cycle — entirely unchanged; assert the broker end to end still runs a full prepare→capture→finalize cycle with no restore consent present. | U-fs | FR-017 |
| 14 | `docs/adr/0006-*.md` exists, documents the writable-mount primitive, and is referenced from the Constitution-check discussion of Principle V (a file-presence + section-heading check, not a behavioural test). | U | FR-018 |
| 15 | The **capture staging** directory (spec 007's per-deployment `deployments/<id>/restore-staging/data.tar.gz`, renamed) and the **restore staging root** (`HOLA_RESTORE_STAGING_ROOT`) never collide: assert their resolved paths are always disjoint (one under the server's `holaDir`, one an independently configured host path), and that no code path threads a value from one into the other. | U | FR-019 |

---

## 3. The request queue

| # | Scenario | Mode | FR/SC covered |
|---|---|---|---|
| 16 | `POST .../index` replaces the calling provider's index wholesale: publish two entries, then publish one; the store afterward holds exactly the one from the second call, not a union of both. | U | FR-022, FR-024 |
| 17 | The publish request/response bodies carry only the fields `RestoreIndexEntry` declares (id, time, size, location, identity) — no field of any shape could carry a byte stream; asserted by exhaustively listing the type's own keys, not by a runtime size check. | U | FR-022, SC-002 |
| 18 | A published index entry round-trips every field data-model.md §3b declares, including a **present** identity record and, separately, a **null** identity (no record found). | U | FR-023, FR-048 |
| 19 | The index survives a process restart: publish, tear down and rebuild the storage service over the same on-disk directory, and read the same entries back. | U-fs | FR-025 |
| 20 | Uninstalling the provider deployment discards its index entirely — a subsequent candidates lookup for any app shows zero provider-origin candidates. | U-fs | FR-025a |
| 21 | Revoking only the `restore@1` grant (provider stays installed, `backup@1` untouched) also discards the index — distinguishing this from scenario 20's full uninstall. | U-fs | FR-025a |
| 22 | The poll response's `destination` for a newly created request is always the server-minted path beneath the staging root; a claim/complete call that attempts to pass its own `destination` value in the body has that value ignored (the persisted record's own value is what's used). | U | FR-026, FR-027 |
| 23 | Claim is exactly once: two concurrent claim calls against the same `pending` request — one returns `{ ok: true }`, the other `RESTORE_REQUEST_ALREADY_CLAIMED`, distinguishable from `RESTORE_REQUEST_NOT_FOUND`. | U | FR-028 |
| 24 | `complete { outcome: 'completed' }` on a claimed request transitions it to `completed`; `complete { outcome: 'failed', reason }` transitions it to `failed` and the waiting install fails without ever calling `composeUp` for the app's own services. | U-fs | FR-029, SC-007 |
| 25 | A `claimed` request whose provider never calls `complete` transitions to `expired` once its deadline passes on the **next read** (no timer required to have fired), and the waiting install fails naming the provider as unresponsive (`RESTORE_PROVIDER_UNRESPONSIVE`). | U | FR-030, FR-031, SC-006 |
| 26 | Simulate a server restart mid-wait: construct a fresh service instance over the same on-disk `restore-broker.json`, with no in-memory reference to the original request object, and confirm the deploy-job-equivalent poll still observes the correct terminal state (or correctly detects expiry) purely from the persisted record. | U-fs | FR-031a, FR-031b |
| 27 | The default deadline is 30 minutes from creation; `HOLA_RESTORE_REQUEST_TIMEOUT_MS` overrides it, following `restoreRequestTimeoutMs()`'s exact fallback behaviour as `prepareTimeoutMs()`'s. | U | FR-031c |
| 28 | `brokerActivity()`'s real override reports **both** `backup@1`'s activity (byte-identical to its pre-feature output, given identical broker-state input) and `restore@1`'s own (`lastPrepareAt`/`lastFinalizeAt`/`openSince`/`lastFinalizeWasExpiry` derived from `restore-broker-state.ts` per data-model.md §5) from one call, with several restore requests open at once. | U | FR-031d, SC-016 |
| 29 | Each of the four provider routes has its own `middleware/auth.ts` capability row; a request to any of the four with no token, or with a non-contract token, is rejected before reaching the service layer. | U | FR-032 |
| 30 | A token minted with capability `contract:backup` only receives 403 on all four restore routes; a token minted with `contract:restore` only receives 403 on `/api/contracts/backup/prepare` and `/api/contracts/backup/finalize`. | U | FR-033 |
| 31 | Polling with no index published for the calling provider returns `reindex: true` and an empty `requests` array; this never triggers any outbound call — asserted by confirming no HTTP client/fetch is invoked anywhere in the poll handler's call graph. | U | FR-021, FR-034, SC-005 |
| 32 | Two requests created for two concurrent installs of the same app receive two distinct `destination` paths under the staging root; writing a marker file into one directory does not make it visible under the other. | U-fs | FR-035, SC-016 |
| 33 | A request reported `completed` whose `destination` directory is empty on disk is **not** treated as a successful restore — the server's own post-condition check (data-model.md §8, application phase) still fires and refuses. An absent `destination` (never written at all) is likewise refused, not silently skipped. | U-fs | FR-036 |
| 34 | The request's `destination` directory is removed after both a successful and a failed restore; a cleanup failure (simulate an `rm` error) is logged but does not change or mask the restore's own success/failure outcome. | U-fs | FR-037 |
| 35 | Revoking the provider's `restore@1` consent after a request is created but before it is claimed renders that request unservable — a subsequent claim attempt against it is refused (not silently left `pending` forever). | U-fs | FR-038 |

---

## 4. Moving files into place

| # | Scenario | Mode | FR/SC covered |
|---|---|---|---|
| 36 | Once a request is `completed`, the exact same call sequence spec 007 uses from the payload post-condition onward — `dirHasContents` check, `discard` loop, `writeInstanceMarkers`, `writeOidcCredentialsFile`, service-scoped `composeUp({ services, wait: true })`, fail-closed restore hooks — runs against `targetAppRoot`, asserted via the same call-order spy spec 007's scenario 15/23 use. No second implementation of any of these steps exists anywhere in the provider path. | U-fs | FR-039, FR-042, SC-008 |
| 37 | When the staging root and apps root resolve to the same filesystem (both under one `mkdtemp` root in the harness), the handoff is a rename (assert via an `fs.rename` spy / inode-preservation check, not a byte-for-byte copy). | U-fs | FR-040 |
| 38 | When they are on different filesystems (simulate with a bind mount or a stub that reports `EXDEV` from `rename`), the handoff falls back to a recursive copy, and the job log contains a line stating the copy path was taken. | U-fs | FR-040 |
| 39 | ★ **Absolute-path subtree location (closes #486).** Deliver a directory tree into `destination` shaped the way a repository restore tool actually produces one — `<destination>/srv/hola/apps/<lost-deployment-id>/...` (an absolute host path reproduced under the destination), rather than root-relative the way this codebase's own tar archives are. Confirm the server locates the true app data root several levels down and completes the restore, proving spec 007's own root-relative assumption (its step-4 comment) was correctly NOT generalised to this origin. | U-fs | FR-041 |
| 40 | A delivered tree containing **two** directories that each independently satisfy the app-root shape check refuses with `RESTORE_SOURCE_UNLOCATABLE` rather than picking either; a delivered tree containing **zero** such directories refuses the same way. Both fail the install; neither starts the app. | U-fs | FR-041, SC-007 |
| 41 | A full database-backed provider-sourced restore on a VM: fabricate a provider that claims a request and delivers a tar-extracted, absolute-path-shaped tree containing a real Postgres dump; the restored app serves the dumped data, and the sequence includes a working reload hook exactly as spec 007's VM scenario 33 does for the local path. | VM | FR-041, FR-042, SC-001, SC-002 |

---

## 5. Candidates: origin, confidence, identifier

| # | Scenario | Mode | FR/SC covered |
|---|---|---|---|
| 42 | The candidates response mixes local-deployment and provider-origin candidates in the same `lineages` array; every candidate carries `source` and `confidence`, and a local candidate is always `source: 'deployment'`, `confidence: 'marker'`. | U-fs | FR-043, FR-044 |
| 43 | A local candidate's `candidateId` equals its `deploymentId` (back-compat, R18); a provider candidate's `candidateId` is the composite `<providerDeploymentId>:<captureId>` and its `deploymentId` field is **absent** from the response entirely. | U | FR-043a |
| 44 | Three captures of the same lost installation (same recovered `installName`, three different `takenAt` values) group into one lineage, newest first, with no change required to `groupIntoLineages` itself — same function, same call, wider input. | U | FR-043b |
| 45 | ★ **A stale (pre-this-feature) client never renders a provider candidate as a local one.** Simulate old client logic — `candidates.find(c => c.deploymentId === selectedId)` — against a response containing only provider-origin candidates and confirm it finds nothing (never a false match, never a crash), which is the actual mechanism FR-045 relies on rather than a client-version check. | U | FR-045 |
| 46 | A provider-origin candidate newer than the version being installed is refused `RESTORE_SOURCE_NEWER`, and one requiring an unacknowledged environment carry-forward is refused `RESTORE_ACK_REQUIRED` — the identical refusal vocabulary and codes spec 007 established, exercised against a provider source for the first time. | U | FR-046 |
| 47 | With no restore provider installed, and separately with one installed but not consented to `restore@1`, `GET /api/apps/:appId/restore-candidates` returns a response byte-identical to spec 007's pre-this-feature shape (field-for-field, including the absence of `source`/`confidence` being impossible since local candidates now always carry them — confirm this addition alone doesn't change any *local* candidate's other field values). | U-fs | FR-047, SC-013 |

---

## 6. Inferred identity

| # | Scenario | Mode | FR/SC covered |
|---|---|---|---|
| 48 | A published index entry with `identity: null` is still returned by the candidates route (for every `appId` queried, per data-model.md §6b), labelled `confidence: 'path'`. | U | FR-048, SC-009 |
| 49 | The path-inference rule is applied exactly as documented: a `location` whose last segment matches `<slug>-[0-9a-f]{8}` yields `installName: <slug>`; a `location` whose last segment does not match that shape yields no `installName` at all (still offered, still `confidence: 'path'`, but with nothing to display as a name beyond the raw location). | U | FR-049 |
| 50 | An inferred `installName` that happens to equal a real catalog app id is **not** treated as that app's identity anywhere: it never appears in the `app` field as anything but the queried `appId` (data-model.md §6b), never satisfies the skew check in place of a known `appVersion` (skew stays `unknown`, requiring acknowledgement, even when `installName` superficially matches), and never marks `hasIdentityRecord: true`. | U | FR-050, SC-010 |
| 51 | Selecting a `confidence: 'path'` candidate without `restore-inferred-identity` in `RestoreChoice.acknowledge` is refused `RESTORE_ACK_REQUIRED` naming that code; supplying it proceeds. | U | FR-051 |
| 52 | Selecting a `confidence: 'path'` candidate with `carryEnv: true` still carries forward **no** configuration (there is none recorded), and the response/refusal explicitly states why rather than silently proceeding with an empty carry. | U-fs | FR-052 |
| 53 | ★ **An inferred-identity candidate is never the default, even alone.** With exactly one lineage present and its sole candidate `confidence: 'path'`, `defaultCandidateId` is `null` and `requiresExplicitChoice` is `true` — the single-lineage default rule (unchanged in `groupIntoLineages`) is explicitly suppressed by the caller for this case, proven by asserting the SAME lineage input with the candidate instead marked `confidence: 'marker'` DOES produce a non-null default, isolating suppression to the confidence field alone. | U | FR-052a, SC-017 |

---

## 7. Coverage verdict

| # | Scenario | Mode | FR/SC covered |
|---|---|---|---|
| 54 | An app accepting `restore@1` whose every recognised-database participation has a matching, hook-bearing `restore` declaration judges `'restorable'`. | U | FR-053, FR-053a |
| 55 | An app accepting `restore@1` with zero recognised-database participations judges `'copy-back'` — asserted as a genuinely **complete** verdict (not merely "not incomplete"), distinct in meaning from backup's `'as-is'` even though structurally parallel. | U | FR-053a |
| 56 | An app with two recognised-database participations where only one has a hook-bearing `restore` declaration judges `'incomplete'`; a declaration with `discard` but **no** `hook` does not count as covering its participation (mirrors `judgeBackupCoverage`'s pre-hook-only counting rule). | U | FR-054 |
| 57 | An app accepting `backup@1` only (no `restore@1`) judges `restoreCoverage: 'undeclared'` while its `coverage` (backup) judges `'quiesced'` **simultaneously** on the same deployment — the two verdicts are independent, and the rollup shows both without either overwriting the other. | U | FR-053, FR-055, SC-011 |
| 58 | `judgeRestoreCoverage` contains no per-app or per-datastore name anywhere in its source (case-insensitive grep for catalog app names and specific datastore products), mirroring `judgeBackupCoverage`'s own purity. | U | FR-055 |

---

## 8. Retiring the fabricated surface, catalog gates, and documentation

| # | Scenario | Mode | FR/SC covered |
|---|---|---|---|
| 59 | `POST /api/backups/:id/restore` no longer matches any route (404 for any path shape that used to match); `RestoreBackupRequest`/`RestoreBackupResponse` no longer exist as exports of `@hola/shared`; a compile-time check that importing either is a type error replaces spec 007's old runtime "not imported" guard test. | U | FR-056, SC-012 |
| 60 | No element in the web dashboard's rendered Backups view is clickable and produces no effect — the restore-button call site and its hook method are gone entirely, not merely disabled. | U | FR-057 |
| 61 | `JobType`'s `'restore'` literal is confirmed to still exist (a deliberate non-removal, data-model.md §9b) and confirmed to be produced by **zero** code paths — no `type: 'restore'` job is ever created anywhere in the server, so the surviving UI label cases in `JobStatus.tsx`/`Dashboard.tsx` are unreachable dead code, not a live dishonest affordance. | U | FR-057 |
| 62 | The prepared catalog diff's `$defs/appProvidedContractRef` enum addition, `bin/validate-manifest.mjs`'s `appProvided` flag flip, and the prose update in both files are all present in the SAME prepared diff (reviewed as one unit, not staged separately) — checked against the diff artifact this feature's implementation phase produces, not against `try-hola/apps` directly (no PR is opened, FR-063). | U | FR-058, FR-063 |
| 63 | A fixture manifest declaring `provides: ["restore@1"]` validates against the prepared, not-yet-merged schema diff; the SAME fixture is rejected by today's unmodified `try-hola/apps` schema, proving the diff is load-bearing rather than redundant with what already validates. | U | FR-058, FR-059 |
| 64 | Attempting to name the restore provider's own deployment as the target of a restore choice for itself is refused (or, equivalently, the provider's own app never appears among its own candidates) — restoring the provider is out of scope and circular by construction (its own configuration holds the repository credentials that make its captures readable). | U-fs | FR-064 |
| 65 | Operator-facing documentation (the ADR and/or `docs/OPERATIONS.md`) states plainly that recovering onto a fresh host requires installing the provider and supplying the repository password, and that Hola never holds that secret; no UI copy anywhere claims otherwise (grep the wizard/CLI strings for any implication that recovery works without operator action). | U | FR-065 |
| 66 | `data-model.md` §1 and `plan.md`'s Constitution Check both record, in text, that spec 007's FR-047 ("`restore@1` is not a capability contract") is deliberately superseded and WHY the supersession is safe — the guard (`assertProviderAllowed`) and grant machinery (`grantsInclude`/`injectWritableMount`) spec 007 named as the precondition now exist. Checked by grepping this feature's own design docs for the required statement, since FR-004 is a documentation requirement rather than a runtime behaviour. | U | FR-004 |
| 67 | The `restore-staging` grant's consent-row `label`/`risk` strings are non-empty, contain no field/type/internal-symbol names (a lint-style check: no `camelCase` or `snake_case` tokens, no file paths), and are distinct from the `apps-data`/`container-logs` rows' copy — matching FR-016's "operator-facing terms, matching the plainness of the existing grant descriptions". | U | FR-016 |
| 68 | The prepared catalog diff (contracts/manifest.md §2) adds the poller as a **new** top-level component in the provider bundle — reviewed against the diff to confirm it does NOT add a clause to `backrest-hola-autowire`'s existing 30-second reconciliation loop and does NOT extend `backup-prepare.sh`'s once-per-snapshot invocation — and the diff's own comments state the reasoning `research.md` R16 records: the reconciler's subject is local configuration, and a failure reading it must not also stall restores. Separately, the diff's comments or `contracts/manifest.md` state why a poller is required at all rather than a hook: Backrest's hook conditions are snapshot-lifecycle only (`CONDITION_SNAPSHOT_START`/`_END`), with no restore-triggered condition to hang work on. | U | FR-060, FR-061, FR-062 |
| 69 | Every deferred item `research.md` R22 lists (the `grantsInclude` live-resolution sharp edge, the two broker stores' shared-but-unmerged read/update pattern, `brokerActivity()`'s hardcoded-key override, restoring-the-provider-is-circular) has a corresponding tracked issue linked from the PR, and the merged diff contains no inline `TODO`/`FIXME`/`XXX` marker introduced by this feature (grep 66 below covers the mechanical half; the issue-linking half is a PR-description check). | U | FR-066 |

---

## 9. Scope boundary greps

The mechanical form of the Principle V audit in `plan.md`, mirroring spec 007's quickstart §9 exactly. If any
of these ever matches, the design has regressed.

```bash
# 70. No app or datastore name has leaked into the platform's generic restore machinery.
grep -rniE "postgres|mealie|immich|gitea|paperless|backrest" \
  packages/server/src/services/core/restore-candidates.ts \
  packages/server/src/services/core/restore-broker-state.ts \
  packages/server/src/services/core/restore-index.ts \
  packages/shared/src/contracts.ts   # must be empty (FR-055's "no per-app special-casing")

# 71. The marker machinery is fully gone, not merely unused.
grep -rn "PARTICIPATION_MARKERS\|RESTORE_PARTICIPATION_REF\|isParticipationMarker" \
  packages/shared/src/contracts.ts packages/server/src/services/core/contracts.ts
  # must be empty (FR-002)

# 72. The coerceRefs carve-out is gone — no `role === 'accepts'` special-case for any ref remains.
grep -n "isParticipationMarker\|accepts.*continue" \
  packages/server/src/services/core/contracts.ts   # must be empty (FR-003)

# 73. The dead restore surface is gone.
grep -rn "RestoreBackupRequest\|RestoreBackupResponse" packages/  # must be empty (FR-056)
grep -n "backups/:id/restore\|backups\\.restore\|backupByIdMatch.*restore" \
  packages/server/src/server.ts packages/shared/src/index.ts    # must be empty

# 74. No captured application byte ever appears in a type this feature sends over HTTP.
grep -n "Buffer\|ArrayBuffer\|base64\|binary" \
  packages/shared/src/index.ts | grep -i restore   # must be empty (FR-022, SC-002)

# 75. The two staging directories are never the same identifier.
grep -rn "restore-staging" packages/server/src/services/core/deployment.ts | grep -v "capture-staging\|capture staging"
  # every hit must be spec 007's renamed local variable/comment, never the new env var or accessor name

# 76. No inline deferred-work marker was introduced (FR-066 — deferred work becomes issues, never inline notes).
git diff main -- packages/ | grep -E "^\+.*\b(TODO|FIXME|XXX)\b"   # must be empty
```

---

## Coverage

All **76 functional requirements** and all **17 success criteria** appear at least once above.

| Group | Scenarios | FR range |
|---|---|---|
| Contract promotion & marker deletion | 1–7 | FR-001–009 |
| Staging grant | 8–15 | FR-010–020 |
| Request queue | 16–35 | FR-021–038 |
| Moving files into place | 36–41 | FR-039–042 |
| Candidates: origin, confidence, identifier | 42–47 | FR-043–047 |
| Inferred identity | 48–53 | FR-048–052a |
| Coverage verdict | 54–58 | FR-053–055 |
| Retiring the surface, catalog gates, docs | 59–69 | FR-004, FR-016, FR-056–066 |
| Scope boundary greps | 70–76 | structural |

**The four scenarios called out as highest value** (★ above) each guard against a specific way this feature
could ship looking correct while doing nothing:

- **Scenario 1** — the carve-out deletion. This is the identical failure shape that shipped spec 007 inert
  (`574d89b`): a table row added while the thing that short-circuits it stays in place is invisible to every
  test that builds fixtures directly. Reintroducing the carve-out and watching the test fail is the only way to
  know the test is actually exercising the deletion.
- **Scenario 10** — the upgrade-without-consent mount. This is SC-003's entire content, and the one place a
  single missing `&&` in `grantsInclude`'s call site would silently hand a provider a host-wide writable mount.
- **Scenario 39** — absolute-path subtree location. This is issue #486 by name: spec 007's own extraction logic
  assumes root-relative archives, which is true of every archive this codebase produces and false of what a
  restic/borg-shaped repository tool delivers. A test built against a root-relative fixture (the easy fixture
  to write) would pass while the real integration fails on day one.
- **Scenario 53** — the inferred-identity default suppression. The dangerous failure here is silent: a
  single-lineage default is exactly the case an operator is most likely to accept without reading closely, and
  it is the one case where accepting a **guess** about identity would look identical to accepting a **known**
  fact. Proving suppression is isolated to `confidence` alone (by flipping only that field on identical input)
  is what rules out the test accidentally passing because of some other property of the fixture.

Requirements verified only on the VM path — FR-041 (also covered in U-fs, scenario 39/40) and FR-042 (also
covered in U-fs, scenario 36) — both have a non-container scenario covering their filesystem-only half, so
neither is untested in the default suite. SC-002 (no captured bytes through the API) is checked twice on
purpose, once as a type-shape assertion (scenario 17) and once structurally (grep 70), because it is the
criterion a shape-only check could satisfy by accident if a future field were added carelessly.
