/**
 * Attach a deployed app's Compose project to the shared Traefik network so the
 * proxy can route to it (the routing last-mile for #15/#16).
 *
 * The Hola server emits Traefik config that targets `http://<serviceName>:<port>`
 * (issue #16). For Traefik to resolve that, the app's ingress service must join
 * the external `hola` network with a network alias equal to `<serviceName>`.
 * This rewrites the user's Compose accordingly, preserving inter-service
 * connectivity (the default network) when the service did not declare networks.
 */

import { parse, stringify } from 'yaml';

export interface AttachOptions {
  /** Network alias Traefik resolves (the routing service name). */
  alias: string;
  /** Preferred ingress service name (falls back to the first service). */
  ingressService?: string;
  /** External network name Traefik shares (default `hola`). */
  networkName?: string;
}

export interface ComposeService {
  networks?: string[] | Record<string, unknown>;
  [key: string]: unknown;
}

export interface ComposeDoc {
  services?: Record<string, ComposeService>;
  networks?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Normalize a service's `environment` (Compose allows a `KEY=value` array or a
 * map) to a flat map. Shared by env injection and platform-defaults.
 *
 * A value of `null` means "pass this key through from the host environment" —
 * the list form's bare `- FOO`, which Compose spells `FOO:` in map form. It must
 * survive a round-trip as null: writing it back as `FOO: ''` would change the
 * container's `FOO` from inherited to explicitly empty (#439).
 */
export function toEnvMap(existing: unknown): Record<string, string | null> {
  const envMap: Record<string, string | null> = {};
  if (Array.isArray(existing)) {
    for (const entry of existing) {
      if (typeof entry !== 'string') continue;
      const eq = entry.indexOf('=');
      if (eq === -1) envMap[entry] = null;
      else envMap[entry.slice(0, eq)] = entry.slice(eq + 1);
    }
  } else if (existing && typeof existing === 'object') {
    for (const [k, v] of Object.entries(existing as Record<string, unknown>)) {
      envMap[k] = v == null ? null : String(v);
    }
  }
  return envMap;
}

function toNetworkMap(networks: ComposeService['networks']): Record<string, unknown> {
  if (!networks) return {};
  if (Array.isArray(networks)) {
    const map: Record<string, unknown> = {};
    for (const name of networks) map[name] = {};
    return map;
  }
  return { ...networks };
}

/**
 * Return the Compose YAML with the ingress service attached to the external
 * routing network under `alias`. Throws if the YAML is not a parseable Compose
 * document; callers may fall back to the original content.
 */
export function attachToHolaNetwork(composeYaml: string, opts: AttachOptions): string {
  const network = opts.networkName ?? 'hola';
  const doc = (parse(composeYaml) ?? {}) as ComposeDoc;

  const services = doc.services;
  if (!services || typeof services !== 'object' || Object.keys(services).length === 0) {
    return composeYaml; // no services to expose
  }

  const names = Object.keys(services);
  const ingress = opts.ingressService && services[opts.ingressService] ? opts.ingressService : names[0];

  // Declare the external network shared with Traefik.
  doc.networks = doc.networks ?? {};
  if (!doc.networks[network]) {
    doc.networks[network] = { external: true };
  }

  // Attach the ingress service to the network with the routing alias.
  const service = services[ingress];
  const hadNetworks = service.networks !== undefined;
  const serviceNetworks = toNetworkMap(service.networks);
  serviceNetworks[network] = { aliases: [opts.alias] };
  // Preserve implicit default connectivity for services that declared no networks.
  if (!hadNetworks) {
    serviceNetworks.default = {};
  }
  service.networks = serviceNetworks;

  return stringify(doc);
}

/**
 * Attach a contract provider's NON-ingress services to the external routing
 * network so they can reach the server's API (#509, second half).
 *
 * A credential with no route to the API is as useless as no credential. The
 * ingress service is joined by `attachToHolaNetwork` because Traefik has to
 * reach it; a provider whose contract work runs in its own long-running process
 * — which `restore@1` forces — was left on the project network only, where
 * `hola-server` does not resolve. So the set of services trusted with a contract
 * token and the set able to use it must be the same set.
 *
 * **No routing alias is applied here.** The alias belongs to the ingress service
 * alone: adding it to a second container would make Traefik round-robin the
 * app's public traffic across containers that do not serve it.
 *
 * Skips `hola-docker-proxy` for the same reason the credential injection does —
 * it is platform-injected, deliberately isolated from this network (see
 * `compose-mounts.ts`), and giving it ambient reach would undo that.
 * Idempotent: a service already on the network keeps the membership (and alias)
 * it has.
 */
export function attachContractServicesToHolaNetwork(
  composeYaml: string,
  opts: { networkName?: string; skipServices?: string[] } = {},
): string {
  const network = opts.networkName ?? 'hola';
  const skip = new Set(opts.skipServices ?? []);
  const doc = (parse(composeYaml) ?? {}) as ComposeDoc;
  const services = doc.services;
  if (!services || typeof services !== 'object' || Object.keys(services).length === 0) {
    return composeYaml;
  }

  doc.networks = doc.networks ?? {};
  if (!doc.networks[network]) doc.networks[network] = { external: true };

  for (const name of Object.keys(services)) {
    if (skip.has(name)) continue;
    const service = services[name];
    if (!service || typeof service !== 'object') continue;
    const hadNetworks = service.networks !== undefined;
    const nets = toNetworkMap(service.networks);
    if (nets[network] === undefined) nets[network] = {};
    if (!hadNetworks) nets.default = {};
    service.networks = nets;
  }

  return stringify(doc);
}

/**
 * Return the Compose YAML with the given environment merged into the ingress
 * service's `environment` block (as a map). Used to inject provisioned auth
 * settings (OIDC client id/secret/issuer/redirect) so the app picks them up on
 * first boot. Injected values take precedence over the app's declared defaults.
 *
 * Throws if the YAML is not a parseable Compose document, or if no env was
 * actually injected when some was requested — callers must NOT swallow this, so
 * a failure fails the deploy rather than silently shipping an app without auth.
 */
export function injectEnvironment(
  composeYaml: string,
  env: Record<string, string>,
  opts: { ingressService?: string }
): string {
  const keys = Object.keys(env);
  if (keys.length === 0) return composeYaml;

  const doc = (parse(composeYaml) ?? {}) as ComposeDoc;
  const services = doc.services;
  if (!services || typeof services !== 'object' || Object.keys(services).length === 0) {
    throw new Error('cannot inject environment: compose document has no services');
  }

  const names = Object.keys(services);
  const ingress = opts.ingressService && services[opts.ingressService] ? opts.ingressService : names[0];
  const service = services[ingress];

  // Normalize an existing `environment` (which may be a `KEY=value` array) to a map.
  const envMap = toEnvMap(service.environment);
  for (const k of keys) envMap[k] = env[k];
  service.environment = envMap;

  return stringify(doc);
}
