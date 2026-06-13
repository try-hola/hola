# ADR 0001: Authentication architecture

- **Status:** Accepted (June 2026)
- **Context:** Recovery epic #21, issue #53. Supersedes the PRD's earlier "Authentik + OIDC + API keys" sketch where it implied all of it ships at once.

## Context

Hola exposes a control plane (web UI, CLI, API) that manages deployments on a single host, and
it deploys applications (e.g. Gitea) that are reached through a consolidated **Traefik** front
door. There are therefore two distinct authentication surfaces:

1. **Control-plane auth** — who may call the Hola API / use the web UI / use the CLI to create and
   manage deployments.
2. **Application SSO** — a single login, external to each deployed app, that protects every app
   behind the Traefik front door (log in once, reach Gitea and everything deployed after it).

Before this decision the production server enabled auth but registered an **empty** API-key
provider — auth was "on" with zero usable credentials, so no one could authenticate. The web,
CLI, and shared `AUTH_API` routes were unimplemented.

## Decision

Authentication is delivered in **two phases**.

### MVP pt.1 — control-plane auth (this issue)
- **API keys** secure the control plane. A single **admin** API key grants full capability (`*`).
- **First-admin bootstrap:** the admin key comes from `HOLA_API_KEY` if set; otherwise, in
  production, the server generates a random key on first boot and persists it to
  `<data-root>/config/admin-api-key` (mode `0600`), logging the file **location** (not the secret)
  so the operator can retrieve it (`cat <data-root>/config/admin-api-key`). The same key is read
  back on subsequent boots.
- **Enforcement** (already present in `middleware/auth.ts`, gated by `featureFlags.useAuth`, which
  is **on by default in production**):
  - Public endpoints (no auth): `/healthz`, `/readyz`, `/metrics`, `/api/system/health`,
    `/api/system/status`, `/api/echo`.
  - Absent or invalid credentials → **401**.
  - Authenticated but missing the required capability → **403**.
  - Mutating routes (`POST`/`PATCH`/`DELETE` on deployments, drafts, settings, …) require a
    write/manage capability; reads require none.
- **Clients:** CLI/SDK send the key via `Authorization: Bearer <key>` or `X-API-Key` (env
  `HOLA_TOKEN`/`HOLA_API_KEY`). The web app, in pt.1, runs against an auth-disabled dev server or a
  reverse-proxy-injected key; a first-class browser login is pt.2.
- `GET /api/auth/me` returns the current principal so clients can confirm identity.

### MVP pt.2 — consolidated application SSO (future)
- An identity provider (Authentik or equivalent) fronts deployed apps via **Traefik forward-auth**,
  giving single sign-on across every deployed application.
- The Hola web UI adopts the same browser session/OIDC flow; API keys remain for CLI/service access.
- Capability/role mapping is sourced from the IdP (groups → capabilities).

## Trust boundaries
- Traefik terminates TLS and is the only ingress; the Hola API and deployed apps are not exposed on
  host ports.
- The admin API key is a bearer secret: treat the data root and logs as sensitive. Encryption at
  rest for the key store is future work.
- Test and development run with auth disabled (`featureFlags.useAuth = false`) and a synthetic
  system principal, so local development and the in-process test suite need no credentials.

## Consequences
- A fresh production deployment has a documented, usable way to establish the first administrator.
- The `AUTH_API` surface is trimmed to the implemented `me` endpoint; session endpoints
  (`login`/`logout`/`refresh`) are deferred to pt.2 rather than left as dead routes.
- No production mode ships with auth enabled but no usable credential.
