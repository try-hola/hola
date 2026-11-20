# Contract: What the injection adds to a rendered compose

This is the whole of the feature's footprint in a deployment's rendered configuration. With the setting off, or absent, none of it is present.

Given backend service `omnigraph`:

```yaml
services:
  omnigraph:
    # … unchanged, plus:
    networks:
      default: {}                  # added only if the service declared no networks
      hola: { aliases: [ … ] }     # existing, untouched
      hola-ts-backend:
        aliases: [hola-ts-backend]

  hola-tailscale:
    image: tailscale/tailscale:v1.104.7@sha256:<digest>
    entrypoint: ["tailscaled"]
    command:
      - --tun=userspace-networking
      - --statedir=/var/lib/tailscale
      - --socket=/tmp/tailscaled.sock
    hostname: hola-omnigraph
    restart: unless-stopped
    read_only: true
    tmpfs: [/tmp]
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    volumes:
      - hola-ts-state:/var/lib/tailscale
    networks: [hola-ts-backend, hola-ts-egress]
    healthcheck: { disable: true }
    stop_grace_period: 15s
    logging: { … }                 # the platform default, when one is configured
    labels:
      sh.hola.app: omnigraph
      sh.hola.deployment: <id>
      sh.hola.name: <name>
      sh.hola.role: tailscale-ingress

networks:
  hola-ts-backend: { internal: true }
  hola-ts-egress: {}

volumes:
  hola-ts-state: {}
```

## What the companion must NOT have (each is a test)

- `ports`, `privileged`, `cap_add`, `devices`, `network_mode`, `pid`, `ipc`, `userns_mode`
- membership of `hola` or of the project's `default` network
- any bind mount, including the Docker socket
- any `environment` entry (no credential, no contract token, no `DOCKER_HOST`)
- the restore-staging or apps-data mount

## What the app's own bundle may not declare

The validator refuses, as reserved: a service named `hola-tailscale`; a network named `hola-ts-backend` or `hola-ts-egress`; a volume named `hola-ts-state` (named volumes are already refused for apps).

## Commands Hola runs inside the companion

All via `compose exec hola-tailscale`, all with `--socket=/tmp/tailscaled.sock`, none logged with output.

| Purpose | Command |
|---|---|
| Observe | `tailscale status --json` |
| Sign in | stdin → `sh -c 'umask 077; cat > /tmp/hola-authkey'`, then `tailscale up --auth-key=file:/tmp/hola-authkey --advertise-tags=<tag> --hostname=<nodeName>`, then `rm -f /tmp/hola-authkey` (always, including on failure) |
| Serve, https | `tailscale serve --service=<svc> --https=<listenPort> http://hola-ts-backend:<backendPort>` |
| Serve, tcp | `tailscale serve --service=<svc> --tcp=<listenPort> tcp://hola-ts-backend:<backendPort>` |
| Withdraw | `tailscale serve drain <svc>`, then `tailscale serve clear <svc>` |
| Sign out | `tailscale logout` |

For an OAuth client secret (`tskey-client-…`) the bytes written to `/tmp/hola-authkey` are the secret followed by `?ephemeral=false&preauthorized=true` (research R3); the argv is the same.

The upstream host is always the literal `hola-ts-backend`. No operator input reaches the host part of an upstream. The only operator-derived tokens in any command are the service name, the tag, the two port numbers and the node name, each validated against the patterns in data-model.md before it is stored, and passed as separate argv elements with no shell (the one `sh -c` line above takes no operator input).
