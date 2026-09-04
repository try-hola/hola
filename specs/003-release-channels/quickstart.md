# Quickstart: validating Release Channels

**Feature**: `003-release-channels` · Branch `003-release-channels`

## Prerequisites

```bash
bun install
bun run typecheck && bun run lint && bun run build
```

## 1. Unit/integration suites (hermetic, no Docker)

```bash
# server: catalog parsing, shared helpers, guard, offers, PATCH, promote
bun --cwd packages/server test src/__tests__/shared/channels.test.ts \
  src/__tests__/catalog/catalog-channels.test.ts \
  src/__tests__/bundles/catalog-remote.test.ts \
  src/__tests__/deployments/channels.test.ts \
  src/__tests__/deployments/persistence.test.ts \
  src/__tests__/deployments/update-info.test.ts \
  src/__tests__/deployments/promote-endpoint.test.ts

# cli + web
cd packages/cli && npx vitest run src/__tests__/install.test.ts src/__tests__/deployments-list.test.ts src/__tests__/catalog.test.ts src/__tests__/deployment-actions.test.ts
cd packages/web && npx vitest run src/__tests__/pages

# everything
bun run test
```

Expected: all green; pre-existing fixtures (stable-only catalogs, records without
`channel`) pass unchanged (SC-004).

## 2. Scenario walk-through against a dev server

Serve a catalog with two channels. Any static host works; the server accepts a `data:`
URL only in tests, so use a file server or a custom catalog source:

```json
{ "apps": [ { "id": "demo", "name": "Demo",
  "versions": [
    { "version": "1.2.0",      "channel": "stable", "refs": { "oci": "ghcr.io/try-hola/demo:1.2.0" } },
    { "version": "1.3.0-rc.1", "channel": "rc",     "refs": { "oci": "ghcr.io/try-hola/demo:1.3.0-rc.1" } },
    { "version": "1.3.0-rc.2", "channel": "RC",     "refs": { "oci": "ghcr.io/try-hola/demo:1.3.0-rc.2" } }
  ] } ] }
```

```bash
HOLA_CATALOG_URL=http://localhost:8000/catalog.json bun run dev:server
```

| Step | Command | Expect |
|---|---|---|
| US1-1 | `hola catalog` | `demo` shows `1.2.0` and `(channels: rc)`; server log has one `warn` for the `RC` entry |
| US1-2 | `hola install demo` | installs `1.2.0`; no "Following channel" line |
| US2-1 | `hola install demo --channel rc --as demo-beta` | succeeds without `--allow-multiple`; prints `Following channel: rc`; `hola deployments` shows `demo-beta [rc]` |
| US2-3 | repeat US2-1 with `--as demo-beta-2` | `409` single-instance message naming channel `rc` |
| US2-4 | `hola install demo --channel beta --as demo-x` | succeeds — `beta` has no dedicated version, but `1.2.0` (stable) is eligible on every channel (the floor, FR-003), so it installs `1.2.0` and prints `Following channel: beta`. (`NO_VERSION_ON_CHANNEL` needs an app with **no stable version at all** to demonstrate — see `channels.test.ts` "an app with no stable version at all") |
| US2-5 | `hola uninstall <demo-beta-id> --yes`, then `hola install demo@1.3.0-rc.1 --name demo-rc2` | succeeds without `--channel`; prints `Following channel: rc` (implied by the pinned version); with `demo-beta` still installed the same command is a `409` because a copy already follows `rc` |
| US2-6 | `hola install demo@1.3.0-rc.1 --channel stable --name y` | `VERSION_NOT_ON_CHANNEL` |
| US3-3 | `curl /api/deployments` | the stable `demo` row has no `updateAvailable` |
| US3-4 | `hola upgrade <stable-id> --app-version 1.3.0-rc.1` | `VERSION_NOT_ON_CHANNEL` with the PATCH hint |
| US4-1 | `curl -X PATCH /api/deployments/<stable-id> -d '{"channel":"rc"}'` | `{ ok: true, warnings: ["…already follows rc"] }`; running version unchanged; `updateAvailable` now true with `latestVersionChannel: "rc"` |
| US4-4 | PATCH `{"channel":"Bad Name"}` | `400 INVALID_CHANNEL` |

Dashboard (`bun run dev:web`): Catalog card shows `rc available` and, once `demo` is
installed on stable, **Install on rc**; wizard shows the Channel select; Deployments list
shows the `rc` pill on `demo-beta`; detail shows `Channel: rc` and `Instance: rc copy of demo`;
the Channel select on the stable copy PATCHes and shows the warning.

## 3. Disposable-VM smoke (optional, needs Proxmox env)

`bin/vm-e2e-suite` is unchanged and must still pass (stable-only flow). No new VM suite is
added by this feature.

## 4. Gates before PR

```bash
bun run typecheck && bun run lint && bun run typecheck && bun run test && bun run build
```
(typecheck twice on purpose: once before and once after any lint auto-fix.)
