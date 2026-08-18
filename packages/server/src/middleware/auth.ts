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
 * Extract authentication token from request
 */
function extractToken(req: Request): string | null {
  // Try Authorization header first (Bearer token)
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // Try X-API-Key header
  const apiKeyHeader = req.headers.get('x-api-key');
  if (apiKeyHeader) {
    return apiKeyHeader;
  }

  // Try the dashboard session cookie (admin-key fallback login sets this HttpOnly
  // cookie so the SPA never holds the raw key in JS-readable storage).
  const sessionCookie = readCookie(req, SESSION_COOKIE);
  if (sessionCookie) {
    return sessionCookie;
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
      return queryToken;
    }
  }

  return null;
}

/** Name of the HttpOnly session cookie used by the admin-key login fallback. */
export const SESSION_COOKIE = 'hola_session';

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
    { pattern: /^\/api\/contracts\/backup\//, method: 'POST', capability: 'contract:backup' },

    // Backup operations
    { pattern: /^\/api\/backups/, method: 'POST', capability: 'write:backups' },
    { pattern: /^\/api\/backups/, method: 'DELETE', capability: 'write:backups' },
    { pattern: /^\/api\/backups\/[^/]+\/restore/, method: 'POST', capability: 'write:backups' },
    
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
    
    const token = extractToken(req);
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
      
      // Check if principal has required capability for this endpoint
      const requiredCapability = getRequiredCapability(path, method);
      if (requiredCapability && !auth.hasCapability(authResult.principal, requiredCapability)) {
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
      };
      
      // Store in request for handlers to access
      (req as Request & { authContext?: AuthContext }).authContext = authContext;
      
      logger.info('Authentication successful', { 
        path, 
        method, 
        principalId: authResult.principal.id,
        principalType: authResult.principal.type 
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
