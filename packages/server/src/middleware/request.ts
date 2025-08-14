/**
 * Request middleware for correlation, logging, and metrics
 */

import { getLogger, createLogger, type LogContext } from '../lib/logger';
import { recordHttpRequest, getMetrics } from '../lib/metrics';

export interface RequestContext {
  requestId: string;
  startTime: number;
  logger: ReturnType<typeof createLogger>;
  userId?: string;
  principal?: unknown; // For auth context later
}

// Extend Request interface to include our context
interface RequestWithContext extends Request {
  __context?: RequestContext;
}

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Extract request ID from headers or generate new one
 */
function getRequestId(req: Request): string {
  const headerValue = req.headers.get('x-request-id');
  return headerValue || generateRequestId();
}

/**
 * Extract user identity from request headers (mock implementation)
 */
function extractUserContext(req: Request): { userId?: string } {
  const userId = req.headers.get('x-user-id');
  return userId ? { userId } : {};
}

/**
 * Request context middleware
 * 
 * Adds request ID, logging context, and sets up metrics collection
 */
export function createRequestMiddleware() {
  return async function requestMiddleware(
    req: Request,
    next: () => Promise<Response>
  ): Promise<Response> {
    const requestId = getRequestId(req);
    const startTime = Date.now();
    const url = new URL(req.url);
    const userContext = extractUserContext(req);
    
    // Create request-scoped logger
    const logContext: LogContext = {
      requestId,
      method: req.method,
      path: url.pathname,
      userAgent: req.headers.get('user-agent') || undefined,
      ...userContext,
    };
    
    const logger = createLogger(logContext);
    
    // Log request start
    logger.info('Request started', {
      method: req.method,
      path: url.pathname,
      query: url.search,
    });
    
    // Store context for request handlers
    const context: RequestContext = {
      requestId,
      startTime,
      logger,
      ...userContext,
    };
    
    // Add context to request
    (req as RequestWithContext).__context = context;
    
    let response: Response;
    let error: Error | undefined;
    
    try {
      response = await next();
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
      logger.error('Request failed', error);
      
      // Return generic error response
      response = new Response(
        JSON.stringify({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Internal server error',
            requestId,
          },
        }),
        {
          status: 500,
          headers: {
            'content-type': 'application/json',
            'x-request-id': requestId,
          },
        }
      );
    }
    
    // Add request ID to response headers
    const headers = new Headers(response.headers);
    headers.set('x-request-id', requestId);
    
    const finalResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    
    // Record metrics and log completion
    const duration = Date.now() - startTime;
    const status = finalResponse.status;
    
    recordHttpRequest(req.method, url.pathname, status, duration);
    
    logger.info('Request completed', {
      status,
      duration,
      error: error?.message,
    });
    
    return finalResponse;
  };
}

/**
 * Get request context from the current request
 */
export function getRequestContext(req: Request): RequestContext | undefined {
  return (req as RequestWithContext).__context;
}

/**
 * Health check middleware for graceful shutdown and monitoring
 */
export function createHealthMiddleware() {
  const logger = getLogger();
  const metrics = getMetrics();
  
  // Track server health state
  let serverHealthy = true;
  let shutdownRequested = false;
  
  // Graceful shutdown handler
  process.on('SIGTERM', () => {
    logger.info('Shutdown requested (SIGTERM)');
    shutdownRequested = true;
    
    // Give time for in-flight requests to complete
    setTimeout(() => {
      logger.info('Shutdown timeout reached, forcing exit');
      process.exit(0);
    }, 30000); // 30 second timeout
  });
  
  process.on('SIGINT', () => {
    logger.info('Shutdown requested (SIGINT)');
    shutdownRequested = true;
    
    setTimeout(() => {
      logger.info('Shutdown timeout reached, forcing exit');
      process.exit(0);
    }, 30000);
  });
  
  return {
    // Health check endpoint handler
    healthCheck: () => {
      const health = {
        status: serverHealthy && !shutdownRequested ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.env.npm_package_version || 'unknown',
      };
      
      return new Response(JSON.stringify(health), {
        status: health.status === 'healthy' ? 200 : 503,
        headers: { 'content-type': 'application/json' },
      });
    },
    
    // Readiness check endpoint handler
    readinessCheck: () => {
      const ready = {
        status: !shutdownRequested ? 'ready' : 'not_ready',
        timestamp: new Date().toISOString(),
        checks: {
          shutdown: !shutdownRequested,
          // TODO: Add service-specific readiness checks in later phases
        },
      };
      
      return new Response(JSON.stringify(ready), {
        status: ready.status === 'ready' ? 200 : 503,
        headers: { 'content-type': 'application/json' },
      });
    },
    
    // Metrics endpoint handler
    metricsEndpoint: () => {
      const allMetrics = metrics.getAll();
      
      return new Response(JSON.stringify(allMetrics, null, 2), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
    
    // Update server health status
    setHealthy: (healthy: boolean) => {
      serverHealthy = healthy;
      logger.info('Server health status changed', { healthy });
    },
    
    // Check if shutdown was requested
    isShuttingDown: () => shutdownRequested,
  };
}
