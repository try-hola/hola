# Contract: HTTP API surface

**Feature**: `specs/007-restore-on-install`

## None of this is a capability contract

Stated plainly, because FR-047 forbids one and the vocabulary is adjacent.

A **capability contract** in this platform (ADR 0004) is an entry in `CONTRACTS`
(`packages/shared/src/contracts.ts:146-199`) with a provider, acceptors, a
participation mode, and — for a privileged one — a grant the operator consents to.
The broker endpoints live under `/api/contracts/...` and are reached by provider
*apps* holding `hct_`-prefixed contract-scoped tokens.

This feature adds **none of that**:

- `CONTRACTS` gains no entry. `auth@1`, `backup@1`, `push@1` and
  `container-logs@1` remain the complete set.
- No `/api/contracts/...` route is added or changed.
- No new grant kind. No app receives any new access to anything.
- No contract-scoped token is minted, and `contractCapability()` is untouched.

What it adds is **one ordinary authenticated platform API read route** and fields
on two existing request bodies — the same class of surface as `channel` (#428) or
`profiles` (#162). The one restore-adjacent thing an *app* declares,
`accepts: ["restore@1"]`, is a participation marker read from the bundle manifest
(see [manifest.md](./manifest.md)); the server never brokers it between two
parties, which is what would make it a contract.

---

## 1. `GET /api/apps/:appId/restore-candidates` (new)

Lists deployments on this host that can serve as a restore source for `appId`.

**Auth**: ordinary authenticated principal. A contract-scoped token must **not**
reach it — `authorizeRequest` already default-denies contract principals on any
route naming no capability (#471), so this needs no special handling, but it is
recorded because #477 was a regression in exactly that area.

**Query**: `?version=<target version>` — optional. When supplied, each candidate's
`skew` and `requiredAcknowledgements` are computed against it. Omitted, `skew` is
reported as `unknown` for every candidate, because skew is meaningless without a
target.

**Why a route and not a field on an existing response** (research R6): the restore
choice is the wizard's *first* step and is an input to draft creation, so a field
on the draft-create response would be circular — the client would need a draft to
learn what to put in the draft request. `--restore-list` must also work without
creating one.

**200**

```jsonc
{
  "appId": "mealie",
  "lineages": [
    {
      "lineageId": "mealie-3f2a9c11",
      "candidates": [
        {
          "deploymentId": "mealie-3f2a9c11",
          "lineageId": "mealie-3f2a9c11",
          "app": "mealie",
          "name": "Recipes",
          "subdomain": "recipes",
          "host": "recipes.example.com",
          "appVersion": "3.20.1",
          "channel": "stable",
          "carriesEnv": true,
          "capturedAt": "2026-09-19T22:14:03.221Z",
          "hasIdentityRecord": true,
          "skew": { "kind": "ok" },
          "requiredAcknowledgements": [],
          "warnings": []
        }
      ]
    }
  ],
  "defaultCandidateId": "mealie-3f2a9c11",
  "requiresExplicitChoice": false
}
```

`defaultCandidateId` is `null` and `requiresExplicitChoice` is `true` whenever two
or more distinct lineages match (FR-036). Candidates are newest-first within a
lineage. An app with no candidates returns `lineages: []` — **200, not 404**
(FR-042): "nothing to restore from" is an answer, not an error, and the wizard
must render it without treating it as a failure.

---

## 2. `POST /api/drafts` — `CreateDraftRequest` gains `restoreFrom`

```ts
restoreFrom?: {
  candidateId: string;
  carryEnv: boolean;
  acknowledge?: string[];
};
```

Accepted on the **catalog** path only. On the install-by-ref path
(`ociRef` supplied) it is **rejected**, never ignored — research R2. Ignoring it
would be the silent-empty-restore failure the whole spec exists to prevent.

**Effect on success**: `appEnv` is seeded from the candidate's environment record
through `mergeUpgradeAppEnv`; `name` and `subdomain` default from the candidate
(FR-035).

**409 `CONFLICT`** with `details.code` — same envelope as `PROVIDER_EXISTS` and
`ALREADY_INSTALLED`, so existing client handling generalises:

| `details.code` | Cause |
|---|---|
| `RESTORE_NOT_SUPPORTED` | `restoreFrom` on the install-by-ref path |
| `RESTORE_NOT_ACCEPTED` | The target app declares no `restore@1` in `accepts` |
| `RESTORE_CANDIDATE_GONE` | No such candidate, or it is not a candidate for this app |
| `RESTORE_CANDIDATE_BUSY` | Candidate not in a settled state |
| `RESTORE_SOURCE_NEWER` | + `candidateVersion`, `targetVersion` |
| `RESTORE_UPGRADE_PATH` | + `suggestedVersion` |
| `RESTORE_ENV_REQUIRED` | + `missingKeys[]` |
| `RESTORE_ACK_REQUIRED` | + `required[]` |
| `RESTORE_ADDRESS_REQUIRED` | FR-035's default would land on the address the candidate still routes under; + `candidateId`, `candidateName`, `subdomain` |

**`RESTORE_ADDRESS_REQUIRED` (#490).** With no `name` in the request, FR-035
defaults the new install's address to the candidate's own — and the candidate,
being an existing deployment on this host, still owns it. That default is
refused here, with the candidate named, rather than allowed to reach
`routingService.validateRule` and come back as a bare host `CONFLICT` carrying
no `details.code` and no mention of restore (FR-037). It fires **only** when the
caller supplied no `name`: an operator who names the install has made the
address decision and gets the routing layer's own conflict, which names the
owning deployment. The server never derives a distinct or suffixed slug on the
operator's behalf — that would put the restored data, full of the old address's
absolute URLs, at a new address nobody chose.

**Four codes are deliberately absent from this table.**
`RESTORE_TARGET_NOT_EMPTY`, `RESTORE_INCOMPLETE`, `RESTORE_PAYLOAD_EMPTY` and
`RESTORE_HOOK_FAILED` (data-model.md §4) are reachable only inside the deploy
job, after the create call has returned. They surface on the deployment's error
state and in the job log, not in any HTTP response body.
`RESTORE_CANDIDATE_GONE` and `RESTORE_CANDIDATE_BUSY` appear in both places,
because the job re-resolves the candidate (FR-013a).

---

## 3. `POST /api/deployments` — re-validation, not a new field

`CreateDeploymentFromDraftRequest` (`shared/src/index.ts:2257-2289`) is
**unchanged**. The restore choice arrives on the finalized manifest, not the
request.

*(The type is `CreateDeploymentFromDraftRequest`. There is no
`CreateDeploymentRequest` in this codebase — the prompt of record named one.)*

What changes is behaviour: `createFromDraft` re-validates the choice before
creating any state, because the candidate may have been deleted or started a
lifecycle action since the draft was made. Acknowledgement codes are enforced here
the way `grants` already are — computed from the manifest and the candidate,
refused when required and absent. Same failure mode, same place in the flow, for
the same reason (research R16).

Returns the same 409 codes as §2.

---

## 4. `GET /api/deployments/:id` — three additive fields

`EnhancedDeploymentDetail` gains `lineageId?`, `restoreFrom?` and `restoredAt?`
(see [data-model.md](../data-model.md) §6). All optional; every record written
before this feature stays valid and reads them as `undefined`.

`lineageId`'s absence-means-self rule is what makes this zero-migration:
`writeInstanceMarkers` becomes `deployment.lineageId ?? deployment.id`, which for
an older record yields exactly the value it has always written.

---

## 5. Unchanged, listed so the boundary is checkable

| Surface | Status |
|---|---|
| `/api/contracts/...` (broker) | untouched |
| `CONTRACTS` registry | no entry added |
| Grant kinds (`apps-data`, `container-logs`) | none added |
| `PatchDraftRequest` | still closed to its four fields |
| `POST /api/drafts/:id/finalize` | still takes no body |
| `JobType` | no new type — the restore rides the existing deploy job |
| `POST /api/backups/:id/restore` | **the pre-existing dead stub** (`server.ts:1663-1668`), deliberately untouched — research R19, tracked by #160 |
