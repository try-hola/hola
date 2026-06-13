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

interface ComposeService {
  networks?: string[] | Record<string, unknown>;
  [key: string]: unknown;
}

interface ComposeDoc {
  services?: Record<string, ComposeService>;
  networks?: Record<string, unknown>;
  [key: string]: unknown;
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
