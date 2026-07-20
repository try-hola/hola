/**
 * Error Mapping Middleware - Phase 1 Observability
 * 
 * Provides structured error handling and mapping for consistent HTTP responses.
 * Integrates with logging and metrics for comprehensive error tracking.
 */

import { getLogger } from '../lib/logger';
import { recordErrorMetric } from '../lib/metrics';
import { getRequestContext } from './request';
import type { ValidationIssue } from '@hola/shared';

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export interface ApiError extends Error {
  code?: string;
  status?: number;
  details?: unknown;
}

/**
 * Standard error types for the application
 */
export class ValidationError extends Error implements ApiError {
  code = 'VALIDATION_ERROR';
  status = 400;
  details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

/**
 * Raised when `finalizeDraft` fails validation. 422 (not 400/500) with the full
 * per-issue detail so a client (install wizard, CLI, or the promote endpoint,
 * which relabels the `code` to `PROMOTE_VALIDATION_FAILED`) can name the
 * offending key(s) rather than seeing an opaque server error.
 */
export class DraftValidationError extends Error implements ApiError {
  code = 'DRAFT_VALIDATION_FAILED';
  status = 422;
  details?: unknown;

  constructor(message: string, public issues: ValidationIssue[]) {
    super(message);
    this.name = 'DraftValidationError';
    this.details = { issues };
  }
}

/**
 * Relabel a `finalizeDraft` validation failure for the promote endpoint: same
 * 422 shape (`details.issues` names the offending key(s)), but a promote-
 * specific `code` so a client can tell "this upgrade's carried-forward config
 * now fails validation" apart from a plain wizard/CLI draft finalize failure.
 * Anything other than a `DraftValidationError` passes through unchanged.
 */
export function asPromoteValidationError(err: unknown): unknown {
  if (err instanceof DraftValidationError) {
    err.code = 'PROMOTE_VALIDATION_FAILED';
  }
  return err;
}

/**
 * A bundle (OCI package) exists but could not be fetched or is unusable: a
 * registry outside the allowlist, a failed or denied pull, an unverifiable
 * signature, an unresolvable credential, or a malformed layout.
 *
 * These are HARD failures. They must reach the operator with the real reason —
 * never be papered over with placeholder defaults, which is how a blocked pull
 * used to reappear much later as "Active release has no compose file". Callers
 * discriminate on the CLASS (not the message), so the `code` is free to gain
 * detail without breaking them.
 */
export class BundleError extends Error implements ApiError {
  status: number;
  details?: unknown;

  constructor(public code: string, message: string, opts?: { status?: number; details?: unknown; cause?: unknown }) {
    super(message, opts && 'cause' in opts ? { cause: opts.cause } : undefined);
    this.name = 'BundleError';
    // 502 by default: the failure is upstream (a registry we proxy to), not the
    // operator's request. Individual sites override (403 blocked, 422 malformed).
    this.status = opts?.status ?? 502;
    this.details = opts?.details;
  }
}

/**
 * No bundle exists for this app/version at all — the catalog entry carries no
 * OCI ref, or the version isn't published.
 *
 * This is the one SOFT outcome: it's the legitimate install-from-ref /
 * bundle-less case where a caller may fall back to generic defaults and let the
 * operator supply their own compose. Anything else is a `BundleError`.
 */
export class BundleUnavailableError extends Error implements ApiError {
  code: string;
  status = 404;

  constructor(message: string, code = 'BUNDLE_UNAVAILABLE') {
    super(message);
    this.name = 'BundleUnavailableError';
    this.code = code;
  }
}

export class NotFoundError extends Error implements ApiError {
  code = 'NOT_FOUND';
  status = 404;

  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends Error implements ApiError {
  code = 'UNAUTHORIZED';
  status = 401;

  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error implements ApiError {
  code = 'FORBIDDEN';
  status = 403;

  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends Error implements ApiError {
  code = 'CONFLICT';
  status = 409;
  details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'ConflictError';
    this.details = details;
  }
}

export class ServiceError extends Error implements ApiError {
  code = 'SERVICE_ERROR';
  status = 500;
  details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'ServiceError';
    this.details = details;
  }
}

export class TimeoutError extends Error implements ApiError {
  code = 'TIMEOUT';
  status = 408;

  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Raised when provisioning auth artifacts against the auth platform (Authentik)
 * fails. 502 because the failure originates upstream, not in the client request.
 */
export class ProvisioningError extends Error implements ApiError {
  code = 'PROVISIONING_ERROR';
  status = 502;
  details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'ProvisioningError';
    this.details = details;
  }
}

export class RateLimitError extends Error implements ApiError {
  code = 'RATE_LIMIT_EXCEEDED';
  status = 429;

  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

/**
 * Map errors to consistent HTTP responses
 */
export function mapErrorToResponse(error: unknown, requestId?: string): { status: number; body: ErrorResponse } {
  const logger = getLogger().child({ service: 'ErrorMapping' });

  // Handle known API errors
  if (error instanceof Error && 'status' in error && 'code' in error) {
    const apiError = error as ApiError;
    
    const response = {
      status: apiError.status || 500,
      body: {
        error: {
          code: apiError.code || 'UNKNOWN_ERROR',
          message: apiError.message,
          details: apiError.details,
          requestId,
        },
      },
    };

    // Log the error with appropriate level
    if (response.status >= 500) {
      logger.error('Server error', error, { 
        requestId, 
        status: response.status, 
        code: response.body.error.code 
      });
    } else if (response.status >= 400) {
      logger.warn('Client error', { 
        requestId, 
        status: response.status, 
        code: response.body.error.code,
        message: error.message,
      });
    }

    // Record error metric
    recordErrorMetric(response.body.error.code, response.status);

    return response;
  }

  // Handle standard JavaScript errors
  if (error instanceof Error) {
    logger.error('Unhandled error', error, { requestId });
    recordErrorMetric('INTERNAL_ERROR', 500);

    return {
      status: 500,
      body: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An internal server error occurred',
          requestId,
        },
      },
    };
  }

  // Handle non-Error objects
  const errorMessage = typeof error === 'string' ? error : 'Unknown error occurred';
  logger.error('Non-Error object thrown', undefined, { 
    requestId, 
    errorValue: error 
  });
  recordErrorMetric('UNKNOWN_ERROR', 500);

  return {
    status: 500,
    body: {
      error: {
        code: 'UNKNOWN_ERROR',
        message: errorMessage,
        requestId,
      },
    },
  };
}

/**
 * Create error response JSON
 */
export function createErrorResponse(error: unknown, requestId?: string): Response {
  const { status, body } = mapErrorToResponse(error, requestId);
  
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/**
 * Error handling middleware factory
 */
export function createErrorMappingMiddleware() {
  const logger = getLogger().child({ service: 'ErrorMappingMiddleware' });

  return async (
    request: Request,
    handler: (req: Request) => Promise<Response>
  ): Promise<Response> => {
    const context = getRequestContext(request);
    const requestId = context?.requestId || 'unknown';

    try {
      return await handler(request);
    } catch (error) {
      logger.debug('Error caught by middleware', { 
        requestId, 
        url: request.url, 
        method: request.method 
      });
      
      return createErrorResponse(error, requestId);
    }
  };
}

/**
 * Validate JSON body middleware
 */
export function createJsonValidationMiddleware() {
  return async (
    request: Request,
    handler: (req: Request) => Promise<Response>
  ): Promise<Response> => {
    // Only validate JSON for requests with JSON content-type
    const contentType = request.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        // Clone the request to avoid consuming the body
        const clonedRequest = request.clone();
        await clonedRequest.json();
      } catch (error) {
        const context = getRequestContext(request);
        throw new ValidationError('Invalid JSON in request body', {
          originalError: error instanceof Error ? error.message : String(error),
          requestId: context?.requestId,
        });
      }
    }

    return handler(request);
  };
}

/**
 * Timeout middleware
 */
export function createTimeoutMiddleware(timeoutMs: number = 30000) {
  return async (
    request: Request,
    handler: (req: Request) => Promise<Response>
  ): Promise<Response> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new TimeoutError(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([handler(request), timeoutPromise]);
    } finally {
      // Clear the timer once the race settles so a fast request doesn't leave a
      // 30s timer (and its rejected promise) armed per request.
      if (timer) clearTimeout(timer);
    }
  };
}

/**
 * Helper functions for creating specific errors
 */
export const createValidationError = (message: string, details?: unknown) => 
  new ValidationError(message, details);

export const createNotFoundError = (resource: string, id?: string) => 
  new NotFoundError(`${resource}${id ? ` '${id}'` : ''} not found`);

export const createUnauthorizedError = (message: string = 'Authentication required') => 
  new UnauthorizedError(message);

export const createForbiddenError = (message: string = 'Access denied') => 
  new ForbiddenError(message);

export const createConflictError = (message: string, details?: unknown) => 
  new ConflictError(message, details);

export const createServiceError = (message: string, details?: unknown) => 
  new ServiceError(message, details);

export const createTimeoutError = (operation: string) => 
  new TimeoutError(`${operation} timed out`);

export const createRateLimitError = (message: string = 'Rate limit exceeded') => 
  new RateLimitError(message);
