// OIDC configuration for the **dashboard's own** login (ADR 0001 follow-up).
//
// This is distinct from the per-app auth the ProvisionerService wires for catalog
// apps: here the Hola web SPA is itself an OAuth2 public client (Authorization Code
// + PKCE) against Authentik, and the server validates the resulting access-token
// JWT (see services/auth/oidc-provider.ts).
//
// Config has two sources, merged with **env winning** so an operator can always
// point the dashboard at an external IdP:
//   1. Explicit env (HOLA_OIDC_*) — set by an operator or installer.
//   2. Self-provisioned values — when HOLA_AUTH_MODE=authentik, the server creates
//      a public OIDC client for the dashboard at startup and calls
//      setProvisionedOidc() with the issuer/clientId it read back.
// When neither yields an issuer+clientId, OIDC is disabled and the dashboard falls
// back to the admin-key login.

function stripTrailingSlash(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url.replace(/\/+$/, '');
}

/** Ensure an OIDC issuer ends with exactly one trailing slash (Authentik issuers do). */
function normalizeIssuer(url: string | undefined): string | undefined {
  const s = stripTrailingSlash(url);
  return s ? `${s}/` : undefined;
}

export interface OidcConfig {
  /** True when a usable issuer + clientId are resolved. */
  enabled: boolean;
  issuer?: string;
  clientId?: string;
  /** Expected token audience; defaults to clientId when unset. */
  audience?: string;
  /** Browser callback URL registered with the IdP. */
  redirectUri?: string;
  scopes: string[];
  /**
   * Optional Authentik group that grants full (write) capabilities. When set,
   * users outside it authenticate as read-only. When unset, any user who obtains
   * a valid token for the dashboard client is treated as admin (Authentik's
   * application-access policy is then the sole gate).
   */
  adminGroup?: string;
}

/** Values discovered by self-provisioning the dashboard's OIDC client at startup. */
export interface ProvisionedOidc {
  issuer: string;
  clientId: string;
  redirectUri: string;
  audience?: string;
}

let provisioned: ProvisionedOidc | undefined;

/** Record the self-provisioned dashboard client so resolveOidcConfig() can use it. */
export function setProvisionedOidc(values: ProvisionedOidc): void {
  provisioned = {
    ...values,
    issuer: normalizeIssuer(values.issuer) ?? values.issuer,
  };
}

/** Test/reset hook. */
export function clearProvisionedOidc(): void {
  provisioned = undefined;
}

function defaultScopes(): string[] {
  const raw = process.env.HOLA_OIDC_SCOPES?.trim();
  if (raw) return raw.split(/[,\s]+/).filter(Boolean);
  return ['openid', 'profile', 'email'];
}

/**
 * Resolve the effective dashboard OIDC config, env overriding self-provisioned.
 * Reads process.env on each call so startup provisioning and tests are reflected
 * without a process restart.
 */
export function resolveOidcConfig(): OidcConfig {
  const issuer = normalizeIssuer(process.env.HOLA_OIDC_ISSUER) ?? provisioned?.issuer;
  const clientId = process.env.HOLA_OIDC_CLIENT_ID?.trim() || provisioned?.clientId;
  const redirectUri =
    stripTrailingSlash(process.env.HOLA_OIDC_REDIRECT_URI) || provisioned?.redirectUri;
  const audience =
    process.env.HOLA_OIDC_AUDIENCE?.trim() || provisioned?.audience || clientId;
  const adminGroup = process.env.HOLA_OIDC_ADMIN_GROUP?.trim() || undefined;

  return {
    enabled: Boolean(issuer && clientId),
    issuer,
    clientId,
    audience,
    redirectUri,
    scopes: defaultScopes(),
    adminGroup,
  };
}
