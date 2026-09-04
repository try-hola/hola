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
import { PLATFORM_LABEL_PREFIX } from '@hola/shared/contracts';

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

/**
 * Merge platform label keys into a service's `labels`, preserving whichever
 * form the app declared (Compose allows a `KEY=value` list or a map) — spec 004
 * FR-030. A key already present is replaced (in place, for list form); every
 * other key is preserved. Absent `labels` defaults to map form, the simpler of
 * the two and the one every Compose parser accepts.
 *
 * `sh.hola.` is a RESERVED namespace (ADR 0004 §13): a user-authored label under
 * it is dropped, not merely shadowed, so a collector grouping on the namespace
 * reads platform facts and never app-supplied ones. Everything outside the
 * namespace — including entries this function can't parse — is left untouched.
 */
export function mergeLabels(existing: unknown, labels: Record<string, string>): unknown {
  const isPlatformValue = (k: string): boolean => Object.prototype.hasOwnProperty.call(labels, k);

  if (Array.isArray(existing)) {
    const keyOf = (e: string): string => {
      const eq = e.indexOf('=');
      return eq === -1 ? e : e.slice(0, eq);
    };
    const seen = new Set<string>();
    const result: unknown[] = [];
    for (const entry of existing) {
      // A non-string entry isn't a `KEY=value` label we can reason about; keep it
      // verbatim rather than silently deleting something the author wrote.
      if (typeof entry !== 'string') {
        result.push(entry);
        continue;
      }
      const k = keyOf(entry);
      // `hasOwnProperty`, not `in`: a user label literally named `constructor`
      // or `toString` would otherwise match Object.prototype and be rewritten to
      // `<key>=undefined`.
      if (isPlatformValue(k)) {
        seen.add(k);
        result.push(`${k}=${labels[k]}`);
      } else if (!k.startsWith(PLATFORM_LABEL_PREFIX)) {
        result.push(entry);
      }
    }
    for (const [k, v] of Object.entries(labels)) {
      if (!seen.has(k)) result.push(`${k}=${v}`);
    }
    return result;
  }

  const map: Record<string, unknown> = {};
  if (existing && typeof existing === 'object') {
    for (const [k, v] of Object.entries(existing as Record<string, unknown>)) {
      if (isPlatformValue(k) || !k.startsWith(PLATFORM_LABEL_PREFIX)) map[k] = v;
    }
  }
  for (const [k, v] of Object.entries(labels)) map[k] = v;
  return map;
}

function applyToService(
  service: ComposeService,
  opts: ComposeDefaultsConfig,
  allowPrivilegeEscalation: boolean,
  labels?: Record<string, string>,
): void {
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

  // Platform labels (spec 004, FR-030) — every service, every deployment.
  // Merged rather than fill-if-absent: a user-authored value under the reserved
  // namespace is deliberately overwritten (the platform is the source of truth
  // for who's who), while every other user label survives untouched.
  if (labels && Object.keys(labels).length > 0) {
    service.labels = mergeLabels(service.labels, labels);
  }
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
  /**
   * Platform labels (spec 004, FR-030/031) applied to every service —
   * `sh.hola.app`, `sh.hola.deployment`, `sh.hola.name`. Present on every
   * deployment, so its presence forces the rewrite path even when the
   * install-wide config (`opts`) is otherwise a no-op.
   */
  labels?: Record<string, string>;
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
  const hasLabels = !!runtime.labels && Object.keys(runtime.labels).length > 0;
  // A no-op config with no escalation and no labels to apply changes nothing —
  // skip the rewrite. Labels are present on every deployment, so this branch
  // exists for tests/callers that pass no runtime at all.
  if (isNoop(opts) && escalate.size === 0 && !hasLabels) return composeYaml;

  const doc = (parse(composeYaml) ?? {}) as ComposeDoc;
  const services = doc.services;
  if (!services || typeof services !== 'object' || Object.keys(services).length === 0) {
    return composeYaml;
  }

  for (const [name, service] of Object.entries(services)) {
    if (service && typeof service === 'object') applyToService(service, opts, escalate.has(name), runtime.labels);
  }

  return stringify(doc);
}
