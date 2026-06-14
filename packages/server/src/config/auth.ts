// Auth / SSO platform configuration (MVP pt2).
//
// Hola provisions per-app auth artifacts (OIDC clients, forward-auth providers,
// LDAP bind accounts) against an auth platform when a catalog app declares an
// `auth` block. Authentik is the default platform; the lightweight Authelia+LLDAP
// alternative is tracked in try-hola/hola#88 and would implement the same
// ProvisionerService contract behind a different `mode`.
//
// When `mode` is `none` the factory wires a no-op MockProvisionerService, so apps
// that declare `auth` simply deploy without auth wiring (and a warning is logged).

export type AuthBackendMode = 'none' | 'authentik';

export interface AuthConfig {
  /** Which auth platform Hola provisions against. */
  mode: AuthBackendMode;
  /**
   * Internal base URL the server uses to reach Authentik's API
   * (e.g. `http://authentik-server:9000`). No trailing slash.
   */
  authentikUrl?: string;
  /**
   * Browser-facing base URL of Authentik used to build OIDC issuer URLs
   * (e.g. `https://auth.example.com`). No trailing slash. Falls back to
   * `authentikUrl` when unset.
   */
  authentikPublicUrl?: string;
  /** Long-lived API token (Bearer) the provisioner authenticates with. */
  authentikApiToken?: string;
  /** Network timeout for Authentik API calls. */
  fetchTimeoutMs: number;
}

function stripTrailingSlash(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url.replace(/\/+$/, '');
}

export const defaultAuthConfig: AuthConfig = {
  mode: (process.env.HOLA_AUTH_MODE as AuthBackendMode) || 'none',
  authentikUrl: stripTrailingSlash(process.env.HOLA_AUTHENTIK_URL),
  authentikPublicUrl:
    stripTrailingSlash(process.env.HOLA_AUTHENTIK_PUBLIC_URL) ||
    stripTrailingSlash(process.env.HOLA_AUTHENTIK_URL),
  authentikApiToken: process.env.HOLA_AUTHENTIK_API_TOKEN || undefined,
  fetchTimeoutMs: Number(process.env.HOLA_AUTHENTIK_FETCH_TIMEOUT_MS) || 5000,
};

export function loadAuthConfig(): AuthConfig {
  return { ...defaultAuthConfig };
}

export const authConfig = loadAuthConfig();
