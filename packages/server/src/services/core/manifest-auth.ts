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

/**
 * Coerce the native-oidc env-var name map. issuer/clientId/clientSecret are
 * required; redirectUri is optional (apps that derive their own redirect URI
 * from their base URL — e.g. Actual Budget — have no env var for it).
 */
function coerceOidcEnv(
  v: unknown
): { issuer: string; clientId: string; clientSecret: string; redirectUri?: string } | undefined {
  const required = coerceEnvMap(v, ['issuer', 'clientId', 'clientSecret'] as const);
  if (!required) return undefined;
  const redirectUri = asString(asRecord(v)?.redirectUri);
  return { ...required, ...(redirectUri ? { redirectUri } : {}) };
}

/** Coerce a flat string→string record (e.g. oidc.staticEnv); undefined unless it
 *  is a record with at least one non-empty string value. */
function coerceStringRecord(v: unknown): Record<string, string> | undefined {
  const rec = asRecord(v);
  if (!rec) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(rec)) {
    if (typeof val !== 'string' || val.length === 0) return undefined;
    out[k] = val;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Coerce an OIDC credentials-file directive: the data-root-relative `path` where
 *  the server drops the provisioned creds JSON for a bundle sidecar to render. */
function coerceOidcCredentialsFile(v: unknown): { path: string } | undefined {
  const rec = asRecord(v);
  const path = asString(rec?.path);
  if (!path) return undefined;
  return { path };
}

/** Coerce an admin-by-group role-claim directive. `claim` is required; the rest
 *  (admin group, claim values, the scope it rides on) have provisioner defaults. */
function coerceOidcRoleClaim(
  v: unknown
): { claim: string; adminGroup?: string; adminValue?: string; memberValue?: string; scope?: string } | undefined {
  const rec = asRecord(v);
  const claim = asString(rec?.claim);
  if (!claim) return undefined;
  const out: { claim: string; adminGroup?: string; adminValue?: string; memberValue?: string; scope?: string } = { claim };
  const adminGroup = asString(rec?.adminGroup);
  if (adminGroup) out.adminGroup = adminGroup;
  const adminValue = asString(rec?.adminValue);
  if (adminValue) out.adminValue = adminValue;
  const memberValue = asString(rec?.memberValue);
  if (memberValue) out.memberValue = memberValue;
  const scope = asString(rec?.scope);
  if (scope) out.scope = scope;
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
    const env = coerceOidcEnv(oidc?.env);
    const setup = coerceOidcSetup(oidc?.setup);
    const staticEnv = coerceStringRecord(oidc?.staticEnv);
    const extraRedirectUris = asStringArray(oidc?.extraRedirectUris);
    const credentialsFile = coerceOidcCredentialsFile(oidc?.credentialsFile);
    const roleClaim = coerceOidcRoleClaim(oidc?.roleClaim);
    // Require redirectPath + scopes, and at least one wiring mechanism (env, setup,
    // or a creds file a bundle sidecar renders). Unknown manifest fields are dropped
    // downstream (see catalog.ts), so every carried field must be coerced explicitly.
    if (!redirectPath || !scopes || (!env && !setup && !credentialsFile)) return undefined;
    result.oidc = {
      redirectPath,
      scopes,
      ...(env ? { env } : {}),
      ...(setup ? { setup } : {}),
      ...(staticEnv ? { staticEnv } : {}),
      ...(extraRedirectUris ? { extraRedirectUris } : {}),
      ...(credentialsFile ? { credentialsFile } : {}),
      ...(roleClaim ? { roleClaim } : {}),
    };
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
