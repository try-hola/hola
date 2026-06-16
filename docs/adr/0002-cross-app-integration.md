# ADR 0002: Cross-app integration via capability providers

- **Status:** Accepted (June 2026)
- **Context:** Discussion of a default dashboard (Homer/Homepage) and how apps like a
  dashboard or a backup tool should learn about other installed apps. Builds on the
  per-app data root (`${HOLA_APP_DATA}`) and install tokens (`${HOLA_APP_HOST}`).

## Context

Some apps are only useful in relation to *other* installed apps:

- a **dashboard** (Homer, gethomepage/homepage) wants a tile per app — name, icon, URL;
- a **backup** tool wants every app's data directory in its backup set.

Two questions follow. (1) Should Hola ship/auto-install a dashboard? (2) What is the
mechanism by which such an app gets wired to the current set of installed apps?

Hola already centrally owns the source of truth these apps need. The routing layer
maintains the full map of every deployment → its public host (`<app>.<base-domain>`),
emitted as Traefik config; the catalog supplies icons; `${HOLA_APP_DATA}` gives each app
one stable data root. The server is already the orchestrator that *reconciles* derived
state (Traefik dynamic config, per-app auth via `ProvisionerService` + the manifest
`auth` block) from the deployment set whenever it changes.

A tempting alternative is an **app-to-app notification bus**: apps subscribe to "app
installed/removed" events and mutate themselves. Rejected — see below.

## Decision

### 1. No auto-installed dashboard; Hola's own UI is the default home

Hola does not auto-install a separate dashboard app. The default landing (`/apps`) is a
read-only launcher in Hola's own web UI, rendered from data the server already has
(deployments joined with catalog icons). This is always present and needs no
synchronization. Homer/Homepage remain **opt-in** catalog apps for users who want a
customizable, public-facing dashboard distinct from the admin console.

### 2. Cross-app wiring is server-owned reconciliation, not app-to-app events

Integration is modeled on the existing `auth`-block + `ProvisionerService` pattern: an app
**declares a capability** in its manifest; the **server** does the wiring by reconciling
that app's config from the registry it already maintains, on every install/uninstall.

```
manifest.json:
  provides: dashboard     # or: backup   (a capability the server reconciles)
```

- **Dashboard provider** → on app-set change, the server regenerates the provider's config
  (e.g. Homepage `services.yaml`) into its `${HOLA_APP_DATA}/config` from the routing map
  (app, host, icon).
- **Backup provider** → the server maintains the provider's include list of per-app data
  roots (`<HOLA_APPS_BIND_ROOT>/<deploymentId>/`).

The event bus exists, but it is **internal to the server** (install/uninstall → run
reconcilers). Subscribers are server-side reconcilers, never the apps themselves.

### Rejected: app-to-app notifications

Letting catalog apps receive system events and react turns curated, static compose
bundles into active agents: each would need a callback token / API access and the right to
mutate config, and would own its own ordering, idempotency, retry, and partial-failure
handling outside Hola's control. This is a large security and complexity escalation for no
benefit over server-owned reconciliation, since the server already holds the registry.

## Consequences

- The app launcher ships first as a thin, read-only view (no new app, no sync). This ADR's
  initial increment populates `deployment.url` server-side and adds the `/apps` landing.
- Provider apps stay "dumb" bundles that only declare a capability; integration logic lives
  in Hola — testable, idempotent, version-controlled, and security-reviewed in one place.
- The model generalizes: dashboards and backups are both reconcilers over the same
  registry; future consumers (e.g. monitoring) follow the same shape.
- A reconciler writes into a provider's `${HOLA_APP_DATA}`, which the server already creates
  and owns — no new privileged surface on the apps.

## Status of follow-on work

- **Now (this increment):** `/apps` landing + server-populated `deployment.url`.
- **Phase 1:** manifest `provides` capability + server reconciler hook on app-set change;
  dashboard reconciler first (Homepage as reference provider, opt-in).
- **Phase 2:** backup reconciler as a second provider over the per-app data roots.
