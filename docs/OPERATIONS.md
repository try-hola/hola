# Hola Operations Guide

How to install, operate, and recover a single-host Hola deployment. For the
system design see [ARCHITECTURE.md](ARCHITECTURE.md); for authentication see
[adr/0001-authentication.md](adr/0001-authentication.md).

> Status legend: **Implemented** · **Optional** · **Roadmap**.

## Install

Prerequisites: a host with **Docker**, the **Docker Compose v2** plugin, and
**git**, with DNS pointing your domains at the host.

### One-line install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/try-hola/hola/main/install.sh | sh
```

This clones Hola (to `$HOLA_HOME`, default `/opt/hola` — created with `sudo` +
`chown` to your user when needed), prompts for the domain settings (or reads
`HOLA_DOMAIN` / `HOLA_BASE_DOMAIN` / `LETSENCRYPT_EMAIL` from the environment),
builds and starts the production stack, and prints the admin API key. Re-running
upgrades an existing install.

### Manual install

The production stack lives in `packages/compose`; its
[README](../packages/compose/README.md) is the authoritative, step-by-step
reference (prerequisites, TLS, upgrade, troubleshooting).

```bash
cd packages/compose
cp .env.example .env          # set HOLA_DOMAIN, HOLA_BASE_DOMAIN, LETSENCRYPT_EMAIL, ...
./scripts/install.sh          # builds + runs the production stack
```

Or use the guided CLI, which validates the config up front and (optionally) installs on a
remote host over SSH — `hola init` to generate a `.env`, or `hola bootstrap --host user@vm`
for the full remote install. See the [compose README](../packages/compose/README.md#guided-recommended--the-hola-cli).

### Authenticate

Auth is **on by default in production**. If you did not set `HOLA_API_KEY` in
`.env`, the server generates one on first boot and writes it into the data
volume:

```bash
docker compose exec server cat /data/config/admin-api-key
```

Send it as `Authorization: Bearer <key>` (or `X-API-Key: <key>`); for the CLI/SDK
set `HOLA_TOKEN`. Development and test run with auth disabled. See ADR 0001.

#### Dashboard sign-in

The web dashboard reads `GET /api/auth/config` (unauthenticated) at load to pick a
login flow:

- **SSO (default).** With `HOLA_AUTH_MODE=authentik` (what `hola init` always sets),
  the server self-provisions
  a public OIDC client for the dashboard at startup (registered at
  `https://<HOLA_DOMAIN>/auth/callback`) and the login screen shows **Sign in with
  SSO** — an Authorization Code + PKCE flow against Authentik. The browser sends the
  resulting access-token JWT as a Bearer header; the server validates it against
  Authentik's JWKS. Set `HOLA_OIDC_ISSUER` + `HOLA_OIDC_CLIENT_ID` to point at an
  external IdP instead, and `HOLA_OIDC_ADMIN_GROUP` to restrict write access to a
  group.
- **Admin-key fallback.** Without OIDC, the login screen accepts the admin API key;
  the server validates it and sets an `HttpOnly` session cookie, so the key is never
  stored in the browser.

When `HOLA_USE_AUTH=false` (dev/test) the dashboard loads with no login.

## Deploy an app

The web dashboard browses a remote **catalog** of installable apps, set via
`HOLA_CATALOG_URL` in `.env` (a fresh install defaults to the official
`try-hola/apps` catalog; blank it to disable, or point it at your own
`catalog.json`). With it set, `GET /api/catalog/apps` lists the apps and the web
catalog renders them. See the catalog notes in the compose
[README](../packages/compose/README.md#app-catalog).

#### Pulling bundles from a non-default registry

Each version in a catalog points at an OCI package (the loose-layer
`compose.yaml` + `manifest.json` bundle) in a registry. The server only pulls
from a registry the operator has consented to, matching against the
`HOLA_REGISTRY_ALLOWLIST` baseline (default `ghcr.io/try-hola/*`). This is a
typo-squat guard, not auth — a `ghcr.io.evil.com` ref can't slip past a
`ghcr.io/*` consent (glob-prefix anchored, not substring).

For a **private** package in another namespace, register a credential (the
credential's registry extends the allowlist automatically):

```bash
hola registry-cred add --registry ghcr.io/myorg --username <user> --token <PAT> --id myorg-ghcr
hola install <appId> --registry-cred myorg-ghcr
```

For a **public** package in a first-party namespace (no token needed), either
extend the baseline allowlist in the host `.env`:

```bash
HOLA_REGISTRY_ALLOWLIST=ghcr.io/try-hola/*,ghcr.io/myorg/*
```

or declare the consent per catalog source at `source add` time (the source's
`allowRegistries` is honored on every pull sourced from it):

```bash
hola source add myorg --url https://raw.githubusercontent.com/myorg/hola-apps/main/catalog.json \
  --allow-registry ghcr.io/myorg/*
hola refresh    # web UI refresh button hits the same force-refresh endpoint
hola install <appId>
```

You don't have to know the glob up front. Adding a source in the dashboard reads
the catalog first and lists the registries its apps actually publish from, with
a tick box per registry — grant them there and the source works from its first
install. `hola source add` without `--allow-registry` prints the same finding as
a note, including the `source update` line that grants it.

The install-by-ref escape hatch (`hola install <ociRef>`) has no source, so it
still needs either `--registry-cred` or the baseline allowlist to cover the ref.

##### Fixing `REF_NOT_ALLOWED` after the fact

A source added *without* `allowRegistries` fails every install from it with a 403:

```
REF_NOT_ALLOWED: ghcr.io/myorg/hola-cms:0.1.13 is not covered by the registry
allowlist (ghcr.io/try-hola/*).
```

The source doesn't need recreating — patch it in place:

```bash
hola source update myorg --allow-registry ghcr.io/myorg/*
```

`source update` is a patch: an omitted flag leaves that field alone,
`--allow-registry` replaces the stored glob list, and `--clear-allow-registry`
empties it back to the baseline. In the dashboard the same fix is offered on the
failure itself ("Allow `ghcr.io/myorg/*` for …", which grants it and retries the
install), or by editing the source under **Settings → Catalog Sources**.

Prefer the narrowest glob that covers the package — `ghcr.io/myorg/*`, not
`ghcr.io/*` — so consenting to one publisher doesn't consent to every other
namespace on that registry.

Through the web dashboard (or the SDK/CLI against the API), an app moves through:

```
catalog → draft → configure → validate → preflight → finalize →
deployment create → job (Compose up) → running → routed via Traefik
```

The deployment becomes reachable at `<app>.<HOLA_BASE_DOMAIN>` once its Traefik
router is emitted. Lifecycle actions — **start / stop / restart / delete** and
**rollback** — run as jobs; their state is reflected consistently across the
deployment's list, detail, and history views. See the
[deployment lifecycle](ARCHITECTURE.md#deployment-lifecycle) for the full path.

### Single sign-on (SSO)

SSO is the default. `HOLA_AUTH_MODE=authentik` deploys **Authentik** alongside the
stack and has Hola auto-provision each catalog app's auth on install (OIDC today);
`hola init` always sets it and `install.sh` generates the bootstrap secrets and
activates the `authentik` compose profile. Authentik needs ~2 GB RAM + Postgres.
Setting `HOLA_AUTH_MODE=none` by hand opts out (apps deploy without auth wiring) —
an advanced/dev escape hatch, not offered by the installer. See the SSO notes in the
compose [README](../packages/compose/README.md#authentication--sso).

### Routing generation

When an app is deployed, the server writes a Traefik router/service for it into
`/data/runtime/traefik/dynamic.yml` (and records canonical state in
`routing-map.json`). Traefik watches that file and picks up the route
automatically. For Traefik to reach the app, the app's Compose services join the
external `hola` network under the service name Hola expects. Ingress is
Traefik-only — apps do not publish host ports.

## Data layout

Everything durable lives under `HOLA_DATA_DIR` — the `hola-data` named volume
mounted at `/data` in the stack:

```
/data/
├── config/
│   └── admin-api-key            # generated admin key (first-boot bootstrap)
├── data/
│   └── hola.db                  # SQLite: jobs, durable records
├── drafts/<draftId>/
│   ├── draft.json               # mutable draft record
│   ├── files/                   # uploaded blobs (compose override, extra files)
│   └── finalized/manifest.json  # immutable finalized spec
├── deployments/<deploymentId>/
│   ├── deployment.json          # deployment record
│   ├── releases/<releaseId>/    # per-release manifest + rendered compose
│   └── runtime/docker-compose.yml  # materialized active project
├── runtime/traefik/
│   ├── routing-map.json         # canonical routing state
│   └── dynamic.yml              # Traefik file-provider config
├── logs/                        # server logs
└── cache/bundles/               # pulled OCI catalog bundles
```

This tree is the single thing to back up.

App data itself lives outside it, under `HOLA_APPS_BIND_ROOT`
(default `/srv/hola/apps/<deploymentId>/`) — see below for the supported way to
get bulk data into it.

## Pushing bulk data into an app

Some apps need data that's too big or too structured to go through their own web
upload: a Calibre library, a media tree, a document archive to seed Paperless.
Apps declare which of their directories accept that in their bundle manifest's
`push` block, and the CLI pushes to them:

```bash
hola app data push calibre-web-ab12cd34 --list          # what does this app accept?
hola app data push calibre-web-ab12cd34 library ~/Calibre\ Library --host me@server
```

What the command does, in order: resolve the named target to an absolute path
inside the deployment's data root (server-side — the client never has to know
Hola's on-disk layout), read the target directory's current ownership, stop the
app if the target declares `quiesce: stop`, rsync, restore ownership, run the
app's declared post-push hook, and start the app again.

Things worth knowing before you run it:

- **It's rsync, so re-pushing is cheap.** Fix some metadata locally, push again,
  and only the changed files cross the wire. This is the intended workflow, not
  a one-time seed.
- **It is one-way.** Your machine is the source of truth and the app's data root
  is a replica. Nothing is merged back, and changes made *in the app* to a
  pushed directory are not protected.
- **`mode: mirror` deletes.** A mirror target (rsync `--delete`) makes the server
  copy match yours exactly — files only on the server are removed. The CLI
  confirms before doing it unless you pass `--yes`. Mode is a property of the
  target, declared by the app, not a flag you choose.
- **`additive` is not add-only.** It doesn't delete, but a local file overwrites
  a same-named server file.
- **Passwordless sudo is required.** App data is written by containers as root,
  so the SSH user needs `sudo -n` on the server (both for the ownership fix and
  for the receiving rsync). The command probes for this and fails before moving
  any bytes if it's missing.
- **The target directory must already exist** — install the app first. The
  command will not create it, because the ownership it copies is the ownership
  the server established.

`--dry-run` prints the exact commands without connecting.

## Restart recovery

Hola is stateless in memory: all deployment, release, routing, and job state is
persisted under `/data` and **rehydrated on startup**. Restarting the server (or
the whole stack) restores deployments, their releases, the active-release
pointer, and Traefik routing from disk — running apps keep running, and the
dashboard reflects their true state after the restart.

```bash
cd packages/compose
docker compose -f docker-compose.yml restart server   # or: down && up
```

Recovery is verified end-to-end by the smoke and integration tests
(`__tests__/smoke`, `__tests__/integration/smoke-workflow.it.ts`), which recreate
the services over the same data dir and assert the deployment, release, and
routing survive.

## Logs

- **Server / stack logs:** `./scripts/logs.sh` or
  `docker compose logs -f traefik server web`.
- **Per-deployment job logs** stream through the API/dashboard (SSE) and are
  also written under `/data`.

## Backup & restore

Everything durable is in the `hola-data` volume (plus keep a copy of `.env` and
`traefik/acme/acme.json`). See the
[compose README](../packages/compose/README.md#backup--restore) for the exact
`tar` commands.

```bash
# Backup
docker run --rm -v hola-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/hola-data-$(date +%F).tgz -C /data .
```

> Scheduled/automatic backups and restore orchestration through the UI are
> **roadmap**; today backup/restore is the manual volume snapshot above.

### App backups and coverage

Hola takes no app backups of its own. A **provider** app from the catalog does
(Backrest today), and Hola brokers it: before the provider captures, the server
runs the pre-backup hook of every app that **accepts** the `backup@1` contract —
a `pg_dump` for a database-backed app — and the post-backup hook after (ADR
0004). An app that accepts the contract and declares no hook is already safe to
copy as it sits (SQLite, flat files).

The **Backups** page is the view over that: which app provides backups, whether
it's running, and which installed apps it covers. An app listed as *not covered*
is still captured as raw files, but nothing quiesces it first — a database there
may be copied mid-write and only reveal itself as unusable during a restore.
Each app's own detail page shows the same fact under its **Backups** tab.

## Upgrade

The supported upgrade path is `hola update` — it brings an existing install up to
the invoking CLI's version **without** re-running the setup wizard and **without**
touching your `.env` or the ACME cert store:

```bash
hola update --host user@vm          # upgrade to this CLI's version
hola update --host user@vm --check  # just report CLI / installed / latest versions
```

It preflights the host, takes a **pre-upgrade snapshot** (see below), downloads the
version-pinned compose bundle (pinning the new `ghcr.io/try-hola` image tags),
extracts it over the install dir, and re-runs the idempotent installer — which
pulls the new images, backfills any newly-required `.env` keys, and recreates only
the changed services. Use the same `--ref`, `--tarball-url`, `--dir`, and
`--dry-run` overrides as `hola bootstrap`.

**Pre-upgrade snapshot.** Before any change, `update` archives a timestamped
snapshot of the platform-tier rollback surface — `.env`, the `traefik/acme` cert
store, and the `hola-data` volume (drafts/deployments/platform state) — to
`<dir>/backups/pre-update-<version>-<timestamp>.tar.gz` on the host. It's a
synchronous local archive with no external dependency (it does **not** rely on the
Backrest app), and it's fail-closed: if the snapshot can't be written the upgrade
halts. App data lives under app-owned bind mounts and is **not** captured by default
(it's large and `update` doesn't recreate app stacks); pass `--backup-app-data` to
include the app-data bind root, or `--no-backup` to skip the snapshot entirely.

Keep the **same install dir** (`--dir`) across upgrades. The Let's Encrypt cert
store is a dir-relative bind mount (`traefik/acme/acme.json`), so relocating the
dir starts with an empty store and re-issues every cert.

**Pre-0.6.23 hosts (no SSO).** Authentik became the default in 0.6.23. A host with
an unset `HOLA_AUTH_MODE` is reconciled automatically (the installer enables
Authentik and generates its secrets). A host pinned to an explicit
`HOLA_AUTH_MODE=none` is left as-is and `update` asks you to choose — pass
`--enable-sso` to turn SSO on (derives `auth.<base>` and pulls in ~2 GB of
Authentik services) or `--keep-auth-mode` to keep it off.

To upgrade on the host directly instead of over SSH:

```bash
cd /opt/hola               # the install dir
curl -fsSL <bundle-url> | tar xz -C .   # extract the new bundle over the dir
HOLA_BOOTSTRAP=1 ./scripts/install.sh   # idempotent: pulls images, recreates changed services
```

State in the `hola-data` volume is preserved across upgrades. The web dashboard
shows an "update available" banner, and the CLI appends a one-line notice to any
command that talks to the server (both read one cached server-side check against
the newest published release). Run `hola update --check` for the discrete report,
or set `HOLA_NO_UPDATE_NOTICE=1` to silence the per-command notice.

### Release channels

Per-app releases (distinct from the *platform* upgrade above) can follow a
release **channel** other than the default `stable` — e.g. `rc` for a
pre-release build the catalog publishes alongside its stable release. See
[ADR 0005](adr/0005-release-channels.md) for the full model.

**Installing on a channel:**

```bash
hola install remo --channel rc --as remo-beta   # a new, channel-differentiated copy
hola install remo@0.11.0-rc.1 --name remo-beta  # channel implied by the pinned version
```

For a single-instance app, a **published** channel that no existing copy of that
app follows is a permitted second install without `--allow-multiple` (it still
needs a distinct `--name`/`--as`, since every copy needs its own subdomain).
"Published" means the catalog lists at least one version of that app on the
channel — `hola catalog` shows those as `(channels: rc)`. Any other well-formed
channel name is still installable and followable (it simply tracks the stable
releases), but it does **not** buy a second copy of a single-instance app: that
install is rejected saying the channel has no versions published for the app,
and `--allow-multiple` is what forces it. The same applies whenever the channel's
published-ness can't be established at install time (the catalog was unreachable,
or the app was installed by OCI reference) — the platform fails closed. The
dashboard's deployment detail names each copy by the channel it follows and
lists the app's other copies ("`rc` instance of remo · also installed: remo
(stable)"), adding *why* the second copy was permitted (it followed a published
channel, or an operator forced it with `--allow-multiple`); `hola deployments`
tags the row with its channel (`gitea-rc [rc]`). Once
installed, `hola upgrade <deploymentId>` (no explicit `--app-version`) always
offers the newest version eligible on the deployment's own channel — its own
channel or `stable`, never an unrelated channel. The channel is **sticky**:
promoting or rolling back never changes it, even when an rc deployment takes a
stable release.

**What a channel copy tests — and doesn't.** A channel deployment installed
from the catalog starts with **empty data**. It proves the new version boots,
routes, and authenticates — it does **not** prove it migrates your existing
data, because there is none to migrate. Rehearsing an actual data migration on
a real volume needs the deployment seeded from an existing one's snapshot,
which is tracked as a follow-up
([try-hola/hola#429](https://github.com/try-hola/hola/issues/429)) and not
built yet.

**Changing the channel a deployment follows** is a metadata-only change — it
never touches the running version, and never enqueues a job:

```bash
curl -X PATCH $HOLA_API_URL/api/deployments/<id> \
  -H "Authorization: Bearer $HOLA_TOKEN" -H 'content-type: application/json' \
  -d '{"channel":"rc"}'
```

(or from the dashboard: Deployment detail → Configuration → Channel). The next
update check is computed against the new channel immediately; the currently
running version is unaffected until you explicitly upgrade.

## Troubleshooting

The [compose README](../packages/compose/README.md#troubleshooting) has the full
list. Common cases:

- **502 from the UI** — the `server` container isn't healthy yet;
  `docker compose logs server`.
- **No TLS cert** — with the default HTTP-01 the host must be internet-reachable on
  port 80. For private/homelab hosts use DNS-01 instead (set `ACME_DNS_PROVIDER` +
  provider credentials in `.env` for a wildcard cert — see the
  [compose README](../packages/compose/README.md#private--homelab-tls-dns-01)).
- **Deployed app not routable** — confirm its Compose joined the `hola` network
  and that `/data/runtime/traefik/dynamic.yml` contains its router.
- **Validate config** — `docker compose config` validates the merged `.env`.

## Security note

The server mounts `/var/run/docker.sock` to run `docker compose` for
deployments. **This grants control of the host's Docker engine (effectively root
on the host).** Run Hola only on a host you trust, keep the admin API key secret,
and never expose the API without auth.
