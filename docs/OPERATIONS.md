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
  the server validates it and sets an `HttpOnly`, `Secure`, `__Host-`-prefixed
  session cookie, so the key is never stored in the browser.

When `HOLA_USE_AUTH=false` (dev/test) the dashboard loads with no login.

#### Dashboard session security

Hola puts every installed app on a subdomain of one domain — the dashboard at
`HOLA_DOMAIN`, apps at `<app>.<HOLA_BASE_DOMAIN>`. Those are *same-site* even
when they are different origins, so `SameSite=Strict` on its own would let a page
served by an installed app send the operator's session cookie to the API. Two
rules close that (F04), and both are on unconditionally:

- **A cookie-authenticated request that changes state must come from the
  dashboard.** Its `Origin` must name a trusted dashboard host and its
  `Sec-Fetch-Site`, when the browser sends one, must say `same-origin`. A
  mutation carrying the session cookie with no `Origin` at all is refused
  (`403 MISSING_ORIGIN`), and one from another origin is refused
  (`403 CROSS_ORIGIN_MUTATION`). Its `Content-Type` must be `application/json`
  (or `multipart/form-data` for a draft file upload), else `415`.
- **The session cookie belongs to the dashboard host alone.** The `__Host-`
  prefix means a browser accepts it only for exactly that host, so a compromised
  app on a sibling subdomain cannot set or replace it.

**Nothing to configure for the normal install.** The origin a browser request was
addressed to is always trusted, so the rule works with no settings; `HOLA_DOMAIN`
pins it to a named host as well. Set `HOLA_TRUSTED_ORIGINS` (comma-separated
origins or bare hosts) only if you open the dashboard at an additional name, or
front it with a proxy that rewrites the `Host` header.

**This never applies to the CLI, the SDK, or a catalog app's contract calls.**
They authenticate with `Authorization: Bearer <key>` or `X-API-Key: <key>`, which
a web page cannot attach to a cross-origin request, so they are not forgeable and
send no `Origin`. If you script the API yourself, send the key as a header — a
copied browser cookie jar is not a supported way to drive mutations and will be
refused.

Upgrading to a build with this change **logs existing cookie sessions out once**
(the cookie's name changed); sign in again with the admin key.

### What a non-admin dashboard user can see

A user who authenticates through SSO but is **not** in `HOLA_OIDC_ADMIN_GROUP`
gets a read-only capability set (`read:system`, `read:deployments`, `read:logs`,
`read:backups`, `read:catalog`). They can browse every installed app, its
configuration and its logs, but they cannot install, change or remove anything.

**Secret values are withheld from them.** Reading an app's configuration and
reading its credentials are separate grants: the second is `read:secrets`, which
only an admin (`*`) holds. So a read-only user sees *which* variables an app is
configured with — key, label, type, and that the variable is a secret — while
each secret's value comes back empty and flagged as hidden. The dashboard
renders those as `•••••••• hidden` with no reveal control, and `hola config`
shows `***`. The same policy covers draft reads and the host-wide `systemEnv` in
Settings.

An admin's own reads are unchanged, and nothing about editing changes: a form
saved with a hidden value still in place keeps the stored secret rather than
blanking it, so an operator never has to re-enter a password to change something
next to it.

Note that `HOLA_OIDC_ADMIN_GROUP` is fail-closed — with no admin group
configured, **every** authenticated user is read-only. Set it to `*` to make
every authenticated user an admin, which makes your IdP's application-access
policy the only gate.

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
runs the pre-backup hook of every **participation** an accepting app declares —
a `pg_dump` for a database-backed app — and the post-backup hook after (ADR
0004). An app with two databases (its own, plus a workflow engine's) declares
two participations, one per database; both dumps run, in order, before the
capture.

The **Backups** page is the view over that, and renders one of four states per
installed app:

- **Quiesced** — every recognised database service the app runs has a
  pre-backup hook; the capture is transaction-consistent.
- **Partially covered** — the app runs at least one recognised database with
  *no* hook (e.g. one participation covers its own database but not a second
  one). Shown with the count, "1 of 2 databases quiesced," and **not** counted
  as fully covered in the page's summary — the whole point of this state is to
  stop a two-database app from reading as safe when it isn't. Fixed by adding
  the missing participation in the catalog.
- **Covered as-is** — the app accepts the contract, runs no recognised
  database, and needs no hook (SQLite, flat files); already safe to copy
  exactly as it sits.
- **Not covered** — the app does not accept `backup@1` at all. Still captured
  as raw files with everything else, but nothing quiesces it first.

Each app's own detail page shows the same judgement under its **Backups** tab,
naming which database is missing a hook when the state is partial.

**One provider per host.** A contract has at most one provider; installing a
second app that also provides `backup@1` is refused at install, naming the
existing provider and telling you to uninstall it first. A pair recorded
before this rule existed (rare) is flagged as a warning on the Backups page
rather than silently resolved — uninstall one of them.

### Restore-on-install

During an **install**, you can pick an existing deployment of the same app on
this host as a restore source. The server quiesces it with the same pre/post
hooks App backups already use, captures its data root, and lays that data down
into the new install after images are pulled and before any container starts —
the one moment an app's life when the data root is empty and no process holds
it open. It closes [#429](https://github.com/try-hola/hola/issues/429): the
fastest way to get a second, independently-addressable copy of a running app
holding its data.

**Where it lives.** The install wizard's first step, before Configuration — a
restore choice determines what configuration gets pre-filled, so it has to
come first. From the CLI: `hola install <app> --restore-from <id|latest>`
(`--restore-list` to see candidates first, with no draft created).

**It is a second copy, and you have to say so.** The source keeps running — a
restore never replaces or stops it — so for a single-instance app (most of
them, including every database-backed app that most needs restore) the
restoring install trips the single-instance guard and is refused as
already-installed. That pairing is the normal path here, not an edge case:
add `--allow-multiple` (and a `--name` that differs from the source's), or
in the wizard use the conflict panel's "Install another copy (operator
override)". Choosing a restore source deliberately does **not** imply the
override: the restored copy comes up live, holding the source's credentials,
so two live copies of the same app is a thing to confirm rather than infer.
The refusal itself says a restore was in play, so the CLI hint and the wizard
panel name the restore rather than talking only about installing.

**What it carries.** Files, always. Configuration — including secrets — only
when you ask for it (on by default when the candidate has one recorded); an
app that generates its own secrets on first boot will mint fresh ones for data
that was encrypted under the originals unless you carry the recorded values
forward too. The confirmation step names this explicitly: a restore carries
**data and credentials**, and any jobs, webhooks or integrations the app runs
may fire the moment it starts holding that data.

**Why it refuses.** A restore fails the whole install rather than starting an
app on empty or partial data — there is no partial-success state. Common
reasons: the candidate was captured on a newer version than you're installing;
the app's own upgrade rules block the version hop; the candidate no longer
exists or isn't in a settled (running/stopped) state by the time the install
actually runs; or a restore hook failed (a database load with `ON_ERROR_STOP`
enabled reports the load failure, not the app's later confusion about missing
tables). Every refusal is a specific answer, not a generic install failure — a
new deployment left in `error` with its data root intact, so you can inspect it
before deciding to retry.

**What an app has to declare.** Nothing, for the common case: most catalog
apps (anything SQLite or flat-file) restore correctly with a plain file copy,
and need no manifest changes at all. A database-backed app declares a small
`restore` block in its manifest naming which paths to discard after the files
land (a live database's file-level copy is a smear across the capture window,
not a snapshot) and the `psql`-style command that reloads the dump — the same
hook shape the backup declaration already uses.

### Restoring onto a fresh host (disaster recovery)

The restore-on-install feature above picks from **live deployments on this
host**. It cannot bring back an app that no longer exists here — which is the
only case that matters after a host is lost. A **restore provider** (Backrest,
once its catalog bundle gains the role) closes that gap: it holds captures
taken elsewhere and can serve them back into a fresh install.

**Recovering onto a fresh host plainly requires two things, neither of which
Hola can supply for you**: installing the provider app itself, and supplying
the repository password that makes its existing captures readable. Hola never
holds that password — it is the provider's own secret, entered when you
install it, not something the platform stores or can recover on your behalf.
Nothing in the install wizard or the CLI implies recovery can happen without
these two steps.

Once the provider is installed and pointed at your existing repository,
installing an app offers its held captures alongside any live siblings on the
candidate list — picked the same way, subject to the same version-skew and
acknowledgement rules as a local restore. The provider writes the capture into
a directory Hola nominates; Hola alone decides when the data is ready to move
into the new install's data root. No captured byte passes through Hola's own
API at any point — the provider's write and Hola's move are both local
filesystem operations.

**The provider's own privilege.** Serving restores requires a second consent,
separate from the read-only access a backup provider already holds: a writable
mount of one platform-owned scratch directory (`HOLA_RESTORE_STAGING_ROOT`,
default `/srv/hola/restore`), and nothing else — not any app's data, not the
apps directory itself. See [ADR 0006](adr/0006-restore-staging-grant.md) for
why this is a new, explicit grant rather than an extension of the existing
read-only one.

**The staging root itself.** Like the apps root, it is created by the Docker
daemon when the stack's identity bind mount is first established, is owned by
whatever the daemon creates it as (`root`), and is expected to exist before a
provider can serve a restore — the server never `mkdir`s it at runtime. It
must be a **sibling** of `HOLA_APPS_BIND_ROOT`, never the same directory, not
inside it, and not containing it: it is mounted *writable* into a consented
provider, so an overlap would silently turn one scratch directory into write
access to every app's data. Hola refuses rather than accepts that — a
provider install configured with an overlapping staging root fails its deploy
job with a message naming both paths, instead of coming up with a wider grant
than the operator consented to. Both paths are set together in the stack's
`docker-compose.yml`; changing one means changing the other.

**Restoring the provider itself is out of scope**, and deliberately so: the
provider's own configuration holds the credentials that make its captures
readable, so restoring it from one of its own captures is circular.

### Container logs

`container-logs@1` is a **provisioned** contract: a log collector app from the
catalog (once one ships) can read every container's logs and enumerate
containers on the host — nothing else. The install wizard's consent step
spells out what that means before you approve it: the collector can read
whatever every installed app writes to its logs (which routinely includes
tokens and personal data) and can see what containers exist and how they're
labelled; it cannot start, stop, exec into, or read the environment of any
container. Access is revoked the moment the collector is uninstalled.

Every app container carries three labels a collector reads to group logs by
app with no per-app configuration: `sh.hola.app` (the app id), `sh.hola.deployment`
(the deployment id) and `sh.hola.name` (the deployment's display name).

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

### Trying pre-release versions of apps

Per-app releases (distinct from the *platform* upgrade above) can follow a
release **channel** other than the default `stable` — e.g. `rc` for a
pre-release build the catalog publishes alongside its stable release. See
[ADR 0005](adr/0005-release-channels.md) for the mechanism and §7 for the
operator model below.

**Enable discovery.** Non-stable channels are hidden from the catalog card,
the install wizard, and the deployments-list filter until you enrol — a
host-level setting, off by default, that only gates what the dashboard shows;
it never changes what channel an already-installed copy follows.

```bash
hola settings prerelease on    # Settings → Pre-release apps → toggle, in the dashboard
```

Once enrolled, an app that publishes a non-stable channel shows a pill on its
catalog card (`Also published on rc`), and the install wizard offers a channel
choice (`Stable (recommended)` / `rc — pre-release`).

**What the pill means.** A pill on a catalog card or a deployments-list row
names a *channel*, but which one depends on context: on the catalog it is
every channel the app publishes; on a deployment row it is whichever is
non-stable — the channel the copy **follows** (its track) if the **running
build**'s own channel is unknown or stable, or the running build's channel
when that's the more informative fact (e.g. a copy that joined `rc`, then left
it, still running an `rc` build). The deployment's Overview page always shows
both explicitly: "Follows: `<channel>`" and "Running `<version>`, a
`<channel>` build."

**Join or leave a channel from an installed copy's Overview tab** — the
Channel block there has one button per published channel not currently
followed (**Join**, shown only while enrolled) and, when the copy follows a
non-stable channel, **Leave** (always available, so you can step back to
`stable` even with discovery off). Leaving is honest about what it does and
doesn't do: the copy keeps running its current build — "Stays on `<version>`
until a stable release at or above it is published" — it does not roll back.
Equivalently from the CLI:

```bash
hola channel <deploymentId>          # show: Follows: rc / Running: 0.11.0-rc.1 (rc build)
hola channel <deploymentId> stable   # leave rc; prints the stays-on note if applicable
hola channel <deploymentId> rc       # join rc (server-side; the wizard/CLI don't gate on enrolment)
```

`hola channel` and the direct API PATCH are metadata-only changes — neither
touches the running version nor enqueues a job:

```bash
curl -X PATCH $HOLA_API_URL/api/deployments/<id> \
  -H "Authorization: Bearer $HOLA_TOKEN" -H 'content-type: application/json' \
  -d '{"channel":"rc"}'
```

The next update check is computed against the new channel immediately; the
currently running version is unaffected until you explicitly upgrade. Once
installed, `hola upgrade <deploymentId>` (no explicit `--app-version`) always
offers the newest version eligible on the deployment's own channel — its own
channel or `stable`, never an unrelated channel. The channel is **sticky**:
promoting or rolling back never changes it, even when an rc deployment takes a
stable release.

**Rehearsing a pre-release in a separate copy.** From an installed copy's
Overview tab, enrolled operators see "Try `<channel>` in a separate copy →"
for each published channel the copy doesn't already follow — it opens the
install wizard pre-selecting that channel. Equivalently:

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
or the app was installed by OCI reference) — the platform fails closed. Every
installed copy's Overview tab lists the app's other copies ("`gitea-rc` (`rc`)
is also installed"), with a muted note when a copy was permitted only by
`--allow-multiple` ("installed with operator override") rather than by
following a distinct published channel; `hola deployments` tags the row with
its channel (`gitea-rc [rc]`).

**What a channel copy tests — and doesn't.** A channel deployment installed
from the catalog starts with **empty data**. It proves the new version boots,
routes, and authenticates — it does **not** prove it migrates your existing
data, because there is none to migrate. Rehearsing an actual data migration on
a real volume needs the deployment seeded from an existing one's snapshot,
which is tracked as a follow-up
([try-hola/hola#429](https://github.com/try-hola/hola/issues/429)) and not
built yet.

**When install hits a conflict.** Installing on a channel an existing
single-instance copy already occupies (or on an unpublished channel, without
`--allow-multiple`) is refused with a message naming the existing copy — the
wizard shows a panel with three choices (switch the existing copy to the new
channel, open it as-is, or install a separate copy on another published
channel); the CLI prints the same server message plus a hint:

```
Failed: 'gitea' is already installed as 'gitea' and follows 'stable'. This app is single-instance.
Hint: 'gitea' (dep_1) already follows stable. Switch it with 'hola channel dep_1 <channel>',
      install a separate copy on another published channel with '--channel <name>',
      or force a second copy with '--allow-multiple --name gitea-2'.
```

An install that was **restoring** gets a restore-specific hint instead (the
channel advice is no route to a restore), because the refusal carries the
restore choice — see
[Restore-on-install](#restore-on-install) above:

```
Failed: 'mealie' is already installed as 'recipes' and follows 'stable'. This app is single-instance.
Hint: restoring from 'mealie-7f61df68' leaves that copy running, so this install is a SECOND live
      copy of the app alongside it — which this app is not marked for. Confirm it deliberately:
      re-run with '--allow-multiple' and a '--name' that differs from the source's.
```

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
