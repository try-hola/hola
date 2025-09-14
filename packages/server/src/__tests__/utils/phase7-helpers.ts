/**
 * Shared test utilities for Phase 7 tests
 */

// Test infrastructure
interface TestResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export async function makeRequest<T = unknown>(options: {
  method: string;
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}): Promise<TestResponse<T>> {
  const headers = {
    'content-type': 'application/json',
    'x-user-id': 'test-user',
    'x-user-email': 'test@example.com',
    'x-user-name': 'Test User',
    ...options.headers,
  };

  const requestOptions: RequestInit = {
    method: options.method,
    headers,
  };

  if (options.body && ['POST', 'PUT', 'PATCH'].includes(options.method)) {
    requestOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(options.url, requestOptions);
  
  if (!response.headers.get('content-type')?.includes('application/json')) {
    return {
      success: response.ok,
      data: (await response.text()) as T,
    };
  }
  
  const data = await response.json();
  return {
    success: response.ok,
    data: response.ok ? data : undefined,
    error: !response.ok ? data.error : undefined,
  };
}

// Additional type definitions for system config and health endpoints
export interface FeatureFlags {
  enableDevApi: boolean;
  useRealDrafts: boolean;
  useRealValidation: boolean;
  useRealDeployments: boolean;
  useRealDevSessions: boolean;
}

export interface SystemConfig {
  featureFlags: FeatureFlags;
}

export interface SystemHealth {
  activatedServices: string[];
}