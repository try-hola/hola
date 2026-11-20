# Quickstart: Private Tailscale ingress

## For an operator

Prerequisites: a tailnet with MagicDNS and HTTPS certificates enabled, admin access to its policy, and a tagged auth key (or an OAuth client secret with the `auth_keys` scope) for the tag you will use.

```sh
# 1. See what an enable would use
hola tailscale <deploymentId>

# 2. Enable (the app restarts once)
hola tailscale enable <deploymentId> \
  --service svc:omnigraph --tag tag:hola-ingress \
  --auth-key-file ./ts.key

# 3. Do the tailnet-side steps the command prints:
#    - tagOwners for tag:hola-ingress
#    - define svc:omnigraph (tcp:443)
#    - approve the host hola-omnigraph, or add an autoApprovers.services entry
#    - add a grant from your client to svc:omnigraph

# 4. Check
hola tailscale <deploymentId>          # state: connected, address shown

# 5. Turn it off
hola tailscale disable <deploymentId>  # then delete the device it names in the admin console
```

The same is on the deployment's Overview tab in the dashboard.

## For a developer

```sh
bun --cwd packages/server test src/__tests__/deployments/compose-tailscale.test.ts
bun --cwd packages/server test src/__tests__/deployments/tailscale-ingress-*.test.ts
cd packages/cli && npx vitest run src/__tests__/tailscale.test.ts
cd packages/web && npx vitest run src/__tests__ -t "Tailscale"

# Real Docker, no tailnet needed: network reach of the companion
bun --cwd packages/server test:integration

# Everything
bun run typecheck && bun run lint && bun run typecheck && bun run test && bun run build
```

The integration test starts the real companion image unauthenticated. It proves the container starts under the hardening in contracts/compose.md, reports `needs-sign-in`, can open a connection to the backend, and cannot open one to a second service of the same project or to a container of another project.

## What cannot be tested here

Anything that needs a tailnet: sign-in, Service approval, policy enforcement, the certificate, and the hostname-substitution checks of Story 2. Those are V1 to V10 in `validation.md`. Run them on a disposable VM (`bin/vm-create`, bootstrap, install two apps) joined to a test tailnet, and record each result in that file.
