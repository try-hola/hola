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

function applyToService(service: ComposeService, opts: ComposeDefaultsConfig, allowPrivilegeEscalation: boolean): void {
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

  // security_opt — additive hardening: ensure no-new-privileges, preserve app
  // entries. EXCEPT when the app has been granted privilege escalation for this
  // service (an operator-consented manifest request, e.g. a browser desktop that
  // needs `sudo`): then we must NOT set no-new-privileges — and must strip any
  // no-new-privileges:true the app itself declared — or the `no_new_privs` kernel
  // flag would still block setuid escalation and defeat the grant.
  if (allowPrivilegeEscalation) {
    if (Array.isArray(service.security_opt)) {
      const kept = (service.security_opt as unknown[]).filter(
        (e): e is string => typeof e === 'string' && e !== NO_NEW_PRIVILEGES
      );
      // Drop the key entirely when nothing else remains, so we don't emit an
      // empty `security_opt: []` (Docker default is no_new_privs unset → sudo works).
      if (kept.length) service.security_opt = kept;
      else delete service.security_opt;
    }
  } else if (opts.noNewPrivileges) {
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

/** Per-deploy overrides that can't come from install-wide config. */
export interface PlatformDefaultsRuntime {
  /**
   * Compose service names the app has been granted privilege escalation for
   * (operator-consented `security.elevated` manifest request). These services
   * skip the `no-new-privileges` hardening so setuid escalation (`sudo`) works.
   * Empty/omitted → every service is hardened as usual.
   */
  allowPrivilegeEscalationServices?: string[];
}

/**
 * Return the compose YAML with platform defaults applied to every service.
 * Returns the input unchanged when nothing would change or when the document
 * has no services. Parse-failure tolerant: callers may rely on this not throwing
 * on already-validated compose, but a parse error propagates (mirrors the
 * sibling helpers).
 *
 * `runtime.allowPrivilegeEscalationServices` names services the operator has
 * consented to run without `no-new-privileges` (see AppSecurityConfig). Because
 * that opt-out must be honored even when the install-wide config is otherwise a
 * no-op, its presence forces the parse/rewrite path.
 */
export function applyPlatformDefaults(
  composeYaml: string,
  opts: ComposeDefaultsConfig,
  runtime: PlatformDefaultsRuntime = {}
): string {
  const escalate = new Set(runtime.allowPrivilegeEscalationServices ?? []);
  // A no-op config with no escalation to apply changes nothing — skip the rewrite.
  if (isNoop(opts) && escalate.size === 0) return composeYaml;

  const doc = (parse(composeYaml) ?? {}) as ComposeDoc;
  const services = doc.services;
  if (!services || typeof services !== 'object' || Object.keys(services).length === 0) {
    return composeYaml;
  }

  for (const [name, service] of Object.entries(services)) {
    if (service && typeof service === 'object') applyToService(service, opts, escalate.has(name));
  }

  return stringify(doc);
}
