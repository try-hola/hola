// Defensive coercion for a catalog bundle manifest's optional `auth` block into
// a typed AppAuthConfig. Mirrors the narrow-shape coercion used for env/ports in
// catalog.ts: anything malformed degrades to `undefined` (treated as no-auth)
// rather than throwing, so a sloppy manifest never breaks catalog browsing.

import type { AppAuthConfig, AuthMode, OidcSetupCommand } from '@hola/shared';

const AUTH_MODES: readonly AuthMode[] = ['none', 'native-oidc', 'native-ldap', 'forward-auth'];

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string');
  return out.length > 0 ? out : undefined;
}

/** Require every named env mapping to be a non-empty string; else undefined. */
function coerceEnvMap<K extends string>(v: unknown, keys: readonly K[]): Record<K, string> | undefined {
  const rec = asRecord(v);
  if (!rec) return undefined;
  const out = {} as Record<K, string>;
  for (const k of keys) {
    const val = asString(rec[k]);
    if (!val) return undefined;
    out[k] = val;
  }
  return out;
}

/** Coerce a post-deploy OIDC setup command. Requires a non-empty string[] command. */
function coerceOidcSetup(value: unknown): OidcSetupCommand | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const command = asStringArray(rec.command);
  if (!command) return undefined;
  const setup: OidcSetupCommand = { command };
  const service = asString(rec.service);
  if (service) setup.service = service;
  const user = asString(rec.user);
  if (user) setup.user = user;
  const check = asStringArray(rec.check);
  if (check) setup.check = check;
  const checkMatch = asString(rec.checkMatch);
  if (checkMatch) setup.checkMatch = checkMatch;
  return setup;
}

/**
 * Coerce an unknown manifest `auth` value into AppAuthConfig.
 * Returns undefined when absent or unusable (caller treats as `none`).
 * For a mode that requires sub-config (oidc/ldap), a missing/invalid sub-block
 * yields undefined so we never half-provision against a bad manifest.
 */
export function coerceManifestAuth(value: unknown): AppAuthConfig | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;

  const mode = rec.mode;
  if (typeof mode !== 'string' || !AUTH_MODES.includes(mode as AuthMode)) return undefined;
  const m = mode as AuthMode;

  if (m === 'none') return { mode: 'none' };

  const result: AppAuthConfig = { mode: m };

  if (m === 'native-oidc') {
    const oidc = asRecord(rec.oidc);
    const redirectPath = asString(oidc?.redirectPath);
    const scopes = asStringArray(oidc?.scopes);
    const env = coerceEnvMap(oidc?.env, ['issuer', 'clientId', 'clientSecret', 'redirectUri'] as const);
    const setup = coerceOidcSetup(oidc?.setup);
    // Require redirectPath + scopes, and at least one wiring mechanism (env or setup).
    if (!redirectPath || !scopes || (!env && !setup)) return undefined;
    result.oidc = { redirectPath, scopes, ...(env ? { env } : {}), ...(setup ? { setup } : {}) };
  }

  if (m === 'native-ldap') {
    const ldap = asRecord(rec.ldap);
    const env = coerceEnvMap(ldap?.env, ['host', 'port', 'bindDn', 'bindPassword', 'baseDn'] as const);
    if (!env) return undefined;
    result.ldap = { env };
  }

  if (m === 'forward-auth') {
    const fa = asRecord(rec.forwardAuth);
    const allowedGroups = asStringArray(fa?.allowedGroups);
    result.forwardAuth = allowedGroups ? { allowedGroups } : {};
  }

  if (asString(rec.fallback) === 'forward-auth') {
    result.fallback = 'forward-auth';
  }

  return result;
}
