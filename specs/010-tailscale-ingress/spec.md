# Feature Specification: Opt-in Private Tailscale Ingress for Any App

**Feature Branch**: `010-tailscale-ingress`

**Created**: 2026-11-20

**Status**: Draft

**Input**: Spec prompt "Opt-in Tailscale ingress for any Hola app — managed sidecars and isolated Services" (Notion, https://app.notion.com/p/41eacfdc54e881f09fbde584b7773f3a). Primary repository `try-hola/hola`; related catalog `try-hola/apps`. Omnigraph is the first consumer, not a special case.

## Scope statement *(read first)*

This adds **one optional, per-deployment, private way in** to an installed app, over the operator's Tailscale network (their "tailnet"). It is **off by default**, it is **added beside** the app's normal address and never replaces it, and it is **not specific to any app**. Hola owns the piece that provides it; a catalog author writes nothing.

It deliberately changes one standing rule. The constitution's Principle I says all app traffic enters through Traefik. After this feature, that stays true for every deployment that has not opted in, and stays true for the app's normal address on those that have. An opted-in deployment gains a second path that does not pass through Traefik. That is a change to a non-negotiable, so this feature MUST ship with a constitution amendment and an architecture decision record (FR-030), not as a quiet exception.

## Background

Every Hola app is reached at `<app>.<base-domain>` through one shared reverse proxy on one shared address. That is right for people using a browser, and wrong for one growing case: a **non-human client that should reach exactly one app and nothing else**. The motivating example is an AI agent calling the Omnigraph app's MCP endpoint.

On a tailnet, access is granted to a *destination*. Today the only destination a Hola host offers is the host itself. Granting an agent access to the host's address grants it the shared reverse proxy, and therefore every app, the dashboard and the admin API, because the proxy chooses the app from a hostname the caller controls. There is no way to say "this identity may reach Omnigraph only".

Tailscale offers a destination that is narrower than a machine: a named **Service** with its own private address and name, which a policy grant can name directly. If each opted-in deployment is its own Service, and that Service forwards only to that app, then "this identity may reach Omnigraph only" becomes one policy line the operator can read and audit.

## Clarifications

### Session 2026-11-20

Run unattended. Each answer below is the recommended option, accepted by the pipeline.

- Q: When the operator enables, changes or disables private ingress on a running app, when does it take effect? → A: Immediately, as a queued deployment job. The app restarts once (amended in planning: the whole app, as for any configuration change, not only the backend), so there is a brief interruption, and the dashboard and command line say so before the operator confirms. On a stopped app the setting is only saved.
- Q: Is the joining credential kept after the companion has joined the tailnet? → A: No. It is held only until the companion reports that it has joined, then deleted from the host. The persisted tailnet identity is what keeps the companion signed in afterwards. If that identity is later lost or revoked, the status becomes "needs sign-in" and the operator supplies a new credential. This keeps no reusable secret at rest and makes "rotation" a single action.
- Q: How is the status kept current? → A: It is observed when asked for: reading the deployment's private-ingress status asks the companion for its present state. There is no background monitor, no history and no notification in this version. A reading older than 30 seconds is refreshed before it is shown.
- Q: Does a deploy wait for the companion to connect? → A: No. A deploy is complete when the app is up, as today. The companion is given up to 60 seconds to join so the credential can be deleted in the same job; if it has not joined by then the job still succeeds and the status reports where it stopped.
- Q: Is the tag chosen per deployment or once for the host? → A: Per deployment, required, with `tag:hola-ingress` offered as the suggestion. Per-deployment tags let an operator write policy for one app's companion; a single host-wide tag would make every companion interchangeable in policy.

### Session 2026-11-20 (planning reconciliation)

Planning read the code at `main@7b2e698` and the current Tailscale documentation and source. Five statements in this spec did not survive that reading. Each is amended in place below; requirements not listed keep their original force. Full evidence is in [research.md](./research.md).

| What was found | Where | Effect on this spec |
|---|---|---|
| The server never reads a manifest ingress *port*; the normal route uses the first declared container port | `packages/server/src/services/core/deployment.ts:6095-6101`, `catalog.ts:658` | FR-008 and Story 1 scenario 3: the default backend port is the port the app's normal route already uses. |
| Signing a non-ephemeral tagged device out expires it; the device record stays listed until deleted in the admin console or by the administration API, which this version does not call | Tailscale docs, `tailscale logout` | FR-026, Story 4 scenarios 2 to 4, SC-005: Hola signs the device out so it can no longer serve, and always names the leftover record for the operator to delete. |
| The only way to re-apply a deployment's configuration restarts every service of the app, not just one | `deployment.ts:3399-3424`, `:5947-5985` | First clarification above and FR-005: the whole app restarts once, the same as a configuration change does today. |
| Every deploy pulls the deployment's images, and a failed pull fails the deploy | `deployment.ts:6037-6038` | FR-027 covers the tailnet being unreachable. A companion image that cannot be pulled fails the deploy like any other image of that deployment, with a message naming it. |
| A rendered configuration is re-serialized on every deploy and, for contract providers, carries a freshly minted token | `deployment.ts:2670`, `:2863` | FR-018, Story 3 and SC-003: "identical" means identical apart from what already varies between two deploys of the same release. The test compares the feature-off rendering against a rendering with the feature's code path removed from the same run. |


## User Scenarios & Testing *(mandatory)*

The "operator" is the person who administers a Hola host and its tailnet. A "client" is whatever connects over the tailnet: a person's device, a server, or an agent.

### User Story 1 — Give one app its own private address on the tailnet (Priority: P1)

The operator opens an installed app, turns on private Tailscale ingress, gives it a Service name and a credential for joining the tailnet, and saves. Hola adds a small platform-owned companion to that deployment. The operator completes the one-time steps on the Tailscale side that Hola cannot do for them, which Hola lists. A client permitted by tailnet policy then reaches the app at its own private address. The app's normal address keeps working exactly as before.

**Why this priority**: This is the feature. Everything else protects or maintains it.

**Independent Test**: On a host with two installed apps, enable private ingress for one. From a tailnet client allowed to reach that Service, a request to the Service's private address returns the app's own response. The same app still answers at its normal address.

**Acceptance Scenarios**:

1. **Given** an installed, running app with private ingress off, **When** the operator enables it with a valid Service name, tag and credential, **Then** the deployment is redeployed with a platform-owned companion, and the app is reachable at a private Service address that is distinct from the host's own tailnet address.
2. **Given** private ingress is enabled, **When** a client requests the app's normal address, **Then** it behaves exactly as before enabling: same route, same certificate, same sign-in gate.
3. **Given** the operator enables private ingress and does not choose a backend, **When** the setting is saved, **Then** the backend is the service the app's manifest names as its ingress, on the port the app's normal route already uses.
4. **Given** the Tailscale side still needs a one-time step (the Service is not defined, or this host is not yet approved to serve it), **When** the operator views the deployment, **Then** the status says which step is outstanding and what to do, and does not report the ingress as working.
5. **Given** the operator uses the command line or the typed API instead of the dashboard, **When** they enable, inspect, change or disable private ingress, **Then** every one of those operations is available and behaves the same as in the dashboard.

---

### User Story 2 — The private address reaches that app and nothing else (Priority: P1)

A client that is allowed to reach one app's Service cannot use that permission to reach any other app, the Hola dashboard or admin API, the host's own tailnet address, the local network, or other machines on the tailnet. Changing the hostname or the address in a request does not change where it lands.

**Why this priority**: Isolation is the reason to build this at all. A private address that still fronts the shared proxy would be the existing problem with a new name.

**Independent Test**: With private ingress enabled for app A only, and a client whose tailnet policy allows only A's Service: requests to A's Service succeed; requests naming app B's hostname, the dashboard's hostname, or an arbitrary hostname, sent to A's Service address, all still land on A (or are refused) and never return B's or the dashboard's content; direct connections to the host's tailnet address are refused by policy.

**Acceptance Scenarios**:

1. **Given** a client allowed only A's Service, **When** it sends a request to A's Service address with app B's hostname in the request, **Then** the response comes from A or is refused, and never from B.
2. **Given** the same client, **When** it sends the dashboard's or admin API's hostname to A's Service address, **Then** it never receives a dashboard or API response.
3. **Given** the same client, **When** it connects to the host's own tailnet address on any port, **Then** tailnet policy refuses it, and Hola's guidance has told the operator that a grant to the host is not a grant to one app.
4. **Given** private ingress is enabled for A, **When** the deployment's rendered configuration is inspected, **Then** the companion can reach A's chosen backend and nothing else on the host: not other deployments, not the shared routing network, not A's other internal services such as its database.
5. **Given** any deployment with private ingress enabled, **When** its rendered configuration is inspected, **Then** it publishes no host ports, runs with no elevated privileges, uses no host networking, and has no access to the container runtime's control socket.

---

### User Story 3 — Apps that have not opted in are untouched (Priority: P1)

An operator who never uses this feature sees no change. No companion, no extra network, no Tailscale address, no stored credential, no new route.

**Why this priority**: The feature is opt-in. A regression for the operators who ignore it would cost more than the feature is worth.

**Independent Test**: Render the configuration of a deployment with the feature never enabled, and again in the same run with the feature's code path bypassed. The two are identical. (Two separate deploys of one release already differ in ways unrelated to this feature; see the planning reconciliation.)

**Acceptance Scenarios**:

1. **Given** a deployment with private ingress never enabled, **When** it is deployed on a Hola version that has this feature, **Then** its rendered configuration is byte-for-byte what it would have been without the feature.
2. **Given** a deployment where private ingress was enabled and then disabled, **When** it is redeployed, **Then** its rendered configuration contains nothing the feature added.
3. **Given** an existing host is upgraded, **When** the upgrade completes, **Then** no deployment has private ingress enabled and no operator action is required.

---

### User Story 4 — It survives ordinary operations and cleans up after itself (Priority: P2)

Restart, stop and start, redeploy, upgrade, rollback, host reboot and Hola restart all leave the private address pointing at the same app under the same name, as the same tailnet device. Disabling the feature or uninstalling the app withdraws the address and signs the device out of the tailnet. The operator can replace the credential without reinstalling.

**Why this priority**: Without this the feature works once and then decays into duplicate devices and dead addresses. It is P2 only because Story 1 has to exist first.

**Independent Test**: Enable private ingress, note the tailnet device. Restart, upgrade and roll back the app and reboot the host. The same single device serves the same Service throughout. Disable the feature: the device is signed out and no longer serves, and the app still answers at its normal address.

**Acceptance Scenarios**:

1. **Given** private ingress is enabled, **When** the app is restarted, redeployed, upgraded or rolled back, or the host reboots, **Then** the Service keeps its name and address and the tailnet shows one device for it, not a new one each time.
2. **Given** private ingress is enabled, **When** the operator disables it, **Then** the Service is no longer served from this host, the device is signed out of the tailnet, the companion is gone, the operator is told the name of the device record left to delete, and the app and its normal address are unaffected.
3. **Given** private ingress is enabled, **When** the app is uninstalled, **Then** the device is signed out of the tailnet, the operator is told the name of the device record left to delete, and nothing the feature stored about that deployment remains on the host.
4. **Given** the device could not even be signed out (the app was stopped, or the network was unreachable at that moment), **When** disable or uninstall completes, **Then** the operator is told by name which device is still signed in and how to remove it. The local cleanup still completes.
5. **Given** the companion's tailnet identity has expired or been revoked and the status reads "needs sign-in", **When** the operator supplies a new credential, **Then** the ingress recovers without reinstalling the app and without creating a second device where the first is still valid.
6. **Given** the tailnet is unreachable, **When** the app is deployed or restarted, **Then** the app itself starts and serves its normal address, and the private ingress status says it is disconnected. The deployment is not reported as failed because of it.
7. **Given** an app is installed by restoring from another deployment, **When** the new install completes, **Then** it does not have private ingress enabled, and no tailnet identity was copied from the source.

---

### User Story 5 — The operator can see what state it is in and what to do next (Priority: P2)

The deployment's page and the command line show whether private ingress is enabled, which backend it targets, the Service name, the private address and name once known, and a plain status. Hola also shows the tailnet-side steps and a small example policy the operator can copy and adapt.

**Why this priority**: Half of this workflow happens in the Tailscale admin console, where Hola cannot see or act. Without clear status and guidance the operator cannot tell a Hola problem from a missing approval.

**Independent Test**: Enable private ingress with the Service not yet defined on the tailnet. The status reads as waiting on that step and names it. Define and approve it. The status becomes connected and shows the private name.

**Acceptance Scenarios**:

1. **Given** private ingress is enabled, **When** the operator views the deployment, **Then** they see one of a fixed set of states (off, starting, needs sign-in, waiting for approval, connected, disconnected, error) with a sentence on what to do for any state that needs action.
2. **Given** the ingress is connected, **When** the operator views the deployment, **Then** they see the private name and address clients should use, and the port.
3. **Given** the operator views the setup guidance, **When** they read it, **Then** it lists the prerequisites, the one-time tailnet steps, and an example grant from one limited source to this Service only, clearly marked as an example to adapt.
4. **Given** the guidance is shown, **When** the operator reads it, **Then** it states that tailnet policy is additive, so an existing broad grant still applies until it is narrowed, and that a grant to the Hola host is not a grant to one app.
5. **Given** any status, log line or diagnostic the feature produces, **When** it is read by anyone, **Then** it contains no credential.

---

### User Story 6 — Target a different backend, or something that is not a website (Priority: P3)

For an app whose useful endpoint is not the one its normal route uses, the operator picks another service that the app's own definition declares, and a port on it. For an endpoint that is not HTTP, the operator selects plain TCP forwarding.

**Why this priority**: The default covers most apps, including the first consumer. This widens the feature without changing its shape.

**Independent Test**: For an app that declares two services, enable private ingress against the second one's port in TCP mode and connect to it over the tailnet.

**Acceptance Scenarios**:

1. **Given** an app that declares several services, **When** the operator chooses the backend, **Then** they choose from that app's declared services only, and a port number, never a free-form address.
2. **Given** the operator names a service the app does not declare, **When** they save, **Then** the request is refused with a message naming the valid choices.
3. **Given** a backend that speaks plain TCP, **When** the operator selects TCP mode, **Then** connections to the Service port are forwarded unmodified to that backend.
4. **Given** an upgrade or rollback moves the app to a release that no longer declares the chosen service, **When** it is deployed, **Then** the private ingress is reported as an error naming the missing service, and no traffic is forwarded to a different service in its place.

---

### Edge Cases

- **Two deployments, one Service name.** A second deployment on the same host asking for a Service name already in use by another is refused, naming the holder. The tailnet could legitimately serve one Service from several hosts, but two different apps on one Hola host sharing a name is a mistake, not redundancy.
- **Invalid names.** A Service name or tag that the tailnet would reject (wrong characters, wrong length, missing prefix) is refused when saved, not discovered at deploy time.
- **Credential that cannot do the job.** A credential that is valid but not permitted to register a device with the requested tag leaves the ingress in "needs sign-in" or "error" with that reason. The app is not affected.
- **Enabling on a stopped app.** The setting is saved and takes effect the next time the app starts. Nothing is started as a side effect.
- **Another operation in flight.** Changing the setting while the deployment is being upgraded, rolled back or removed is refused as busy, the same way those operations refuse each other.
- **App that checks its own hostname.** An app that validates the hostname or origin of incoming requests may refuse requests arriving under the new private name. Hola does not rewrite the hostname to disguise it and does not loosen the app's checks. The guidance explains how the operator can add the private name to the app's own trusted list where the app supports that.
- **Sign-in gate.** An app protected by Hola's forward-auth gate at its normal address is protected there by the shared proxy. The private path does not pass through that proxy, so that gate does not apply to it. Enabling private ingress on such an app requires an explicit acknowledgement that tailnet policy and the app's own authentication are what protect the private path.
- **Unsupported shape.** An app whose chosen backend cannot be given a private path safely (for example, it shares another container's network identity) is refused with the reason, rather than given a wider path that would work.
- **New credential while the device is healthy.** A new credential is used only if the existing device identity is no longer valid; a healthy device is not re-registered, and the unneeded credential is deleted.
- **Shared client identity.** Where several agents share one tailnet identity, tailnet policy cannot tell them apart. The guidance says so, and says that per-agent permissions must then come from the app's own authorization.
- **Rollback of Hola itself.** A deployment with private ingress enabled, run on an older Hola version that predates the feature, simply has no companion; its normal address is unaffected.

## Requirements *(mandatory)*

### Functional Requirements

**Opt-in and control**

- **FR-001**: Each deployment MUST have a private-ingress setting that is off by default, and that an operator can enable, inspect, modify and disable.
- **FR-002**: The setting MUST be available through the dashboard, the typed API, the SDK and the command line, with the same capabilities in each.
- **FR-003**: Enabling MUST NOT require any change to the app's published bundle, and MUST work for an app whose catalog entry says nothing about Tailscale.
- **FR-004**: Changing the setting MUST require the same authority as other changes to a deployment. Reading it MUST never return the stored credential to anyone, including an administrator.
- **FR-005**: Changing the setting on a running app MUST take effect immediately through the existing deployment job machinery, serialized with every other operation on that deployment, and MUST be refused as busy while a conflicting operation is in flight. On a stopped app the setting MUST only be saved. The dashboard and command line MUST warn, before the operator confirms, that the app restarts briefly.

**Destination**

- **FR-006**: Each opted-in deployment MUST be served as its own named Tailscale Service with its own private address and name, which a tailnet policy grant can name as a destination by itself.
- **FR-007**: The Service name MUST be chosen by the operator, MUST be stable across every lifecycle operation, and MUST be unique among the deployments on one Hola host.
- **FR-008**: The backend MUST default to the service the app's manifest names as its ingress, on the port the app's normal route already uses. The operator MAY choose a different service, but only from those the app's own definition declares, plus a port number.
- **FR-009**: The setting MUST NOT accept a free-form upstream address, hostname or URL.
- **FR-010**: The setting MUST support HTTPS-terminated forwarding to an HTTP backend and plain TCP forwarding. The listening port MUST be configurable, defaulting to 443.
- **FR-011**: HTTP forwarding MUST carry WebSocket upgrades, streamed responses and long-lived requests without imposing a shorter limit than the app's normal path does.
- **FR-012**: Hola MUST NOT rewrite the request's hostname to disguise the private name, MUST NOT relax any security header, and MUST NOT add any application credential to forwarded requests.

**The companion**

- **FR-013**: The piece that joins the tailnet (the "companion") MUST be generated by Hola when the deployment is materialized, MUST be pinned to an exact version Hola ships, and MUST NOT come from the app's bundle.
- **FR-014**: The companion MUST run without elevated privileges, without added kernel capabilities, without host devices, without host networking, without sharing another container's network identity, without the container runtime's control socket, and without published host ports.
- **FR-015**: The companion MUST be able to reach the chosen backend and MUST NOT be able to reach any other deployment, the shared routing network, or the other internal services of its own deployment.
- **FR-016**: The compose validator's existing rules MUST NOT be weakened. The companion is a platform injection added after validation and re-checked by the existing deploy-time gate, the same way the platform's other injections are. A bundle that itself declares anything resembling the companion gains no privilege from this feature.
- **FR-017**: The companion MUST NOT offer subnet routing, exit-node behaviour or public exposure, and the setting MUST have no way to request them.
- **FR-018**: A deployment with the setting off MUST render exactly as it would if this feature did not exist.

**Identity and credentials**

- **FR-019**: The companion MUST join the tailnet as a tagged device. The tag is set per deployment, is required, and MUST be validated when saved. `tag:hola-ingress` is offered as the suggestion.
- **FR-020**: The operator MUST be able to supply the joining credential as a tailnet auth key or as an OAuth client credential. Hola MUST state the narrowest scope each needs.
- **FR-021**: The credential MUST be held only until the companion reports that it has joined the tailnet, and MUST then be deleted from the host. While held it is a write-only secret: it MUST NOT appear in any API read, exported or downloadable configuration, log, job record, status or diagnostic.
- **FR-022**: The companion's tailnet identity MUST persist per deployment, outside the app's own data, so that it survives redeploy, upgrade, rollback and reboot, is not captured in the app's backups or snapshots, and is not copied by restore-on-install.
- **FR-023**: The operator MUST be able to supply a new credential without reinstalling the app, whenever the status is "needs sign-in" or a credential is still pending. A new credential MUST NOT register a second device while the existing identity is valid. Reads MUST say whether a credential is currently held, never its value.
- **FR-024**: Upgrading Hola to a version that ships a newer companion MUST carry existing opted-in deployments forward on their next deploy without re-enrolment.

**Lifecycle**

- **FR-025**: Stop MUST stop the companion with the app; start and restart MUST bring it back as the same device serving the same Service.
- **FR-026**: Disabling the setting and uninstalling the app MUST withdraw the Service from this host, sign the device out of the tailnet, and delete the stored identity and credential. The operation MUST always tell the operator the name of the device record that remains for them to delete, and whether it was signed out. If the device cannot be signed out, the operation MUST still complete locally.
- **FR-027**: A companion that cannot connect, or is waiting on a tailnet-side step, MUST NOT cause the app's deployment to be reported as failed, and MUST NOT stop the app from serving its normal address. A deploy MUST NOT wait more than 60 seconds on the companion.
- **FR-028**: When the chosen backend no longer exists in the active release, Hola MUST report an error for the private ingress and MUST NOT forward to anything else.
- **FR-029**: Force removal of a deployment MUST also remove the feature's local state for it.

**Governance**

- **FR-030**: The feature MUST ship with an architecture decision record describing the second ingress path and its boundaries, and with a constitution amendment restating Principle I so that it describes the platform truthfully after this change.

**Status and guidance**

- **FR-031**: Hola MUST report a private-ingress status per deployment, observed when it is read and never shown more than 30 seconds stale, from a fixed set: off, starting, needs sign-in, waiting for approval, connected, disconnected, error. Each state needing action MUST carry a plain statement of the action.
- **FR-032**: When connected, Hola MUST show the private name, address and port.
- **FR-033**: Hola MUST show the tailnet-side prerequisites and one-time steps, including any definition or approval the tailnet requires, and MUST NOT present the ingress as working before they are done.
- **FR-034**: Hola MUST offer a copyable example policy granting one limited source access to this Service on its port, marked as an example. Hola MUST NOT change tailnet policy itself.
- **FR-035**: The guidance MUST state that tailnet policy is additive, that a grant to the Hola host is not a grant to one app, that clients sharing one tailnet identity cannot be told apart by policy, and that tailnet reachability does not replace the app's own authentication.
- **FR-036**: Enabling private ingress on an app whose normal address is behind Hola's forward-auth gate MUST require an explicit acknowledgement that the gate does not cover the private path.
- **FR-037**: The operator documentation MUST cover prerequisites, the enable and disable workflows, credential rotation, the meaning of each status, how to let an app trust its private name, and the difference between a Service and simply sharing a machine's own address.

**Verification**

- **FR-038**: The feature MUST be covered by tests of the rendered configuration (on, off, and after disable), by negative tests of every refused input and every forbidden privilege, and by tests against a real container runtime showing the companion's network reach is limited as FR-015 states.
- **FR-039**: Behaviour that depends on the live Tailscale service (Service definition and approval, policy enforcement, the hostname and address-substitution checks of Story 2) MUST be verified on a real tailnet before the feature is called complete. Where that cannot run automatically, it MUST be recorded as a named manual validation with its result, not assumed.

### Key Entities

- **Private ingress setting**: Per deployment. Whether it is enabled, the Service name, the tag, the backend (a declared service and a port), the forwarding mode (HTTPS or TCP), the listening port, and whether the forward-auth acknowledgement was given. Belongs to the deployment, not to a release, so it survives upgrade and rollback.
- **Joining credential**: The secret used to register the companion on the tailnet. Write-only, and deleted once the companion has joined. Belongs to one deployment's setting.
- **Tailnet identity**: The companion's persisted device state. Belongs to one deployment; kept apart from the app's data; never backed up, snapshotted or restored with it.
- **Private ingress status**: The observed state, the private name, address and port when known, the last error, and when it was last observed. Derived, not configured.
- **Companion**: The platform-owned part of a deployment that holds the tailnet identity and forwards to the backend.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator who already has a tailnet can take an installed app from "private ingress off" to "connected" in under 10 minutes using only Hola's own guidance, including the tailnet-side steps.
- **SC-002**: For a client permitted to reach only one app's Service, 100% of attempts to reach any other app, the dashboard, the admin API or the host's own address through that permission fail, across the hostname-substitution and address-substitution cases in Story 2.
- **SC-003**: For every app in the catalog, the rendered configuration with the feature off is identical to what it would be without the feature, apart from what already varies between two deploys of the same release.
- **SC-004**: Across restart, redeploy, upgrade, rollback and host reboot of an opted-in app, the tailnet shows exactly one device for it, and the Service name and address do not change.
- **SC-005**: After disabling or uninstalling, no Service advertisement, stored credential or stored identity for that deployment remains on the host, the device can no longer serve, and the operator has been told by name which device record to delete.
- **SC-006**: With the tailnet unreachable, 100% of app deployments and restarts still succeed and serve their normal address.
- **SC-007**: No credential appears in any API response, exported configuration, log, job record or diagnostic, and none remains anywhere on the host once the companion has joined, verified by searching all of them for a known test credential after a full enable, re-enrol and disable cycle.
- **SC-008**: An opted-in app publishes zero host ports and its companion holds zero elevated privileges, verified from the running containers.
- **SC-009**: The first consumer works end to end: an agent identity limited to the Omnigraph Service completes a call to its MCP endpoint over the private address, and cannot reach a second installed app.

## Assumptions

- The operator already has a tailnet, administrative access to its policy, and a plan that includes Tailscale Services. Hola does not create tailnets or accounts.
- The Hola host has outbound internet access to the Tailscale coordination and relay servers. No inbound port is opened.
- In this version Hola does not call the Tailscale administration API. It does not define Services, approve hosts or edit policy; it tells the operator what to do and reads the companion's own view of its state. Automating those steps with an operator-supplied administrative credential is a possible later addition.
- One credential is supplied per opted-in deployment and is not kept after joining. A host-wide stored credential is a possible later addition and would be a separate decision, because it keeps a reusable secret at rest.
- The Service's HTTPS certificate is the one the tailnet issues for the Service's private name. The operator has HTTPS certificates enabled on the tailnet. Hola issues no certificate for this path.
- The companion forwards to its backend over plain HTTP or plain TCP on a private, deployment-local path. Re-encrypting to a backend that only speaks HTTPS is out of scope for this version.
- One private ingress per deployment, one backend, one listening port. Several ports or several Services for one deployment are out of scope for this version.
- Apps that use a shared network identity for their ingress service are refused rather than supported.
- The catalog needs no change. A manifest's existing ingress service, on the port the app's normal route already uses, is the default backend. A later optional manifest hint (for example, a suggested Service name or mode) would be backward compatible and is not part of this work.
- Whether the tailnet mechanisms behave exactly as described here (how a Service is advertised from a container without elevated privileges, what the companion can report about pending approval, how removal behaves) is not assumed proven. Each is a validation task for planning, and a mechanism that fails validation changes the design before it changes the requirements.
- Private ingress settings are not carried by restore-on-install and are not part of an app's backups.

## Out of Scope

- Subnet routing, exit nodes, and any public exposure.
- Putting the shared reverse proxy, the dashboard or the admin API on the tailnet.
- Changing any app's source or bundle to make it reachable.
- Managing tailnet policy, users, devices or Services on the operator's behalf.
- Other private-network products. The setting is shaped so another could be added later, but only Tailscale is built.
