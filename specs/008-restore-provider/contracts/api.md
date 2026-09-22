# Contract: HTTP API surface

**Feature**: `specs/008-restore-provider`

## The reversal, stated plainly

Spec 007's `contracts/api.md` opened by stating that none of its surface was a capability contract. **This
feature is the reversal of that statement**, and it is deliberate (FR-004): the four routes below ARE
capability-contract broker endpoints under ADR 0004, reached by a provider app holding an `hct_`-prefixed
`contract:restore` token, exactly as `/api/contracts/backup/*` already works for `backup@1`. `restore@1` moves
from `shared/src/contracts.ts`'s participation-marker list (no provider, no broker, no grant) into `CONTRACTS`
itself (`brokered`, `providerKind: 'app'`) — see `data-model.md` §1 for the full entry and everything that
promotion touches.

What stays **unchanged** from spec 007: the candidates route (`GET /api/apps/:appId/restore-candidates`)
remains an ordinary authenticated platform read, not a broker route — a *client* asks it, never a provider; and
`CreateDraftRequest.restoreFrom` / `POST /api/deployments` re-validation are unchanged in shape (§4, §5 below).
The four new routes are additive; nothing about how an operator drives a restore changes.

---

## 0. Error code table

Every code below is `details.code` on a `ConflictError` (409) unless noted. Codes marked **broker** are new to
this feature; codes marked **007** are unchanged, reused as-is (data-model.md §4 of spec 007).

| `details.code` | HTTP | Raised by | Meaning |
|---|---|---|---|
| `RESTORE_REQUEST_NOT_FOUND` | 404 | claim, complete | No request with this id exists (never claimed, never created, or the store was reset) |
| `RESTORE_REQUEST_ALREADY_CLAIMED` | 409 | claim | The request is already `claimed`/`completed`/`failed`/`expired` — distinguishable from "not found" (FR-028) |
| `RESTORE_REQUEST_NOT_CLAIMED` | 409 | complete | `complete` called on a request still `pending` — a provider must claim before it can complete |
| `RESTORE_REQUEST_EXPIRED` | 409 | claim, complete | The request's deadline has passed; the caller is told rather than silently accepted (FR-030) |
| `RESTORE_INDEX_INVALID` | 400 | index | The published body is malformed (missing `captureId`, non-finite `sizeBytes`, etc.) — the previous index is left untouched |
| `NOT_CONTRACT_PROVIDER` | 403 | all four, and `backup@1`'s prepare/finalize/status | **#501.** Top-level `code`, not `details.code`. The calling token's deployment is not a consented provider of this contract — it never declared the role, consent was never given or was withdrawn, or it is not installed. Every broker call is performed AS the deployment its token was minted for; the server no longer resolves "the provider" by scanning the host, so two consented providers (the legacy `providerConflict` state) can never be confused for one another. A request addressed to a DIFFERENT provider stays `RESTORE_REQUEST_NOT_FOUND` (404) — a provider has no business learning another's queue exists |
| `RESTORE_NOT_ACCEPTED` | 409 | drafts, deployments | **007, unchanged.** Target app declares no `restore@1` in `accepts` |
| `RESTORE_NOT_SUPPORTED` | 409 | drafts | **007, unchanged.** `restoreFrom` on the install-by-ref path |
| `RESTORE_CANDIDATE_GONE` | 409 | drafts, deployments, job | **007, unchanged in meaning.** Now also covers: the index entry no longer exists, or the provider that published it is no longer the consented `restore@1` provider |
| `RESTORE_CANDIDATE_BUSY` | 409 | drafts, deployments, job | **007, unchanged.** For a provider-sourced candidate this is unreachable — a capture has no "settled state" to be busy in; kept for the local-deployment path only |
| `RESTORE_SOURCE_NEWER` / `RESTORE_UPGRADE_PATH` / `RESTORE_ENV_REQUIRED` / `RESTORE_ACK_REQUIRED` / `RESTORE_ADDRESS_REQUIRED` | 409 | drafts, deployments | **007, unchanged.** Provider origin weakens none of them (FR-046) |
| `RESTORE_TARGET_NOT_EMPTY` / `RESTORE_INCOMPLETE` / `RESTORE_PAYLOAD_EMPTY` / `RESTORE_HOOK_FAILED` | job only | job | **007, unchanged.** Job-time only, per spec 007's table; not reachable from any create call |
| `RESTORE_SOURCE_UNLOCATABLE` | job only | job | **new.** The delivered tree contains zero or more than one plausible app data root; the install fails rather than guessing (FR-041, closes #486) |
| `RESTORE_PROVIDER_UNRESPONSIVE` | job only | job | **new.** The request expired before the provider claimed or completed it; the message names the provider (FR-030, SC-006) |

---

## 1. `POST /api/contracts/restore/index`

Publish (replace wholesale) the calling provider's snapshot index.

**Auth**: `contract:restore` — the provider's own contract-scoped token, minted at install exactly as
`contract:backup`'s is. A dashboard/CLI principal cannot reach this route (FR-033).

**Request**

```ts
type PublishRestoreIndexRequest = { entries: RestoreIndexEntry[] };
```

**200**

```jsonc
{ "ok": true, "count": 14 }
```

**Effect**: `store[providerDeploymentId]` is replaced entirely with `{ publishedAt: now, entries }` —
never merged (FR-024, data-model.md §3c). A capture the provider's repository no longer holds simply stops
appearing in the next publish; the server does not diff against the previous index.

**400** `RESTORE_INDEX_INVALID` on a malformed entry. The previous index is left untouched — a bad publish
must not blank out a good one.

---

## 2. `GET /api/contracts/restore/requests`

Poll for pending work.

**Auth**: `contract:restore`. Listed as its own capability-map row, separately from §1/§3/§4's rows — a
contract-scoped principal is denied by default even for reads (`isContractScoped`/`authorizeRequest`), so a GET
needs the same explicit naming the `backup@1` status poll already required (`middleware/auth.ts:152`
precedent, `research.md` R17).

**200**

```jsonc
{
  "requests": [
    { "id": "req_8f3a", "captureId": "cap_20260910T013000Z", "destination": "/srv/hola/restore/req_8f3a", "deadlineAt": "2026-09-21T14:30:00.000Z" }
  ],
  "reindex": false
}
```

`requests` lists every `pending` `RestoreRequestRecord` addressed to the calling provider's deployment id — the
provider is never told which app or which install it's serving (data-model.md §4c). `reindex: true` (FR-034)
signals "the server holds no index for you" — a freshly installed provider on a new host, or one whose index
was discarded on a prior uninstall/revoke (§3c) and never republished. This is a flag in the response the
provider reads, never a call the server makes (R15's corollary) — the direction of initiation never reverses.

**Provider claims its own destinations, never the server's.** `destination` is always the server-minted path
(data-model.md §4a); nothing in this response is provider-suppliable.

---

## 3. `POST /api/contracts/restore/requests/:id/claim`

**Auth**: `contract:restore`, its own row.

**200** `{ "ok": true }`

**404** `RESTORE_REQUEST_NOT_FOUND` — no such id.
**409** `RESTORE_REQUEST_ALREADY_CLAIMED` — someone (possibly this same provider, on a retried poll) already
claimed it. **409** `RESTORE_REQUEST_EXPIRED` — the deadline passed before this claim arrived; the provider
should simply stop pursuing it, the install has already failed.

---

## 4. `POST /api/contracts/restore/requests/:id/complete`

**Auth**: `contract:restore`, its own row.

**Request**

```ts
type CompleteRestoreRequestRequest = { outcome: 'completed' | 'failed'; reason?: string };
```

**200** `{ "ok": true }`

**404** `RESTORE_REQUEST_NOT_FOUND`. **409** `RESTORE_REQUEST_NOT_CLAIMED` — the request is still `pending`
(complete without claim is refused, not silently accepted as if claimed first). **409**
`RESTORE_REQUEST_EXPIRED` — the deadline passed before this report arrived; the server has already moved on and
the report is simply too late (the install already failed with `RESTORE_PROVIDER_UNRESPONSIVE`).

`outcome: 'failed'` fails the waiting install without starting the app (FR-029), matching spec 007's
fail-closed disposition exactly — a reported failure and a silent expiry both end the job the same way, differing
only in the message the operator sees (named-provider unresponsive vs. the `reason` the provider gave).

---

## 5. `GET /api/apps/:appId/restore-candidates` — additive changes only

Route, auth (ordinary authenticated principal, unchanged — a contract-scoped token still cannot reach it,
`authorizeRequest`'s default-deny), and query parameters (`?version=`) are **unchanged** from spec 007.

**What's new in the response**: each `RestoreCandidate` gains `candidateId`, `source`, `confidence`
(data-model.md §6), and provider-origin candidates are mixed into the same `lineages` array local ones already
occupy — grouped by `lineageId` exactly as before, with no separate section. When no provider is installed, or
one is installed without the `restore@1` role, the response carries the **identical set of local candidates**
spec 007 would have returned — same content, same lineage grouping, same skew/acknowledgement/warning values,
same defaulting — with the provider-sourced branch contributing zero candidates (FR-047, SC-013). It is **not**
byte-identical at the wire level: §6a's three new fields (`candidateId`, `source: 'deployment'`,
`confidence: 'marker'`) are added to every local candidate unconditionally, not only when a provider exists.
No local candidate's *other* field values change (quickstart.md scenario 47 checks exactly this distinction).

```jsonc
{
  "appId": "mealie",
  "lineages": [
    {
      "lineageId": "mealie-3f2a9c11",
      "candidates": [
        {
          "candidateId": "mealie-3f2a9c11",
          "deploymentId": "mealie-3f2a9c11",
          "source": "deployment",
          "confidence": "marker",
          "lineageId": "mealie-3f2a9c11",
          "app": "mealie", "name": "Recipes", "subdomain": "recipes", "host": "recipes.example.com",
          "appVersion": "3.20.1", "channel": "stable", "carriesEnv": true,
          "capturedAt": "2026-09-19T22:14:03.221Z", "hasIdentityRecord": true,
          "skew": { "kind": "ok" }, "requiredAcknowledgements": [], "warnings": []
        }
      ]
    },
    {
      "lineageId": "backrest-91a2c3d4:cap_20260201T090000Z",
      "candidates": [
        {
          "candidateId": "backrest-91a2c3d4:cap_20260201T090000Z",
          "source": "provider",
          "confidence": "path",
          "lineageId": "backrest-91a2c3d4:cap_20260201T090000Z",
          "app": "mealie", "name": "recipes-8b41d0e7", "subdomain": null, "host": null,
          "appVersion": null, "channel": null, "carriesEnv": false,
          "capturedAt": "2026-02-01T09:00:00.000Z", "hasIdentityRecord": false,
          "skew": { "kind": "unknown" },
          "requiredAcknowledgements": ["restore-version-unknown", "restore-env-not-carried", "restore-inferred-identity"],
          "warnings": [{ "code": "no-identity-record" }]
        }
      ]
    }
  ],
  "defaultCandidateId": null,
  "requiresExplicitChoice": true
}
```

(Illustrating FR-052a: with only these two lineages present, `defaultCandidateId` would ordinarily be null
already since two lineages match — the single-lineage-suppression rule in data-model.md §6b fires only when
exactly one lineage matches AND its top candidate is `confidence: 'path'`, in which case `defaultCandidateId`
is forced `null` where it would otherwise have been set.)

`restore-inferred-identity` (FR-051) is a new acknowledgement code, alongside spec 007's
`restore-version-unknown` / `restore-env-not-carried` — required whenever `confidence: 'path'`, checked the
same way the other two already are (data-model.md §3, spec 007).

---

## 6. `POST /api/drafts` / `POST /api/deployments` — no shape change, wider values

`CreateDraftRequest.restoreFrom.candidateId` and the re-validation at `createFromDraft` are **unchanged in
type** — both were always a plain `string` and remain one (data-model.md §6c). What's new is purely that the
string may now decompose (via `parseCandidateId`) into a provider reference rather than always naming a local
deployment. Every 409 code spec 007 already returns from these two calls (§0's table, "007, unchanged" rows)
still fires identically for a provider-sourced choice — FR-046 requires no relaxation.

---

## 7. Capability rows — four, not one (R17)

Each provider endpoint gets its own `middleware/auth.ts` `capabilityMap` row, following the `backup@1`
precedent's reasoning exactly: a contract-scoped principal is closed by default (`authorizeRequest`), so even a
read needs its capability named explicitly.

```ts
{ pattern: /^\/api\/contracts\/restore\/index$/, method: 'POST', capability: 'contract:restore' },
{ pattern: /^\/api\/contracts\/restore\/requests$/, method: 'GET', capability: 'contract:restore' },
{ pattern: /^\/api\/contracts\/restore\/requests\/[^/]+\/claim$/, method: 'POST', capability: 'contract:restore' },
{ pattern: /^\/api\/contracts\/restore\/requests\/[^/]+\/complete$/, method: 'POST', capability: 'contract:restore' },
```

Listed before the generic mutating-method fallback, exactly as the `backup@1` rows are (`middleware/auth.ts:
137-141`'s comment). A caller holding only `contract:backup` cannot reach any of these four routes, and a
`contract:restore` principal cannot reach `/api/contracts/backup/*` — capabilities are per-contract-ref, never
shared (FR-033), because `contractCapability(ref)` mints exactly one capability string per provided ref
(data-model.md §1's table).

---

## 8. Unchanged, listed so the boundary is checkable

| Surface | Status |
|---|---|
| `/api/contracts/backup/*` | untouched — request/response shapes, capability rows, broker state all unchanged |
| `GetContractsResponse` / `/api/contracts` (base) | additive only — `restore@1` now appears as a fourth-then-fifth row with its own `providers`/`acceptors`/`unaffiliated`/`activity` |
| `PatchDraftRequest` | still closed to its existing fields |
| `POST /api/drafts/:id/finalize` | still takes no body |
| `JobType` | no new type — the request/poll cycle is not a `Job` at all (data-model.md §4d, §9b) |
| `POST /api/backups/:id/restore` | **deleted** (§0 note; data-model.md §9b, closes #484) — was previously listed here as "deliberately untouched"; that changes in this feature |
