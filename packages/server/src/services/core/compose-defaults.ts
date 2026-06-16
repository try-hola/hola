/**
 * Apply install-wide operational defaults to a deployed app's compose
 * (restart policy, log rotation, no-new-privileges hardening, optional TZ and
 * resource limits) — the "platform defaults" layer.
 *
 * Unlike network/auth injection (ingress service only), these are container-level
 * concerns and apply to EVERY service in the app's compose.
 *
 * Precedence (see plan): the app wins for fill-if-absent fields (restart,
 * logging, TZ, limits); `no-new-privileges` is additive policy (appended,
 * preserving any app-declared `security_opt`).
 */

import { parse, stringify } from 'yaml';

import type { ComposeDefaultsConfig } from '../../config/compose-defaults';
import type { ComposeDoc, ComposeService } from './compose-network';
import { toEnvMap } from './compose-network';

const NO_NEW_PRIVILEGES = 'no-new-privileges:true';

/** True when the config would change nothing — lets us skip parse/stringify. */
function isNoop(opts: ComposeDefaultsConfig): boolean {
  return (
    !opts.restartPolicy &&
    !opts.logMaxSize &&
    !opts.noNewPrivileges &&
    !opts.tz &&
    !opts.memLimit &&
    !opts.cpus
  );
}

function applyToService(service: ComposeService, opts: ComposeDefaultsConfig): void {
  // restart — fill-if-absent (app wins).
  if (opts.restartPolicy && service.restart === undefined) {
    service.restart = opts.restartPolicy;
  }

  // logging — fill-if-absent (app wins).
  if (opts.logMaxSize && service.logging === undefined) {
    service.logging = {
      driver: 'json-file',
      options: { 'max-size': opts.logMaxSize, 'max-file': opts.logMaxFile },
    };
  }

  // security_opt — additive policy: ensure no-new-privileges, preserve app entries.
  if (opts.noNewPrivileges) {
    const existing = Array.isArray(service.security_opt)
      ? (service.security_opt as unknown[]).filter((e): e is string => typeof e === 'string')
      : [];
    if (!existing.includes(NO_NEW_PRIVILEGES)) existing.push(NO_NEW_PRIVILEGES);
    service.security_opt = existing;
  }

  // TZ — env add-if-absent (app wins).
  if (opts.tz) {
    const envMap = toEnvMap(service.environment);
    if (!('TZ' in envMap)) {
      envMap.TZ = opts.tz;
      service.environment = envMap;
    }
  }

  // resource limits — fill-if-absent (service-level keys for `docker compose up`,
  // not the swarm-only `deploy.resources`).
  if (opts.memLimit && service.mem_limit === undefined) service.mem_limit = opts.memLimit;
  if (opts.cpus && service.cpus === undefined) service.cpus = opts.cpus;
}

/**
 * Return the compose YAML with platform defaults applied to every service.
 * Returns the input unchanged when nothing would change or when the document
 * has no services. Parse-failure tolerant: callers may rely on this not throwing
 * on already-validated compose, but a parse error propagates (mirrors the
 * sibling helpers).
 */
export function applyPlatformDefaults(composeYaml: string, opts: ComposeDefaultsConfig): string {
  if (isNoop(opts)) return composeYaml;

  const doc = (parse(composeYaml) ?? {}) as ComposeDoc;
  const services = doc.services;
  if (!services || typeof services !== 'object' || Object.keys(services).length === 0) {
    return composeYaml;
  }

  for (const service of Object.values(services)) {
    if (service && typeof service === 'object') applyToService(service, opts);
  }

  return stringify(doc);
}
