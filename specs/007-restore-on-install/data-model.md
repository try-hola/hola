# Data Model: Restore-on-Install from a Live Deployment

**Feature**: `specs/007-restore-on-install` · **Baseline**: `ca3d3f4`

Every shape below is given with field, type, source expression, and nullability.
"Source expression" means *where the value actually comes from at runtime* — the
field that most often goes silently wrong is one whose source was never written
down (spec 006's `deployment.metadata.source` being the local precedent).

---

## 1. `RestoreChoice` — what the operator decided

Lives in `packages/shared/src/index.ts`. Created once at draft creation (R1),
carried on the draft → finalized manifest → deployment record, consumed once.

| Field | Type | Source | Null? | Notes |
|---|---|---|---|---|
| `candidateId` | `string` | operator selection; the candidate's **deployment id** | no | Not a lineage id. Identifies one source exactly. |
| `carryEnv` | `boolean` | operator selection | no | Explicit, never defaulted from candidate state — declining is a decision (FR-033/4). |
| `acknowledge` | `string[]` | operator selection | yes (absent = `[]`) | Acknowledgement codes (§3). Modelled on `grants` (R16). |

**Invariant.** `candidateId` must not equal the deployment being created — it
cannot, since the id is minted after the draft, but the guard is stated because
Sequence 6 may introduce ids that are not host deployments.

---

## 2. `RestoreCandidate` — a source the operator can pick

**Derived, never stored.** Computed on demand from deployments + identity records
+ catalog upgrade metadata. Returned by the candidates read route
([contracts/api.md](./contracts/api.md)).

| Field | Type | Source expression | Null? |
|---|---|---|---|
| `deploymentId` | `string` | `deployment.id` | no |
| `lineageId` | `string` | `identity.lineageId ?? deployment.lineageId ?? deployment.id` | no |
| `app` | `string` | `identity.app ?? deployment.app` | no |
| `name` | `string` | `deployment.name` | no |
| `subdomain` | `string \| null` | `identity.subdomain ?? deployment.subdomain ?? null` | yes |
| `host` | `string \| null` | `identity.host ?? null` | yes |
| `appVersion` | `string \| null` | `identity.appVersion ?? deployment.version ?? null` | yes |
| `channel` | `string \| null` | `identity.channel ?? deployment.channel ?? null` | yes |
| `carriesEnv` | `boolean` | `exists(<appsBindRoot>/.hola/<deploymentId>/env.json)` | no |
| `capturedAt` | `string \| null` | `identity.writtenAt ?? null` — ISO 8601 | yes |
| `hasIdentityRecord` | `boolean` | whether `.hola/instance.json` parsed | no |
| `skew` | `RestoreSkewVerdict` | §4 | no |
| `requiredAcknowledgements` | `string[]` | §3, derived | no |
| `warnings` | `RestoreWarning[]` | §5 | no |

**Why the deployment record is only a fallback** (FR-003): for *this* slice both
sources are present and the record alone would do. Reading the identity record
first is what makes the same resolver work unchanged when Sequence 6 replaces "a
live deployment" with "an archive", where the record is the *only* source. A
candidate whose record is absent or unparseable is still offered, described from
the record alone, with `hasIdentityRecord: false` and `lineageId` degrading to the
deployment id.

### Eligibility (FR-001, FR-004, FR-004a)

A deployment is a candidate **iff all** hold:

1. `deployment.app === <app being installed>`
2. `deployment.id !== <deployment being created>`
3. `deployment.status` is settled — `running` or `stopped`; **not** in flight,
   **not** `error`
4. `dirHasContents(appRootFor(deployment.id), [INSTALL_MARKERS_DIR])` is `true`

Rule 4's ignore-list is load-bearing and is not a new invention: without it every
materialised install looks like it holds data, because `writeInstanceMarkers`
writes `.hola/instance.json` on every deploy. The identical call already guards
`capturePreUpgradeSnapshot` at `deployment.ts:2513`, where omitting it was found
to be a data-loss path during spec 006's review.

### Ordering (FR-005, FR-036)

Group by `lineageId`; within a lineage sort by `capturedAt` descending (a null
`capturedAt` sorts last). A single matching lineage supplies a default selection;
**two or more distinct lineages require an explicit pick** and no default is
offered.

---

## 3. Acknowledgement codes

A closed union. The server computes which are *required* for a given candidate;
the client supplies them in `RestoreChoice.acknowledge`; a required-and-absent
code fails the create exactly as a missing `grant` does (R16).

| Code | Required when | What the operator is accepting |
|---|---|---|
| `restore-version-unknown` | `skew.kind === 'unknown'` | The version relationship could not be checked, so the app's own upgrade rules were not applied. |
| `restore-env-not-carried` | `carryEnv === false`, **or** `carriesEnv === false` | Platform-generated secrets will be minted fresh; data encrypted under the originals may be unreadable. |

**Both conditions map to one code for `restore-env-not-carried`** deliberately:
the operator-facing risk is identical whether configuration *cannot* be carried or
they *chose* not to carry it, and a second code would invite a UI that treats one
as less serious.

Codes are **not** required for a refusal — a refusal cannot be acknowledged away
(FR-029, FR-030, FR-034). Acknowledgement exists only for risks that are
proceedable.

---

## 4. `RestoreSkewVerdict` — the version relationship

```
{ kind: 'ok' }
{ kind: 'unknown' }                                     // acknowledgeable
{ kind: 'refused', code: RestoreRefusalCode,
  message: string, suggestedVersion?: string }
```

Evaluated in this order (R15). Note that **only rows 3 and 4 come from
`checkUpgradePath`**; rows 1 and 2 are this feature's own rules, because
`checkUpgradePath` returns `ok` for both:

| # | Condition | Verdict |
|---|---|---|
| 1 | `candidate.appVersion` absent, or target version absent, or no upgrade metadata | `unknown` → acknowledgeable |
| 2 | `isNewerVersion(candidate.appVersion, targetVersion)` | `refused`, `RESTORE_SOURCE_NEWER` |
| 3 | `checkUpgradePath(candidate.appVersion, targetVersion, meta)` returns `!ok` | `refused`, `RESTORE_UPGRADE_PATH`, carrying `suggestedVersion` |
| 4 | otherwise | `ok` |

Row 2 must be evaluated **before** row 3. `checkUpgradePath` short-circuits on
`!isNewerVersion(to, from)` and would return `ok` for the newer-source case,
letting it through.

### `RestoreRefusalCode`

Closed union, carried in `details.code` so surfaces build guidance from structure
rather than prose (FR-037, and `deploy-flow.ts:137-155`'s established rule).

| Code | Meaning | `details` also carries |
|---|---|---|
| `RESTORE_SOURCE_NEWER` | Candidate newer than the version being installed | `candidateVersion`, `targetVersion` |
| `RESTORE_UPGRADE_PATH` | The app's own rules guard this hop | `suggestedVersion` |
| `RESTORE_ENV_REQUIRED` | `restore.requiresEnv` and no environment record | `missingKeys[]` |
| `RESTORE_CANDIDATE_GONE` | Candidate deleted between choice and deploy | `candidateId` |
| `RESTORE_CANDIDATE_BUSY` | Candidate not in a settled state | `candidateId`, `status` |
| `RESTORE_TARGET_NOT_EMPTY` | Target data root already holds app data | `deploymentId` |
| `RESTORE_PAYLOAD_EMPTY` | Post-condition failed: nothing landed (FR-016) | `deploymentId` |
| `RESTORE_HOOK_FAILED` | A restore hook failed or its service never became healthy | `participationId`, `service` |
| `RESTORE_NOT_SUPPORTED` | `restoreFrom` supplied on the install-by-ref path | — |
| `RESTORE_NOT_ACCEPTED` | The target app declares no `restore@1` in `accepts` | `appId` |
| `RESTORE_ACK_REQUIRED` | A required acknowledgement code was absent | `required[]` |

**Create-time vs job-time.** Seven of these can be returned synchronously from a
draft-create or deployment-create call, so a client sees them in a `409` body.
Three cannot: `RESTORE_TARGET_NOT_EMPTY`, `RESTORE_PAYLOAD_EMPTY` and
`RESTORE_HOOK_FAILED` are only reachable **inside the deploy job**, long after the
request returned. They surface on the deployment's error state and in the job log,
never in a create response — which is why they are absent from the error tables in
`contracts/api.md` and from the CLI's hint mapping in `contracts/cli.md`. The
union is one union; the delivery channel differs. `RESTORE_CANDIDATE_GONE` and
`RESTORE_CANDIDATE_BUSY` are the two that occur in **both** places, because the
job re-resolves the candidate (FR-013a).

---

## 5. `RestoreWarning` — proceedable, named, non-fatal

```
{ code: 'env-not-carried', keys: string[] }   // the isSecret && generate keys
{ code: 'host-divergence', from: string, to: string }
{ code: 'no-identity-record' }
```

`env-not-carried.keys` is **derived, not declared** (FR-033): every `AppEnvVar`
(`shared/src/index.ts:903-958`) where `isSecret === true` **and** `generate` is
present. Those are values the *platform* invented and will mint fresh; anything
the operator supplied is theirs to re-supply knowingly. Deriving beats a manifest
field that an app author must remember to maintain and that silently rots.

---

## 6. Deployment record additions

On `EnhancedDeploymentDetail` (`shared/src/index.ts:2017-2076`), persisted with
the record. All optional, so every existing record on disk stays valid with no
migration.

| Field | Type | Source | Null? | Notes |
|---|---|---|---|---|
| `lineageId` | `string?` | `restoreFrom` ? candidate's `lineageId` : `deployment.id` | yes | **Reading it is the change spec 006 predicted.** `writeInstanceMarkers` becomes `deployment.lineageId ?? deployment.id` (`deployment.ts:3374`). The fallback is what makes this zero-migration: an older record reads `undefined` and yields exactly the value it always had. |
| `restoreFrom` | `RestoreChoice?` | the finalized manifest | yes | Persisted beside `channel` (`deployment.ts:1028`), **not** in the job payload (R3). |
| `restoredAt` | `string?` | set by the job on success — ISO 8601 | yes | Consumption marker. Its presence is what makes FR-012 enforceable: a restart/promote/rollback finds it set and skips. |

**Why the record and not the payload** (R3): the deploy payload is
`{ releaseId, action: 'deploy' }` (`deployment.ts:1193`) — `deploymentId` is a
sibling `Job` field, never a payload key, so the prompt's assumed shape does not
exist. More substantively, a payload does not survive a job retry, and
"has this install already restored?" is a fact about the deployment's history.

---

## 7. `AppRestoreDeclaration` — what an app says (manifest)

Per backup participation, keyed by participation id. Reuses `AppBackupHook`
verbatim (`shared/src/index.ts:295-298`). Full schema in
[contracts/manifest.md](./contracts/manifest.md).

| Field | Type | Null? | Notes |
|---|---|---|---|
| `id` | `string` | no | The **backup** participation id this restores. `default` for the legacy singular form, which `backupParticipations()` already normalises — and which is the form all five catalog apps use. |
| `discard` | `string[]?` | yes | Data-root-relative paths removed after extraction, before any container starts. Each resolved through `resolveContainedDir`; one that escapes refuses the restore (FR-017). |
| `hook` | `AppBackupHook?` | yes | `{ service, command }`. Run after discards, against the started-and-healthy service. |
| `requiresEnv` | `boolean?` | yes (default `false`) | `true` turns the no-environment-record **warning** into a **refusal** (FR-034). |

### The three declaration states (FR-025)

| Declaration | Meaning |
|---|---|
| No `accepts: ["restore@1"]` | Nobody has considered restoring this app. Not offered. |
| `accepts: ["restore@1"]`, no `restore` block | **"A plain file copy back is all I need."** Files land, nothing is discarded, no hook runs. |
| `accepts: ["restore@1"]` + a `restore` block | Discards and/or a hook apply. |

The middle state **already exists in the catalog**: 12 of 17 acceptor apps
declare `accepts` with no backup block today. This feature gives that shape
meaning rather than introducing it.

`restore@1` here names a *participation an app declares*, not a capability
contract the platform brokers. `CONTRACTS` (`contracts.ts:146-199`) gains no
entry — FR-047 holds.

---

## 8. Lifecycle of a restore

```
draft create ──> RestoreChoice validated (candidate resolved, skew judged,
                 acknowledgements checked) ──> appEnv seeded from the candidate's
                 env record via mergeUpgradeAppEnv

finalize ──────> restoreFrom rides OUTSIDE canonicalSpec, beside channel

createFromDraft ─> re-validated (the candidate may have changed), acknowledgements
                 enforced as grants are; restoreFrom + lineageId persisted

deploy job ────> if restoreFrom && !restoredAt:
                   assert target empty · re-resolve candidate · quiesce + capture
                   · extract · assert payload present · discard · rewrite marker
                   · write OIDC file · up --wait <hook services> · run hooks
                 then set restoredAt

later actions ─> restoredAt is set ⇒ skip. The restore is consumed exactly once.
```

**Two independent guards enforce FR-012**: the action must be the deployment's
first deploy, *and* `restoredAt` must be unset. Either alone would be enough in
the happy path; both together mean a retried job after a partial failure cannot
re-quiesce a live source.
