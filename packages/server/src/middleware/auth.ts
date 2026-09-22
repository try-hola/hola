/**
 * Authentication and authorization middleware
 * 
 * Handles principal resolution and capability checking for protected endpoints
 */

import { getLogger } from '../lib/logger';
import type { Principal, AuthService, Capability } from '../services/auth/auth-service';
import { getServices } from '../services/simple-factory';
import { featureFlags, environmentConfig } from '../config/features';

export interface AuthContext {
  isAuthenticated: boolean;
  principal?: Principal;
  error?: string;
  /** How the credential reached us — see {@link CredentialSource}. */
  credentialSource?: CredentialSource;
}

/**
 * Where a request's credential came from.
 *
 * This distinction is the hinge of the CSRF rule (F04, see
 * `middleware/origin-guard.ts`), not a diagnostic nicety:
 *
 * - `header` — `Authorization: Bearer` / `X-API-Key`. Nothing attaches these
 *   for the caller; a page has to set them itself, which means knowing the key.
 *   (A cross-origin page setting one also triggers a CORS preflight, and this
 *   server answers none that permits a *credentialed* cross-origin request —
 *   but the decisive point is simpler: a header credential is proof of intent
 *   because the caller had to hold it.)
 * - `cookie` — the admin-key session cookie. Attached AMBIENTLY by the browser
 *   to any request to this origin, including one initiated by a page on a
 *   sibling app subdomain, which is same-SITE and therefore not blocked by
 *   `SameSite=Strict`. This is the only CSRF-able credential Hola has.
 * - `query` — `?token=` / `?api_key=`, dev/test only. Ambient in no sense: the
 *   caller must already know the key to put it in the URL.
 */
export type CredentialSource = 'header' | 'cookie' | 'query';

/** A credential found on a request, with the source that yielded it. */
export interface RequestCredential {
  token: string;
  source: CredentialSource;
}

// Extend RequestContext to include auth information
export interface RequestContextWithAuth {
  requestId: string;
  startTime: number;
  logger: ReturnType<typeof getLogger>;
  userId?: string;
  principal?: Principal;
  auth: AuthContext;
}

/**
 * Find the request's credential AND record which of the three sources it came
 * from, in precedence order.
 *
 * Exported because the CSRF rule (`middleware/origin-guard.ts`) must decide
 * from the *same* answer this function gives, not from a second reading of the
 * headers. If the two ever disagreed — say the guard called a request
 * cookie-authenticated while `authenticate()` used its Bearer header, or the
 * reverse — the guard would be enforcing a rule about a credential that isn't
 * the one in force. One function, two consumers, no drift.
 *
 * The precedence matters as much as the values: an explicit header wins over
 * the ambient cookie, so a caller that sends both (the dashboard, once it holds
 * an OIDC access token) is treated as header-authenticated and is exempt from
 * the origin rule on its own merits.
 */
export function resolveCredential(req: Request): RequestCredential | null {
  // Try Authorization header first (Bearer token)
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return { token: authHeader.substring(7), source: 'header' };
  }

  // Try X-API-Key header
  const apiKeyHeader = req.headers.get('x-api-key');
  if (apiKeyHeader) {
    return { token: apiKeyHeader, source: 'header' };
  }

  // Try the dashboard session cookie (admin-key fallback login sets this HttpOnly
  // cookie so the SPA never holds the raw key in JS-readable storage).
  const sessionCookie = readCookie(req, SESSION_COOKIE);
  if (sessionCookie) {
    return { token: sessionCookie, source: 'cookie' };
  }

  // Try query parameter — only outside production. The browser authenticates SSE
  // (EventSource can't set headers) via the same-origin HttpOnly session cookie
  // above, so a query-string credential is purely a dev/testing convenience; in
  // production it would leak the admin key into proxy/access logs and browser
  // history, so it's disabled there.
  if (environmentConfig.enableDevApi) {
    const url = new URL(req.url);
    const queryToken = url.searchParams.get('token') || url.searchParams.get('api_key');
    if (queryToken) {
      return { token: queryToken, source: 'query' };
    }
  }

  return null;
}

/**
 * Name of the HttpOnly session cookie used by the admin-key login fallback.
 *
 * `__Host-` prefixed (F04): a browser will only accept such a cookie when it is
 * `Secure`, `Path=/` and carries NO `Domain` attribute, and — the part that
 * matters here — it then belongs to exactly this host. Without the prefix, a
 * compromised sibling app on `*.<HOLA_BASE_DOMAIN>` could set a `hola_session`
 * cookie scoped to the registrable domain and have the browser send it to the
 * dashboard (cookies are scoped by domain, not by origin), shadowing or seeding
 * the operator's session. The prefix makes that impossible.
 *
 * Renaming the cookie logs existing browser sessions out once, on the upgrade
 * that introduces it; the SPA already routes a 401 to its login screen, and the
 * login response expires the old name (see `AUTH_API.login` in server.ts).
 */
export const SESSION_COOKIE = '__Host-hola_session';

/**
 * The pre-F04 cookie name. Never read — it is only expired, on login and on
 * logout, so an upgraded install stops sending a cookie the server ignores.
 * Deliberately not accepted as a credential: doing so would keep alive exactly
 * the domain-scoped, sibling-settable name that `__Host-` exists to retire.
 */
export const LEGACY_SESSION_COOKIE = 'hola_session';

/**
 * Attributes shared by every session-cookie header we emit.
 *
 * `Secure` and `Path=/` are two of the three things the `__Host-` prefix
 * requires (the third is the absence of `Domain`, which is expressed by not
 * writing one); a browser silently DROPS a `__Host-` cookie that misses any of
 * them, so these are load-bearing, not decoration.
 */
const SESSION_COOKIE_ATTRIBUTES = 'HttpOnly; Secure; SameSite=Strict; Path=/';

/** Thirty days, in seconds — the session cookie's lifetime. */
const SESSION_COOKIE_MAX_AGE = 2592000;

/** The `Set-Cookie` value that establishes an admin-key session. */
export function sessionCookieHeader(key: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(key)}; ${SESSION_COOKIE_ATTRIBUTES}; Max-Age=${SESSION_COOKIE_MAX_AGE}`;
}

/** The `Set-Cookie` value that clears the session cookie. */
export function expiredSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; ${SESSION_COOKIE_ATTRIBUTES}; Max-Age=0`;
}

/**
 * The `Set-Cookie` value that deletes the pre-F04 cookie name. Emitted on
 * logout AND on login, so an upgraded browser stops sending a domain-scoped
 * cookie the server no longer reads.
 */
export function expiredLegacySessionCookieHeader(): string {
  return `${LEGACY_SESSION_COOKIE}=; ${SESSION_COOKIE_ATTRIBUTES}; Max-Age=0`;
}

/** Read a single cookie value from the request's Cookie header. */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/**
 * Check if endpoint is public (doesn't require authentication)
 */
function isPublicEndpoint(path: string, method: string): boolean {
  const publicEndpoints = [
    { path: '/healthz', method: 'GET' },
    { path: '/readyz', method: 'GET' },
    { path: '/metrics', method: 'GET' },
    { path: '/api/system/health', method: 'GET' },
    { path: '/api/system/status', method: 'GET' },
    { path: '/api/echo', method: 'POST' }, // For testing
    // Auth bootstrap: the SPA reads its login config and logs in before it has a
    // credential, so these must be reachable without one.
    { path: '/api/auth/config', method: 'GET' },
    { path: '/api/auth/login', method: 'POST' },
    { path: '/api/auth/logout', method: 'POST' },
  ];
  
  return publicEndpoints.some(endpoint => 
    endpoint.path === path && endpoint.method === method
  );
}

/**
 * Check if endpoint requires specific capabilities.
 *
 * Exported for tests: the fall-through default below (`write:deployments` for any
 * unmatched mutation) means a missing rule silently escalates what a route asks
 * for, which for the contract endpoints would be the difference between "announce
 * a backup" and "install and delete apps". That's worth asserting directly.
 */
export function getRequiredCapability(path: string, method: string): Capability | null {
  // Define capability requirements for different endpoints
  const capabilityMap: Array<{ 
    pattern: RegExp; 
    method: string; 
    capability: Capability 
  }> = [
    // System management
    { pattern: /^\/api\/settings/, method: 'PATCH', capability: 'write:settings' },
    { pattern: /^\/api\/settings/, method: 'PUT', capability: 'write:settings' },
    
    // Deployment operations
    { pattern: /^\/api\/deployments\/[^/]+\/actions/, method: 'POST', capability: 'write:deployments' },
    { pattern: /^\/api\/deployments/, method: 'POST', capability: 'write:deployments' },
    { pattern: /^\/api\/deployments/, method: 'PATCH', capability: 'write:deployments' },
    { pattern: /^\/api\/deployments/, method: 'DELETE', capability: 'write:deployments' },
    
    // Draft operations  
    { pattern: /^\/api\/drafts/, method: 'POST', capability: 'write:deployments' },
    { pattern: /^\/api\/drafts/, method: 'PATCH', capability: 'write:deployments' },
    { pattern: /^\/api\/drafts/, method: 'DELETE', capability: 'write:deployments' },
    
    // Capability contract broker (ADR 0004 §6). MUST be listed before the generic
    // fallback below: an unmatched POST defaults to `write:deployments`, which a
    // contract token deliberately does not have — without this rule the provider
    // could never call its own endpoint, and granting it the default would hand a
    // catalog container the ability to install and delete apps.
    //
    // The status GET is listed for the mirror-image reason (#477). It is a read,
    // and reads normally name no capability — but a contract-scoped principal is
    // closed by default (`authorizeRequest`), so a route naming no capability is
    // one it cannot reach. The prepare → poll → finalize loop needs this read, so
    // the route has to name the capability the provider holds. Scope it to
    // `/backup/status/` and no wider: `GET /api/contracts` is the dashboard's
    // rollup of who fills which contract role across the whole install, and a
    // provider token must stay out of it.
    { pattern: /^\/api\/contracts\/backup\//, method: 'POST', capability: 'contract:backup' },
    { pattern: /^\/api\/contracts\/backup\/status\//, method: 'GET', capability: 'contract:backup' },

    // restore@1 provider half (spec 008). Same reasoning as backup@1 above, but
    // FOUR routes rather than one POST + one status GET — each needs its own
    // row because a contract-scoped principal is closed by default even for
    // reads, and none of these four share a path prefix distinct enough for
    // one rule to cover them all without also matching a sibling route.
    { pattern: /^\/api\/contracts\/restore\/index$/, method: 'POST', capability: 'contract:restore' },
    { pattern: /^\/api\/contracts\/restore\/requests$/, method: 'GET', capability: 'contract:restore' },
    { pattern: /^\/api\/contracts\/restore\/requests\/[^/]+\/claim$/, method: 'POST', capability: 'contract:restore' },
    { pattern: /^\/api\/contracts\/restore\/requests\/[^/]+\/complete$/, method: 'POST', capability: 'contract:restore' },

    // Backup operations. No such route exists today — both mutations were
    // deleted for reporting success without performing one (F12) — but the
    // rules stay deliberately: they are the one place this host records that
    // a backup mutation is privileged, and without them the generic
    // mutating-method default below would silently guard any future real
    // implementation with `write:deployments` instead of `write:backups`.
    { pattern: /^\/api\/backups/, method: 'POST', capability: 'write:backups' },
    { pattern: /^\/api\/backups/, method: 'DELETE', capability: 'write:backups' },

    // Job operations (mostly read, but some control)
    { pattern: /^\/api\/jobs\/[^/]+\/cancel/, method: 'POST', capability: 'write:deployments' },
    
    // System control
    { pattern: /^\/api\/system/, method: 'POST', capability: 'manage:system' },
    { pattern: /^\/api\/system/, method: 'PATCH', capability: 'manage:system' },
    { pattern: /^\/api\/system/, method: 'DELETE', capability: 'manage:system' },
  ];
  
  // Find matching pattern
  for (const rule of capabilityMap) {
    if (rule.pattern.test(path) && rule.method === method) {
      return rule.capability;
    }
  }
  
  // Default capability for mutating operations
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return 'write:deployments'; // Default write capability
  }
  
  // Read operations typically don't require special capabilities
  return null;
}

/**
 * Whether this principal is a capability-contract token — the credential Hola
 * injects into a *provider app's* container so it can announce its own work
 * (ADR 0004 §6).
 *
 * Recognised by its capabilities rather than by `type` or `id`: `type: 'service'`
 * is shared with other machine principals, and a contract token is minted with
 * exactly one `contract:<id>` capability per contract it provides and nothing
 * else (`contractCapability` in services/auth/contract-tokens.ts). A principal
 * holding a capability outside that namespace — an operator key, a wildcard — is
 * therefore not one of these, and is unaffected by the restriction above.
 */
export function isContractScoped(principal: Principal): boolean {
  return (
    principal.capabilities.length > 0 &&
    principal.capabilities.every((capability) => capability.startsWith('contract:'))
  );
}

/**
 * The authorization decision for an authenticated principal on one route.
 *
 * Two rules, and the second is the reason this is a function rather than two
 * lines inline:
 *
 * - **Everyone**: a route that names a capability requires it. A route that
 *   names none (every GET — `getRequiredCapability` returns null for reads) is
 *   open to any authenticated principal. That is the operator model: if you hold
 *   a key to this host, you may read it.
 * - **Contract tokens are closed by default.** That credential is not an
 *   operator's — it is injected into a *catalog container* so a provider app can
 *   announce its own work (ADR 0004 §6: "not usable elsewhere in the API"). The
 *   read rule above handed it `/api/deployments`, another app's logs,
 *   `/api/settings` and every job. So a contract token is allowed exactly the
 *   routes that demand a capability it was minted for, and nothing else.
 *
 * Closing it at the principal rather than by adding a capability to every read
 * route means no other caller's access changes, and a route added tomorrow is
 * closed to contract tokens without anyone having to remember to close it.
 */
export function authorizeRequest(
  principal: Principal,
  requiredCapability: Capability | null,
  hasCapability: (principal: Principal, capability: Capability) => boolean,
): 'allow' | 'outside-contract' | 'missing-capability' {
  const holds = requiredCapability !== null && hasCapability(principal, requiredCapability);
  if (isContractScoped(principal)) return holds ? 'allow' : 'outside-contract';
  if (requiredCapability !== null && !holds) return 'missing-capability';
  return 'allow';
}

/**
 * Whether a principal holds one capability, decided from the principal alone.
 *
 * Identical in effect to `AuthService.hasCapability` for every real provider —
 * each one is `capabilities.includes('*') || capabilities.includes(cap)` — but
 * deliberately NOT routed through the service, for two reasons:
 *
 * - `MockAuthService.hasCapability` returns `true` unconditionally, and
 *   `RealAuthService` short-circuits to `true` whenever auth is disabled. Both
 *   are right for a ROUTE gate (no auth configured ⇒ no authorization to
 *   perform), and both are wrong for shaping a response around a capability:
 *   they would make the shaping a no-op in exactly the configurations where a
 *   test could observe it, leaving the real rule unverifiable.
 * - The principal is the whole input. When auth is disabled the middleware
 *   substitutes a wildcard system principal, so a single-operator host still
 *   sees everything — by holding `*`, not by the check being skipped.
 *
 * Use it for response policy (see `canReadSecrets` in server.ts). Route
 * authorization stays with `authorizeRequest` + the service.
 */
export function principalHasCapability(principal: Principal, capability: Capability): boolean {
  return principal.capabilities.includes('*') || principal.capabilities.includes(capability);
}

/**
 * Create authentication middleware
 */
export function createAuthMiddleware() {
  const logger = getLogger().child({ service: 'AuthMiddleware' });
  
  return async function authMiddleware(
    req: Request,
    next: () => Promise<Response>
  ): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    
    // Check if this is a public endpoint
    if (isPublicEndpoint(path, method)) {
      logger.debug('Public endpoint, skipping auth', { path, method });
      return next();
    }
    
    // If auth is disabled, create a system principal and continue
    if (!featureFlags.useAuth) {
      logger.debug('Auth disabled, creating system principal', { path, method });
      
      const systemPrincipal: Principal = {
        id: 'system',
        type: 'system',
        name: 'System User',
        roles: ['admin'],
        capabilities: ['*'],
      };
      
      // Add auth context to request (this would typically be added to request context)
      const authContext: AuthContext = {
        isAuthenticated: true,
        principal: systemPrincipal,
      };
      
      // Store in request for handlers to access
      (req as Request & { authContext?: AuthContext }).authContext = authContext;
      
      return next();
    }
    
    // Auth is enabled, perform authentication
    logger.debug('Auth enabled, performing authentication', { path, method });
    
    const credential = resolveCredential(req);
    const token = credential?.token ?? null;
    if (!token) {
      logger.warn('No authentication token provided', { path, method });
      return new Response(
        JSON.stringify({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        }),
        {
          status: 401,
          headers: {
            'content-type': 'application/json',
            'www-authenticate': 'Bearer',
          },
        }
      );
    }
    
    // Get auth service and authenticate
    try {
      const { auth } = getServices();
      const authResult = await auth.authenticate(token, {
        path,
        method,
        userAgent: req.headers.get('user-agent') || undefined,
      });
      
      if (!authResult.success || !authResult.principal) {
        logger.warn('Authentication failed', { 
          path, 
          method, 
          error: authResult.error 
        });
        
        return new Response(
          JSON.stringify({
            error: {
              code: 'UNAUTHORIZED',
              message: authResult.error || 'Authentication failed',
            },
          }),
          {
            status: 401,
            headers: {
              'content-type': 'application/json',
            },
          }
        );
      }
      
      // Check if principal is authorized for this endpoint
      const requiredCapability = getRequiredCapability(path, method);
      const decision = authorizeRequest(authResult.principal, requiredCapability, (p, c) =>
        auth.hasCapability(p, c),
      );

      if (decision === 'outside-contract') {
        logger.warn('Contract token used outside its contract', {
          path,
          method,
          principalId: authResult.principal.id,
          requiredCapability,
        });

        return new Response(
          JSON.stringify({
            error: {
              code: 'FORBIDDEN',
              message: 'This credential may only be used for its capability contract.',
            },
          }),
          { status: 403, headers: { 'content-type': 'application/json' } },
        );
      }

      if (decision === 'missing-capability' && requiredCapability) {
        logger.warn('Insufficient capabilities', { 
          path, 
          method, 
          principalId: authResult.principal.id,
          requiredCapability,
          userCapabilities: authResult.principal.capabilities 
        });
        
        return new Response(
          JSON.stringify({
            error: {
              code: 'FORBIDDEN',
              message: `Insufficient permissions. Required capability: ${requiredCapability}`,
            },
          }),
          {
            status: 403,
            headers: {
              'content-type': 'application/json',
            },
          }
        );
      }
      
      // Authentication and authorization successful
      const authContext: AuthContext = {
        isAuthenticated: true,
        principal: authResult.principal,
        ...(credential ? { credentialSource: credential.source } : {}),
      };

      // Store in request for handlers to access
      (req as Request & { authContext?: AuthContext }).authContext = authContext;

      logger.info('Authentication successful', {
        path,
        method,
        principalId: authResult.principal.id,
        principalType: authResult.principal.type,
        // Which credential was in force. Worth a log field: it is what decides
        // whether the origin rule applied (F04), so a 403 an operator does not
        // expect is diagnosable from the preceding success lines.
        credentialSource: credential?.source,
      });
      
      return next();
      
    } catch (error) {
      logger.error('Auth middleware error', error instanceof Error ? error : undefined, {
        path,
        method,
      });
      
      return new Response(
        JSON.stringify({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Authentication service error',
          },
        }),
        {
          status: 500,
          headers: {
            'content-type': 'application/json',
          },
        }
      );
    }
  };
}

/**
 * Get auth service instance
 */
function getAuthService(): AuthService {
  return getServices().auth;
}

/**
 * Helper to get auth context from request
 */
export function getAuthContext(req: Request): AuthContext | null {
  return (req as Request & { authContext?: AuthContext }).authContext || null;
}

/**
 * Helper to get principal from request
 */
export function getPrincipal(req: Request): Principal | null {
  const authContext = getAuthContext(req);
  return authContext?.principal || null;
}

/**
 * Helper to check if request is authenticated
 */
export function isAuthenticated(req: Request): boolean {
  const authContext = getAuthContext(req);
  return authContext?.isAuthenticated || false;
}

/**
 * Helper to require authentication (for use in handlers)
 */
export function requireAuth(req: Request): Principal {
  const principal = getPrincipal(req);
  if (!principal) {
    throw new Error('Authentication required');
  }
  return principal;
}

/**
 * Helper to require specific capability (for use in handlers)
 */
export function requireCapability(req: Request, capability: Capability): Principal {
  const principal = requireAuth(req);
  const authService = getAuthService();
  
  if (!authService.hasCapability(principal, capability)) {
    throw new Error(`Insufficient permissions. Required capability: ${capability}`);
  }
  
  return principal;
}
