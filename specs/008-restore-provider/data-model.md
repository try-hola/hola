# Data Model: restore@1 — the provider half

**Feature**: `specs/008-restore-provider` · **Baseline**: `main@03290b8`
**Builds on**: `specs/007-restore-on-install/data-model.md` (all ten sections there are unchanged except where
noted in §6 and §9 below). Citations to `R<n>` are `research.md`'s Phase 0 decisions; `anchors-008.md` /
`seams-008.md` are the read-only sweeps those decisions were verified against.

Every shape below is given with field, type, source expression, and nullability — the convention spec 007
established, for the reason it gave: the field that most often goes silently wrong is one whose source was
never written down.

---

## 1. The `restore@1` contract — a `CONTRACTS` entry (R1, R2, R4)

Added to `packages/shared/src/contracts.ts`'s `CONTRACTS` array, in the same change that deletes the
participation-marker machinery (§9). Every field is a literal on the new table row — there is no runtime
computation here, which is the point: promoting the ref means the table now says the true thing.

| Field | Type | Value | FR |
|---|---|---|---|
| `id` | `string` | `'restore'` | FR-001 |
| `version` | `number` | `1` | FR-001 |
| `shape` | `ContractShape` | `'brokered'` — the provider asks the server and the server acts, exactly `backup@1`'s shape (R15) | FR-001 |
| `providerKind` | `ContractProviderKind` | `'app'` — an app fills this role; the platform's own local-deployment restore (spec 007) fills no role at all (R4) | FR-001 |
| `participation` | `'declared' \| 'implicit'` | `'declared'` — an acceptor opts in via `accepts`, unchanged from spec 007's marker | FR-001, FR-005 |
| `acceptorBlock` | `string?` | `'restore'` — the existing manifest key spec 007 already reads; its shape does not change (contracts/manifest.md §1) | FR-001, FR-005 |
| `providerGrant` | `ProviderGrant?` | `{ kind: 'restore-staging', label, risk }` — see §2 and contracts/grant.md for the copy | FR-010, FR-016 |
| `summary` | `string` | One line for the rollup, e.g. `"A held capture delivered into the staging root the platform nominates for a restoring install."` | — |

`formatContractRef` on this row yields `restore@1`, unchanged from the string every acceptor manifest already
writes (FR-006: zero manifest changes for existing acceptors).

**Why `providerKind: 'app'` and not `'platform'`.** Spec 007's restore has no second party — the server reads
one of its own deployments. That is not this contract's provider role; it is restoring with no provider
involved, which FR-007 requires to keep working unchanged. `providerKind: 'app'` means only a catalog app can
fill the role, which is what makes `assertProviderAllowed` (one-provider-per-host, FR-008) apply to it for
free — the guard already filters `provides` by `providerKind === 'app'` (anchors-008.md item 13.4).

**Generic machinery this ref rides for free, confirmed by the sweep (R1, seams-008.md item A/C):**

| Machinery | Where | Change needed |
|---|---|---|
| `parseContractRef` / `formatContractRef` | `shared/contracts.ts` | none — table-driven |
| `providerGrantsFor` / `missingGrantConsents` / `grantsInclude` | `shared/contracts.ts` | none — generic over `providerGrant.kind` |
| `contractCapability(ref)` → `contract:restore` | `server/services/auth/contract-tokens.ts:50` | none — `def ? \`contract:${def.id}\` : undefined` |
| `mintContractEnv` | `deployment.ts:2222-2237` | none — filters `readActiveGrantedContracts` by `shape === 'brokered'` |
| `assertProviderAllowed` | `deployment.ts:4534` | none — already filters `provides` by `providerKind === 'app'` |
| Web/CLI consent UI | `InstallWizard.tsx:1390-1414`, `install.ts` `--grant` | none — both iterate `providerGrantsFor(provides)` generically |
| `buildContractRollup` | `services/core/contracts.ts:145-222` | none — iterates the full `CONTRACTS` table already |

**Machinery that is NOT generic and must be extended (seams-008.md item A "not free" list, item B):**

| Machinery | Where | Change needed |
|---|---|---|
| `brokerActivity()` override | `deployment.ts:3038-3052` | hardcoded to one key (`BACKUP_CONTRACT_REF`); must return a second key for `restore@1`'s own request-store-derived activity, byte-identical output for the existing key (FR-031d) |
| Broker state store | none exists for restore | new `restore-broker-state.ts` (§5) |
| Routes + capability rows | `server.ts`, `middleware/auth.ts` | four new routes, four new capability rows (contracts/api.md, R17) |
| `materializeCompose`'s grant branches | `deployment.ts:2073-2103` | one new `if (grantsInclude(granted, 'restore-staging'))` branch (§2) |
| `compose-mounts.ts` | — | one new injector function (§2, R21) |

---

## 2. The staging grant

### 2a. `ProviderGrantKind` gains `restore-staging` (R3, R21)

`packages/shared/src/contracts.ts:99` — `export type ProviderGrantKind = 'apps-data' | 'container-logs' |
'restore-staging';`. A pure addition to a closed union; every existing switch/exhaustiveness check over this
type must account for it (typecheck will find them).

### 2b. `restoreStagingRoot()` — the accessor (R6)

New **private** method on `RealDeploymentService`, in the file and following the exact pattern of
`appsBindRoot()` (`deployment.ts:2635-2636`) — env override, hardcoded default, trailing slashes trimmed, no
`mkdir`.

| Field | Type | Source expression | Null? | FR |
|---|---|---|---|---|
| `DEFAULT_RESTORE_STAGING_ROOT` | `string` | literal `'/srv/hola/restore'` | no | FR-013 |
| `restoreStagingRoot()` return | `string` | `(process.env.HOLA_RESTORE_STAGING_ROOT?.trim() \|\| DEFAULT_RESTORE_STAGING_ROOT).replace(/\/+$/, '')` | no | FR-011, FR-012, FR-013 |

**Sibling, not descendant (FR-012).** `/srv/hola/restore` sits beside `/srv/hola/apps`
(`DEFAULT_APPS_BIND_ROOT`, `deployment.ts:139`), never under it — a provider whose own backup plan targets the
apps root must not capture its own restore output as a new "snapshot".

**Not created by the server (FR-020, R6).** No `mkdir`/`ensureDir` call targets this path anywhere in
`deployment.ts`, mirroring the confirmed absence for `appsBindRoot()` (anchors-008.md item 16). Documentation
(FR-020) states who provisions it, what ownership it needs, and that it must exist before the provider is
materialised or its writable mount resolves to a missing host path.

### 2c. `injectWritableMount` — the new compose-mounts injector (R21)

`packages/server/src/services/core/compose-mounts.ts`, beside `injectReadonlyMount`. Same shape — parse,
append to every service's `volumes`, dedupe, `stringify` — with one difference: **no `:ro` suffix**.

```ts
export function injectWritableMount(composeYaml: string, opts: { hostPath: string }): string {
  const mount = `${opts.hostPath}:${opts.hostPath}`; // read-write, identity-mapped — no `:ro`
  // … identical body to injectReadonlyMount otherwise
}
```

A **separate function**, not a parameter on `injectReadonlyMount` (R21): parameterising a security-relevant
mount helper with a read/write flag makes one function mean two things at the exact boundary where that is
least acceptable. `injectWritableMount` is called with `hostPath: this.restoreStagingRoot()` **only** —
never with any app's data root, never with the apps root itself (FR-011).

**Materialisation branch** (`deployment.ts` ~`2073-2103`, beside the existing `apps-data`/`container-logs`
branches):

```ts
if (grantsInclude(granted, 'restore-staging')) {
  content = injectWritableMount(content, { hostPath: this.restoreStagingRoot() });
}
```

`granted` is the same `readActiveGrantedContracts(deployment)` read already shared by the other two branches
(one read, three checks) — so an installed-but-unconsented restore provider (declared `provides` without a
recorded grant) takes neither this branch nor either of the others: **no writable mount, full stop** (FR-014,
SC-003). See contracts/grant.md for the consent-row copy and the upgrade-without-consent test.

---

## 3. Snapshot index (R13)

### 3a. `RestoreCaptureIdentity` — what the provider knows about one capture (new, shared)

```ts
export type RestoreCaptureIdentity = {
  app?: string;             // present only when read from an identity record inside the capture
  installName?: string;     // FR-050: the installation's directory-derived name — NEVER an app id
  lineageId?: string;
  appVersion?: string | null;
  channel?: string | null;
  subdomain?: string | null;
  host?: string | null;
  writtenAt?: string | null; // when the identity record ITSELF was written (spec 006), distinct from capture time
};
```

| Field | Source | Null? | FR |
|---|---|---|---|
| `app` | Parsed `.hola/instance.json`-shaped record found inside the capture, when present | yes (absent ⇒ the entry has no known app; see §6's app-matching rule) | FR-023, FR-048 |
| `installName` | Recovered from the capture's `location` when it matches the deployment-id shape `<slug>-[0-9a-f]{8}` (R19) — the **installation's** own directory name, not the catalog app | yes | FR-049, FR-050 |
| `lineageId`, `appVersion`, `channel`, `subdomain`, `host`, `writtenAt` | Read verbatim from the identity record, exactly the fields `RestoreIdentitySnapshot` already reads for a local deployment | yes | FR-023 |

### 3b. `RestoreIndexEntry` — one capture (new, shared)

```ts
export type RestoreIndexEntry = {
  captureId: string;   // provider-assigned, unique within its own index
  takenAt: string;     // ISO 8601 — when the capture was taken
  sizeBytes: number;
  location: string;    // opaque to the server; round-tripped back to the provider verbatim at delivery time
  identity: RestoreCaptureIdentity | null; // null ⇒ no identity record found at all (FR-048)
};
```

| Field | Source | Null? | FR |
|---|---|---|---|
| `captureId` | Provider-minted | no | FR-023 |
| `takenAt` | Provider-reported, from its own repository metadata | no | FR-023 |
| `sizeBytes` | Provider-reported | no | FR-023 |
| `location` | Provider-reported; the server never parses or interprets it — only stores it and hands it back on delivery | no | FR-023 |
| `identity` | Provider-reported, §3a | yes | FR-023, FR-048 |

### 3c. The index store — `config/restore-index.json` (R13, FR-024, FR-025, FR-025a)

New `restore-index.ts`, same `StorageService` read-modify-write shape as `BackupBrokerStateStore` (fail-open
read, warn-only write failure), but keyed by the **publishing provider's deployment id**, not a single record:

```ts
// config/restore-index.json
type RestoreIndexStore = Record<
  /* providerDeploymentId */ string,
  { publishedAt: string; entries: RestoreIndexEntry[] }
>;
```

| Operation | Behaviour | FR |
|---|---|---|
| Publish (`POST .../index`) | **Replaces** `store[providerDeploymentId]` wholesale — never merges | FR-024 |
| Read (candidates route, request creation) | `store[providerDeploymentId]?.entries ?? []` | FR-023 |
| Provider uninstalled, or its `restore@1` grant revoked | `delete store[providerDeploymentId]`, persisted immediately | FR-025a |
| Server restart | Read back from disk — no re-publish required | FR-025 |

The index is a **cache, never a promise** (Assumptions): it is not re-validated on read. A capture named in the
index but pruned from the provider's repository since publication fails at claim or delivery time, not at
listing time — the install then fails honestly (edge case, spec §Edge Cases).

---

## 4. Restore request

### 4a. `RestoreRequestRecord` — server-internal, persisted (R10, FR-031a)

New `restore-broker-state.ts`, modelled on `backup-broker-state.ts`: same `StorageService`-backed read/write/
update, same fail-open-to-`{}` read, same warn-only write failure, same fail-closed
"unparseable timestamp reads as expired" rule as `isPrepareExpired` — but keyed by **request id**, because
several requests are open at once (the property `BackupBrokerStateStore`'s single record depends on does not
hold here, R10).

```ts
// config/restore-broker.json
type RestoreRequestStore = Record</* requestId */ string, RestoreRequestRecord>;

interface RestoreRequestRecord {
  id: string;
  providerDeploymentId: string;   // the consented restore@1 provider that must serve this
  targetDeploymentId: string;     // the install waiting on it
  targetAppId: string;
  captureId: string;              // the chosen RestoreIndexEntry.captureId
  destination: string;            // absolute path under the staging root, server-minted
  status: RestoreRequestStatus;
  createdAt: string;              // ISO
  deadlineAt: string;             // ISO — createdAt + restoreRequestTimeoutMs()
  claimedAt?: string;
  completedAt?: string;
  failureReason?: string;         // set on 'failed' (provider-reported) or 'expired' (server-set, names the provider)
}
```

| Field | Source | Null? | FR |
|---|---|---|---|
| `id` | `crypto.randomUUID()`, server-minted | no | FR-031a |
| `providerDeploymentId` | The one deployment currently providing **and** consented to `restore@1` (looked up the same way `assertProviderAllowed`'s scan does) | no | FR-008, FR-021 |
| `targetDeploymentId`, `targetAppId` | The install performing the restore | no | FR-035 |
| `captureId` | The operator's `RestoreChoice.candidateId`, decomposed (§6c) | no | FR-026 |
| `destination` | `<restoreStagingRoot>/<requestId>/` — minted here, never by the provider; a destination the provider supplies or modifies is rejected | no | FR-027, FR-035 |
| `status` | See §4b | no | — |
| `createdAt`, `deadlineAt` | `deadlineAt = createdAt + restoreRequestTimeoutMs()` | no | FR-031c |
| `claimedAt`, `completedAt`, `failureReason` | Set at the matching transition | yes | FR-028, FR-029, FR-030 |

**Timeout** (R12, following `DEFAULT_PREPARE_TIMEOUT_MS`'s precedent verbatim):

```ts
export const DEFAULT_RESTORE_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;
export function restoreRequestTimeoutMs(): number {
  const raw = process.env.HOLA_RESTORE_REQUEST_TIMEOUT_MS?.trim();
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RESTORE_REQUEST_TIMEOUT_MS;
}
```

### 4b. Lifecycle states and legal transitions (FR-028, FR-029, FR-030, FR-031)

```
RestoreRequestStatus = 'pending' | 'claimed' | 'completed' | 'failed' | 'expired'
```

| State | Meaning | Entered by | FR |
|---|---|---|---|
| `pending` | Created, minted a destination, not yet claimed | Request creation (inside the deploy job, Constitution III) | FR-026, FR-027 |
| `claimed` | Exactly one provider owns it | `POST .../claim` on a `pending` request | FR-028 |
| `completed` | Provider reports success | `POST .../complete { outcome: 'completed' }` on a `claimed` request | FR-029 |
| `failed` | Provider reports failure | `POST .../complete { outcome: 'failed' }` on a `claimed` request | FR-029 |
| `expired` | Deadline passed with no completion | Server, evaluated lazily whenever the record is read (`isRestoreRequestExpired`, mirroring `isPrepareExpired`) — from either `pending` or `claimed` | FR-030, FR-031 |

```
        create               claim                complete(completed)
pending ───────► pending ────────► claimed ─────────────────────────► completed  (terminal)
   │                 │                │
   │  deadline        │  deadline      │ complete(failed)
   └───────────────►  └───────────────►├─────────────────────────────► failed     (terminal)
              expired         expired  │  deadline
                                        └─────────────────────────────► expired    (terminal)
```

**Claim is exactly-once** (FR-028): a claim attempt against a request already in `claimed`/`completed`/`failed`/
`expired` is refused with a code distinct from "not found" (`RESTORE_REQUEST_ALREADY_CLAIMED`, contracts/api.md
§0's error table) — this is the mechanical answer to spec §Edge Cases' "two providers attempt to claim it".

**Expiry is re-evaluated on read, not only by a timer** (R11, mirroring `expireOpenPrepareIfStale`'s dual
guard): every read of a record — by the deploy job's poll, by a poll/claim/complete call — first checks
`isRestoreRequestExpired`, and a `pending`/`claimed` record past its deadline is written back as `expired`
before the read returns. This is what survives a server restart (FR-031, FR-031b): no in-memory timer, no
in-memory handle, only the persisted `deadlineAt`.

### 4c. `RestoreRequestForProvider` — the wire projection (FR-026, FR-027)

What the poll response actually hands the provider — deliberately minimal (Constitution V: the provider is a
generic primitive, not a party that needs to know which app or which install it's serving):

```ts
export type RestoreRequestForProvider = {
  id: string;
  captureId: string;
  destination: string;
  deadlineAt: string;
};
```

### 4d. The deploy job's wait (R12, FR-031b, FR-031c)

Inside `runLifecycleJob`, the provider-acquisition branch of `performRestoreOnInstall` (§7) creates the
`pending` record, then polls the **same persisted record** in-process on an interval (no HTTP hop — the job and
the store live in the same server process), stopping on the first terminal state or on
`isRestoreRequestExpired`. This is a read of `restore-broker-state.ts`, never an awaited in-memory promise or
event: a server restart mid-wait loses the poll loop but not the record, and the record is what expiry already
has to consult (R12's rationale, verbatim from `DEFAULT_PREPARE_TIMEOUT_MS`'s).

---

## 5. `brokerActivity()` gains a second key (FR-031d)

`deployment.ts:3038-3052`'s Real override currently returns exactly one key. It must return two, computed from
two independent stores, with the first key's **output unchanged**:

```ts
protected override async brokerActivity(): Promise<Record<string, ContractBrokerActivity | undefined>> {
  const backup = await this.brokerState.read();      // unchanged
  const restore = await this.restoreBrokerActivity(); // NEW — derived from restore-broker-state.ts
  return {
    [BACKUP_CONTRACT_REF]: { lastPrepareAt: backup.lastPrepareAt, /* … unchanged … */ },
    [RESTORE_CONTRACT_REF]: restore,
  };
}
```

`ContractBrokerActivity`'s shape (`lastPrepareAt?`, `lastFinalizeAt?`, `openSince?`, `lastFinalizeWasExpiry?`)
is already a generic "cycle" shape and needs no new field (seams-008.md item B) — for restore it is read as:
`lastPrepareAt` = latest `createdAt` across all requests, `lastFinalizeAt` = latest of `completedAt`/expiry
time, `openSince` = earliest `createdAt` among requests still `pending`/`claimed` (absent when none are open),
`lastFinalizeWasExpiry` = whether the most recently closed request closed via `expired` rather than
`completed`/`failed`.

`buildContractRollup` needs **no change** — it already keys `activity` off `activity?.[ref]` generically
(seams-008.md item B) and will pick up `restore@1`'s activity automatically once this override reports it.

---

## 6. `RestoreCandidate` — origin, confidence, and the identifier change (R18, R19)

### 6a. New fields

```ts
export type RestoreCandidate = {
  candidateId: string;          // NEW — origin-independent, canonical (§6c)
  deploymentId?: string;        // deprecated back-compat alias, present only when source === 'deployment'
  source: 'deployment' | 'provider'; // NEW
  confidence: 'marker' | 'path';     // NEW
  lineageId: string;
  app: string;
  // … name, subdomain, host, appVersion, channel, carriesEnv, capturedAt, hasIdentityRecord,
  //   skew, requiredAcknowledgements, warnings — all unchanged from spec 007
};
```

| Field | Type | Source expression | Null? | FR |
|---|---|---|---|---|
| `candidateId` | `string` | `source === 'deployment'` ? `deployment.id` : `` `${providerDeploymentId}:${captureId}` `` | no | FR-043a |
| `deploymentId` | `string?` | `source === 'deployment'` ? `deployment.id` : **absent** | yes | FR-045 |
| `source` | `'deployment' \| 'provider'` | which resolver produced this candidate | no | FR-043 |
| `confidence` | `'marker' \| 'path'` | `'marker'` when a real identity record was read (a local deployment's `.hola/instance.json`, or a provider capture's identity record); `'path'` when the capture's identity was inferred from `location` or is unknown entirely | no | FR-044 |

**`deploymentId`'s absence is the FR-045 mechanism, not an oversight.** A stale client reading
`c.deploymentId === selectedCandidateId` against a provider candidate compares against `undefined` and simply
never matches — a safe non-selection, not a miscategorisation as a local deployment. `candidateId` is the field
every call site must move to (§6d); `deploymentId` exists for one release as a compatibility read, never
written by new code as the primary key.

**Why `source`/`confidence` are new fields, not new enum values (R18).** The candidate shape has no origin
concept today at all — there is nothing to extend. `confidence` is likewise orthogonal to `hasIdentityRecord`:
a `source: 'deployment'` candidate is always `confidence: 'marker'` (a live deployment's `app` comes from the
deployment registry, which is authoritative even when its identity-record file is missing — see spec 007's
`hasIdentityRecord: false` fallback, which degrades the *description* but never the *app*). Only a
`source: 'provider'` candidate can be `confidence: 'path'`.

### 6b. `RestoreCandidate.app` for a `confidence: 'path'` provider entry — the app-matching rule

**This is a genuine design decision the spec leaves implicit; recorded here so it is checkable rather than
silently assumed.** A `RestoreIndexEntry` with `identity: null` or `identity.app` absent carries no reliable
app id at all (R19: the recovered `installName` is an installation's own directory name, not necessarily the
catalog app — FR-050 forbids treating it as one). Since `GET /api/apps/:appId/restore-candidates` is already
scoped to one `appId`, the rule adopted is:

- `identity.app` known and **equals** the queried `appId` → included, `confidence: 'marker'`, `app: appId`.
- `identity.app` known and **differs** from the queried `appId` → excluded entirely from this response (it is
  a real capture of a *different* app; showing it here would be actively misleading, not merely uncertain).
- `identity` null, or `identity.app` absent → included for **every** `appId` queried, `confidence: 'path'`,
  `app: appId` (the response's own scope, not a fact read off the capture — §6a's `app` field is populated from
  the route parameter in this case, never from the capture). This is what makes FR-048 ("still offerable")
  possible at all for an entry the platform genuinely cannot rule in or out; FR-051's required acknowledgement
  and FR-052a's no-default rule (§7c) exist specifically to keep this honest rather than a guess dressed up as
  a match.

`lineageId` for a `confidence: 'path'` entry is the recovered `installName` itself (not `captureId`), so that
several captures of the same lost installation — sharing the same directory name across capture times — group
into one lineage exactly as `groupIntoLineages` already does for local candidates, with no change to that
function (R18).

### 6c. `candidateId` format and the parser (new)

```ts
/** Splits on the FIRST ':' — a deployment id (`<slug>-[0-9a-f]{8}`) never contains one. */
export function parseCandidateId(candidateId: string):
  | { kind: 'deployment'; deploymentId: string }
  | { kind: 'provider'; providerDeploymentId: string; captureId: string } {
  const at = candidateId.indexOf(':');
  if (at < 0) return { kind: 'deployment', deploymentId: candidateId };
  return {
    kind: 'provider',
    providerDeploymentId: candidateId.slice(0, at),
    captureId: candidateId.slice(at + 1),
  };
}
```

`RestoreChoice.candidateId` (`shared/index.ts:378-385`) needs **no schema change** — it is already a plain
`string`; only the set of legal values widens. The CLI's `--restore-from <id>` and `--restore-list`'s
`Default: <id>` output (contracts/cli.md, unchanged file) therefore keep working as typed/printed strings, with
a provider candidate's id simply looking like `backrest-91a2c3d4:cap_20260910T013000Z` rather than a bare
deployment id — still one copy-pasteable token (R18's "public surface, not internal plumbing" constraint).

### 6d. Blast radius — every non-test call site the identifier change touches (seams-008.md item G)

| Layer | Site | Today | After |
|---|---|---|---|
| server | `restore-candidates.ts:100` `describeCandidate` | sets `deploymentId: deployment.id` | also sets `candidateId: deployment.id`, `source: 'deployment'`, `confidence: 'marker'` |
| server | `restore-candidates.ts:147` `groupIntoLineages` | `defaultCandidateId` copies `.deploymentId` | copies `.candidateId` (§7c also gates this on `confidence`) |
| server | `restore-candidates.ts:288-297` `checkCandidateStillEligible` | compares `source.deployment.id === excludeDeploymentId` | branches on `RestoreSource.kind`; the provider branch checks the index entry and the provider's current consent, not a deployment id |
| server | `draft.ts:404` `resolveRestoreChoice` | `getRestoreSource(choice.candidateId)` as a deployment-registry lookup | `parseCandidateId` first, then either the existing local lookup or a new index-entry lookup |
| server | `deployment.ts:1057` `createFromDraft` re-validation | same local-only lookup | same branch as above |
| server | `deployment.ts:3984` `performRestoreOnInstall` step 2 | same local-only lookup | same branch; the provider branch additionally creates/awaits a `RestoreRequestRecord` (§4) |
| server | `deployment.ts:838-843` `getRestoreSource` | `this.deployments.get(deploymentId)` | widened to a discriminated `RestoreSource` (`{kind:'deployment',…} \| {kind:'provider',…}`), branching via `parseCandidateId` |
| web | `InstallWizard.tsx:406` | `.find(c => c.deploymentId === selectedCandidateId)` | `.find(c => c.candidateId === selectedCandidateId)` |
| web | `InstallWizard.tsx:671` | reads `previousChoice?.candidateId` | unchanged (already reads `candidateId`, which was always the wire field) |
| web | `InstallWizard.tsx:864` | builds `restoreFrom: { candidateId: selectedCandidateId }` | unchanged shape, now may carry a composite id |
| cli | `install.ts:201` | `.find(c => c.deploymentId === candidateId)` | `.find(c => c.candidateId === candidateId)` |
| cli | `install.ts:167` | prints `resp.defaultCandidateId` | unchanged call, now may print a composite id |
| cli | `install.ts:196-198` | reads `resp.defaultCandidateId` / `opts.restoreFrom` | unchanged |
| cli | `install.ts:322` | echoes `restoreFrom.candidateId` | unchanged |
| cli | `deploy-flow.ts:153` | passes `candidateId?: string` through | unchanged (already origin-agnostic — a plain string) |

Twelve non-test sites total, matching seams-008.md's count. Three (web/CLI passthroughs) need **no code
change** because they already treat the id as an opaque string; the rest branch on origin at the point they
resolve it, never at the point they merely carry it.

---

## 7. Restore coverage verdict (R14)

### 7a. `RestoreCoverageState` — a closed, four-state vocabulary distinct from `BackupCoverageState`

FR-053a forbids reusing `'quiesced' | 'partial' | 'as-is' | 'uncovered'` verbatim: those words describe being
read consistently while running, which says nothing about being put back, and `'as-is'`'s backup meaning (no
hooks — a *weaker* guarantee) would silently invert to mean "fully restorable" if reused for restore's
plain-copy state, since plain-copy restoration of a non-database app is a **complete** answer, not a
diminished one.

```ts
export type RestoreCoverageState = 'undeclared' | 'copy-back' | 'incomplete' | 'restorable';
```

| State | Meaning | Parallels (by role, not by word) |
|---|---|---|
| `undeclared` | Does not accept `restore@1` at all — nobody has considered restoring this app | `uncovered` |
| `copy-back` | Accepts `restore@1`; no recognised database participation exists, so a plain file copy is a **complete**, correct answer | `as-is` |
| `incomplete` | Accepts `restore@1`; at least one recognised database participation has **no** matching restore declaration with a hook — it would restore via a corrupting bare copy of a live-database smear | `partial` |
| `restorable` | Accepts `restore@1`; every recognised database participation has a matching restore declaration with a hook | `quiesced` |

### 7b. `judgeRestoreCoverage` — pure, beside `judgeBackupCoverage`

```ts
export function judgeRestoreCoverage(input: {
  accepts: boolean;
  participations: AppBackupParticipation[];       // the app's stateful parts (backupParticipations())
  restoreDeclarations: AppRestoreDeclaration[];    // manifest.restore, unchanged shape from spec 007
  databaseServices: string[];                      // same recognition judgeBackupCoverage uses
}): RestoreCoverage;

export type RestoreCoverage = {
  state: RestoreCoverageState;
  targeted: number;    // recognised DB services with a matching, hook-bearing restore declaration
  recognised: number;  // recognised DB services the deployment actually runs
  participations: Array<{ id: string; service?: string; declared: boolean }>;
  databases: string[];
};
```

**Only a `restoreDeclarations` entry carrying a `hook` counts as covering a database participation** — a
discard-only entry removes the smeared `PGDATA` but never loads the real dump, mirroring
`judgeBackupCoverage`'s own precedent of only counting a participation's operative half (its `preHook`).

Derivation, in this order:

```ts
if (!accepts) state = 'undeclared';
else if (recognised === 0) state = 'copy-back';
else state = targeted === recognised ? 'restorable' : 'incomplete';
```

### 7c. Wiring — `DeploymentContracts`, `ContractParticipant`, `buildContractRollup`

```ts
// shared/index.ts additions, additive-only
export type DeploymentContracts = {
  // … unchanged …
  restoreCoverage?: Record<string, RestoreCoverage>; // keyed by ref, only 'restore@1' populated today
};
export type ContractParticipant = {
  // … unchanged …
  restoreCoverage?: RestoreCoverage;
};
```

`readDeploymentContracts` (server-side, computes `DeploymentContracts` per deployment) gains one additional
call to `judgeRestoreCoverage`, alongside its existing `judgeBackupCoverage` call, populating
`restoreCoverage['restore@1']`. `buildContractRollup`'s acceptor-push branch (`services/core/contracts.ts:184-
194`) gains one line spreading `restoreCoverage: contracts.restoreCoverage?.[ref]` the same way `coverage` is
spread today — the two are independent judgements over independent declarations (FR-053), so an app can be
`quiesced` for backup and `incomplete` for restore simultaneously, and the rollup shows both.

### 7d. Acceptance is never derived (R5, FR-006a)

`judgeRestoreCoverage`'s `accepts` input is `contracts.accepts?.includes('restore@1')` — **never**
`contracts.accepts?.includes('backup@1')`. An app that accepts `backup@1` and declares no `restore` block gets
`accepts: false` passed in, yielding `state: 'undeclared'`, and lands in the rollup's `unaffiliated` bucket for
`restore@1` regardless of its backup coverage. Today that is thirteen of eighteen catalog apps, the provider
itself among them (R5) — a correct answer that will read as a regression to anyone expecting parity with
`backup@1`'s rollup, and is not one.

---

## 8. What acquisition/application actually splits (R8, R9)

Not a new persisted entity, but the shape every provider-sourced restore's server-side code follows —
recorded here because it is the seam the whole feature is built on top of, and getting the boundary wrong is
the failure mode plan.md's Known Trap section warns about.

**Application (origin-agnostic, shared verbatim, unchanged from spec 007):** `performRestoreOnInstall`'s steps
5–10 — the payload post-condition (`dirHasContents`), `discard` paths, `.hola/instance.json` rewrite, pending
OIDC credential write, service-scoped `composeUp({ services, wait: true })`, fail-closed restore hooks. These
run against `targetAppRoot` and know nothing about where the payload came from (FR-042).

**Acquisition (origin-specific):**

| Step | Local (unchanged) | Provider (new) |
|---|---|---|
| 1. Target-empty check | `dirHasContents(targetAppRoot, …)` | *identical* — genuinely origin-agnostic already |
| 2. Resolve the candidate | `getRestoreSource` → local deployment registry lookup | `parseCandidateId` → index-entry lookup + current-provider-consent check |
| 3. Obtain the payload | Quiesce source hooks, `tarGzipDir` into **capture staging** (§9's rename) | Create a `RestoreRequestRecord` (§4), poll it to a terminal state (§4d), refuse on `failed`/`expired` |
| 4. Land it in `targetAppRoot` | `restoreTarGzInto(stagingPath, targetAppRoot)` — root-relative tar, no search needed | **Locate** the app data root inside `<destination>` (a repository tool reproduces absolute paths — R9), refusing rather than guessing when it cannot be identified unambiguously; then rename (same filesystem) or copy (different filesystem, FR-040) the located subtree into `targetAppRoot`, logging which path was taken |

Step 4's location rule (FR-041, closing #486): search `<destination>` for exactly one directory whose contents
satisfy the same `dirHasContents(_, [INSTALL_MARKERS_DIR])`-style shape check the post-condition (step 5) will
apply anyway — not a fuzzy heuristic, a bounded search that **refuses on more than one match or on zero
matches**, because picking the wrong one restores the wrong data over a live install and refusing costs only an
operator retry.

---

## 9. What is removed

### 9a. The participation-marker machinery (R2, FR-002, FR-003)

| Symbol | File | Disposition |
|---|---|---|
| `PARTICIPATION_MARKERS` | `shared/src/contracts.ts:241` | deleted |
| `RESTORE_PARTICIPATION_REF` | `shared/src/contracts.ts:244` | deleted |
| `isParticipationMarker` | `shared/src/contracts.ts:250-252` | deleted |
| The `coerceRefs` carve-out (`if (role === 'accepts' && isParticipationMarker(ref)) { … continue; }`) | `server/services/core/contracts.ts:45-48` | deleted |

A regression test **must** assert the carve-out is gone by exercising the actual coercion path with a real
manifest fixture — not by asserting the symbols don't exist, which a stub could satisfy while leaving
equivalent inline logic behind (quickstart.md scenario 1, FR-003).

### 9b. The fabricated restore surface (#484, R20, FR-056, FR-057)

| Symbol | File | Disposition |
|---|---|---|
| `RestoreBackupRequest`, `RestoreBackupResponse` | `shared/src/index.ts:1890-1891` | deleted |
| `POST /api/backups/:id/restore` handler | `server.ts:1722-1727` | deleted |
| Its capability row | `middleware/auth.ts:157` | deleted |
| `API.backups.restore` path builder | `shared/src/index.ts:109` | deleted |
| `restoreBackup` hook method | `web/src/hooks/useBackupsApi.ts:9,107-116` | deleted |
| `backups.restore` SDK method | `web/src/utils/sdk-adapter.ts:33,600-602` | deleted |
| The button/action calling it | `web/src/pages/Backups.tsx:44,68` | deleted |
| `api-explorer.ts` / `type-browser.ts` doc entries | `shared/src/docs/*.ts` | deleted |

**Deliberately NOT removed (R20's "Open" note, made a decision here):** `JobType`'s `'restore'` literal
(`shared/index.ts:731`) and its two UI-label cases (`JobStatus.tsx:58`, `Dashboard.tsx:38`). This feature's
requests are not `Job` records (§4d — the deploy job polls a store, not a second job), so the literal stays
unused exactly as it is today. Removing a `JobType` union member is a larger, independently-reviewable change
with no test currently depending on it either way; leaving it is not "an interface element that appears
actionable but does nothing" (FR-057), because nothing produces a job of that type for any UI to render. Filed
as a follow-up per FR-066 rather than bundled here.

The pre-existing guard test asserting spec 007's restore feature never imports the dead types
(`restore-on-install.test.ts:286-297`, "scenario 55" in spec 007's quickstart) becomes vacuous once the types
themselves are gone and should be **replaced**, not merely left passing — quickstart.md scenario 2 below.

---

## 10. Deployment record — unchanged (contrast with spec 007)

Spec 007 added `lineageId`, `restoreFrom` and `restoredAt` to `EnhancedDeploymentDetail`. **This feature adds no
new field to the deployment record.** `restoreFrom.candidateId` already carries whatever the operator chose,
now possibly a composite provider id (§6c) — a widened *value space* on an existing field, not a schema change.
`RestoreRequestRecord` (§4a) is the new persisted state this feature introduces, and it lives in its own store,
addressed by `targetDeploymentId`/`providerDeploymentId`, not on the deployment record itself.

---

## 11. Lifecycle of a provider-sourced restore

```
draft create ──> RestoreChoice validated: parseCandidateId branches to the index-entry lookup;
                 skew/acknowledgement rules (data-model.md §3/§4, spec 007) apply identically —
                 provider origin weakens nothing (FR-046)

createFromDraft ─> re-validated against the CURRENT index and the provider's CURRENT consent
                 (the index may have changed, the grant may have been revoked — FR-038)

deploy job ────> assert target empty (shared) · resolve candidate → provider branch ·
                 create RestoreRequestRecord (pending, destination minted, deadline set) ·
                 poll the record in-process until terminal or expired ·
                   on 'failed'/'expired': refuse, fail the whole install (FR-029, FR-030) ·
                   on 'completed': locate the app root inside <destination> (refuse on
                     ambiguity, FR-041) · rename-or-copy into targetAppRoot (FR-040) ·
                 [rejoin the shared application sequence — post-condition onward, unchanged]

provider uninstalled  ─> its index entry set is discarded (FR-025a); any request still open for
or consent revoked        it is unservable from that point (FR-038) and expires normally
```
