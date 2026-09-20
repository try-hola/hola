# Quickstart: verifying Restore-on-Install

**Feature**: `specs/007-restore-on-install` · **Baseline**: `ca3d3f4`

Every scenario below is numbered and individually citable, so a task in
`tasks.md` can say "implements scenario 14" and a reviewer can check it. The
**Mode** column says how each is verified:

| Mode | Meaning |
|---|---|
| **U** | Server unit test, `bun --cwd packages/server test` |
| **U-fs** | Server unit test needing the **real-filesystem harness** — `RealStorageService` + `mkdtemp` + `HOLA_APPS_BIND_ROOT`. Copy `install-markers.test.ts:116-142` or `snapshot.test.ts:99-125`. |
| **W** | Web test, `cd packages/web && npx vitest run` |
| **C** | CLI test, `cd packages/cli && npx vitest run` |
| **VM** | Disposable VM — needs real Docker, real containers, a real database. `bin/vm-e2e-suite` / the `vm-e2e` skill. **Not** in the default suite. |

> **Why so many U-fs.** `MockStorageService` discards file modes (issue #475) and
> `MockDockerService` starts no containers, so anything asserting on real files or
> real ordering has to use the real harness. This is the same constraint spec 006
> hit; the harness is copy-paste, not new work.

---

## 0. Prerequisites

```bash
bun install
bun run typecheck && bun run lint && bun run test && bun run build
```

For VM scenarios, see `docs/MCP_VM_TESTING.md` and the `vm-e2e` skill. Use an app
with a database for anything exercising discards or hooks — **mealie** is the
cheapest (one Postgres, one app container, a declared healthcheck on both).

---

## 1. Candidate discovery

| # | Scenario | Mode | Covers |
|---|---|---|---|
| 1 | With one installed copy of an app holding data, the candidates route lists exactly that copy, described by name, address, version, `carriesEnv` and `capturedAt`. | U-fs | FR-001, FR-002, US1-AC1 |
| 2 | A candidate's description comes from its `.hola/instance.json`; with that file deleted it is **still listed**, described from the deployment record, with `hasIdentityRecord: false` and `lineageId` falling back to the deployment id. | U-fs | FR-003 |
| 3 | A deployment whose data root holds **only** `.hola/` is not listed. (This is the ignore-list rule — without it every install looks like it has data.) | U-fs | FR-004 |
| 4 | A deployment that is deploying, promoting or in `error` is not listed; the same deployment once `running` or `stopped` is. | U-fs | FR-004a |
| 5 | Three candidates across two lineages: grouped by lineage, newest-first within each, `defaultCandidateId: null` and `requiresExplicitChoice: true`. With all three in one lineage, the newest is the default. | U | FR-005, FR-036 |
| 6 | The candidates route answers with no backup provider installed and no grant consented anywhere on the host. | U-fs | FR-006, SC-001 |
| 7 | An app with no other copies returns `200` with `lineages: []` — not `404`. | U | FR-042 |

---

## 2. Entering the choice

| # | Scenario | Mode | Covers |
|---|---|---|---|
| 8 | `restoreFrom` on `POST /api/drafts` is accepted on the catalog path; the same body on the install-by-ref path is **refused** with `RESTORE_NOT_SUPPORTED`. | U | FR-007, FR-048 |
| 9 | `PatchDraftRequest` still rejects `restoreFrom`, and finalize still takes no body. | U | FR-007 |
| 10 | With `carryEnv: true`, the draft's `appEnv` carries the candidate's values; a key the new release declares that the candidate lacked **and** that has a `generate` recipe is freshly minted; a new key without one rides through to be surfaced by name. (The three-case rule.) Assert the carried values **equal** the source's, which is SC-003. | U-fs | FR-008, SC-003, US2-AC1, US2-AC2 |
| 11 | The finalized manifest carries `restoreFrom` **outside** `canonicalSpec`: two finalizes differing only in `restoreFrom` produce the **same** checksum. | U | FR-009 |
| 12 | After `createFromDraft`, the deployment record carries `restoreFrom` and `lineageId`. The deploy job payload is unchanged — still `{ releaseId, action }`. | U | FR-010 |
| 13 | A fresh install's `lineageId` equals its own id; a restored install's equals the candidate's. Confirm by reading `.hola/instance.json` after each. | U-fs | FR-011, SC-007 |
| 14 | A restored deployment sets `restoredAt`. A subsequent restart, promote and rollback each leave the data root untouched and quiesce nothing. | U-fs | FR-012 |

---

## 3. Executing the restore

| # | Scenario | Mode | Covers |
|---|---|---|---|
| 15 | The restore runs after `composePull` and before `composeUp`. Assert on call ordering through the Mock docker service. | U | FR-013 |
| 16 | A target data root that already holds app data aborts with `RESTORE_TARGET_NOT_EMPTY`. A root holding only `.hola/` proceeds — the marker is not app data. | U-fs | FR-014 |
| 16a | A candidate deleted, or moved out of a settled state, between the draft and the deploy job fails the install with `RESTORE_CANDIDATE_GONE` / `RESTORE_CANDIDATE_BUSY` — the job re-resolves rather than trusting the draft. | U-fs | FR-013a |
| 17 | The source's pre-hooks run before the capture, its post-hooks run after, and after the restore the source's data, status and address are unchanged and it is still running. | VM | FR-015, SC-006, US1-AC5 |
| 18 | After a restore the target data root holds the source's files. With the archive emptied, the install fails with `RESTORE_PAYLOAD_EMPTY` rather than reporting success. **No subtree search** — the post-condition is the mechanism (research R9). | U-fs | FR-016 |
| 19 | The staging archive lives under the **target** deployment, not the source, and is gone after both a successful and a failed restore. It never appears in the source's snapshot listing. | U-fs | FR-016a, SC-013 |
| 20 | Every `discard` path is removed before any container starts. A path resolving outside the data root (`../`, an absolute path, a symlink out) **refuses** the restore. | U-fs | FR-017, US4-AC1, US4-AC4 |
| 21 | After a restore, `.hola/instance.json` describes the **new** install — its `deploymentId`, `name` and `host` — while its `lineageId` is the source's. The source's record does not survive. | U-fs | FR-018, SC-007 |
| 22 | **The OIDC ordering trap.** With auth provisioned and a restore requested, `oidc.json` exists in the data root after the restore. Run the same install with the write left at its old position to confirm the test actually fails — a test that passes either way tests nothing. | U-fs | FR-019, SC-008 |
| 23 | `composeUp` with `{ services: ['db'], wait: true }` issues `up -d --wait db` and starts nothing else. `MockDockerService` **records** the services and wait flag. | U | FR-020 |
| 24 | A hook service that never becomes healthy fails the install with `RESTORE_HOOK_FAILED`; no other service is started. A restore hook exiting non-zero does the same. | VM | FR-021, US3-AC5, US4-AC3 |
| 25 | Every restore failure leaves a **failed install** — never a running app on an empty or half-restored root. | U-fs | FR-022, SC-004, US3-AC6 |
| 26 | A failed restore leaves the deployment in `error` with its data root intact, and that deployment is then absent from the candidates list. | U-fs | FR-022a |
| 27 | **The regression guard.** With no `restoreFrom`, the deploy job's calls and their order are identical to `main`'s — including `writeOidcCredentialsFile`'s original position. | U | FR-023, SC-009 |
| 28 | An end-to-end restore of a database-backed app: install mealie, add a recipe, install a second copy restoring from the first, and see the recipe in the second. Read back an item stored under a platform-generated secret to prove SC-003 end to end. | VM | US1-AC2, SC-002, SC-003 |

---

## 4. The app's declaration

| # | Scenario | Mode | Covers |
|---|---|---|---|
| 29 | A `restore` block keyed by participation id drives discards and the hook for that participation. An app with two participations restores both. | U-fs | FR-024, FR-027, SC-010 |
| 30 | `accepts: ["restore@1"]` with **no** block restores by plain file copy: files land, nothing is discarded, no hook runs. An app declaring nothing is not offered at all. | U-fs | FR-025, US4-AC5 |
| 31 | The restore hook uses `AppBackupHook`'s shape verbatim; no second hook type exists in `shared`. | U | FR-026 |
| 32 | Every current catalog manifest validates unchanged against the extended schema; a manifest with a `restore` block validates. | U | FR-028 |
| 33 | A real Postgres restore: discard the captured `PGDATA`, let `initdb` run clean, load the dump. The app serves the dumped data. | VM | FR-017, US4-AC1, US4-AC2 |

---

## 5. Refusals and warnings

| # | Scenario | Mode | Covers |
|---|---|---|---|
| 34 | A candidate **newer** than the target refuses with `RESTORE_SOURCE_NEWER`. **This is the rule `checkUpgradePath` cannot express** — assert directly that `checkUpgradePath(newer, older, meta)` returns `ok`, so the test documents why the rule is stated independently. | U | FR-029, US3-AC1 |
| 35 | A guarded older→target hop refuses with `RESTORE_UPGRADE_PATH` and surfaces `suggestedVersion`. | U | FR-030, US3-AC2, SC-005 |
| 36 | Equal versions, and older-with-a-clean-path, both proceed. | U | FR-031 |
| 37 | An unknown candidate version proceeds **only** with `restore-version-unknown`; without it, `RESTORE_ACK_REQUIRED` naming that code. | U | FR-032, US3-AC3 |
| 38 | With no environment record, the warning names exactly the keys that are `isSecret` **and** carry a `generate` recipe — not every secret, not every generated value. | U-fs | FR-033, US2-AC3 |
| 39 | With `requiresEnv: true` and no environment record, the restore is **refused** (`RESTORE_ENV_REQUIRED`), not warned. | U | FR-034, US3-AC4 |
| 40 | Name and subdomain default from the candidate; changing the subdomain produces a `host-divergence` warning naming both. | U | FR-035, US1-AC1 |
| 41 | Every refusal carries `details.code`; every version refusal that has a next step carries `suggestedVersion`. | U | FR-037, SC-005 |
| 42 | A required acknowledgement code that is absent fails the create with `RESTORE_ACK_REQUIRED` — the same shape as a missing `grant`. | U | FR-037a, FR-046 |
| 43 | Declining to carry configuration that **is** available still produces the named warning and still requires the acknowledgement. | U-fs | FR-033, US2-AC4 |

---

## 6. Wizard

| # | Scenario | Mode | Covers |
|---|---|---|---|
| 44 | The restore step renders at index 0, before Configuration. | W | FR-038 |
| 45 | Changing the restore choice deletes and re-creates the draft, resetting consent — the `switchChannel` pattern. | W | FR-039 |
| 46 | Carried values render as ordinary `appEnv` rows through the existing mask/reveal component, with no separate widget. | W | FR-040 |
| 47 | Any restore shows the acknowledgement on the summary step, naming data **and credentials** and the fact that jobs, webhooks and integrations may fire on start. | W | FR-041, US2-AC5 |
| 48 | With no candidates the step says so and Next is enabled. | W | FR-042 |

---

## 7. CLI

| # | Scenario | Mode | Covers |
|---|---|---|---|
| 49 | `--restore-from <id>`, `--restore-from latest`, `--no-restore` and `--restore-list` each behave as specified; `latest` refuses across two lineages. | C | FR-043, FR-036, US5-AC2, US5-AC3 |
| 50 | An install with **no** restore flag performs no restore even when candidates exist. | C | FR-044, SC-012, US5-AC4 |
| 51 | Every refusal hint is built from `details`; with the message blanked and only `details` populated, the hint is still correct and still names the right flag. | C | FR-045, US5-AC5 |
| 52 | `--ack` parses repeated and comma-separated values exactly as `--grant` does. | C | FR-037a, FR-046 |
| 53 | **#429 closed**: one command produces a second independent copy of a running app holding its data, with the source untouched. | VM | SC-011, US5-AC1 |

---

## 8. Scope boundary

| # | Scenario | Mode | Covers |
|---|---|---|---|
| 54 | `CONTRACTS` is unchanged — still exactly `auth@1`, `backup@1`, `push@1`, `container-logs@1`. No new grant kind exists. No `/api/contracts/*` route changed. `JobType` gained nothing. | U | FR-047 |
| 55 | The pre-existing `POST /api/backups/:id/restore` stub and `RestoreBackupRequest` are untouched, and nothing in this feature imports them. | U | research R19 |
| 56 | A whole restore completes with no backup provider installed — `backrest` absent from the host entirely. | VM | FR-047, SC-001 |

---

## 9. Gate

```bash
bun run typecheck && bun run lint && bun run typecheck && bun run test && bun run build
```

Typecheck twice — CI has caught typecheck regressions that a lint auto-fix
introduced after the first run (CLAUDE.md `## Commands`).

### Scope-boundary greps

```bash
# No capability contract was added.
git diff main -- packages/shared/src/contracts.ts        # must be empty

# The dead restore stub was not touched.
git diff main -- packages/web/src/pages/Backups.tsx \
                 packages/web/src/hooks/useBackupsApi.ts # must be empty
grep -rn "RestoreBackupRequest" packages/server/src       # only the pre-existing stub

# No per-app branching in the server's restore path (Constitution V).
grep -rniE "postgres|mealie|immich|gitea|paperless" \
  packages/server/src/services/core/restore-candidates.ts # must be empty
```

That last grep is the mechanical form of the Principle V audit in
[plan.md](./plan.md). If it ever matches, an app's name has leaked into the
platform and the design has regressed.

---

## Coverage

All 53 functional requirements and all 13 success criteria appear at least once
above. SC-003 (carried configuration matches the source's) is verified twice on
purpose — once as an assertion inside scenario 10, and once end to end in scenario
28 — because it is the criterion whose failure is silent: an app with mismatched
secrets starts cleanly and shows its data. Requirements verified only on the VM path — FR-015, FR-021 — are the two
that need real containers and a real database; both also have a U-fs scenario
covering their non-container half, so neither is untested in the default suite.

| Group | Scenarios |
|---|---|
| Candidate discovery | 1–7 |
| Entering the choice | 8–14 |
| Executing the restore | 15–28 (incl. 16a) |
| App declaration | 29–33 |
| Refusals and warnings | 34–43 |
| Wizard | 44–48 |
| CLI | 49–53 |
| Scope boundary | 54–56 |
