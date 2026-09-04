/**
 * Inject a server-granted read-only mount into a deployed app's compose.
 *
 * The `apps-data` capability (declared in a manifest as `consumes: apps-data`)
 * grants a trusted app — e.g. a backup tool — read-only access to ALL apps' data
 * roots. The mount is identity-mapped (`<hostPath>:<hostPath>:ro`) so absolute
 * host paths resolve unchanged inside the container (the apps bind root is
 * identity-mounted into the server too — see packages/compose). Like the network
 * and platform-defaults injections, this happens after validation: it's a
 * deliberate platform grant, not user-authored, and is gated by the capability.
 *
 * SECURITY: this exposes every app's data to the consumer. It is read-only and
 * reserved for trusted catalog apps that explicitly declare the capability.
 */

import { parse, stringify } from 'yaml';

import type { ComposeDoc, ComposeService } from './compose-network';
import { toEnvMap } from './compose-network';
import { mergeLabels } from './compose-defaults';

/** Manifest capability granting read-only access to all app data roots. */
export const APPS_DATA_CAPABILITY = 'apps-data';

/**
 * Reserved compose service name for the container-logs proxy sidecar (spec
 * 004, ADR 0004 §12) — pinned by `@hola/shared/compose-validate`'s
 * `RESERVED_SERVICE_NAMES` so a user-authored service can never collide with
 * or spoof it.
 */
export const CONTAINER_LOGS_PROXY_SERVICE = 'hola-docker-proxy';

/** Port the sidecar listens on, and the one `DOCKER_HOST` points every other service at. */
export const CONTAINER_LOGS_PROXY_PORT = 2375;

/** Where every other service reaches the sidecar (the compose project's default network). */
export const CONTAINER_LOGS_DOCKER_HOST = `tcp://${CONTAINER_LOGS_PROXY_SERVICE}:${CONTAINER_LOGS_PROXY_PORT}`;

/** Container-side path of the socket bind; the host side is the caller's `socketPath`. */
const PROXY_SOCKET_MOUNT_PATH = '/var/run/docker.sock';

const DOCKER_HOST_ENV_KEY = 'DOCKER_HOST';

/** The external routing network; the sidecar must never join it (no ambient reach). */
const HOLA_NETWORK = 'hola';

/**
 * The networks the sidecar has to sit on for `DOCKER_HOST` to resolve: every
 * network the provider's own services declare, plus `default` for any service
 * that declares none. Compose only puts a service on `default` when it declares
 * no `networks` at all, so a provider whose services are all on a custom network
 * would otherwise be unable to reach a sidecar sitting alone on `default`.
 *
 * `hola` is excluded deliberately — `attachToHolaNetwork` has already put the
 * ingress service on the external routing network, and joining it would give the
 * proxy ambient reach across every app on the host (ADR 0004 §5). Returns an
 * empty list when no service declares any network, which leaves the sidecar's
 * `networks` key off entirely: everything is on `default` already.
 */
function sidecarNetworks(services: Record<string, ComposeService | undefined>): string[] {
  const names: string[] = [];
  const add = (name: string): void => {
    if (name !== HOLA_NETWORK && !names.includes(name)) names.push(name);
  };

  let anyDeclared = false;
  for (const [name, service] of Object.entries(services)) {
    if (name === CONTAINER_LOGS_PROXY_SERVICE) continue;
    if (!service || typeof service !== 'object') continue;
    const declared = service.networks;
    if (declared === undefined) {
      add('default'); // implicit default connectivity
      continue;
    }
    anyDeclared = true;
    if (Array.isArray(declared)) for (const n of declared) { if (typeof n === 'string') add(n); }
    else if (declared && typeof declared === 'object') for (const n of Object.keys(declared)) add(n);
  }

  // Nobody declared anything: every service is on `default` and so is the
  // sidecar by omission. Keep the compose clean rather than stating the obvious.
  return anyDeclared ? names : [];
}

/**
 * Inject the container-logs provider grant (spec 004, ADR 0004 §12) into a
 * provider deployment's compose, mirroring how `injectReadonlyMount` adds the
 * apps-data mount: post-validation, into every service, on consent only.
 *
 * Adds a `hola-docker-proxy` sidecar (a redacting Docker API proxy, run from
 * the server's own image) with a read-only bind of the Docker socket, and
 * points every OTHER service at it via `DOCKER_HOST` — never the reverse, so a
 * user-authored `DOCKER_HOST` is overwritten (the grant is the only sanctioned
 * source). The sidecar joins only networks inside the provider's own compose
 * project — whichever ones its services are actually on (see `sidecarNetworks`),
 * never the external `hola` network and never a published port, so nothing
 * outside the project can reach it. Idempotent: re-materialising does not
 * duplicate the service, the networks or the env entry.
 */
export function injectContainerLogsSource(
  composeYaml: string,
  opts: { image: string; socketPath: string; labels: Record<string, string>; logging?: unknown },
): string {
  const doc = (parse(composeYaml) ?? {}) as ComposeDoc;
  const services = doc.services;
  if (!services || typeof services !== 'object' || Object.keys(services).length === 0) return composeYaml;

  for (const [name, service] of Object.entries(services)) {
    if (name === CONTAINER_LOGS_PROXY_SERVICE) continue; // the validator already rejects a user-authored one
    if (!service || typeof service !== 'object') continue;
    const envMap = toEnvMap((service as ComposeService).environment);
    // Overwritten unconditionally: DOCKER_HOST is the grant's own wiring, not
    // something an app should be able to redirect.
    envMap[DOCKER_HOST_ENV_KEY] = CONTAINER_LOGS_DOCKER_HOST;
    (service as ComposeService).environment = envMap;
  }

  const sidecar: Record<string, unknown> = {
    image: opts.image,
    command: ['bun', 'src/docker-proxy.ts'],
    volumes: [`${opts.socketPath}:${PROXY_SOCKET_MOUNT_PATH}:ro`],
    restart: 'unless-stopped',
    security_opt: ['no-new-privileges:true'],
    // Pinned, not inherited. The sidecar runs from the SERVER's image, whose
    // `ENV PORT=3001` would otherwise make the proxy listen on 3001 while every
    // other service dials `DOCKER_HOST` on 2375 — a grant that silently wires up
    // to nothing. `DOCKER_SOCKET` is the container-side bind target, which is
    // fixed regardless of where the socket lives on the host.
    environment: {
      PORT: String(CONTAINER_LOGS_PROXY_PORT),
      DOCKER_SOCKET: PROXY_SOCKET_MOUNT_PATH,
    },
    // Same reason: the server image's HEALTHCHECK probes the API server's
    // `/healthz` on 3001, which the proxy neither serves nor listens on, so an
    // inherited check would report every provider's sidecar as unhealthy forever.
    healthcheck: { disable: true },
    labels: mergeLabels(undefined, opts.labels),
  };
  if (opts.logging !== undefined) sidecar.logging = opts.logging;
  const networks = sidecarNetworks(services);
  if (networks.length > 0) sidecar.networks = networks;
  services[CONTAINER_LOGS_PROXY_SERVICE] = sidecar as ComposeService;

  return stringify(doc);
}

/**
 * Return the compose YAML with `<hostPath>:<hostPath>:ro` added to every
 * service's `volumes` (deduped). Returns the input unchanged when there are no
 * services. Parse errors propagate (mirrors the sibling injection helpers).
 */
export function injectReadonlyMount(composeYaml: string, opts: { hostPath: string }): string {
  const mount = `${opts.hostPath}:${opts.hostPath}:ro`;
  const doc = (parse(composeYaml) ?? {}) as ComposeDoc;
  const services = doc.services;
  if (!services || typeof services !== 'object' || Object.keys(services).length === 0) {
    return composeYaml;
  }

  for (const service of Object.values(services)) {
    if (!service || typeof service !== 'object') continue;
    const existing = Array.isArray(service.volumes) ? service.volumes : [];
    if (existing.includes(mount)) continue;
    service.volumes = [...existing, mount];
  }

  return stringify(doc);
}
