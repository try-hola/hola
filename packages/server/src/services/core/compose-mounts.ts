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

import type { ComposeDoc } from './compose-network';

/** Manifest capability granting read-only access to all app data roots. */
export const APPS_DATA_CAPABILITY = 'apps-data';

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
