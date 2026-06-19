# @hola/compose

Production-capable, single-host Docker Compose stack for Hola: **Traefik** (ingress + TLS),
the **web** SPA, and the **API server**. The server orchestrates app deployments through the
host Docker engine and emits Traefik routing config so deployed apps (e.g. Gitea) become
reachable at `<app>.<HOLA_BASE_DOMAIN>`.

## Architecture

- **Single origin** — the `web` container (nginx) serves the SPA and reverse-proxies `/api`
  (including SSE log streams) to `hola-server:3001`. The browser only ever talks to one origin,
  so there is no CORS and only **one Hola domain** (`HOLA_DOMAIN`) to configure.
- **Traefik** terminates TLS, redirects HTTP→HTTPS at the entrypoint, and routes everything
  from the **file provider** at `/data/runtime/traefik` — both the server-emitted per-app routes
  (`dynamic.yml`) and the platform's own routes (`core.yml`: the UI at `HOLA_DOMAIN`, the
  dashboard, and the Authentik login UI). Traefik uses **no Docker provider and mounts no Docker
  socket**; the server is the single source of routing truth.
- **Persistence** — all server state (deployments, releases, sqlite, logs, generated Traefik
  config) lives in the `hola-data` named volume mounted at `/data`. It survives restarts and is
  the single thing to back up.
- **Prebuilt images** — the `server` and `web` services run published, version-pinned images
  (`ghcr.io/try-hola/server:<version>`, `ghcr.io/try-hola/web:<version>`) built by the CLI release
  workflow, so the host **pulls** them rather than building from source. `HOLA_VERSION` (set by
  `scripts/_common.sh` from the bundle's `VERSION` file) selects the tag. To build locally instead,
  opt into the build overlay: `HOLA_BUILD=1 ./scripts/up.sh --build`.

```
browser ──TLS──▶ Traefik ──▶ web (nginx: SPA + /api proxy) ──▶ server ──┬─▶ Docker engine (deploys apps)
                    │                                                     └─▶ /data/runtime/traefik/*.yml
                    └────────────────── routes deployed apps ◀────────────────────┘ (file provider)
```

## Prerequisites
- A host with **Docker** and the **Docker Compose v2** plugin (`docker compose version`).
- DNS (or `/etc/hosts`) pointing your domains at the host.

## Install (production)

### Guided (recommended) — the `hola` CLI

The CLI walks you through the config, **validates it before anything is applied** (DNS, TLS/DNS-01
credentials, catalog reachability), and writes the `.env` for you:

```bash
# On your laptop — produce a validated .env (no server contact):
hola init

# …or do it all the way to a remote host over SSH (wizard → download → install):
hola bootstrap --host user@your-vm        # add --dry-run first to preview the plan
```

`hola bootstrap` SSHes in (reusing your ssh-agent / `~/.ssh/config`), checks the host has Docker +
Compose v2 (plus `curl`/`tar` — **no git or build toolchain needed**), downloads the compose
bundle for your CLI's release version, writes the `.env` (streamed over stdin so secrets never hit
the command line), and runs `./scripts/install.sh` — which pulls the matching `ghcr.io/try-hola`
images and brings the stack up, streaming the output back. Secrets (Authentik keys etc.) are
generated **on the host** and never leave it. Re-running with a newer CLI is an upgrade: it
downloads the new bundle and re-runs the idempotent installer.

### Manual

From a source checkout you can install directly (this builds the images locally, since a checkout
has no `VERSION` file pinning a published tag):

```bash
cd packages/compose
cp .env.example .env                       # set HOLA_DOMAIN, HOLA_BASE_DOMAIN, LETSENCRYPT_EMAIL, ...
HOLA_BUILD=1 ./scripts/up.sh --build       # build server/web from source and start (production)
# or manually:
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

`./scripts/install.sh` defaults to the **production** stack. On a released host (the bundle ships a
`VERSION` file) it **pulls** the version-pinned `ghcr.io/try-hola` images; from a source checkout,
opt into the build overlay (`HOLA_BUILD=1`) as above to build them locally. The dev overlay
(`docker-compose.dev.yml`) is opt-in via `HOLA_DEV=1`, and because the overlays are named `*.dev.yml`
/ `*.build.yml` (not `*.override.yml`) `docker compose` never auto-merges them — so a fresh-host
install is always production-pull.

### Retrieve the admin API key
Auth is **on by default in production**. If you did not set `HOLA_API_KEY` in `.env`, the server
generates one on first boot and writes it into the data volume. Retrieve it with:

```bash
docker compose exec server cat /data/config/admin-api-key
```

Send it as `Authorization: Bearer <key>` (or `X-API-Key: <key>`) from the CLI/SDK, or set
`HOLA_TOKEN` for the CLI. See `docs/adr/0001-authentication.md`.

## Local development

```bash
cd packages/compose
cp .env.example .env
HOLA_DEV=1 ./scripts/up.sh    # opt into the dev overlay (docker-compose.dev.yml)
# or: bun run dev
```

Dev runs the monorepo with Bun dev servers (hot reload) over **HTTP only** (no TLS/LE). The web
dev server (Vite, internal `:5173`) proxies `/api` to the server container. Add the dev domains to
`/etc/hosts`:

```
127.0.0.1 app.local.hola traefik.local.hola
```

Then open `http://app.local.hola`. (Auth is disabled in development.)

## TLS (production)
- Set `LETSENCRYPT_EMAIL` and use real, internet-resolvable domains for `HOLA_DOMAIN` and
  `TRAEFIK_DASHBOARD_DOMAIN` pointing at the host.
- `install.sh` creates `traefik/acme/acme.json` (chmod 600). Certs are stored there.
- **Default is HTTP-01** — a per-host cert is issued on demand for each domain (the UI, the
  dashboard, the Authentik UI, and every deployed app at `<app>.<HOLA_BASE_DOMAIN>`). This
  requires the host to be **reachable from the internet on port 80** so Let's Encrypt can
  validate.

### Private / homelab TLS (DNS-01)
If the host is **not reachable from the internet** (e.g. a homelab box behind NAT), HTTP-01
can't validate. Use **DNS-01** instead: Traefik proves domain control by writing a TXT record
through your DNS provider's API, so no inbound port is needed — and it can issue a single
**wildcard** cert (`*.<HOLA_BASE_DOMAIN>`) covering the UI, dashboard, Authentik, and every app.

Your A records can point at private IPs (`10.x` / `192.168.x`); only the domain's *public DNS*
needs to be API-manageable. (A made-up internal-only domain like `*.home`/`*.lan` won't work —
Let's Encrypt can't sign names it can't validate; you'd need an internal CA for those.)

Enable it in `.env`:

```bash
ACME_DNS_PROVIDER=route53            # or: cloudflare
# Route 53:
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
# AWS_HOSTED_ZONE_ID=...             # optional; pin if the account has several zones
# Cloudflare instead:
# CF_DNS_API_TOKEN=...               # scoped token with Zone:DNS:Edit
```

Then run `./scripts/install.sh` (or `./scripts/up.sh`). When `ACME_DNS_PROVIDER` is set, the
DNS-01 overlay (`docker-compose.dns01.yml`) is included automatically and a wildcard cert is
requested for `*.<HOLA_BASE_DOMAIN>`. Manually that's:

```bash
docker compose -f docker-compose.yml -f docker-compose.dns01.yml up -d
```

Example for `HOLA_BASE_DOMAIN=hola.get2know.io`: one `*.hola.get2know.io` cert serves
`app.hola.get2know.io` (UI), `traefik.`/`auth.`, and `gitea.`/`n8n.`/… apps. The Route 53 IAM
principal needs `route53:ChangeResourceRecordSets`, `GetChange`, `ListHostedZonesByName`, and
`ListResourceRecordSets` on the zone. Note the wildcard is single-level, so deployed apps must
be one label under the base (they are: `<app>.<HOLA_BASE_DOMAIN>`).

## Upgrade

The supported upgrade path is `hola bootstrap` with a newer CLI — it downloads the new bundle
(which pins the new image tags) and re-runs the idempotent installer. On the host directly:

```bash
cd packages/compose
./scripts/up.sh --pull always   # pull the version-pinned images and recreate changed services
```

(From a source checkout, `git pull` then `HOLA_BUILD=1 ./scripts/up.sh --build` to rebuild locally.)
State in the `hola-data` volume is preserved across upgrades.

## Backup & restore
Everything durable is in the `hola-data` volume.

```bash
# Backup
docker run --rm -v hola-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/hola-data-$(date +%F).tgz -C /data .

# Restore (stack stopped)
docker run --rm -v hola-data:/data -v "$PWD":/backup alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/hola-data-YYYY-MM-DD.tgz -C /data"
```

Also keep a copy of `.env` and `traefik/acme/acme.json`.

## Security: the Docker socket
The server mounts `/var/run/docker.sock` so it can run `docker compose` for deployments. **This
grants control of the host's Docker engine** (effectively root on the host). Run Hola only on a
host you trust, keep the admin API key secret, and do not expose the API without auth.

## App catalog
The install wizard browses a remote **catalog** of installable apps. The server fetches the
catalog JSON from `HOLA_CATALOG_URL`, set in `.env`:

```bash
# the official catalog (the default in .env.example)
HOLA_CATALOG_URL=https://raw.githubusercontent.com/try-hola/apps/main/catalog.json
```

- **Default (turnkey):** `.env.example` ships pointing at the official `try-hola/apps` catalog, so a
  fresh install shows published apps (e.g. Gitea) out of the box.
- **Self-host:** point `HOLA_CATALOG_URL` at your own `catalog.json` (same shape; see the
  [apps repo](https://github.com/try-hola/apps)).
- **Disable:** leave `HOLA_CATALOG_URL` blank — the catalog is empty and you install by
  pasting/uploading a Compose file instead.

Apps are pulled from GHCR (`ghcr.io/try-hola/*`) as OCI bundles; the bundle's `compose.yaml`
becomes the deployment. Pulling requires the package to be **public** (or a registry token).

## Authentication & SSO
Catalog apps can integrate with single sign-on. When enabled, Hola deploys **Authentik** (an
all-in-one SSO platform) as part of the stack and **auto-provisions** each app's auth on install —
e.g. for an app with native OIDC, Hola creates the OAuth2 client in Authentik and injects the
issuer/client id/secret into the app, so SSO works on first boot with no manual setup.

This is **opt-in** (Authentik needs ~2 GB RAM + Postgres). Enable it in `.env`:

```bash
HOLA_AUTH_MODE=authentik          # default is `none` (no SSO platform)
HOLA_AUTHENTIK_DOMAIN=auth.example.com   # browser-facing login UI (needs DNS + TLS)
```

Then run `./scripts/install.sh`. It will:
- generate per-install secrets into `.env` (`AUTHENTIK_SECRET_KEY`, `AUTHENTIK_PG_PASS`,
  `AUTHENTIK_BOOTSTRAP_PASSWORD`, `AUTHENTIK_BOOTSTRAP_TOKEN`) — idempotent; existing values are kept;
- reuse the bootstrap token as `HOLA_AUTHENTIK_API_TOKEN` (the server's provisioning credential);
- set `HOLA_AUTHENTIK_PUBLIC_URL` and add `authentik` to `COMPOSE_PROFILES` so the stack starts.

The Authentik services (`authentik-server`, `authentik-worker`, `authentik-postgres`) run under the
`authentik` compose profile; the server reaches Authentik internally at `http://authentik-server:9000`
and the login UI is served at `HOLA_AUTHENTIK_DOMAIN`. First admin login is `akadmin` with the
generated `AUTHENTIK_BOOTSTRAP_PASSWORD`.

**App auth styles.** Hola auto-provisions three integration styles per app:
- **native-OIDC** — registers an OIDC client and injects (or, for CLI-configured apps like Gitea,
  runs a setup command with) the issuer/client id/secret. Works out of the box.
- **forward-auth** — protects apps with no native auth via the embedded proxy outpost (Traefik
  forward-auth middleware). Works out of the box.
- **native-LDAP** — for apps that bind to an LDAP directory; **needs one-time setup** (below).

An app's manifest can also set `auth.fallback: forward-auth` to gate a native-OIDC (or
no-auth) app behind the proxy *as well*, for defense-in-depth.

### native-LDAP one-time setup
The bind-account half is automatic (Hola creates a per-app LDAP service account on install), but the
shared LDAP directory needs an outpost you create once:
1. In Authentik, create an **LDAP Provider** (set its **Base DN**, e.g. `dc=hola,dc=internal`) and an
   **Outpost** of type *LDAP* bound to it.
2. Copy the outpost's **token** into `AUTHENTIK_LDAP_OUTPOST_TOKEN` in `.env`, and set
   `HOLA_AUTHENTIK_LDAP_BASE_DN` to the same Base DN.
3. `docker compose up -d authentik-ldap` — the outpost connects and serves the directory at
   `authentik-ldap:3389` on the `hola` network. native-LDAP apps then bind automatically.

(Pinning the outpost token without this manual copy is a known Authentik gap; revisit when upstream
supports it.)

Notes & limitations:
- The bootstrap token is the **akadmin superuser** token. Acceptable for first delivery; a scoped
  least-privilege service-account token is a planned hardening follow-up.
- We **do not** mount the Docker socket into Authentik — Hola runs any outposts as its own services.
- A lightweight Authelia+LLDAP backend (for low-RAM hosts) is tracked separately.

## Deploying apps & routing
When you deploy an app through Hola, the server writes a Traefik router/service for it into
`/data/runtime/traefik/dynamic.yml`, which Traefik picks up automatically. For Traefik to reach the
app container, the app's Compose services must join the external `hola` network under the service
name Hola expects. Validating this end-to-end (e.g. deploying Gitea) on a real Docker host is
covered by the integration test in issue #19.

The platform's own services route the same way: at startup the server emits `core.yml` next to
`dynamic.yml`, with file-provider routers for the UI (`HOLA_DOMAIN` → `hola-web:80`), the Traefik
dashboard (`TRAEFIK_DASHBOARD_DOMAIN` → the built-in `api@internal`), and — when
`HOLA_AUTH_MODE=authentik` — the Authentik login UI (`HOLA_AUTHENTIK_DOMAIN` →
`authentik-server:9000`). Because everything comes from the file provider, **Traefik mounts no
Docker socket** (only the `server` container does, to orchestrate deployments).

## Troubleshooting
- `docker compose config` — validate your `.env` and merged configuration.
- `./scripts/logs.sh` / `docker compose logs -f traefik server web` — follow logs.
- `./scripts/status.sh` / `docker compose ps` — service/health status.
- **502 from the UI** — the `server` container isn't healthy yet; check `docker compose logs server`.
- **No TLS cert** — domains must be public and resolve to the host for Let's Encrypt HTTP-01.
- **Deployed app not routable** — confirm its Compose joined the `hola` network and that
  `/data/runtime/traefik/dynamic.yml` contains its router.

## Files
- `docker-compose.yml` — production stack (build, server socket, data volume, Traefik file provider only).
- `docker-compose.dev.yml` — opt-in local dev overlay (Bun dev servers, HTTP only); `HOLA_DEV=1`.
- `docker-compose.dns01.yml` — opt-in DNS-01 TLS overlay (wildcard cert for private/homelab
  hosts); auto-included when `ACME_DNS_PROVIDER` is set.
- `../server/Dockerfile`, `../web/Dockerfile`, `../web/nginx.conf` — images.
- `.env.example` — domains, ports, admin auth, catalog URL, SSO (Authentik) settings.
- `scripts/` — install/up/down/logs/status helpers.
