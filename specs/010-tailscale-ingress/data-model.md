# Data Model: Opt-in Private Tailscale Ingress

## 1. `TailscaleIngressSetting` (persisted)

Stored as `tailscaleIngress?` on the deployment record (`deployments/<id>/metadata.json`). Optional: a record written before this feature reads it as `undefined`, which means off. It belongs to the deployment, not a release, so upgrade and rollback do not touch it.

| Field | Type | Rule |
|---|---|---|
| `enabled` | boolean | |
| `serviceName` | string | `svc:` + a DNS label: `^svc:[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`. Unique among deployments on this host whose setting is enabled or has removal pending. |
| `tag` | string | `^tag:[a-zA-Z][a-zA-Z0-9-]*$` |
| `backend.service` | string | Must be a service declared by the active release's compose. Not `hola-tailscale`, not `hola-docker-proxy`. Must have no `network_mode`. |
| `backend.port` | integer | 1 to 65535 |
| `mode` | `'https'` \| `'tcp'` | `https` = TLS terminated at the companion, plain HTTP to the backend. `tcp` = bytes forwarded unmodified. |
| `listenPort` | integer | 1 to 65535, default 443 |
| `forwardAuthAcknowledged` | boolean | Must be `true` to enable when the active release's auth mode is `forward-auth`. |
| `nodeName` | string | Derived, not operator-set: `hola-` + the service label, truncated to 63. The device's hostname on the tailnet, and the name every cleanup message quotes. |
| `applied` | `{ serviceName, mode, listenPort, backendPort }` \| undefined | What was last successfully configured on the companion. Compared against the setting to decide whether the previous Service must be withdrawn first (name, mode or listen port changed); the serve configuration itself is re-applied on every lifecycle job. |
| `enrolledAt` | ISO string \| undefined | Set when the companion first reports `Running`. |
| `removalPending` | boolean \| undefined | Set by disable on a running app; cleared by the job's after-up hook once the volume and networks are gone. While set, `enabled` is `false`. |
| `updatedAt` | ISO string | |

Not a field: the credential. It is never part of the record.

### State of the setting

```
(absent) ──enable──▶ enabled ──disable (running)──▶ removalPending ──job done──▶ (absent)
                        │                                                           ▲
                        └────────disable (stopped): local cleanup inline────────────┘
```

Uninstall and force removal go to (absent) from any state.

## 2. Joining credential (transient file)

`deployments/<id>/tailscale/credential`, mode 0600, on the server's data volume.

- Written by `PUT` when the body carries `authKey`.
- Read only by the lifecycle job's after-up hook.
- Deleted when the companion reports `Running`, when a new one replaces it, on disable, and with `deployments/<id>` on uninstall.
- Accepted forms: `tskey-auth-…` or `tskey-client-…`. Anything else is refused without echoing the value.

`credentialHeld` on reads is "this file exists".

## 3. Tailnet identity (named volume)

`<compose-project>_hola-ts-state`, mounted at `/var/lib/tailscale` in the companion. Holds the device key, the serve configuration, the advertise preference and issued certificates. Created by Compose on first up. Removed by Hola on disable, uninstall and force removal. In no backup, snapshot or restore.

## 4. `TailscaleIngressStatus` (derived, not persisted)

| Field | Type |
|---|---|
| `state` | `'off' \| 'starting' \| 'needs-sign-in' \| 'waiting-for-approval' \| 'connected' \| 'disconnected' \| 'error'` |
| `message` | string, one sentence |
| `action` | string \| undefined. What the operator should do. Present for `needs-sign-in`, `waiting-for-approval`, `error`, and `disconnected` when the app is running. |
| `dnsName` | string \| undefined. `<label>.<tailnet suffix>` |
| `addresses` | string[] \| undefined. The Service's private addresses. |
| `port` | number |
| `nodeName` | string |
| `observedAt` | ISO string |

Cached in memory per deployment for 30 seconds. Invalidated by any write to the setting and by the end of any lifecycle job for that deployment.

## 5. `TailscaleIngressGuidance` (derived, pure)

Built by a pure function in `@hola/shared` from the setting alone, so the dashboard and the command line show the same text.

| Field | Content |
|---|---|
| `prerequisites` | string[] |
| `steps` | `{ title, detail, snippet? }[]`: tag owner, define the Service, approve the host or add an auto-approver, grant access |
| `exampleGrant` | JSON string. `src` is the placeholder `tag:example-client`, `dst` this Service, `ip` `tcp:<listenPort>`. |
| `exampleAutoApprover` | JSON string |
| `notes` | string[]: policy is additive; a grant to the host is not a grant to the app; shared identities cannot be told apart; reachability is not authentication; how an app can trust its private name |

## 6. Detail-read summary

`EnhancedDeploymentDetail.tailscaleIngress?: { enabled: boolean; serviceName: string }`, added to the `toDetailResponse` allowlist. No live status here: detail and list reads must not run an exec.

## 7. Removal report

Returned by disable, and attached to the uninstall response as a warning.

| Field | Type |
|---|---|
| `nodeName` | string |
| `signedOut` | boolean \| null. `null` only in the immediate response to disabling a running app, where the job has not yet tried (contracts/api.md). |
| `message` | string. Always tells the operator to delete the device record named `nodeName` in the Tailscale admin console; says so more strongly when `signedOut` is false. |

## Addendum (#596): exposure

`TailscaleIngressSetting` gains two optional fields. Records written before this change carry neither and read as `both` with no observed name.

| Field | Type | Notes |
|---|---|---|
| `exposure` | `'both'` or `'tailscale-only'` | Absent reads as `both`. `tailscale-only` while `enabled` means no Traefik route (`hasTraefikRoute`). |
| `lastDnsName` | string, optional | Last tailnet name observed `connected`; a hint used for the published URL, never proof of connectivity. |

`TraefikRoutingRule` gains `held?: boolean`: the host is reserved for the deployment in the routing map, but no router/service/middleware is rendered for it. `TailscaleIngressDefaults` gains `exposure`, `tailscaleOnlySupported`, `tailscaleOnlyUnsupportedReason?`.
