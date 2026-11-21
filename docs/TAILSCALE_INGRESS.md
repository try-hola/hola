# Private Tailscale ingress

Give one installed app its own private address on your Tailscale network (your
"tailnet"), so a client you choose can reach that app and nothing else.

Design record: [ADR 0007](adr/0007-private-tailscale-ingress.md). Spec and contracts:
`specs/010-tailscale-ingress/`.

> **Status of this feature.** The code is tested against a stubbed companion and real Docker
> networking. The Tailscale-side behaviour it relies on (Service advertisement and approval,
> policy enforcement, certificates, restart resume) has **not yet been run on a real tailnet**;
> those checks are listed as V1 to V10 in `specs/010-tailscale-ingress/validation.md`. Where this
> guide describes what Tailscale does, treat it as documentation-derived until that file says
> otherwise.

## What it is, and is not

It **is** one optional, per-deployment way in, **added beside** the app's normal address
(`<app>.<HOLA_BASE_DOMAIN>`), which it replaces only if you choose [Tailscale only](#tailscale-only). It is off by default and works for any
app: nothing in the catalog entry or bundle needs to mention Tailscale.

Why it exists: on a tailnet, access is granted to a *destination*. The only destination a Hola
host offers by itself is the host, and a grant to the host reaches the shared reverse proxy,
which means every app, the dashboard and the admin API. Instead, each opted-in app becomes its
own **Tailscale Service** (`svc:<name>`), with its own private address and name, and a policy
grant can name that Service alone.

How: Hola adds a small platform-owned container (the *companion*, service `hola-tailscale`) to
that deployment. It joins your tailnet as a tagged device, serves the Service, and forwards to
exactly one backend service of the app over a private network that contains nothing else.

It is **not**:

- subnet routing, an exit node, or public exposure (Funnel). There is no setting for any of them.
- a way to put the Hola dashboard, the admin API or Traefik on the tailnet.
- authentication. Reaching the address is not signing in (see [Forward-auth](#forward-auth-caveat)).
- something that manages your tailnet. Hola does not call the Tailscale administration API: it
  never defines a Service, approves a host, edits policy or deletes a device. It tells you what
  to do.

## Prerequisites

- A tailnet with **MagicDNS** and **HTTPS certificates** enabled, on a plan that includes
  Tailscale Services (generally available; confirm your plan's limits).
- Admin access to the tailnet's policy file and to the admin console.
- A **tag** for the companion (default suggestion `tag:hola-ingress`; one tag per deployment
  lets you write policy for one app's companion). It must be owned in `tagOwners` (step 1 below).
- A **joining credential**, in one of two forms. Give it the narrowest scope that works:

  | Form | Looks like | Narrowest scope |
  |---|---|---|
  | Auth key | `tskey-auth-…` | One that can register a device with your chosen tag: create it **tagged**, and preferably single-use, short-lived and pre-approved. |
  | OAuth client secret | `tskey-client-…` | Scope `auth_keys` (write), restricted to your tag. Hola appends `?ephemeral=false&preauthorized=true` itself. |

- A Hola host with **outbound** internet access to Tailscale's coordination and relay servers.
  No inbound port is opened.

The companion image is `tailscale/tailscale` pinned by tag and digest; it is pulled only for
deployments that opt in. Set `HOLA_TAILSCALE_IMAGE` to a full `tag@sha256:digest` reference to use a
registry mirror (an override without a tag or digest is refused).

## Enable

Enabling a **running** app restarts the whole app once, as any configuration change does, so
expect a brief interruption; the dashboard and CLI warn before you confirm. On a **stopped** app
the setting is only saved and takes effect on next start. Enabling is refused as busy
(`DEPLOYMENT_BUSY`) while an upgrade, rollback or removal of that deployment is in flight.

### From the dashboard

Open the deployment, Overview tab, **Private Tailscale ingress**. Choose Enable and fill in:
Service name (`svc:` plus a DNS label), tag, backend service and port (defaults below), mode,
listening port, and the joining credential (a password field; it is write-only and never shown
again). If the app's normal address is behind forward-auth you must tick the acknowledgement.

### From the command line

```sh
hola tailscale <deploymentId>          # show what an enable would use, status, guidance
hola tailscale enable <deploymentId> \
  --service svc:omnigraph --tag tag:hola-ingress \
  --auth-key-file ./ts.key
```

Flags: `--backend <service>:<port>`, `--mode https|tcp`, `--port <n>`,
`--auth-key-file <path>` or `--auth-key-stdin`, `--ack-forward-auth`, `--yes`, `--json`.
The credential is **never accepted as a flag value**, so it cannot land in shell history or a
process list. Without a TTY and without `--yes`, enable and disable refuse (and
`--auth-key-stdin` on a running app needs `--yes`, since stdin is consumed by the key).
`enable` replaces the whole setting: running it again to change one field resets every flag you
leave out to its default, so pass all of them. (Command spelling
follows `contracts/api.md`; check `hola --help` for the exact form in your build.)

Defaults: the backend is the service the app's manifest names as its ingress, on the port its
normal route already uses; mode is `https` (TLS ends at the companion, plain HTTP to the
backend); listening port is 443. You may pick a different **declared** service of the app, and a
port, but never a free-form address. If the release declares no port you must give one.

## The four tailnet-side steps

Hola cannot do these for you. The dashboard and `hola tailscale <id>` print them with your actual
names filled in; the JSON below is an **example** using `svc:omnigraph` and `tag:hola-ingress`.

**1. Let the tag be used.** In the policy file:

```json
{ "tagOwners": { "tag:hola-ingress": ["autogroup:admin"] } }
```

**2. Define the Service.** In the admin console, Services: define `svc:omnigraph`, listening on
the port you chose (`tcp:443` by default).

**3. Approve the host.** Approve the device (named `hola-<service label>`, e.g. `hola-omnigraph`)
for the Service in the admin console, or add an auto-approver so future hosts need no approval:

```json
{ "autoApprovers": { "services": { "svc:omnigraph": ["tag:hola-ingress"] } } }
```

**4. Grant access.** Let only the clients you choose reach the Service, on its port:

```json
{
  "grants": [
    { "src": ["tag:example-client"], "dst": ["svc:omnigraph"], "ip": ["tcp:443"] }
  ]
}
```

Replace `tag:example-client` with the identity that should connect. Hola never edits policy.

## Status, and what to do

The status is read when you ask for it and is never more than 30 seconds stale
(`hola tailscale <id>`, or the card; `refresh=true` forces a fresh read). It is not monitored in
the background and nothing notifies you.

| State | Meaning | What to do |
|---|---|---|
| `off` | Not enabled. | Enable it, if you want it. |
| `starting` | The companion is coming up (under a minute after a deploy). | Wait; check again. |
| `needs-sign-in` | The companion has no valid tailnet identity: no credential, or the credential was rejected (for example it cannot register that tag). | Supply a credential (below), after checking the tag is owned and the credential's scope. |
| `waiting-for-approval` | Signed in, but the Service is not yet being served. This also covers "the Service is not defined yet"; from the host the two may look the same. | Do steps 2 and 3. |
| `connected` | The Service is advertised and approved. Shows the private name, addresses and port. | Do step 4 if no client can reach it yet. |
| `disconnected` | The app is stopped, or the device is offline. | Start the app; check the host's outbound connectivity. |
| `error` | The companion is not running when it should be, a command failed, or the chosen backend no longer exists in the active release (naming it). | Read the message. For a missing backend, pick a service the release declares. The app itself keeps serving its normal address. |

The ingress is never presented as working until the steps above are done. A companion that
cannot connect does **not** fail the app's deployment or stop its normal address, and a deploy
never waits more than 60 seconds for it.

## Supplying a new credential

Whenever the status is `needs-sign-in`, or a credential is still pending, send a new one: the
dashboard's field, or

```sh
hola tailscale login <deploymentId> --auth-key-file ./ts.key     # or --auth-key-stdin
```

Reads only ever say whether a credential is **held** (`credentialHeld`), never its value. The
credential is stored briefly on the Hola host with owner-only permissions, used once by the next
job, and **deleted as soon as the companion reports it has joined**; it is not kept for
re-enrolment. A healthy device is not re-registered: a new credential is used only if the
existing identity is no longer valid, and the unneeded one is deleted. The device identity
itself lives in a Docker volume (`hola-ts-state`) that is in no backup or snapshot and is not
copied by restore-on-install, which is also why a restored or reinstalled app needs enabling
afresh.

## Disable, and delete the device record

```sh
hola tailscale disable <deploymentId>
```

On a running app Hola restarts it, withdraws the Service from this host, signs the device out,
and removes the identity volume and the two private networks. Uninstalling the app (and force
removal) does the same cleanup. If the device cannot be signed out, the removal still completes
locally.

**You still have a step to do.** Signing out expires the device but leaves its record in the
admin console until someone deletes it. Hola always prints the device's name (`hola-<label>`)
and whether it was signed out; delete that record in the Tailscale admin console. (That the
record remains is documentation-derived: V9.) On a stopped app the cleanup is done locally and
the device cannot be signed out, so the response says so, and you should delete the record, or
check it, with extra care.

## Tailscale only

By default the private address is **added beside** the normal one (`exposure: both`). For an
app with no reason to answer on the shared hostname at all (an API or MCP server with one admin token
and no web UI), you can remove the normal address: **Tailscale only**. The app then has no Traefik
route; the only way in is the one your tailnet policy controls. The hostname stays reserved, so no
other app can take it.

**It is a two-step flow, on purpose.** Removing the normal address removes the fallback that makes
a misbehaving private address harmless, so Hola only lets you switch once the private address has
been observed `connected`:

1. Enable private ingress as usual (exposure `both`) and get it to `connected` (see
   [Status](#status-and-what-to-do)).
2. Switch exposure to Tailscale only, and acknowledge that if the private address stops working the
   app is unreachable. Dashboard: Edit, choose "Tailscale only" (disabled, with the reason, until it
   is connected), tick the acknowledgement. CLI:
   `hola tailscale enable <id> --service ... --tag ... --exposure tailscale-only --ack-tailscale-only`
   (re-send the other settings: `enable` replaces the whole setting). API: `exposure:
   "tailscale-only"` and `acknowledgeTailscaleOnly: true`.

Enabling as Tailscale only in one step is refused (409, `TAILSCALE_ONLY_NOT_CONNECTED`, with the
current state), as is switching while the app is stopped, since a stopped app cannot be connected.
The app restarts briefly to apply the change.

**The SSO limit.** An app that signs in through Authentik (`native-oidc`, or the `forward-auth`
gate) has its redirect URIs and gate tied to the public hostname, so Tailscale only is refused for it
(`TAILSCALE_ONLY_UNSUPPORTED_AUTH`). Apps with LDAP or no auth are fine. If a later upgrade or rollback
puts a Tailscale-only app onto a release that uses one of those, Hola keeps it private (it does not
quietly restore the public address) and the status tells you sign-in cannot work until you switch
back.

**Getting back.** Edit and choose "Public hostname and Tailscale" (`--exposure both`, or omit the
flag: `enable` resets what you do not send), or disable private ingress. Either restores the
normal address in the same restart job. If the private address breaks while you are Tailscale only
(needs sign-in, waiting for approval, tailnet down), you can still supply a new credential with the
same settings, or switch back to both.

**When the app is stranded.** If the companion cannot be rendered (for example an upgrade removed the
backend service), the app stays private with no route; the status is `error` and its action says to
fix the backend or switch exposure to both. Hola never restores the public address by itself.

**What changes elsewhere.** The dashboard's Open link and the app-registry feed (Homepage links)
point at the private `https://<name>` address when it is known, and are omitted otherwise. The
`${HOLA_APP_HOST}` token an app may use still resolves to the (now unserved) hostname. Anything
that calls `<app>.<base-domain>` (including `bin/vm-*` test scripts) no longer reaches the app.
Apps that talk to the Hola server through the contract broker are unaffected.

## Letting an app trust its private name

Requests arrive with the **private** name in the `Host` header (for example
`omnigraph.<tailnet>.ts.net`). Hola does not rewrite it to disguise it, does not relax any
security header, and adds no application credential. The proxy also adds `X-Forwarded-*`
headers and strips and re-adds Tailscale's identity headers, which are **empty for tagged
callers**, so an app cannot read a user identity from them.

An app that validates the host or origin of requests may therefore refuse the private name.
Add the name to the app's own trusted-hosts or allowed-origins setting, where it has one. Hola
loosens none of the app's checks for you.

## A Service versus sharing a machine's own address

You could instead share the Hola host's tailnet address, or let a client reach the machine.
That is a different thing: a grant to a *machine* is a grant to everything listening on it,
which here is the shared reverse proxy, so every app, the dashboard and the admin API, and the
client picks the app by the `Host` it sends. A grant to a *Service* names only that Service's
destination, and the companion forwards it to one backend. So:

- A grant to the Hola host is **not** a grant to one app.
- Policy is **additive**: any other grant a client holds still applies. Check the client's whole
  policy, not just the grant you wrote.
- Clients that share one tailnet identity (several agents on one tag or machine) cannot be told
  apart by policy. Per-agent permissions must then come from the app's own authorization.
- Reachability is not authentication.

## Forward-auth caveat

Hola's forward-auth gate (Authentik's embedded outpost) sits in Traefik. The private path does
not pass through Traefik, so **the gate does not cover it**. Protection there is tailnet policy
plus the app's own authentication. Enabling the ingress on a forward-auth app therefore requires
an explicit acknowledgement (dashboard checkbox; `--ack-forward-auth`; `acknowledgeForwardAuthBypass`
in the API), and an app whose only protection is the forward-auth gate should be reconsidered.
Apps with native OIDC or LDAP authenticate inside the app and are unaffected.

## Worked example: an agent calling Omnigraph's MCP endpoint

Goal: an agent can call `https://omnigraph.<tailnet>.ts.net/mcp` and cannot reach any other app.

1. `hola tailscale enable <omnigraph-id> --service svc:omnigraph --tag tag:hola-ingress --auth-key-file ./ts.key`
2. Complete steps 1 to 3 above for `svc:omnigraph` and `tag:hola-ingress`.
3. Tag the agent's machine or container `tag:grokbot` (own it in `tagOwners`), and grant only the
   Service:

   ```json
   {
     "tagOwners": { "tag:grokbot": ["autogroup:admin"] },
     "grants": [
       { "src": ["tag:grokbot"], "dst": ["svc:omnigraph"], "ip": ["tcp:443"] }
     ]
   }
   ```

4. From the agent: call the Service's name on port 443. Requests to the Hola host's own tailnet
   address are refused by policy (the host holds no grant), and a request that carries another
   app's hostname to this address lands on Omnigraph or is refused, never on the other app.
   (Both are what the design intends; V5 and V10 confirm them on a real tailnet and have not
   run.)

Note on shared bot identities: if several bots run as `tag:grokbot`, policy sees one identity.
To let them differ, give each its own tag and its own grant, or enforce per-bot permissions in
Omnigraph.

## Limits

- One private ingress per deployment: one backend, one listening port, one Service. The Service
  name is unique among deployments on one Hola host.
- HTTPS-terminated forwarding to a plain **HTTP** backend, or plain **TCP** forwarding
  (`--mode tcp`, bytes unmodified). The companion does not re-encrypt to a backend that only
  speaks HTTPS. A backend that shares another container's network identity (`network_mode`) is
  refused.
- WebSocket, streamed responses and long requests are intended to pass unchanged; confirming
  that on a real tailnet is V7.
- Private ingress settings are not carried by restore-on-install or included in app backups.
- Only Tailscale is built.

## Updating the companion image

This section is for people maintaining Hola, not for operators. An operator who mirrors
registries sets `HOLA_TAILSCALE_IMAGE` instead.

The companion image is pinned by version and digest in one place:
`packages/server/platform-images/tailscale/Dockerfile`. That file is never built. It holds a
single `FROM tailscale/tailscale:vX.Y.Z@sha256:<digest>` line, which the server imports as text
and uses as its default. The server refuses to start if the line is anything else. Changing
that line is the whole update.

Dependabot checks the file every Monday and, once a release is seven days old, opens a pull
request that changes the tag and the digest together. The pull request is titled
`chore(tailscale): …` and labelled `tailscale-companion`. It is separate from the base-image
updates and is not merged automatically.

Before merging one:

1. Unit CI passing shows only that the new reference is well formed. CI does not start the
   real image.
2. Run the real-Docker integration test against a Docker daemon. It starts the pinned image
   without signing in and checks the flags Hola passes:

   ```bash
   cd packages/server
   bun test ./src/__tests__/integration/tailscale-ingress.it.ts
   ```

3. For a new minor version (`v1.104` to `v1.106`), also go through the real-tailnet list in
   `specs/010-tailscale-ingress/validation.md`. Hola drives `tailscale up`, `tailscale serve`
   and `tailscale status --json`, and a new release can change them.

To update by hand, edit the `FROM` line. Take the digest from
`docker buildx imagetools inspect tailscale/tailscale:vX.Y.Z`: it is the index digest that
covers every architecture, not a single platform's.

## See also

- [ADR 0007](adr/0007-private-tailscale-ingress.md) for the design and its boundaries.
- [Operations guide](OPERATIONS.md).
