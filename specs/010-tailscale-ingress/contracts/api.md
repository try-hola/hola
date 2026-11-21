# Contract: API, SDK and CLI

All routes are under the existing deployment prefix. Mutations need `write:deployments` (the existing default for mutating methods); the read needs no capability, like every other read. Errors use the existing envelope `{ error: { code, message, details, requestId } }`.

## `GET /api/deployments/:id/tailscale-ingress`

Query: `refresh=true` bypasses the 30-second status cache.

```jsonc
{
  "setting": {                      // null when never enabled
    "enabled": true,
    "serviceName": "svc:omnigraph",
    "tag": "tag:hola-ingress",
    "backend": { "service": "omnigraph", "port": 8080 },
    "mode": "https",
    "listenPort": 443,
    "forwardAuthAcknowledged": false,
    "nodeName": "hola-omnigraph",
    "enrolledAt": "2026-11-20T18:00:00.000Z",
    "updatedAt": "2026-11-20T18:00:00.000Z"
  },
  "credentialHeld": false,
  "defaults": {                     // always present; what an enable would use
    "backend": { "service": "omnigraph", "port": 8080 },
    "services": ["omnigraph"],      // the active release's declared services
    "tag": "tag:hola-ingress",
    "mode": "https",
    "listenPort": 443,
    "requiresForwardAuthAcknowledgement": false
  },
  "status": { "state": "connected", "message": "…", "dnsName": "omnigraph.example.ts.net",
              "addresses": ["100.100.1.2"], "port": 443, "nodeName": "hola-omnigraph",
              "observedAt": "…" },
  "guidance": { "prerequisites": [], "steps": [], "exampleGrant": "…",
                "exampleAutoApprover": "…", "notes": [] }
}
```

No response from this or any other route ever contains the credential.

## `PUT /api/deployments/:id/tailscale-ingress`

Replaces the setting. Body:

```jsonc
{
  "serviceName": "svc:omnigraph",          // required
  "tag": "tag:hola-ingress",               // required
  "backend": { "service": "omnigraph", "port": 8080 },   // optional; defaults as in GET
  "mode": "https",                         // optional, default "https"
  "listenPort": 443,                       // optional, default 443
  "acknowledgeForwardAuthBypass": true,    // required true when defaults say so
  "authKey": "tskey-auth-…"                // optional; required on first enable
}
```

Response `200`: `{ ok: true, jobId?: string, setting, credentialHeld, warnings?: string[] }`. `jobId` is present when the app is running (a restart job was enqueued). On a stopped app there is no job and `warnings` says the setting takes effect on next start.

A body with only a new `authKey` and otherwise unchanged fields is how a new credential is supplied.

| Status | `code` / `details.code` | When |
|---|---|---|
| 400 | `INVALID_TAILSCALE_INGRESS`, `details.field` | Bad service name, tag, port, mode, or credential form; or no `backend.port` given when the active release declares no port to default to (`details.field: "backend.port"`; `defaults.backend.port` is then `null` in `GET`). The message never echoes the credential. |
| 400 | `TAILSCALE_BACKEND_UNKNOWN`, `details.services` | Backend service not declared by the active release |
| 400 | `TAILSCALE_BACKEND_UNSUPPORTED`, `details.reason` | Backend has a `network_mode`, or is a platform service |
| 400 | `TAILSCALE_FORWARD_AUTH_ACK_REQUIRED` | Forward-auth app and no acknowledgement |
| 400 | `TAILSCALE_CREDENTIAL_REQUIRED` | First enable (no identity enrolled, none held) without `authKey` |
| 409 | `CONFLICT` / `TAILSCALE_SERVICE_NAME_TAKEN`, `details.deploymentId` | Another deployment on this host holds the name |
| 409 | `CONFLICT` / `DEPLOYMENT_BUSY` | A conflicting operation is in flight |
| 404 | | No such deployment |

## `DELETE /api/deployments/:id/tailscale-ingress`

Disables. Response `200`: `{ ok: true, jobId?: string, removal: { nodeName, signedOut, message } }`.

- Running app: sets `removalPending`, enqueues a restart job. `signedOut` in the response is `null` (not yet known); the job records the outcome and the next `GET` carries it in `status.message`.
- Stopped app: cleans up inline. `signedOut: false`.
- Already off: `200`, `{ ok: true }`, no job.

`409 DEPLOYMENT_BUSY` as above.

## Other responses that change

- `GET /api/deployments/:id` gains `tailscaleIngress?: { enabled, serviceName }`.
- `DELETE /api/deployments/:id` (uninstall) gains a `warnings` entry carrying the removal message when the deployment had private ingress.

## SDK

```ts
sdk.deployments.tailscaleIngress.get(id, { refresh? })
sdk.deployments.tailscaleIngress.set(id, body)
sdk.deployments.tailscaleIngress.disable(id)
```

`put` is added to the SDK's HTTP helper and to the web `sdk-adapter`.

## CLI

```
hola tailscale <deploymentId>                 show setting, status and guidance
hola tailscale enable <deploymentId>
     --service <svc:name> --tag <tag:name>
     [--backend <service>:<port>] [--mode https|tcp] [--port <n>]
     [--auth-key-file <path> | --auth-key-stdin]
     [--ack-forward-auth] [--yes] [--json]
hola tailscale login <deploymentId> (--auth-key-file <path> | --auth-key-stdin) [--json]
hola tailscale disable <deploymentId> [--yes] [--json]
```

- The credential is never accepted as a flag value, so it cannot land in shell history or a process list. `--auth-key-file -` is not a synonym for stdin; `--auth-key-stdin` is the only stdin form.
- `enable` and `disable` on a running app print that the app restarts briefly and ask for confirmation unless `--yes`. Without a TTY and without `--yes` they refuse.
- `--json` prints the response body, or the JSON error envelope on failure, as the rollback command does.
- Command naming follows whatever the CLI's existing multi-word commands do; if the framework supports `hola tailscale enable` as a subcommand without special-casing, prefer that spelling and keep the flags.

## Addendum (#596): `exposure`

`GET` setting gains `exposure?: "both" | "tailscale-only"` (absent means `both`) and `lastDnsName?` (the last observed tailnet name); `defaults` gains `exposure: "both"`, `tailscaleOnlySupported: boolean` and `tailscaleOnlyUnsupportedReason?`. The detail summary gains `exposure`. `GET /api/deployments/:id` and the list carry `url` = the tailnet address (last observed name) for a `tailscale-only` deployment, and no `url` when the name is unknown.

`PUT` gains `exposure?: "both" | "tailscale-only"` (default `both`; PUT still replaces the whole setting, so omitting it switches back to `both`) and `acknowledgeTailscaleOnly?: boolean`.

| Status | `code` / `details.code` | When |
|---|---|---|
| 400 | `INVALID_TAILSCALE_INGRESS`, `details.field: "exposure"` | Value is not `both` or `tailscale-only` |
| 400 | `TAILSCALE_ONLY_ACK_REQUIRED` | `tailscale-only` without `acknowledgeTailscaleOnly: true` |
| 400 | `TAILSCALE_ONLY_UNSUPPORTED_AUTH`, `details.authMode` | Active release is `native-oidc` or `forward-auth` |
| 409 | `CONFLICT` / `TAILSCALE_ONLY_NOT_CONNECTED`, `details.state`, `details.reason` | No fresh `connected` observation (first enable, stopped app, not approved, disconnected), or the Service settings changed while already `tailscale-only` (`reason: "connection-settings-changed"`) |

Two-step flow: enable as `both`, wait for `connected`, then PUT `tailscale-only`. CLI: `hola tailscale enable ... --exposure both|tailscale-only --ack-tailscale-only`.
