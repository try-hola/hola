/**
 * Inject the private-Tailscale-ingress companion into a rendered compose
 * (spec 010, contracts/compose.md).
 *
 * Pure YAML -> YAML. The companion is a PLATFORM-owned service: it is added
 * after validation and after every other platform helper (the caller's
 * ordering is what keeps it from receiving a contract token, `DOCKER_HOST`, the
 * restore-staging mount or `hola` membership — research R6), and it joins
 * exactly two networks of its own: `hola-ts-backend` (internal; the companion
 * and ONE backend service) and `hola-ts-egress` (the companion only, for its
 * outbound coordination traffic). It joins neither the project's `default`
 * network nor `hola`, which is what makes "reaches that app and nothing else"
 * a property of the network graph rather than of the companion's behaviour.
 */

import { parse, stringify } from 'yaml';
import {
  TAILSCALE_SERVICE,
  TAILSCALE_BACKEND_NETWORK,
  TAILSCALE_EGRESS_NETWORK,
  TAILSCALE_STATE_VOLUME,
} from '@hola/shared';
import type { ComposeDoc, ComposeService } from './compose-network';

export interface TailscaleInjectOptions {
  /** Digest-pinned companion image (`tailscaleImage()`). */
  image: string;
  /** The app service the private address forwards to. */
  backendService: string;
  /** The device's hostname on the tailnet (`nodeNameFor`). */
  nodeName: string;
  /** Platform labels (`sh.hola.app`/`deployment`/`name`). `sh.hola.role` is added here. */
  labels: Record<string, string>;
  /** Platform default log driver config, when one is configured. */
  logging?: unknown;
}

export class TailscaleBackendError extends Error {
  constructor(
    public readonly reason: 'missing' | 'network-mode',
    public readonly backendService: string,
  ) {
    super(
      reason === 'missing'
        ? `Private ingress backend service '${backendService}' is not declared by the active release`
        : `Private ingress backend service '${backendService}' uses network_mode and cannot join a private network`,
    );
    this.name = 'TailscaleBackendError';
  }
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
 * Return `content` with the companion, its two networks and its state volume
 * added and the backend attached to `hola-ts-backend`. Every other service is
 * left exactly as it was. Throws `TailscaleBackendError` (never a generic
 * error) when the backend cannot be attached.
 */
export function injectTailscaleIngress(content: string, opts: TailscaleInjectOptions): string {
  const doc = (parse(content) ?? {}) as ComposeDoc;
  const services = doc.services;
  const backend = services?.[opts.backendService];
  if (!services || !backend || typeof backend !== 'object') {
    throw new TailscaleBackendError('missing', opts.backendService);
  }
  if (backend.network_mode !== undefined) {
    throw new TailscaleBackendError('network-mode', opts.backendService);
  }

  // Attach the backend. A service that declared no networks is implicitly on
  // `default`; naming any network drops that, so restore it explicitly (the
  // same correction `attachToHolaNetwork` makes).
  const hadNetworks = backend.networks !== undefined;
  const backendNetworks = toNetworkMap(backend.networks);
  if (!hadNetworks) backendNetworks.default = {};
  backendNetworks[TAILSCALE_BACKEND_NETWORK] = { aliases: [TAILSCALE_BACKEND_NETWORK] };
  backend.networks = backendNetworks;

  const companion: Record<string, unknown> = {
    image: opts.image,
    entrypoint: ['tailscaled'],
    command: ['--tun=userspace-networking', '--statedir=/var/lib/tailscale', '--socket=/tmp/tailscaled.sock'],
    hostname: opts.nodeName,
    restart: 'unless-stopped',
    read_only: true,
    tmpfs: ['/tmp'],
    cap_drop: ['ALL'],
    security_opt: ['no-new-privileges:true'],
    volumes: [`${TAILSCALE_STATE_VOLUME}:/var/lib/tailscale`],
    networks: [TAILSCALE_BACKEND_NETWORK, TAILSCALE_EGRESS_NETWORK],
    // The image's own HEALTHCHECK (if any) probes containerboot's endpoint, not a bare tailscaled.
    healthcheck: { disable: true },
    stop_grace_period: '15s',
    labels: { ...opts.labels, 'sh.hola.role': 'tailscale-ingress' },
  };
  if (opts.logging !== undefined) companion.logging = opts.logging;
  services[TAILSCALE_SERVICE] = companion as ComposeService;

  doc.networks = {
    ...(doc.networks ?? {}),
    [TAILSCALE_BACKEND_NETWORK]: { internal: true },
    [TAILSCALE_EGRESS_NETWORK]: {},
  };
  doc.volumes = { ...(doc.volumes as Record<string, unknown> | undefined), [TAILSCALE_STATE_VOLUME]: {} };

  return stringify(doc);
}
