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

Two JSON documents, at **two different paths** under the apps bind root. Their
exact fields, types, source expressions, nullability and examples are specified
in [`../data-model.md`](../data-model.md) and are not duplicated here.

| File | Path | Mode | Content | Consumers |
| --- | --- | --- | --- | --- |
| `instance.json` | `<apps-bind-root>/<deploymentId>/.hola/instance.json` | `0644` | Install identity: schema, writer version, ids, lineage, app, version, channel, source, name, subdomain, host, accepted contracts, backup participation ids. | None in this feature. Future: Sequence 5/6; a human reading a capture. |
| `env.json` | `<apps-bind-root>/.hola/<deploymentId>/env.json` | `0600`, in a `0700` dir | Schema, timestamp, deployment id, and the install's resolved app environment. | Same. |

The two live apart on purpose (#478). `${HOLA_APP_DATA}` resolves to
`<apps-bind-root>/<deploymentId>` and is bind-mounted into the app's own
containers, overwhelmingly as `/data`; the identity record carries no secret and
belongs there, the environment record carries nothing but and does not. `.hola`
is reserved at both levels and can never collide with a deployment id
(`<app-slug>-<8 hex>`). A reader pairs the two through `deploymentId`, which both
records carry.

### Who can read them

**Both records**: any process privileged over the whole apps bind root. It is
identity-mounted **read-only in its entirety** into every service of a
deployment holding the `apps-data` grant (`compose-mounts.ts:152-168`, called
from `deployment.ts` with `hostPath = appsBindRoot()`), with no per-app and no
per-file exclusion — so a consented backup provider reads both by design. That
is the point of writing them, and it is why the environment record moved *up*
into the apps root rather than *out* to the platform's own data volume, which no
grant covers at all.

**`instance.json` additionally**: the app itself, and anyone holding a copy of
the app's data folder. It carries no secret, so this is intended.

**`env.json` additionally**: nobody. Specifically **not** the app whose install
it describes, and therefore not that app's end users — an app that serves, syncs
or browses its own data directory (a file manager, a sync tool, a media server
with a file browser) exposes everything inside its mount, and `0600` is no
defence because plenty of images run as root. The placement, not the mode, is
what excludes them. The `0600`/`0700` modes restrict ordinary unprivileged local
readers (a support engineer browsing the host); they do not restrict the
provider, which reads it by design.

**Nothing reads `env.json` out of a pre-upgrade snapshot archive**, because it
is not in one. `capturePreUpgradeSnapshot` tars the app data root only, and that
archive is written world-readable under the process umask and retained to the
retention bound (#478 item 2).

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
   written by two calls into two different directories; a failure between them is
   possible (FR-016 keeps the deploy alive either way). The identity record is
   written first, so a half-pair is the identity record alone.
6. **A reader must pair the records by `deploymentId`, never by directory.**
   They are not siblings on disk. A capture that preserves only one app's folder
   holds the identity record and no environment record at all — by design, not
   by corruption.
7. **A reader must never assume the record describes the data beside it.** A
   capture taken mid-deploy can pair a new record with older data. Records are
   evidence, not proof.
