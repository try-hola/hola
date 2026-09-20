# Contract: On-Disk Records

**Feature**: `specs/006-install-identity` · **Date**: 2026-09-20

## There is no API, CLI or UI contract in this feature

Stated plainly because it is the feature's defining property, not an oversight:

- **No HTTP surface.** No route added, removed or changed. No response body gains
  a field. The API explorer's error table is untouched.
- **No CLI surface.** No command, flag or output change.
- **No web surface.** No component, page or rendered string changes.
- **No capability-contract change.** The contract vocabulary
  (`packages/shared/src/contracts.ts`) is untouched: no new contract, no change to
  `backup@1`, no new grant kind, no change to any consent text.
- **No catalog surface.** No manifest field, no bundle schema change, no change to
  `try-hola/apps`.

Spec FR-018 and SC-008 require this, and the implementation should treat any
pressure to add one of the above as a signal that work has drifted into
Sequence 5 or 6.

## The only external contract is the file format

Two JSON documents under `<apps-bind-root>/<deploymentId>/.hola/`. Their exact
fields, types, source expressions, nullability and examples are specified in
[`../data-model.md`](../data-model.md) and are not duplicated here.

| File | Mode | Content | Consumers |
| --- | --- | --- | --- |
| `instance.json` | `0644` | Install identity: schema, writer version, ids, lineage, app, version, channel, source, name, subdomain, host, accepted contracts, backup participation ids. | None in this feature. Future: Sequence 5/6; a human reading a capture. |
| `env.json` | `0600` | Schema, timestamp, deployment id, and the install's resolved app environment. | Same. |

### Who can read them

The apps bind root is identity-mounted **read-only in its entirety** into every
service of a deployment holding the `apps-data` grant
(`compose-mounts.ts:152-168`, called from `deployment.ts:1751`/`:1763`). There is
no per-app or per-file exclusion. So a consented backup provider reads both
records by design — that is the point of writing them. The `0600` mode on
`env.json` restricts ordinary and unprivileged readers (an app's own non-root
container, a person browsing the folder), not the provider.

### Compatibility rules for future writers

These records will outlive this feature inside captures that cannot be rewritten,
so the compatibility rules are part of the contract:

1. **`schema` is per-record.** `instance.json` and `env.json` version
   independently. Both start at `1`.
2. **Additive changes do not bump `schema`.** A reader must ignore unknown fields.
3. **Removing or retyping a field bumps `schema`.**
4. **A reader must tolerate an older `schema`** and must tolerate a record it has
   never seen a version of — it degrades to path-based inference rather than
   failing (spec US3 scenario 3).
5. **A reader must tolerate one record present and the other absent.** The pair is
   written by two calls; a failure between them is possible (FR-016 keeps the
   deploy alive either way).
6. **A reader must never assume the record describes the data beside it.** A
   capture taken mid-deploy can pair a new record with older data. Records are
   evidence, not proof.
