# Feature Specification: Aggregated MCP Endpoint

**Feature Branch**: `002-mcp-aggregation`

**Created**: 2026-07-11

**Status**: Draft — ready for planning

**Input**: User description: "Add platform-level MCP support to Hola. Applications declare
their MCP endpoint in their bundle manifest. Hola aggregates the tools from every installed,
running MCP-capable application behind one stable endpoint routed by the existing Traefik and
Authentik infrastructure. Installing, upgrading, rolling back, stopping, or deleting an app
updates the aggregate. The proxy owns any credentials needed to call application MCP endpoints.
Use agentgateway for the data plane. For MVP client authentication, support Authentik OAuth with
pre-registered clients and a separately issued MCP API-token fallback."

## Executive Summary

Hola will add a platform-owned `hola-mcp-gateway` service based on the standalone
[agentgateway](https://agentgateway.dev/) container. The service exposes one remote MCP
Streamable HTTP endpoint:

```text
https://<HOLA_MCP_DOMAIN>/mcp
```

Traefik remains the only ingress and terminates TLS. Unlike browser-oriented forward-auth apps,
the MCP route will not use Authentik's Traefik forward-auth middleware. The MCP endpoint itself
acts as an OAuth resource server: unauthenticated clients receive the MCP-standard `401` and
protected-resource metadata, authenticate through Authentik using Authorization Code + PKCE,
and retry with a bearer access token. Because the Authentik version currently pinned by Hola
does not support Dynamic Client Registration, MVP OAuth clients are pre-registered. Named,
revocable Hola MCP access tokens provide a compatibility fallback for clients that cannot use a
pre-registered OAuth client.

An app opts in with a top-level `mcp` block in its OCI bundle's `manifest.json`. Hola validates
that declaration, connects only the declared Compose service to a dedicated `hola-mcp` network,
and reconciles an agentgateway target after the deployment reaches its active/running state.
Targets and tools are namespaced by deployment ID, so independently developed apps cannot
collide. When an app leaves the active set, its target is removed before its containers are
stopped whenever possible.

The Hola deployment database and finalized manifests remain the sole source of truth. Generated
agentgateway configuration is derived runtime state, just like generated Traefik configuration.

## Fixed Decisions for Planning

The implementation plan MUST treat these decisions as settled unless implementation research
proves one technically impossible. Any proposed deviation must be called out explicitly as a
spec change rather than silently substituted during planning.

1. **Gateway framework**: standalone agentgateway in a separately version-pinned container.
2. **Public transport**: MCP Streamable HTTP at `/mcp`; legacy SSE and public stdio are excluded.
3. **Ingress**: Traefik-only, with a platform/core route and no host-published gateway port.
4. **Client OAuth**: native MCP OAuth resource-server behavior backed by Authentik; never
   browser-cookie forward-auth on the MCP data-plane route.
5. **MVP OAuth onboarding**: pre-registered public OAuth client(s), Authorization Code + PKCE.
6. **Compatibility auth**: separately issued, named, revocable MCP access tokens. The Hola
   control-plane admin key MUST NOT double as an MCP token.
7. **Upstream app auth**: the gateway, not the MCP client, supplies the app's internal bearer
   credential. Client credentials MUST never be passed through to an app.
8. **Discovery/lifecycle source of truth**: active Hola deployments and their finalized
   manifests. There is no operator-managed parallel target registry in agentgateway.
9. **Network isolation**: a dedicated external Docker network named `hola-mcp` joins the gateway
   only to manifest-declared MCP services.
10. **Naming**: deployment-scoped target/tool prefixes are mandatory.
11. **Failure isolation**: a broken MCP integration degrades MCP availability for that app but
    does not turn an otherwise healthy app deployment into a failed deployment.
12. **Service convention**: MCP orchestration follows Hola's Real/Mock service-pair convention.

## Goals

- Give an MCP client one stable URL for the tools exposed by all currently active MCP-capable
  apps installed on a Hola host.
- Make the aggregate converge automatically when apps are installed, promoted, rolled back,
  restarted, stopped, or deleted.
- Preserve Hola's Traefik-only ingress and default Authentik identity model.
- Keep every app's internal MCP endpoint and credential off the public network and out of client
  configuration.
- Keep the server generic: app-specific endpoint details are declared in the bundle manifest;
  the server contains no Gitea-, Immich-, or other app-specific MCP logic.
- Produce deterministic, restart-recoverable derived gateway configuration.
- Give operators enough status and diagnostics to distinguish a healthy app from a degraded MCP
  integration.

## Non-Goals for MVP

- Supporting stdio-only MCP servers or allowing manifests to execute arbitrary gateway commands.
- Supporting legacy public SSE endpoints.
- Registering arbitrary internet-hosted MCP servers that are not part of an installed Hola app.
- Passing the end user's Authentik token through to an application MCP endpoint.
- Per-user delegated OAuth to each upstream app.
- Arbitrary upstream authentication schemes. MVP upstream auth is `none` or a static bearer
  secret referenced from the app's declared environment.
- Multiple public MCP endpoints, user-defined namespaces, profiles, or per-client tool subsets.
- Per-tool approval prompts, argument policies, content inspection, quotas, or fine-grained RBAC.
- Automatic semantic tool selection or mitigation of tool-list/context growth.
- Making agentgateway's admin UI or configuration API public.
- Treating prompts and resources as MVP acceptance requirements. They may pass through if
  agentgateway supports them without additional scope; tools are the required capability.
- Dynamic Client Registration while Hola remains on an Authentik version without it.
- Replacing Hola's existing dashboard/control-plane authentication.

## Terminology

- **Aggregate endpoint**: the single public MCP Streamable HTTP endpoint exposed by Hola.
- **MCP-capable app**: a deployed app whose finalized bundle manifest contains a valid `mcp`
  declaration.
- **MCP target**: one internal app MCP endpoint configured as an agentgateway backend target.
- **Desired target set**: targets derived from Hola deployments that are active, running, and
  have valid MCP metadata.
- **Observed target state**: whether the generated target is loaded, reachable, and able to
  complete MCP initialization/tool discovery.
- **Upstream credential**: a secret used by agentgateway when calling an app's internal MCP
  endpoint. It is distinct from the credential presented by an external MCP client.
- **MCP access token**: a Hola-issued compatibility credential accepted by the aggregate
  endpoint. It is not the Hola control-plane admin key and not an Authentik access token.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect once and use tools from multiple apps (Priority: P1)

A user configures an MCP client with the Hola aggregate endpoint. After authenticating, the
client discovers tools from every installed, running MCP-capable application and can invoke them
without knowing app-local URLs or API keys.

**Why this priority**: This is the product outcome. Without one authenticated endpoint that can
list and call tools across apps, the feature provides no value.

**Independent Test**: Run Hola with two deterministic MCP fixture apps. Connect one standards-
compliant Streamable HTTP client, authenticate, list tools, and successfully invoke one tool from
each fixture through the same public endpoint.

**Acceptance Scenarios**:

1. **Given** two running apps declare MCP tools, **When** an authenticated client calls
   `tools/list`, **Then** the response contains the tools from both apps under collision-safe
   deployment prefixes.
2. **Given** tools from two apps originally share the name `search`, **When** the aggregate lists
   them, **Then** both remain available under distinct names and route to the correct app.
3. **Given** an authenticated client invokes a prefixed tool, **When** the app returns a valid MCP
   response, **Then** the gateway returns that response while preserving MCP content, structured
   content, errors, annotations, and `_meta` fields supported by agentgateway.
4. **Given** an unauthenticated client, **When** it initializes against `/mcp`, **Then** it receives
   `401 Unauthorized` and MCP/OAuth protected-resource discovery information, and no tool names or
   schemas are disclosed.
5. **Given** a client using a valid, non-revoked Hola MCP access token, **When** it initializes and
   calls a tool, **Then** it can use the same endpoint without an Authentik browser flow.

---

### User Story 2 - Installed apps appear and disappear automatically (Priority: P1)

An operator installs, updates, rolls back, stops, or deletes apps through normal Hola workflows.
The MCP aggregate converges to the active app set without separately configuring the gateway.

**Why this priority**: Automatic lifecycle aggregation is the core distinction from manually
maintaining a generic MCP proxy.

**Independent Test**: Keep a client connected while installing an MCP fixture app, verify its
tools become discoverable, then remove the app and verify those tools can no longer be listed or
invoked.

**Acceptance Scenarios**:

1. **Given** an app without MCP metadata is installed, **When** it reaches `running`, **Then** no
   MCP target is created and its deployment behavior is unchanged.
2. **Given** an app with valid MCP metadata reaches `running`, **When** reconciliation completes,
   **Then** its tools are present in a newly initialized aggregate session within 10 seconds.
3. **Given** an MCP-capable app is deleted, **When** deletion begins, **Then** its target is removed
   from desired gateway state before Compose teardown whenever possible, and calls to its old tool
   names fail closed.
4. **Given** an app is stopped and Hola represents it as not active/running, **When** reconciliation
   completes, **Then** the target is disabled or removed until the app returns to the active set.
5. **Given** an app is promoted or rolled back to a release with different MCP metadata, **When**
   the new release becomes active, **Then** the target switches atomically to the new release's
   service, port, path, and credential reference.
6. **Given** connected sessions have a stale tool list after an app-set change, **When** the
   gateway cannot emit `notifications/tools/list_changed`, **Then** Hola/agentgateway closes or
   invalidates those sessions so clients can reconnect; silently retaining callable removed tools
   is prohibited.

---

### User Story 3 - Authenticate through Authentik (Priority: P1)

A user of a compatible MCP client starts an OAuth connection. The client is directed to the
existing Authentik deployment, signs in using the same identity and policies used by Hola, and
returns to the client with a short-lived access token valid only for the aggregate MCP resource.

**Why this priority**: The desired endpoint is an externally reachable tool-execution surface.
Correct resource-bound authentication is mandatory for MVP, not a later hardening task.

**Independent Test**: With a pre-registered public OAuth client and exact callback URI, connect a
real MCP client, complete Authorization Code + PKCE through Authentik, and prove that a token with
the correct issuer/audience succeeds while a token for another Hola application fails.

**Acceptance Scenarios**:

1. **Given** an unauthenticated OAuth-capable client, **When** it follows resource and authorization
   server discovery, **Then** it reaches Authentik without an Authentik forward-auth HTML/cookie
   interposition on `/mcp`.
2. **Given** a user allowed to access the MCP Authentik application, **When** they complete login
   and PKCE verification, **Then** the client receives a short-lived token accepted by the gateway.
3. **Given** a correctly signed Authentik token issued for the Hola dashboard or another app,
   **When** it is presented to `/mcp`, **Then** it is rejected because its audience/resource does
   not match the canonical aggregate endpoint.
4. **Given** an expired, revoked, malformed, or incorrectly issued token, **When** it is presented,
   **Then** the request returns `401` without contacting an upstream app.
5. **Given** `HOLA_AUTH_MODE=none` in a dev/test environment, **When** MCP is enabled, **Then** OAuth
   is unavailable and the environment must use explicit dev/test authentication configuration;
   production MUST never silently expose an unauthenticated MCP endpoint.

---

### User Story 4 - Keep upstream app credentials inside Hola (Priority: P1)

An MCP-capable app requires a bearer token on its internal endpoint. The bundle declares the
environment variable containing that secret. Hola resolves it during deployment, supplies it to
the app, and configures the gateway to use it without returning or requiring it from the external
client.

**Why this priority**: Credential brokerage is an explicit product requirement and a critical
trust boundary.

**Independent Test**: Deploy an MCP fixture requiring a generated bearer secret. Invoke it through
the aggregate using only the client-side OAuth/MCP token, then inspect public APIs, logs, generated
non-secret config, exports, and tool metadata to prove the upstream secret is absent.

**Acceptance Scenarios**:

1. **Given** `mcp.auth.mode=bearer`, **When** a deployment is finalized, **Then** the referenced env
   parameter exists, is secret, and has a non-empty resolved value or finalization fails clearly.
2. **Given** a valid upstream bearer secret, **When** a tool is invoked, **Then** agentgateway sends
   it only to the selected internal target and does not forward the external client's bearer token.
3. **Given** an upstream secret changes during update/rollback, **When** the active release changes,
   **Then** the gateway uses only the new release's secret after the target switch.
4. **Given** a deployment is removed, **When** reconciliation completes, **Then** its runtime secret
   material is deleted even if Compose teardown fails.
5. **Given** an operator reads MCP status or target APIs, **When** records are serialized, **Then**
   secret values and reusable authorization headers are never included.

---

### User Story 5 - Diagnose degraded MCP integrations without breaking apps (Priority: P2)

An operator can see whether the core gateway and each declared app target are healthy. A malformed
or unreachable app MCP endpoint is reported as degraded while the app itself remains running and
usable through its normal web route.

**Why this priority**: MCP is an optional app capability. Its failure must be observable but must
not unnecessarily take down the primary app.

**Independent Test**: Deploy a healthy web app whose declared MCP endpoint refuses connections.
Verify the deployment remains running, the target shows a sanitized degraded status, and other
apps' MCP tools continue to function.

**Acceptance Scenarios**:

1. **Given** an app is healthy but its MCP endpoint is unreachable, **When** reconciliation retries
   fail, **Then** its MCP state becomes `degraded`, its tools are not advertised, and the app
   deployment remains `running`.
2. **Given** one degraded target, **When** a client lists or invokes tools belonging to other
   targets, **Then** those operations remain available.
3. **Given** agentgateway is unavailable, **When** Hola starts or deploys an app, **Then** normal
   control-plane and app deployment functions continue while system MCP health is degraded.
4. **Given** a target later recovers, **When** a retry or reconciliation succeeds, **Then** it
   becomes active without requiring the app to be reinstalled.

---

### User Story 6 - Recover deterministically after restart (Priority: P2)

After the Hola server, gateway, or host restarts, the aggregate endpoint is rebuilt from persisted
deployment state and converges without an operator rebuilding a second registry.

**Why this priority**: Self-hosted systems restart routinely. Derived configuration cannot become
an independent source of truth.

**Independent Test**: Install two fixture apps, delete the generated gateway config/state, restart
Hola, and verify the same target/tool set and public endpoint are restored from deployment data.

**Acceptance Scenarios**:

1. **Given** persisted active deployments, **When** the Hola server starts, **Then** it reconstructs
   the desired target set and atomically emits deterministic gateway configuration.
2. **Given** stale target/secret files for a deleted deployment, **When** startup reconciliation
   runs, **Then** stale state is removed before being considered active.
3. **Given** agentgateway starts before a valid config exists, **When** the init dependency runs,
   **Then** the required runtime directory and safe empty configuration exist and the container
   does not boot with an open/unconfigured listener.

### Edge Cases

- Two installations of the same catalog app are active simultaneously.
- Two apps expose tools with identical names.
- An upstream tool name already begins with another deployment's prefix.
- An app declares MCP on a Compose service different from its web ingress service.
- The declared service is absent from Compose, or the port/path is invalid.
- The endpoint accepts TCP connections but fails MCP initialization or returns an incompatible
  protocol version.
- The upstream lists no tools.
- The upstream changes its tool list without an app lifecycle event.
- App installation succeeds while agentgateway is down.
- Agentgateway reload rejects a newly generated configuration.
- A target is removed while a tool invocation is in flight.
- A release changes only its upstream credential, not its endpoint.
- A client holds an old MCP session across install/delete/restart.
- Authentik is reachable internally but its public issuer URL is unavailable to the client.
- Authentik rotates signing keys while clients have active tokens.
- A token is validly signed but has the wrong issuer, audience, resource, or required scope.
- An OAuth callback URI is not an exact member of the configured allowlist.
- A Hola MCP access token is revoked while a session is active.
- Runtime secret cleanup runs after a partial or failed app deletion.
- The configured MCP hostname conflicts with an app hostname.
- `HOLA_MCP_DOMAIN` is unset, malformed, not covered by TLS, or not publicly resolvable.
- The manifest attempts to place a scheme, hostname, query, fragment, traversal, or encoded
  traversal into the path.
- A malicious or compromised upstream returns oversized schemas, names, descriptions, results,
  logs, or protocol frames.

## Manifest Contract

An invalid `mcp` declaration is a pre-deployment configuration error, not a runtime degradation.
Draft finalization/install MUST fail with a clear validation error when a manifest explicitly
declares MCP but violates this contract. The failure-isolation rule applies after a valid app has
been deployed: endpoint discovery and invocation failures degrade MCP without failing the app.

### Shape

MVP adds an optional top-level `mcp` object to the bundle `manifest.json`:

```jsonc
{
  "mcp": {
    "transport": "streamable-http",
    "service": "api",
    "port": 3000,
    "path": "/mcp",
    "auth": {
      "mode": "bearer",
      "secretEnv": "APP_MCP_TOKEN"
    }
  }
}
```

Unauthenticated internal endpoint example:

```jsonc
{
  "mcp": {
    "transport": "streamable-http",
    "service": "app",
    "port": 8080,
    "path": "/mcp",
    "auth": { "mode": "none" }
  }
}
```

### Field semantics

| Field | Required | MVP rules |
|---|---:|---|
| `transport` | yes | Literal `streamable-http`. Unknown transports are rejected. |
| `service` | yes | Exact Compose service key. Must exist in the materialized app Compose model. |
| `port` | yes | Integer `1..65535`; internal container port only. It is never published on the host. |
| `path` | yes | Absolute HTTP path beginning with `/`; no scheme, authority, query, fragment, backslash, NUL, or dot-segment traversal. Length is bounded. |
| `auth.mode` | yes | `none` or `bearer`. Unknown modes are rejected. |
| `auth.secretEnv` | for bearer | Name of a manifest-declared secret environment parameter. Its resolved value is write-only. |

### Contract rules

- Unknown fields in `mcp` MUST be rejected or deliberately stripped by one shared coercion/
  validation function; they MUST NOT be silently interpreted differently across catalog, draft,
  deployment, and runtime paths.
- `mcp` metadata MUST flow from bundle detail to draft, finalized manifest, immutable release
  metadata, deployment metadata/status, and update/rollback paths without user editing.
- `auth.secretEnv` MUST reference a `defaultEnv` entry marked `isSecret: true`.
- The referenced parameter may use the existing manifest secret-generation recipe. The `mcp`
  block does not introduce a second secret generator.
- An empty bearer value is not permitted, even if the underlying parameter is otherwise optional.
- The manifest cannot specify an arbitrary URL, hostname, Docker network, TLS behavior, headers,
  gateway command, or public route.
- Apps requiring a non-bearer upstream scheme must provide bundle-level glue that exposes a
  bearer-compatible internal MCP endpoint. This keeps the server generic.
- The app bundle remains responsible for translating app-specific configuration formats. Hola
  owns only the generic endpoint, network, and secret-reference contract.

## Public Endpoint and Routing Contract

- New setting: `HOLA_MCP_ENABLED` (new production installs default to enabled; explicit disable is
  permitted for development, repair, and staged upgrades).
- New setting: `HOLA_MCP_DOMAIN`.
- Turnkey install default: `mcp.${HOLA_BASE_DOMAIN}`.
- Canonical MCP resource URI: `https://${HOLA_MCP_DOMAIN}/mcp`.
- `HOLA_MCP_DOMAIN` is reserved by the platform. Deployment host validation MUST reject an app
  that would claim the same hostname.
- The Hola server emits a platform/core Traefik route from `HOLA_MCP_DOMAIN` to the gateway's
  internal data-plane listener.
- The route covers `/mcp` and the well-known protected-resource metadata paths required by the
  selected MCP authorization specification.
- Traefik terminates TLS using the existing certificate-resolver behavior.
- The route MUST NOT attach the Authentik forward-auth middleware.
- The route and gateway MUST NOT publish a host port or enable Traefik's Docker provider.
- The gateway's admin/diagnostic listener MUST remain internal, disabled, or loopback-bound. It
  MUST NOT share the public MCP router.
- The endpoint MUST implement the MCP protocol version selected and verified during planning;
  planning should target the current `2025-11-25` specification where agentgateway supports it.
- Enabling MCP in production requires a configured public domain plus at least one working
  authentication path. If prerequisites cannot be provisioned, MCP readiness fails closed while
  the rest of Hola remains available.

## Network and Container Contract

- Add one platform service named `hola-mcp-gateway` using a pinned agentgateway image tag (and
  preferably pinned digest). Floating `latest`/development tags are prohibited.
- Add a platform-created external network named `hola-mcp`.
- `hola-mcp-gateway` joins:
  - the existing platform `hola` network so Traefik can reach it; and
  - `hola-mcp` so it can reach declared app MCP services.
- During Compose materialization, Hola injects `hola-mcp` only into the service named by a valid
  active `mcp.service` declaration. It does not attach every app service.
- Existing web ingress networking remains unchanged. If the MCP and ingress service are the same,
  that service belongs to both required networks without duplicate/invalid Compose output.
- The app MCP service receives no host port and no public Traefik route.
- Internal target hosts are constructed by Hola from deployment-scoped Docker DNS names/aliases;
  the manifest never controls the host component.
- Network and service-name injection MUST remain deterministic across restart, upgrade, rollback,
  and multiple installations of the same app.

## Tool Naming and Protocol Behavior

- Every target uses a deterministic identifier derived from the stable deployment ID.
- Public tool names use agentgateway's target prefixing and MUST be globally unique. The expected
  shape is `<target>_<upstreamToolName>`; exact legal-character normalization is fixed during
  planning and covered by contract tests.
- Prefixing MUST use deployment identity, not only catalog app slug, because multiple instances of
  one app are legal.
- Hola MUST persist or deterministically reproduce the mapping from public target prefix to
  deployment ID for status and diagnostics.
- The gateway MUST route `tools/call` using the advertised public name and MUST NOT allow a client
  to bypass namespacing to address an internal target directly.
- Upstream tool schemas and annotations are preserved unless agentgateway requires standards-
  compliant normalization. Any lossy normalization discovered in the proof of concept must be
  documented in the plan.
- After a desired target-set change, new sessions MUST see the new tool set within 10 seconds.
- Active sessions MUST either receive the appropriate list-changed notification or be invalidated
  so removed tools do not remain apparently callable.
- Tool calls to a target that is no longer desired fail closed, even if an old session or cached
  tool name exists.
- MVP MUST enforce bounded request, schema, result, and timeout limits using agentgateway/Hola
  controls so one app cannot exhaust the aggregate endpoint.

## Client Authentication Contract

### OAuth path (preferred)

1. Client sends an MCP request without credentials.
2. Gateway returns `401` with a standards-compliant `WWW-Authenticate` challenge and protected-
   resource metadata URL.
3. Protected-resource metadata identifies the canonical resource URI and the existing Authentik
   authorization server.
4. Client uses a pre-registered public client ID and an exact pre-approved redirect URI.
5. Client performs Authorization Code + PKCE (`S256`) in the user's browser.
6. Authentik applies normal authentication, MFA, and application access policies.
7. Authentik issues a short-lived access token bound to the MCP resource/audience.
8. Client retries with `Authorization: Bearer <access-token>`.
9. Agentgateway validates signature, issuer, audience/resource, expiry/not-before, and required
   scope before processing MCP data.

OAuth requirements:

- Hola provisions or reconciles a dedicated Authentik MCP application/provider using the existing
  platform-agnostic provisioner boundary where feasible.
- The OAuth client is public; no reusable client secret is distributed to desktop/CLI clients.
- PKCE `S256` is mandatory.
- Redirect URIs are exact allowlist entries. A wildcard such as `.+` is prohibited.
- The default access policy is the platform administrator group unless an explicit operator-
  controlled allowed-group setting is introduced in the plan.
- The issued access token MUST be distinguishable from dashboard and other app tokens by audience
  or equivalent resource binding.
- The gateway MUST NOT accept a token solely because it is signed by Authentik.
- The gateway MUST NOT pass the client token to an upstream application.
- OAuth discovery metadata and the unauthenticated 401 response may be public; tool enumeration,
  schemas, prompts, resources, invocation, and gateway diagnostics are authenticated.
- Authentik 2025.10's lack of DCR is an explicit MVP limitation. The endpoint MUST NOT advertise a
  registration capability that does not exist.
- The plan MUST include a compatibility matrix proving at least one real client works with a
  supplied/pre-registered client ID. Clients that require DCR use MCP access tokens in MVP.

### Hola MCP access-token path (compatibility fallback)

- MCP access tokens are a distinct credential class used only for the aggregate endpoint.
- Tokens are named, generated from cryptographically secure randomness, displayed only once,
  listable only as redacted metadata, and individually revocable.
- Token records include stable ID, display name, created time, optional expiration, last-used time,
  revocation state, and a non-reversible verifier/hash.
- The raw token MUST NOT be stored in normal deployment metadata, API responses after creation,
  logs, metrics, events, exports, or browser local storage.
- The Hola control-plane admin API key MUST never be accepted as an MCP token merely because both
  are bearer strings.
- The required MVP presentation is `X-API-Key: <hola-mcp-token>` to keep opaque fallback tokens
  distinct from OAuth bearer JWTs. Query-string tokens are prohibited. The plan MAY additionally
  support `Authorization: Bearer` for prefixed opaque MCP tokens only if coexistence with OAuth JWT
  validation is unambiguous and covered by security tests.
- Token validation occurs before any MCP initialization result or tool metadata is returned.
- Revocation MUST prevent new requests within 10 seconds. Existing sessions must be terminated or
  rejected on their next authenticated request.
- MVP tokens grant access to the whole aggregate endpoint. Fine-grained per-target/per-tool scopes
  are future work and MUST NOT be implied in the UI/API.
- Production startup with neither working OAuth nor at least one deliberate token-auth mechanism
  MUST fail the MCP readiness check rather than expose anonymous access.

## Upstream Authentication and Secret Handling

- `auth.mode=none` means the internal app endpoint itself has no credential. It is still reachable
  only through the dedicated Docker network and the externally authenticated gateway.
- `auth.mode=bearer` means Hola resolves `auth.secretEnv` from the active release and supplies that
  credential to agentgateway for the selected target.
- The external client's `Authorization`, cookies, and Authentik identity headers are removed before
  upstream dispatch unless a future explicit identity-propagation feature is designed.
- Runtime secret files live under a dedicated data-root directory with owner-only permissions and
  deterministic deployment-scoped names that reveal no secret value.
- Generated non-secret gateway config references secret files; it SHOULD NOT embed raw upstream
  credentials.
- If the selected agentgateway version cannot consume a bearer credential from a file, the plan
  must design an equivalently protected mechanism and explicitly document the exposure tradeoff.
- Durable upstream secret storage must follow a single Hola secret-store abstraction. Base64 alone
  is not encryption. Planning must either use an existing resolved deployment secret without
  creating a second durable copy or introduce authenticated encryption under a platform master
  key.
- Runtime config/secret writes are atomic. Permissions are applied at creation, not repaired later.
- Secrets are redacted from structured logs and error messages, including upstream response
  headers/bodies that might echo authorization material.
- Secret deletion occurs on target removal and is reconciled on startup.

## Desired-State Reconciliation and Lifecycle

### Source of truth

The desired target set is computed from Hola deployment/release records. A deployment contributes
one target only when all of the following are true:

- it has an active release;
- its lifecycle/status is eligible for traffic (`running`/active, as finalized in planning);
- the active finalized manifest has a valid `mcp` block;
- the referenced service exists in the materialized Compose model; and
- required upstream secret material resolves successfully.

Agentgateway configuration, discovery cache, and status files are derived state. Operators cannot
manually add persistent targets through agentgateway and expect Hola to preserve them.

### Lifecycle ordering

| Event | Required MCP ordering |
|---|---|
| First install | Validate declaration during draft/finalize; inject network/secret during lifecycle materialization; start app; verify eligible endpoint; add target only after deployment becomes active. |
| Restart | Keep stable target identity; mark temporarily unavailable if needed; reconcile after app returns. |
| Stop | Remove/disable target before or as the app stops so tools are not advertised against an intentionally stopped endpoint. |
| Promote/update | Build new release; after new release is active, atomically replace target metadata/secret and refresh discovery. |
| Rollback | Same atomic switch semantics as promote, using rollback release metadata. |
| Delete | Remove/disable target and runtime secret before Compose teardown whenever possible; deletion proceeds even if gateway reconciliation fails, with startup cleanup guaranteed. |
| Hola startup | Rehydrate deployments, compute complete desired set, remove stale files, emit full deterministic config, then verify observed state. |
| Gateway restart | Reload the last valid desired config, then accept a full reconcile from Hola; no manual registration. |

### Reconciliation properties

- Idempotent: reconciling the same desired set produces byte-identical non-secret config and no
  duplicate targets.
- Full-set: startup and repair can replace the entire target set, not only replay incremental events.
- Atomic: clients see either the previous valid config or the next valid config, never a partial
  file.
- Serialized: concurrent deployment completions cannot overwrite each other's targets.
- Retryable: transient gateway/endpoint failures use bounded exponential backoff with jitter.
- Last-known-good: an invalid newly generated/reloaded config does not destroy the prior valid
  configuration for unrelated targets.
- Fail-closed removal: once a target is no longer desired, calls cannot continue merely because
  agentgateway reload failed.
- Observable: desired, loading, active, degraded, and removing states are distinguishable without
  exposing credentials.

## Service and State Model

### Service boundary

Introduce an `McpAggregationService` interface with Real and Mock implementations registered in
the standard service factory. The exact method names are planning details, but the boundary must
cover:

- manifest/deployment eligibility validation;
- full desired-set reconciliation;
- target removal/disable before teardown;
- gateway and target health/status;
- client token lifecycle or integration with the component that owns it; and
- restart recovery.

Deployment orchestration depends on the interface, never directly on agentgateway APIs/config
format. Agentgateway-specific rendering and health behavior live behind the Real implementation.

### Key entities

- **AppMcpConfig**: immutable, finalized manifest metadata: transport, service, port, path, and
  upstream auth declaration.
- **McpTargetDesiredState**: derived target identity, deployment/release IDs, internal endpoint,
  auth secret reference, enabled state, and deterministic public prefix.
- **McpTargetStatus**: redacted observed state: target/deployment IDs, desired state, observed
  status, discovered tool count, last successful sync, retry time, and sanitized last error.
- **McpGatewayStatus**: enabled state, public URL, authentication modes, readiness, loaded target
  count, active/degraded counts, agentgateway version, and last reconciliation time.
- **McpAccessToken**: named fallback token metadata and verifier; raw token exists only at creation.
- **ProvisionedMcpAuthRef**: opaque Authentik provider/application/client identifiers needed for
  idempotent reuse and deprovisioning. No client/user token is persisted here.

### Runtime artifacts

Planning may refine names, but all artifacts belong under the Hola data root and are treated as
generated state:

```text
runtime/mcp/
  config.yaml              # last desired, non-secret agentgateway config
  config.last-good.yaml    # optional rollback copy
  status.json              # redacted desired/observed reconciliation state
  secrets/
    <deployment-id>.token  # upstream bearer material, mode 0600
```

No runtime artifact is committed or included in ordinary support bundles without redaction.

## Control-Plane API and Operator Visibility

The plan MUST define shared SDK types and authenticated API routes that provide at least these
behaviors. Exact route grouping may follow existing conventions.

### Status

- Read aggregate gateway status, public endpoint URL, advertised auth methods, OAuth issuer/client
  metadata safe to disclose to an authenticated operator, and target counts.
- Read per-target redacted status keyed by deployment ID.
- Surface an app's MCP capability and status in deployment detail responses.
- Provide a manual reconcile/refresh action for administrators only. It recomputes desired state;
  it does not create arbitrary targets.

### MCP access tokens

- Create a named token with optional expiration; return raw token once.
- List redacted token metadata.
- Revoke/delete a token idempotently.
- Never provide a "show token again" endpoint.

### Authorization

- Status reads require authenticated control-plane access.
- Reconcile and token mutations require administrator/manage capability.
- MCP data-plane credentials do not grant control-plane API access.
- Control-plane credentials do not automatically grant MCP data-plane access.

### UI/CLI scope

- A dedicated MCP management console is not required for MVP.
- Existing system/deployment views SHOULD surface a concise enabled/active/degraded status and the
  aggregate URL.
- Token management must be available through at least one supported operator surface (API plus
  web or CLI). The implementation plan must name that surface and include safe one-time display.

## Functional Requirements *(mandatory)*

### Platform and manifest

- **FR-001**: The system MUST accept an optional, validated top-level `mcp` manifest block matching
  the contract in this specification.
- **FR-002**: The system MUST preserve `mcp` metadata unchanged through catalog detail, draft,
  finalize, release, deployment, promote, rollback, and restart rehydration paths.
- **FR-003**: The system MUST reject invalid service, port, path, transport, auth mode, or bearer
  secret references before activating an MCP target.
- **FR-004**: Apps without `mcp` metadata MUST retain their current install/runtime behavior.

### Gateway and networking

- **FR-005**: Production Compose MUST include a pinned standalone agentgateway service with no
  host-published data or admin ports.
- **FR-006**: Traefik MUST expose one stable TLS MCP hostname as a platform/core route using only
  the file provider.
- **FR-007**: The MCP route MUST NOT use browser-oriented Authentik forward-auth middleware.
- **FR-008**: The system MUST create/use a dedicated `hola-mcp` network and attach only the gateway
  and declared MCP service for each eligible app.
- **FR-009**: App MCP endpoints MUST NOT receive individual public Traefik routes or host ports.

### Aggregation and lifecycle

- **FR-010**: The gateway MUST expose tools from all and only the desired eligible target set.
- **FR-011**: Public target/tool names MUST be deterministic, deployment-scoped, and collision-safe.
- **FR-012**: The system MUST add/update a target after the corresponding release becomes active.
- **FR-013**: The system MUST remove/disable a target before app teardown whenever possible and
  MUST guarantee eventual removal after partial failure.
- **FR-014**: Startup MUST fully reconstruct gateway desired state from persisted Hola deployments.
- **FR-015**: Reconciliation MUST be idempotent, serialized, atomic, and safe under concurrent app
  lifecycle completions.
- **FR-016**: A degraded MCP target MUST NOT fail an otherwise healthy app deployment or unrelated
  MCP targets.
- **FR-017**: Removed targets MUST fail closed for both new and stale sessions.
- **FR-018**: New sessions MUST observe an app-set change within 10 seconds of successful lifecycle
  reconciliation.
- **FR-019**: Active sessions MUST be notified of tool-list changes or invalidated/reconnected;
  silent indefinite staleness is not acceptable.

### Authentication and authorization

- **FR-020**: The public MCP endpoint MUST require authentication in production before revealing
  tools, schemas, prompts, resources, or invocation results.
- **FR-021**: OAuth-capable requests MUST follow MCP protected-resource discovery and use Authentik
  Authorization Code + PKCE with a pre-registered public client in MVP.
- **FR-022**: The gateway MUST validate token issuer, signature, temporal claims, and MCP-specific
  audience/resource binding.
- **FR-023**: Tokens issued for the Hola dashboard or another app MUST NOT authorize MCP access.
- **FR-024**: The system MUST support separately issued named/revocable MCP access tokens as a
  compatibility path.
- **FR-025**: The Hola admin API key MUST NOT serve as an MCP access token.
- **FR-026**: Revoked/expired MCP tokens MUST be rejected within 10 seconds and before upstream
  dispatch.
- **FR-027**: The gateway MUST NOT forward external client credentials to app targets.

### Upstream credentials and security

- **FR-028**: For bearer-authenticated targets, the system MUST supply the active release's
  referenced secret without requiring it from the MCP client.
- **FR-029**: Secret values MUST be write-only and redacted from APIs, logs, metrics, events,
  exports, status, tool metadata, and non-secret gateway configuration.
- **FR-030**: Runtime secret files MUST be owner-only, atomically written, and removed when no
  longer desired.
- **FR-031**: Durable secret material MUST use an approved secret-store/encryption design; base64
  encoding alone is insufficient.
- **FR-032**: Internal target URLs MUST be constructed from validated platform-owned components to
  prevent SSRF and manifest-controlled arbitrary network access.
- **FR-033**: The gateway MUST enforce bounded connection, initialization, invocation, response,
  and schema limits so one target cannot exhaust the platform.

### Operations and visibility

- **FR-034**: System and deployment status APIs MUST expose redacted gateway/target health and
  sanitized errors.
- **FR-035**: The system MUST expose an administrator-only reconcile action that recomputes desired
  state from deployments.
- **FR-036**: Operators MUST be able to create, list metadata for, and revoke MCP access tokens
  without ever retrieving a stored raw token.
- **FR-037**: Gateway failure MUST degrade MCP system health without blocking normal Hola API,
  dashboard, Traefik app routes, or app lifecycle completion.
- **FR-038**: Relevant gateway authentication, reconciliation, target state, and tool-call audit
  events MUST be logged without request arguments/results or secrets by default.

### Quality

- **FR-039**: The feature MUST have Real and Mock service implementations and hermetic default tests.
- **FR-040**: Docker/Authentik integration tests MUST be separately gated on their dependencies.
- **FR-041**: The implementation MUST pass repository typecheck, lint, unit test, and build gates,
  with typecheck re-run after lint fixes.
- **FR-042**: The implementation MUST include a disposable-VM end-to-end validation covering TLS/
  Traefik routing, Authentik login, two app targets, install/remove convergence, and secret redaction.
- **FR-043**: Before implementation begins, the selected architecture and cross-app capability
  contract MUST be recorded in a new accepted ADR under `docs/adr/`, as required by the Hola
  constitution.

## Security Invariants

These are release blockers:

1. No unauthenticated production tool discovery or invocation.
2. No public app-local MCP endpoint or host port.
3. No Authentik forward-auth cookie flow on the MCP protocol route.
4. No acceptance of any Authentik-signed token without audience/resource validation.
5. No client token passthrough to an app.
6. No upstream secret in manifest JSON, generated non-secret config, logs, events, APIs, exports,
   status payloads, or MCP metadata.
7. No arbitrary manifest-controlled URL or command execution.
8. No direct public access to agentgateway administration.
9. No reuse of the Hola admin API key as an MCP data-plane key.
10. No removed target remaining callable because of stale desired state.

## Failure Semantics

| Failure | Required behavior |
|---|---|
| Invalid manifest MCP block | Reject/coerce it consistently before target activation; catalog quality tests fail for official bundles. |
| Missing bearer secret | Fail draft/finalize clearly before deployment; never configure an empty credential. |
| App starts but MCP endpoint is unavailable | App remains running; target is degraded/not advertised; retry with backoff. |
| Gateway unavailable during app install | App lifecycle completes; desired MCP state persists/recomputes; system MCP health is degraded; retry later. |
| Invalid generated gateway config | Retain last-known-good config for unrelated targets, report failure, and never partially load. |
| Gateway reload times out | Verify observed state; retry safely; do not assume success from file write alone. |
| Target delete fails | Remove it from desired state and external authorization immediately; continue app deletion; cleanup on retry/startup. |
| Authentik unavailable | OAuth connections fail closed; valid fallback tokens may continue only if their verifier does not depend on Authentik. |
| JWKS refresh failure | Previously verified keys may be used only within a bounded cache policy; unknown signing keys fail closed. |
| Token verifier unavailable | Token-authenticated requests fail closed. |
| Tool call in flight during target removal | Existing call may complete only if safely bound to the old target; no new calls start after removal becomes effective. |
| One upstream returns invalid MCP | Isolate/degrade that target; do not crash or poison the aggregate session for other targets. |

## Observability and Audit

- Health distinguishes process liveness, gateway readiness, OAuth readiness, and per-target MCP
  readiness.
- Metrics SHOULD include target counts by state, reconciliation duration/failures, auth outcomes,
  active sessions, tool calls by target/tool/status, upstream latency, and timeouts.
- Metric labels MUST be bounded; raw arguments, results, tokens, user emails, and arbitrary error
  bodies are prohibited labels.
- Default tool-call logs include request/correlation ID, authenticated principal/token ID,
  deployment target, public tool name, outcome, and duration. Arguments and results are omitted by
  default because they can contain sensitive app data.
- Auth failures distinguish missing, malformed, expired, revoked, wrong issuer, wrong audience,
  and insufficient access without returning sensitive validation detail to the client.
- Reconciliation logs show desired/added/updated/removed/degraded counts and sanitized target IDs.

## Compatibility and Migration

- Existing hosts upgrade with MCP disabled until the new core service/config is installed and the
  route can be made secure. Upgrade scripts MUST be idempotent.
- Existing apps without `mcp` metadata require no migration.
- Existing finalized releases remain valid; they simply contribute no target.
- A catalog app begins contributing tools only after a new bundle version containing `mcp` metadata
  is installed/promoted.
- `HOLA_MCP_DOMAIN` is added to install/init configuration and `.env.example`; upgrades choose a
  deterministic default and clearly report DNS/TLS prerequisites.
- `HOLA_MCP_ENABLED` is added to install/init/upgrade configuration. New production installs enable
  it after secure prerequisites are provisioned; staged upgrades may leave it disabled until the
  operator completes DNS, TLS, and client-registration setup.
- The selected agentgateway version is pinned and its config schema/version is recorded. Upgrades
  require compatibility tests and last-known-good rollback behavior.
- Authentik DCR support is future work. When Hola upgrades to a verified DCR-capable Authentik
  version, DCR can be added without changing the public MCP resource URI or app manifest contract.

## Test Requirements

### Unit and contract tests

- Manifest coercion/validation for every valid and invalid field combination.
- Propagation of `mcp` through catalog, draft, finalize, release, update, and rollback types.
- Compose materialization attaches only the selected service to `hola-mcp`.
- Deterministic target naming and config rendering, including two installs of one app.
- Atomic config/secret writes and file permissions.
- Desired-set calculation across all deployment statuses.
- Serialized/idempotent add, update, remove, and startup reconciliation.
- Secret-reference validation and comprehensive redaction.
- MCP token create/list/revoke/expiry behavior and separation from control-plane keys.
- OAuth claim validation: issuer, signature, expiry, audience/resource, and wrong-app token.
- Mock service behavior for default tests.

### Docker integration tests

- One no-auth upstream fixture and one bearer-auth upstream fixture.
- Duplicate upstream tool names and correct prefixed routing.
- Target discovery, tool call, target failure isolation, recovery, and removal.
- Config hot reload with new sessions.
- Active-session list-change notification or forced invalidation/reconnect behavior.
- Gateway restart and full reconstruction.
- Removal during an in-flight call.
- Oversized/invalid upstream messages and timeout enforcement.

### Authentik integration tests

- Idempotent provisioning/reuse/deprovision of the MCP OAuth artifacts.
- Protected-resource and authorization-server metadata discovery.
- Authorization Code + PKCE using an exact pre-registered callback.
- Correct MCP audience/resource token succeeds.
- Dashboard/wrong-audience token fails.
- Disallowed user/group, expired token, rotated key, and unavailable Authentik fail correctly.

### Disposable-VM end-to-end test

On a throwaway Authentik-enabled VM:

1. Bootstrap Hola with an MCP hostname and TLS-capable Traefik route.
2. Verify `/mcp` is publicly reachable only through Traefik and returns authenticated discovery.
3. Install two MCP fixture/catalog apps.
4. Authenticate a real Streamable HTTP client with pre-registered OAuth.
5. List and invoke a tool from each app.
6. Verify the bearer-auth app succeeds without exposing its upstream secret.
7. Delete one app and verify its tools disappear/fail closed while the other still works.
8. Restart Hola/gateway and verify reconstruction.
9. Create and revoke an MCP access token and verify enforcement.
10. Capture sanitized logs/status on failure and destroy/snapshot the VM according to repository
    VM-testing policy.

## Proof-of-Concept Gates Before Full Planning Commitment

The implementation plan may begin with a bounded spike, but it must resolve all of these before
the feature is treated as implementation-ready:

1. A pinned agentgateway release runs as one standalone container on the target architectures.
2. It multiplexes two Streamable HTTP servers and deterministically prefixes duplicate tool names.
3. It reloads target changes without process restart or supports a safe restart strategy.
4. Removed targets cannot be invoked through stale sessions.
5. Active clients receive list-changed notification or reliably reconnect after invalidation.
6. Per-target bearer auth can be sourced from a protected file or an equivalently safe mechanism.
7. Its MCP authentication policy can publish correct protected-resource metadata for the public
   Hola URI and validate generic Authentik issuer/JWKS/audience claims.
8. Authentik 2025.10 can issue a resource/audience-bound token acceptable to agentgateway for a
   pre-registered public PKCE client. If not, the plan must identify the smallest compliant shim or
   constrain OAuth release scope explicitly; weakening audience validation is not acceptable.
9. At least one target MCP client can be configured with the pre-registered client ID; at least one
   client that cannot do so works with the `X-API-Key` MCP token fallback.
10. agentgateway administration can be disabled or kept unreachable while preserving required
    health/config reload functionality.
11. Authentik OAuth JWTs and opaque Hola MCP access tokens can coexist securely on the same `/mcp`
    endpoint without an invalid token falling through from one validator to the other.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: One authenticated Streamable HTTP client lists and successfully invokes tools from
  two separately deployed apps through one stable URL.
- **SC-002**: 100% of advertised tools have deterministic deployment-scoped names, with zero
  collisions across two installations of the same app and duplicate upstream tool names.
- **SC-003**: A successfully installed active MCP app appears in new-session `tools/list` within
  10 seconds of reconciliation; a removed app disappears and becomes non-callable within 10 seconds.
- **SC-004**: Presenting no credential, an invalid credential, a wrong-audience Authentik token, or
  a revoked MCP token results in zero disclosed tools and zero upstream requests.
- **SC-005**: An external client invokes a bearer-protected upstream without knowing or sending the
  upstream secret, and automated secret scans find zero occurrences in prohibited surfaces.
- **SC-006**: Failure of one target causes zero failed calls to healthy unrelated targets in the
  integration scenario.
- **SC-007**: Deleting generated MCP state and restarting Hola reconstructs the exact desired target
  set from persisted deployments with no manual gateway configuration.
- **SC-008**: No new host-published ports or app-local public MCP routes are introduced.
- **SC-009**: OAuth login completes through Authentik using PKCE for at least one real client, and
  resource/audience validation rejects a token issued for another Hola surface.
- **SC-010**: Named fallback token creation, one-time display, use, and revocation pass end-to-end;
  revocation is enforced within 10 seconds.
- **SC-011**: All unit, integration, Authentik contract, and disposable-VM acceptance scenarios pass,
  followed by repository typecheck, lint, test, and build gates.

## Assumptions

- Authentik remains Hola's default installed identity provider; `none` remains dev/test-only.
- MCP-capable upstreams can expose Streamable HTTP on an internal container port.
- Official catalog bundles can add small bearer-translation glue when an upstream uses a
  non-bearer API-key format.
- Hola continues to allow multiple installations of the same app, so deployment identity is the
  correct namespace key.
- Tool aggregation is instance-wide in MVP. Every authenticated MCP principal sees the same target/
  tool set; Authentik controls who may enter, not which individual tools they see.
- The platform remains single-host/single-gateway for MVP; horizontal agentgateway scaling and
  distributed sessions are excluded.
- Agentgateway is a replaceable data plane behind `McpAggregationService`; its configuration is
  not exposed as a public Hola contract.
- Ten seconds is an acceptable MVP convergence/revocation window; planning may tighten it.
- Upstream tool execution can mutate application state. Therefore MCP access defaults to the Hola
  administrator group until a later authorization design broadens it deliberately.

## Dependencies

- A pinned agentgateway standalone image and supported configuration schema.
- Existing Traefik file-provider/core-route machinery.
- Existing deployment lifecycle, finalized manifest propagation, Compose materialization, and
  storage abstractions.
- Existing Authentik provisioner and least-privilege bootstrap/scoped-token flow.
- Existing typed shared/SDK/API conventions and Real/Mock service factory.
- Disposable-VM and Authentik integration-test infrastructure.
- Catalog changes in `try-hola/apps` for real MCP-capable apps or dedicated fixtures.

## Future Work

- Authentik Dynamic Client Registration once a DCR-capable version is adopted and verified.
- OAuth Client ID Metadata Documents if supported by Authentik and target clients.
- Per-user/per-group target and tool authorization using Authentik claims and agentgateway MCP
  authorization policies.
- Multiple named MCP profiles/endpoints to control tool-list size and risk.
- Per-tool approval, read-only/write classification, quotas, audit detail, and argument policies.
- Delegated per-user upstream OAuth and standards-based token exchange.
- Additional upstream auth modes after a generic secret-provider design.
- Prompt/resource aggregation as a first-class tested contract.
- Upstream-originated dynamic list-change propagation without app lifecycle changes.
- Operator UI for target inspection, client setup instructions, and token management.
- Tool search/semantic routing for large installations.

## Planning Handoff Notes

The next agent should produce `research.md`, `data-model.md`, explicit contracts, `plan.md`,
`quickstart.md`, and `tasks.md` under this feature directory. Planning must:

- start with the proof-of-concept gates above;
- draft the required MCP aggregation/authentication ADR and schedule its acceptance before
  implementation tasks;
- include a Constitution Check for Traefik-only ingress, async lifecycle placement, Real/Mock
  services, generic capability-driven integration, default-on platform-agnostic auth, and all
  quality gates;
- separate work in this repository from catalog-bundle work in `try-hola/apps`;
- identify the exact pinned agentgateway version/digest and Authentik compatibility result;
- define the client compatibility matrix and exact pre-registration operator workflow;
- define the MCP-token verifier integration without putting reusable raw tokens into normal
  agentgateway config/status surfaces;
- map every requirement and success criterion to implementation tasks and tests; and
- call out any spec amendment needed before implementation rather than burying unresolved security
  or protocol gaps in tasks.

## Research References

- [MCP Authorization specification (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [agentgateway virtual MCP federation](https://agentgateway.dev/docs/standalone/latest/mcp/connect/virtual/)
- [agentgateway MCP authentication](https://agentgateway.dev/docs/standalone/latest/mcp/mcp-authn/)
- [agentgateway per-target policies](https://agentgateway.dev/docs/standalone/main/mcp/mcp-target-policies/)
- [agentgateway backend authentication](https://agentgateway.dev/docs/standalone/latest/configuration/security/backend-authn/)
- [agentgateway Docker deployment](https://agentgateway.dev/docs/standalone/latest/integrations/platforms/docker/)
- [Authentik OAuth2/OIDC provider](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/)
- [Authentik forward-auth](https://docs.goauthentik.io/add-secure-apps/providers/proxy/forward_auth)
- [Authentik DCR tracking issue](https://github.com/goauthentik/authentik/issues/8751)
- [Hola ADR 0001: Authentication](../../docs/adr/0001-authentication.md)
- [Hola ADR 0002: Cross-app integration](../../docs/adr/0002-cross-app-integration.md)
- [Hola architecture](../../docs/ARCHITECTURE.md)
- [Hola disposable-VM testing](../../docs/MCP_VM_TESTING.md)
