/**
 * OIDC auth provider — validates dashboard access-token JWTs (ADR 0001 follow-up).
 *
 * The web dashboard runs an Authorization Code + PKCE flow against Authentik and
 * sends the resulting access token as `Authorization: Bearer <jwt>`. This provider
 * verifies that JWT against the IdP's published JWKS:
 *   - signature (RS256/ES256) via the issuer's discovery → jwks_uri
 *   - `iss` exact match + `exp`/`nbf` (enforced by jose)
 *   - audience: `aud` contains, or `azp`/`client_id` equals, the expected value
 *     (Authentik's access-token audience shape varies, so we accept either)
 *
 * Config is resolved per-call from resolveOidcConfig(), so the provider can be
 * registered once at startup and lights up when issuer/clientId become available
 * (e.g. after self-provisioning). When OIDC is disabled it fails closed, letting
 * the api-key provider handle the token instead.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

import { getLogger } from '../../lib/logger';
import { resolveOidcConfig, type OidcConfig } from '../../config/oidc';
import type { AuthProvider, AuthResult, Principal } from './auth-service';

/** Read-only capability set for authenticated-but-non-admin OIDC users. */
const READONLY_CAPABILITIES = [
  'read:system',
  'read:deployments',
  'read:logs',
  'read:backups',
  'read:catalog',
];

interface OidcClaims extends JWTPayload {
  email?: string;
  name?: string;
  preferred_username?: string;
  given_name?: string;
  groups?: string[];
  azp?: string;
  client_id?: string;
}

export class OidcAuthProvider implements AuthProvider {
  readonly name = 'oidc';
  private logger = getLogger().child({ service: 'OidcAuthProvider' });

  // Cache a remote JWKS per issuer; createRemoteJWKSet handles its own key caching
  // and rotation. Keyed by jwks_uri so an issuer/config change rebuilds it.
  private jwksByUri = new Map<string, JWTVerifyGetKey>();
  // Cache discovered jwks_uri per issuer to avoid a discovery fetch on every token.
  private jwksUriByIssuer = new Map<string, string>();

  /** Allow tests/config changes to drop cached discovery + key sets. */
  resetCache(): void {
    this.jwksByUri.clear();
    this.jwksUriByIssuer.clear();
  }

  async authenticate(token: string): Promise<AuthResult> {
    const cfg = resolveOidcConfig();
    if (!cfg.enabled || !cfg.issuer || !cfg.clientId) {
      return { success: false, error: 'OIDC not configured' };
    }
    // Cheap pre-filter: only compact JWTs (header.payload.signature) are ours.
    // Anything else (e.g. the admin API key) is left to other providers.
    if (token.split('.').length !== 3) {
      return { success: false, error: 'not a JWT' };
    }

    try {
      const jwks = await this.getJwks(cfg.issuer);
      const { payload } = await jwtVerify(token, jwks, { issuer: cfg.issuer });
      const claims = payload as OidcClaims;

      if (!this.audienceMatches(claims, cfg.audience ?? cfg.clientId)) {
        this.logger.warn('OIDC token audience mismatch', { aud: claims.aud, azp: claims.azp });
        return { success: false, error: 'token audience mismatch' };
      }

      return { success: true, principal: this.toPrincipal(claims, cfg) };
    } catch (error) {
      // Expired/invalid/wrong-issuer tokens land here; not an error worth raising.
      this.logger.debug('OIDC token verification failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, error: 'invalid OIDC token' };
    }
  }

  hasCapability(principal: Principal, capability: string): boolean {
    return principal.capabilities.includes('*') || principal.capabilities.includes(capability);
  }

  async healthCheck(): Promise<boolean> {
    return resolveOidcConfig().enabled;
  }

  private async getJwks(issuer: string): Promise<JWTVerifyGetKey> {
    const jwksUri = await this.discoverJwksUri(issuer);
    let set = this.jwksByUri.get(jwksUri);
    if (!set) {
      set = createRemoteJWKSet(new URL(jwksUri));
      this.jwksByUri.set(jwksUri, set);
    }
    return set;
  }

  /** Resolve jwks_uri from the issuer's OIDC discovery document (cached). */
  private async discoverJwksUri(issuer: string): Promise<string> {
    const cached = this.jwksUriByIssuer.get(issuer);
    if (cached) return cached;

    // issuer is normalized to a trailing slash; the well-known path joins cleanly.
    const discoveryUrl = `${issuer}.well-known/openid-configuration`;
    const res = await fetch(discoveryUrl, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status} ${discoveryUrl}`);
    const doc = (await res.json()) as { jwks_uri?: string };
    if (!doc.jwks_uri) throw new Error('OIDC discovery document has no jwks_uri');

    this.jwksUriByIssuer.set(issuer, doc.jwks_uri);
    return doc.jwks_uri;
  }

  /** Accept the token if its audience, azp, or client_id names our client. */
  private audienceMatches(claims: OidcClaims, expected: string): boolean {
    const aud = claims.aud;
    if (typeof aud === 'string' && aud === expected) return true;
    if (Array.isArray(aud) && aud.includes(expected)) return true;
    if (claims.azp === expected) return true;
    if (claims.client_id === expected) return true;
    return false;
  }

  private toPrincipal(claims: OidcClaims, cfg: OidcConfig): Principal {
    const groups = Array.isArray(claims.groups) ? claims.groups : [];
    // Admin unless an admin group is configured and the user isn't in it.
    const isAdmin = !cfg.adminGroup || groups.includes(cfg.adminGroup);
    const name =
      claims.name || claims.preferred_username || claims.given_name || claims.email || 'OIDC User';

    return {
      id: String(claims.sub ?? name),
      type: 'user',
      name,
      email: claims.email,
      roles: isAdmin ? ['admin'] : ['user'],
      capabilities: isAdmin ? ['*'] : [...READONLY_CAPABILITIES],
      metadata: { provider: 'oidc', groups },
    };
  }
}

/** Factory mirroring createAdminApiKeyProvider for symmetric wiring. */
export function createOidcAuthProvider(): OidcAuthProvider {
  return new OidcAuthProvider();
}
