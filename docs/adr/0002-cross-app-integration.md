# ADR 0002: Cross-app integration via a registry feed + bundle bolt-ons

- **Status:** Accepted (June 2026)
- **Context:** Discussion of a default dashboard (Homer/Homepage) and how apps like a
  dashboard or a backup tool should learn about other installed apps. Builds on the
  per-app data root (`${HOLA_APP_DATA}`) and install tokens (`${HOLA_APP_HOST}`).

## Context

Some apps are only useful in relation to *other* installed apps:

- a **dashboard** (Homer, gethomepage/homepage) wants a tile per app — name, URL, icon;
- a **backup** tool wants every app's data directory in its backup set.

Two questions follow. (1) Should Hola ship/auto-install a dashboard? (2) What is the
mechanism by which such an app learns the current set of installed apps?

Hola already centrally owns the source of truth these apps need: the routing layer knows
every deployment's public host (`<app>.<base-domain>`), and `${HOLA_APP_DATA}` gives each
app one stable data root the server writes into. The server is already the orchestrator
that reconciles derived state (Traefik config, per-app auth via `ProvisionerService` + the
manifest `auth` block) from the deployment set whenever it changes.

## Guiding principle: the bundle is the integration layer

A Hola catalog bundle is **the upstream app, untouched, plus hola-centric glue bolted
around it.** The server exposes a small set of **generic, stable primitives**; the bundle
*composes* them around the core image to deliver hola-specific benefits. The upstream image
never has to know about Hola, and **the server never has to know about the upstream app.**

This is already how the platform works: `${HOLA_APP_DATA}` (a data-root primitive),
`${HOLA_APP_HOST}`/`${HOLA_BASE_DOMAIN}` (install primitives), and platform defaults
(generic ops policy) are all primitives the bundle leans on. Cross-app integration is the
next primitive, and the app-specific part lives in the bundle — not the server.

## Decision

### 1. No auto-installed dashboard; Hola's own UI is the default home

Hola does not auto-install a separate dashboard app. The default landing (`/apps`) is a
read-only launcher in Hola's own web UI, rendered from data the server already has. It is
always present and needs no synchronization. Homer/Homepage remain **opt-in** catalog apps
for users who want a customizable, public-facing dashboard distinct from the admin console.

### 2. The server publishes a generic registry feed; the bundle renders it

The server's entire role is to maintain an **app registry** and deliver it to any app that
declares it wants it:

```jsonc
// manifest.json
"consumes": "app-registry"
```

On every app-set change (install / uninstall), the server writes a canonical
`registry.json` into that app's data root (`${HOLA_APP_DATA}/registry.json`):

```jsonc
{ "version": 1, "apps": [ { "id", "app", "name", "url", "icon", "status" }, ... ] }
```

The document carries a `version` so the schema can be revved later without breaking
consumers (they read `version` and tolerate unknown fields). That schema is the
**only** contract the server owns. It never learns what Homepage or
Homer is, and adding a new dashboard app to the catalog requires **no server change**.

**Rendering — turning the registry into an app's own config format — lives in the
bundle**, as a bolt-on around the core image: a small **watcher sidecar** that reads
`registry.json` and writes the app's config (e.g. Homepage's `services.yaml`), re-rendering
when the registry changes. It runs in the app's own Docker sandbox, holds no tokens, calls
no API, and touches no other app.

The same primitive serves backups: a backup bundle consumes the registry (which carries
each app's data-root) and includes those paths in its backup set — again, bundle-side.

The server has an **internal** event (app-set change → rewrite registry feeds). Subscribers
are the server's own feed-writer, never the apps.

### Rejected alternatives

- **App-to-app notification bus** — apps subscribe to system events and react. Turns
  curated, static bundles into active agents needing callback tokens / API access, each
  owning ordering, idempotency, retry, and failure handling outside Hola's control. Large
  security and complexity escalation for no benefit over the registry feed.
- **Server-side per-app rendering** — the server generating each provider's native config
  (a Homepage renderer, a Homer renderer, …). Rejected because it pulls app-format
  knowledge into the orchestrator: every new dashboard app would need a server release, and
  any format the server's engine can't express becomes a server change. That re-centralizes
  exactly what should evolve in the catalog. (A *generic* renderer sidecar image may be
  offered later as optional authoring sugar — but as a container, never server code.)

## Consequences

- The server stays a pure data-publisher with one tiny, versioned contract (`registry.json`
  + the `consumes` flag). All app-specific logic and execution lives in the catalog and runs
  in container sandboxes — testable and evolvable without server releases.
- The security boundary holds: the server pushes data one-way into a sandbox; apps never get
  events, tokens, API access, or reach into other apps.
- The model generalizes: dashboards and backups are both registry consumers; future
  consumers (monitoring, status pages) follow the same shape with no new server surface.
- Reactivity to later installs is the bundle's concern (a watcher sidecar), keeping the
  server free of per-provider restart logic.

## Status of follow-on work

- **Done:** `/apps` landing + server-populated `deployment.url` (#118).
- **This increment:** generic `consumes: app-registry` → `registry.json` feed on the server,
  written to consumers' data roots on app-set change.
- **Catalog (try-hola/apps):** Homepage bundle gains a watcher-sidecar bolt-on that renders
  `registry.json` → `services.yaml` and declares `consumes: app-registry`.
- **Later:** backup consumer; optional generic renderer-sidecar image as authoring sugar.
