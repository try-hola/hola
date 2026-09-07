# Materialised compose contract

What the server writes into `deployments/<id>/runtime/docker-compose.yml` beyond the user-authored compose. Applied post-validation, in this order (unchanged positions marked):

1. `attachToHolaNetwork` (ingress service) — unchanged
2. env injection (ingress service) — unchanged; contract env only for brokered grants (see 5)
3. token substitution — unchanged
4. `applyPlatformDefaults` (every service) — **+ platform labels**
5. provider grants — `apps-data` mount (unchanged) **+ `container-logs` source**

## Platform labels (every deployment, every service)

```yaml
services:
  postiz:
    labels:
      sh.hola.app: postiz
      sh.hola.deployment: postiz-1a2b
      sh.hola.name: Postiz
```

- List-form `labels` (`- key=value`) is preserved as a list with the three entries appended or replaced by key; map form stays a map.
- A user-authored value under `sh.hola.` is overwritten; every other user label is preserved.
- Applied even when every `HOLA_DEFAULT_*` is disabled.

## `container-logs` grant (provider deployments with the grant consented)

```yaml
services:
  alloy:                                    # every user service
    environment:
      DOCKER_HOST: tcp://hola-docker-proxy:2375
    labels: { sh.hola.app: grafana-alloy, sh.hola.deployment: alloy-77, sh.hola.name: Alloy }
  hola-docker-proxy:                        # injected
    image: ghcr.io/try-hola/server:0.11.0   # HOLA_SERVER_IMAGE ?? ghcr.io/try-hola/server:${HOLA_VERSION}
    command: ["bun", "src/docker-proxy.ts"]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro   # HOLA_DOCKER_SOCKET ?? /var/run/docker.sock
    restart: unless-stopped
    security_opt: ["no-new-privileges:true"]
    environment: { PORT: "2375", DOCKER_SOCKET: /var/run/docker.sock }  # pinned: the server image sets PORT=3001
    healthcheck: { disable: true }                                      # the server image probes /healthz on 3001
    logging: { driver: json-file, options: { max-size: 10m, max-file: "3" } }
    labels: { sh.hola.app: grafana-alloy, sh.hola.deployment: alloy-77, sh.hola.name: Alloy }
```

Guarantees:
- The sidecar joins **only** networks inside the provider's own compose project — the ones its services are actually on (`default` when they declare none): never the `hola` network, no `ports`, no aliases. (Pinned to `default` alone it would be unreachable from services that declare a custom network.)
- Idempotent: re-materialising does not duplicate the service, the volume or the env.
- `DOCKER_HOST` set by the app for a service is overwritten (the grant is the only sanctioned source).
- Without the grant (declared but not consented, or consent later withdrawn by a manifest that drops `provides`), nothing above is present.
- Removed with the project on uninstall (`docker compose down`); nothing persists.

## Proxy behaviour (`hola-docker-proxy:2375`)

| Request | Result |
|---|---|
| `GET /_ping`, `GET /version`, `GET /containers/json`, `GET /containers/{id}/logs?…`, `GET /events?…` | forwarded to the socket; logs and events streamed |
| `GET /containers/{id}/json` | forwarded; response rebuilt with `Id`, `Name`, `Created`, `State`, `Image`, `Config: { Tty, Labels, Image, Hostname }` only |
| any other method or path (`/containers/{id}/archive`, `/exec`, `/images`, POST/PUT/DELETE, `/containers/{id}/top`, `/stats`) | `403 {"message":"not permitted by the container-logs grant"}` |

`/v1.NN` API-version prefixes are accepted and forwarded unchanged.

## Validator (unchanged rules, pinned)

- Bind sources not under `{{APP_DATA}}` → `VOLUME_NOT_UNDER_APP_DATA` (pinned for `/var/run/docker.sock`, `/var/lib/docker/containers`, `/var/lib/docker`, `/var/run`).
- New: a user service named `hola-docker-proxy` → `RESERVED_SERVICE_NAME`.
