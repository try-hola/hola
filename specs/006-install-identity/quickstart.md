# Quickstart: Verifying Install Identity

**Feature**: `specs/006-install-identity` · **Date**: 2026-09-20

Two ways to prove this works: the unit suite (authoritative, runs in CI) and a
disposable VM (proves it on a real host with real file modes and a real catalog
app). Shapes referenced here live in [`data-model.md`](./data-model.md).

---

## 1. Gates

```bash
bun run typecheck && bun run lint && bun run typecheck && bun run test && bun run build
```

`typecheck` runs twice on purpose: CI has caught regressions that a lint auto-fix
introduced after the first pass (CLAUDE.md, Constitution VII).

Targeted iteration while developing:

```bash
bun --cwd packages/server test src/__tests__/deployments/install-markers.test.ts
```

---

## 2. Unit verification

New suite: `packages/server/src/__tests__/deployments/install-markers.test.ts`.

**Harness**: copy `backup-hooks.test.ts:65-95`. Real `RealStorageService` over a
`mkdtemp` dir, `process.env.HOLA_APPS_BIND_ROOT` pointed at a *second* `mkdtemp`
dir (saved and restored around each test), real database/logging/job/routing/draft
services, `MockDockerService` + `MockProvisionerService`, driven through
`drafts.createDraft` → `finalizeDraft` → `deployments.createFromDraft` →
`waitForJob`.

**`MockStorageService` cannot be used for mode assertions** — it stores content in
a `Map` and only logs the `mode` (`storage.ts:378-382`). A mode check against it
would silently assert nothing (research R11).

Scenarios to cover, mapped to requirements:

| # | Scenario | Asserts |
| --- | --- | --- |
| 1 | Install an app whose compose uses `${HOLA_APP_DATA}` | `instance.json` under `<appsRoot>/<id>/.hola/`, `env.json` under `<appsRoot>/.hola/<id>/`; every FR-003/FR-004 field present and correct |
| 1a | Recursively walk `<appsRoot>/<id>/` after an install | `instance.json` is there; **no `env.json` anywhere under it** — the #478 invariant, swept rather than path-checked so a move to a different subdirectory still fails |
| 2 | `fs.stat` both records, mask `& 0o777` | `instance.json` → `0o644`; `env.json` → `0o600` (FR-005, FR-012) |
| 2a | `fs.stat` `<appsRoot>/.hola/` and `<appsRoot>/.hola/<id>/` | Both `0o700` — `mkdir -p` would otherwise leave the outer one umask-wide and every install enumerable (FR-012) |
| 3 | Fresh install | `lineageId === deploymentId` (FR-008) |
| 4 | Install an app with **no** `${HOLA_APP_DATA}` | No app root created at all, **and** no `<appsRoot>/.hola/<id>/` — "no data root" no longer implies "no records" (FR-015) |
| 5 | Upgrade to a new version, re-read | `appVersion` is the new version; `writtenAt` advanced (FR-006, SC-006) |
| 6 | Restart / promote / rollback | `lineageId` unchanged throughout (FR-009, SC-004) |
| 7 | Manifest declaring `accepts: ["backup@1"]` with two participations | `accepts` verbatim; `participations["backup@1"]` lists both ids (FR-004) |
| 8 | Manifest with the legacy singular `backup` block | `participations["backup@1"] === ["default"]` (R6) |
| 9 | Manifest with no backup block | `participations` has no `backup@1` key (data-model) |
| 10 | App with generated env values | `env.json`'s `env` matches `readActiveAppEnv` output; contains no provisioned OIDC values (data-model) |
| 11 | Corrupt the release `manifest.json` **for the duration of this feature's own read**, then deploy | Deploy still **succeeds**; exactly one warning naming the deployment id; no throw; neither record rewritten (FR-016, SC-007). See the note below — a *globally* corrupt manifest fails the deploy earlier, by pre-existing design |
| 12 | Make the app root unwritable, then deploy | Same as 11 — deploy survives (FR-016) |
| 13 | Deploy twice | Second write replaces the first in **both** directories; no temp file left behind in either (FR-019, SC-009) |
| 14 | Deploy, delete both record directories, deploy again | Both records reappear with no operator action and no migration step — the mechanism by which installs predating this feature acquire them (FR-017, SC-001) |
| 15 | Upgrade, then roll back with `restoreData: true` | The data root is wiped and replaced from the pre-upgrade archive containing *older* records, then materialize rewrites them: `appVersion` describes the release **brought up**, not the one rolled away from (FR-006, SC-010) |
| 16 | Change the app's env, re-materialize | `env.json`'s `env` reflects the new values (FR-013) |
| 17 | Uninstall the app | **Both** locations removed — the data root *and* `<appsRoot>/.hola/<id>/`. Sweep the whole apps root afterwards: nothing named for the install, and no `env.json`, survives (spec Edge Cases) |
| 17a | Delete the data root by hand, then uninstall | The env record is still removed — the two deletes are independent, so an install whose data root is already gone does not orphan a directory of secrets (#478) |
| 18 | Upgrade with `snapshot: true` after writing real app data, then `tar -tzf` the resulting `data.tar.gz` | The archive lists `.hola/instance.json` and the app's own data, and **no `env.json`** — the world-readable pre-upgrade archive carries no secrets (#478 item 2) |

Scenario 11 is the one most likely to be skipped and most likely to matter: the
manifest read is *inside* the try/catch precisely because it throws (research R8).

**A correction discovered during implementation.** Scenario 11 cannot be run
"globally": `materializeCompose` reads the active manifest **unguarded** several
times *before* this feature's call site — `readActiveIngressService` at
`deployment.ts:1702` versus the marker write at `:1773` — and
`readReleaseManifest` throws a `ServiceError` on corrupt JSON with the explicit
reasoning "refusing to operate on this deployment with unknown auth/config". So a
genuinely corrupt manifest fails the deploy before this feature's code runs, and
that pre-existing behaviour (covered by `corrupt-manifest.test.ts`) is correct and
not this feature's to relax. What FR-016 actually promises is narrower and still
worth having: *if this feature's own manifest read fails, that failure must not
escape the helper.* The test brackets the corruption tightly around the one read
this feature owns. The try/catch around the manifest read is therefore
defence-in-depth — against a manifest that changes between `:1702` and `:1773`,
and against any future refactor that reorders those reads — not a live path.

Scenario 15 is the second: it is the only automated check on the clarification
ruling that pins the write site. A refactor that hoists the write earlier in the
lifecycle job passes every other test in this table and silently breaks it.

Scenarios 1a, 17a and 18 are the third group, and they exist because the defect
they guard was shipped once already (#478). 1a is the load-bearing one: it is a
recursive sweep of the app data root, not a check that one old path is empty, so
a future refactor that puts the record back *anywhere* inside the app's mount
fails it.

---

## 3. Manual verification on a disposable VM

Proves real file modes, a real catalog app, and the read-only mount — none of
which the unit suite exercises. Background: `docs/MCP_VM_TESTING.md`.

```bash
bin/mcp-setup                      # confirm Proxmox env + hola.env exist
VMID=$(bin/vm-create | tail -1)
bin/vm-wait-ssh --vmid "$VMID"
ALIAS="hola-vm-$VMID"
```

Bootstrap with a server image carrying this branch (the released image will not
have it — see the `vm-e2e` skill's "Advanced" section for `docker save` |
`vm-ssh docker load`), then:

```bash
# Install any app that stores data
bin/vm-ssh --vmid "$VMID" -- 'hola install vaultwarden --name vault --yes'

# 1. The identity record is in the app's data root, 0644
bin/vm-ssh --vmid "$VMID" -- 'ls -la /srv/hola/apps/*/.hola/'
#   expect: -rw-r--r-- instance.json
#   expect: NO env.json here — that is the #478 fix

# 2. The environment record is in the SIBLING reserved dir, 0600 in a 0700 dir
bin/vm-ssh --vmid "$VMID" -- 'sudo ls -la /srv/hola/apps/.hola/ /srv/hola/apps/.hola/*/'
#   expect: drwx------ on /srv/hola/apps/.hola and on each <id> under it
#           -rw------- env.json

# 3. THE POINT OF THE AMENDMENT: env.json is not inside any app's mount.
#    From the host — nothing named env.json anywhere under a data root:
bin/vm-ssh --vmid "$VMID" -- 'sudo find /srv/hola/apps -mindepth 2 -name env.json -not -path "/srv/hola/apps/.hola/*"'
#   expect: NO OUTPUT. Any line here is the defect.
#
#    And from inside the app's own container, where /data is the data root:
bin/vm-ssh --vmid "$VMID" -- 'docker exec <app-container> sh -c "ls -la /data/.hola/ ; cat /data/.hola/env.json"'
#   expect: instance.json listed; env.json "No such file or directory"

# 4. The identity record is readable and complete
bin/vm-ssh --vmid "$VMID" -- 'cat /srv/hola/apps/*/.hola/instance.json'
#   expect every data-model field; lineageId === deploymentId === dir name

# 5. The environment record is root-only but present
bin/vm-ssh --vmid "$VMID" -- 'sudo cat /srv/hola/apps/.hola/<id>/env.json'

# 6. An app with no data root gets nothing, in EITHER location
#    install one, then confirm neither /srv/hola/apps/<its-id>/ nor
#    /srv/hola/apps/.hola/<its-id>/ exists

# 7. Upgrade refreshes the version
bin/vm-ssh --vmid "$VMID" -- 'hola upgrade <id> --yes'
bin/vm-ssh --vmid "$VMID" -- 'cat /srv/hola/apps/<id>/.hola/instance.json'
#   expect: appVersion is the new version

# 8. The pre-upgrade snapshot tarball carries no secrets (#478 item 2)
bin/vm-ssh --vmid "$VMID" -- 'sudo docker exec hola-server sh -c "tar -tzf /root/.hola/deployments/<id>/snapshots/*/data.tar.gz | grep -E \"instance.json|env.json\""'
#   expect: ./.hola/instance.json only. No env.json line.

# 9. An existing install gains the records with no operator action
#    (install BEFORE deploying this branch, then restart after — records appear)
bin/vm-ssh --vmid "$VMID" -- 'hola restart <id>'

# 10. Uninstall removes BOTH locations
bin/vm-ssh --vmid "$VMID" -- 'hola uninstall <id> --yes'
bin/vm-ssh --vmid "$VMID" -- 'sudo ls -la /srv/hola/apps/ /srv/hola/apps/.hola/'
#   expect: no <id> directory under either — no orphaned secrets

# 11. Both records are visible through the apps-data mount
#    install backrest (holds the grant), then from inside its container:
bin/vm-ssh --vmid "$VMID" -- 'docker exec <backrest-container> sh -c "cat /srv/hola/apps/<id>/.hola/instance.json; cat /srv/hola/apps/.hola/<id>/env.json"'
#   expect: BOTH readable — this is the design, not a leak (research R9). The
#   whole reason env.json went one level up rather than to the platform volume
#   is that this keeps working.
```

Teardown:

```bash
FORCE=1 bin/vm-destroy --vmid "$VMID"        # on pass
bin/vm-snapshot --vmid "$VMID" --name "failure-<reason>"   # on fail
```

---

## 4. What "done" looks like

- All gates green; the new suite covers every scenario above.
- A capture of any app's data folder answers "which app, which install, which
  version" with no access to the host (SC-002). A capture of the **apps root**
  additionally answers "what environment" (SC-003) — the data folder alone does
  not, and that narrowing is deliberate (#478).
- `env.json` appears nowhere under any app's data root, and nowhere in any
  pre-upgrade snapshot archive.
- Uninstall leaves nothing named for the install under the apps root, in either
  reserved location.
- **Nothing reads the records.** `grep -rn "instance.json\|env.json\|\.hola/" packages/`
  returns only the writer and its tests. If it returns a reader, scope has drifted
  into Sequence 5 (FR-018, SC-008).
