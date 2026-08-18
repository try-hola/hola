import { API } from '@hola/shared';
import type { ErrorResponse } from '@hola/shared';
import { safeFetchEnhanced } from './error-enhanced';
import { globalCache, CacheTTL } from './cache';

// Environment-based configuration
const getBaseUrl = (): string => {
  // Check for explicit environment variable first
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  
  // Check for Node.js environment variable (for tests)
  if (typeof process !== 'undefined' && process.env?.VITE_API_BASE_URL) {
    return process.env.VITE_API_BASE_URL;
  }
  
  // In development with Vite, use the proxy (empty base URL)
  if (
    typeof import.meta !== 'undefined' && 
    (import.meta.env?.DEV || import.meta.env?.MODE === 'development')
  ) {
    return ''; // Use Vite proxy
  }
  
  // For tests or any environment without import.meta, use direct connection
  if (typeof import.meta === 'undefined' || typeof process !== 'undefined') {
    return 'http://localhost:3001';
  }
  
  // In production, API should be served from same origin
  return '';
};

const BASE_URL = getBaseUrl();

// Enhanced request deduplication with cancellation
interface PendingRequest {
  promise: Promise<Response>;
  controller: AbortController;
  timestamp: number;
}

const pendingRequests = new Map<string, PendingRequest>();

// Request deduplication policies
const DEDUPE_POLICIES = {
  // Always deduplicate GET requests
  GET: true,
  // Deduplicate idempotent mutations within short time window
  PUT: true,
  PATCH: true,
  // Don't deduplicate creation or deletion
  POST: false,
  DELETE: false,
} as const;

// Create cache key for request deduplication
function createCacheKey(url: string, options: RequestInit = {}): string {
  const method = options.method || 'GET';
  const body = options.body || '';
  return `${method}:${url}:${body}`;
}

// Cache TTL mapping based on endpoint patterns
function getCacheTTL(path: string): number {
  if (path.includes('/summary')) return CacheTTL.dashboard;
  if (path.includes('/status')) return CacheTTL.system_status;
  if (path.includes('/jobs')) return CacheTTL.job_status;
  if (path.includes('/deployments')) return CacheTTL.deployments;
  if (path.includes('/notifications')) return CacheTTL.notifications;
  if (path.includes('/catalog')) return CacheTTL.catalog;
  if (path.includes('/settings')) return CacheTTL.settings;
  if (path.includes('/backups')) return CacheTTL.backups;
  if (path.includes('/me')) return CacheTTL.user_info;
  return CacheTTL.deployments; // default
}

// Type-safe API client with enhanced deduplication, caching, and optimistic updates
export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = BASE_URL) {
    this.baseUrl = baseUrl;
  }

  // Build full URL from API path
  private buildUrl(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  // Enhanced request method with smart deduplication and caching
  private async request<T>(
    path: string,
    options: RequestInit = {},
    dedupeEnabled: boolean = true
  ): Promise<T> {
    const url = this.buildUrl(path);
    const method = (options.method || 'GET') as keyof typeof DEDUPE_POLICIES;
    const cacheKey = createCacheKey(url, options);

    // Check if deduplication should be applied
    const shouldDedupe = dedupeEnabled && DEDUPE_POLICIES[method];

    // Check for existing request
    if (shouldDedupe) {
      const existingRequest = pendingRequests.get(cacheKey);
      if (existingRequest) {
        // Cancel if older than 30 seconds
        if (Date.now() - existingRequest.timestamp > 30000) {
          existingRequest.controller.abort();
          pendingRequests.delete(cacheKey);
        } else {
          const response = await existingRequest.promise;
          return response.clone().json();
        }
      }
    }

    // Set default headers
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Create abort controller for cancellation
    const controller = new AbortController();
    
    // Create request promise with abort signal
    const requestPromise = safeFetchEnhanced(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    // Store pending request if deduplication is enabled
    if (shouldDedupe) {
      const pendingRequest: PendingRequest = {
        promise: requestPromise,
        controller,
        timestamp: Date.now(),
      };
      
      pendingRequests.set(cacheKey, pendingRequest);

      // Clean up after completion
      requestPromise
        .then(() => pendingRequests.delete(cacheKey))
        .catch(() => pendingRequests.delete(cacheKey));
    }

    const response = await requestPromise;
    
    // Cache GET responses with appropriate TTL
    if (method === 'GET') {
      const data = await response.clone().json();
      const ttl = getCacheTTL(path);
      globalCache.set(`api:${url}`, data, ttl);
      return data;
    }
    
    return response.json();
  }

  // Try to get from cache first, then fetch if not available
  private async getWithCache<T>(path: string): Promise<T> {
    const url = this.buildUrl(path);
    const cached = globalCache.get<T>(`api:${url}`);
    
    if (cached !== null) {
      return cached;
    }
    
    return this.request<T>(path, { method: 'GET' });
  }

  // HTTP method helpers with smart caching
  async get<T>(path: string, useCache: boolean = true): Promise<T> {
    if (useCache) {
      return this.getWithCache<T>(path);
    }
    return this.request<T>(path, { method: 'GET' }, false);
  }

  async post<T>(path: string, data?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }, false);
  }

  async patch<T>(path: string, data?: unknown): Promise<T> {
    const result = await this.request<T>(path, {
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    }, true); // Enable deduplication for idempotent PATCH operations
    
    // Invalidate related cache entries
    this.invalidateCache(path);
    return result;
  }

  async delete<T>(path: string): Promise<T> {
    const result = await this.request<T>(path, { method: 'DELETE' }, false);
    
    // Invalidate related cache entries
    this.invalidateCache(path);
    return result;
  }

  // Specialized methods for file uploads
  async upload<T>(path: string, formData: FormData): Promise<T> {
    const url = this.buildUrl(path);
    
    // Don't set Content-Type for FormData - let browser set it with boundary
    const response = await safeFetchEnhanced(url, {
      method: 'POST',
      body: formData,
    });

    const result = await response.json();
    
    // Invalidate related cache entries
    this.invalidateCache(path);
    return result;
  }

  // Build query string from parameters
  buildQuery(params: Record<string, string | number | boolean | undefined>): string {
    const searchParams = new URLSearchParams();
    
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    });

    const queryString = searchParams.toString();
    return queryString ? `?${queryString}` : '';
  }

  // Smart cache invalidation
  invalidateCache(path: string): void {
    const url = this.buildUrl(path);
    
    // Remove exact match
    globalCache.delete(`api:${url}`);
    
    // Remove related cache entries based on path patterns
    if (path.includes('/deployments')) {
      // Match both item ops (/deployments/:id — remove, lifecycle actions) and
      // create (POST /api/deployments), so installing an app or removing one both
      // refresh every page that lists deployments.
      globalCache.deleteByPattern(/^api:.*\/deployments/);
      globalCache.deleteByPattern(/^api:.*\/summary/); // Dashboard depends on deployments
      // useDeploymentsApi caches the list under its own `deployments-<params>` keys
      // (a separate namespace from the `api:` keys above) with a 30s TTL. Without
      // clearing it here, a mutation on one page (e.g. removing an app on the
      // Deployments page) leaves another page that lists deployments (e.g. Apps)
      // serving the stale cached rows until the TTL lapses or a full reload.
      globalCache.deleteByPattern(/^deployments-/);
      // Contract coverage is derived from the installed set (ADR 0004 Phase 4):
      // installing a backup provider or removing a covered app changes it, and a
      // coverage view that lags behind an install is worse than none.
      globalCache.deleteByPattern(/^api:.*\/contracts/);
    } else if (path.includes('/jobs/')) {
      globalCache.deleteByPattern(/^api:.*\/jobs/);
      globalCache.deleteByPattern(/^api:.*\/summary/); // Dashboard depends on jobs
    } else if (path.includes('/backups/')) {
      globalCache.deleteByPattern(/^api:.*\/backups/);
    } else if (path.includes('/notifications/')) {
      globalCache.deleteByPattern(/^api:.*\/notifications/);
      globalCache.deleteByPattern(/^api:.*\/summary/); // Dashboard shows notification count
    } else if (path.includes('/settings/')) {
      globalCache.deleteByPattern(/^api:.*\/settings/);
    }
  }

  // Clear all caches (useful for forced refreshes)
  clearCache(): void {
    globalCache.clear();
    pendingRequests.clear();
  }

  // Cancel all pending requests
  cancelPendingRequests(): void {
    for (const [key, request] of pendingRequests.entries()) {
      request.controller.abort();
      pendingRequests.delete(key);
    }
  }
}

// Default API client instance
export const apiClient = new ApiClient();

// Convenience API methods using shared API constants with enhanced caching
export const api = {
  // Health and basic endpoints
  health: () => apiClient.get(API.health, false), // Don't cache health checks
  me: () => apiClient.get(API.me),
  summary: () => apiClient.get(API.summary),

  // System status
  system: {
    status: () => apiClient.get(API.system.status),
    updateCheck: () => apiClient.get(API.system.updateCheck),
  },

  // Catalog with smart caching
  catalog: {
    apps: (params?: { query?: string; category?: string; page?: number; limit?: number }) => {
      const query = apiClient.buildQuery(params || {});
      return apiClient.get(`${API.catalog.apps}${query}`);
    },
    
    appById: (appId: string) => apiClient.get(API.catalog.appById(appId)),
    
    versions: (appId: string) => apiClient.get(API.catalog.versions(appId)),

    versionDetail: (appId: string, version: string) =>
      apiClient.get(API.catalog.versionDetail(appId, version)),

    // Force an immediate catalog re-fetch (bypasses the server's refresh-interval
    // TTL) so newly-published versions surface as available updates right away.
    // A refresh can change which apps have updates, so drop the cached deployment
    // lists (they carry `updateAvailable`), catalog, and dashboard summary.
    refresh: async (force = true) => {
      const res = await apiClient.post(`${API.catalog.refresh}${apiClient.buildQuery({ force })}`);
      globalCache.deleteByPattern(/^api:.*\/deployments/);
      globalCache.deleteByPattern(/^api:.*\/catalog/);
      globalCache.deleteByPattern(/^api:.*\/summary/);
      return res;
    },
  },

  // Drafts (Install Wizard) with cache invalidation
  drafts: {
    create: (data: { appId: string; version?: string }) => 
      apiClient.post(API.drafts.create, data),
    
    byId: (draftId: string) => apiClient.get(API.drafts.byId(draftId), false), // Don't cache draft state
    
    update: (draftId: string, data: unknown) => 
      apiClient.patch(API.drafts.byId(draftId), data),
    
    uploadFile: (draftId: string, formData: FormData) => 
      apiClient.upload(API.drafts.uploads(draftId), formData),
    
    deleteFile: (draftId: string, uploadId: string) => 
      apiClient.delete(API.drafts.uploadById(draftId, uploadId)),
    
    validate: (draftId: string) => 
      apiClient.post(API.drafts.validate(draftId)),
    
    preflight: (draftId: string) => 
      apiClient.post(API.drafts.preflight(draftId)),
    
    finalize: (draftId: string) => 
      apiClient.post(API.drafts.finalize(draftId)),
  },

  // Deployments with optimistic cache management
  deployments: {
    list: (params?: { status?: string; page?: number; limit?: number; q?: string }) => {
      const query = apiClient.buildQuery(params || {});
      return apiClient.get(`${API.deployments.base}${query}`);
    },
    
    byId: (deploymentId: string) => apiClient.get(API.deployments.byId(deploymentId)),
    
    update: (deploymentId: string, data: unknown) => 
      apiClient.patch(API.deployments.byId(deploymentId), data),
    
    history: (deploymentId: string, params?: { page?: number; limit?: number }) => {
      const query = apiClient.buildQuery(params || {});
      return apiClient.get(`${API.deployments.history(deploymentId)}${query}`);
    },
    
    action: (deploymentId: string, action: { action: 'start' | 'stop' | 'restart' | 'delete' }) =>
      apiClient.post(API.deployments.actions(deploymentId), action),

    // Upgrade to a newer catalog version (#284 Phase 2). The server carries the
    // current env/secrets forward and runs the upgrade skip-guard + pre-upgrade
    // snapshot before switching the active release.
    promote: (deploymentId: string, body?: { version?: string; snapshot?: boolean }) =>
      apiClient.post(API.deployments.promote(deploymentId), body ?? {}),

    // Full teardown: stop + deprovision + release the Traefik route + remove the
    // record (DELETE /api/deployments/:id). The `delete` action only stops compose
    // and leaves the route held, which blocks reinstalling the same app.
    remove: (deploymentId: string) =>
      apiClient.delete(API.deployments.byId(deploymentId)),

    logs: (deploymentId: string, params?: { since?: string; lines?: number }) => {
      const query = apiClient.buildQuery(params || {});
      return apiClient.get(`${API.deployments.logs(deploymentId)}${query}`, false); // Don't cache logs
    },

    // On-demand richer update check (#299): breaking/backup/notes + skip-guard
    // path for one deployment. Pulls the target bundle, so callers gate it on
    // updateAvailable.
    updateCheck: (deploymentId: string) => apiClient.get(API.deployments.updateCheck(deploymentId)),
  },

  // Jobs with frequent updates
  jobs: {
    list: (params?: { deploymentId?: string; status?: string; page?: number; limit?: number }) => {
      const query = apiClient.buildQuery(params || {});
      return apiClient.get(`${API.jobs.base}${query}`);
    },
    
    byId: (jobId: string) => apiClient.get(API.jobs.byId(jobId), false), // Don't cache job details

    logs: (jobId: string, params?: { since?: string; lines?: number }) => {
      const query = apiClient.buildQuery(params || {});
      return apiClient.get(`${API.jobs.logs(jobId)}${query}`, false); // Don't cache logs
    },

    // Clear finished (completed/failed/cancelled) jobs, optionally scoped by
    // deployment and/or terminal status. Never removes running/queued jobs.
    clear: async (params?: { deploymentId?: string; status?: string }) => {
      const res = await apiClient.delete(`${API.jobs.base}${apiClient.buildQuery(params || {})}`);
      globalCache.deleteByPattern(/^api:.*\/jobs/);
      globalCache.deleteByPattern(/^api:.*\/summary/);
      return res;
    },
  },

  // Backups with cache management
  backups: {
    list: (params?: { appId?: string; status?: string; page?: number; limit?: number }) => {
      const query = apiClient.buildQuery(params || {});
      return apiClient.get(`${API.backups.base}${query}`);
    },
    
    byId: (backupId: string) => apiClient.get(API.backups.byId(backupId)),
    
    create: (data: { appId?: string }) => 
      apiClient.post(API.backups.base, data),
    
    restore: (backupId: string, data?: { targetDeploymentId?: string }) => 
      apiClient.post(API.backups.restore(backupId), data),
    
    delete: (backupId: string) => 
      apiClient.delete(API.backups.byId(backupId)),
  },

  // Notifications with cache management
  notifications: {
    list: (params?: { filter?: string; page?: number; limit?: number }) => {
      const query = apiClient.buildQuery(params || {});
      return apiClient.get(`${API.notifications.base}${query}`);
    },
    
    byId: (id: string) => apiClient.get(API.notifications.byId(id)),
    
    update: (id: string, data: { read?: boolean; dismiss?: boolean }) => 
      apiClient.patch(API.notifications.byId(id), data),
    
    actions: (data: { action: 'markAllRead' | 'dismissAll' }) => 
      apiClient.post(API.notifications.actions, data),
  },

  // Settings with cache management
  settings: {
    get: () => apiClient.get(API.settings.base),
    
    update: (data: unknown) => 
      apiClient.patch(API.settings.base, data),
    
    backup: {
      get: () => apiClient.get(API.settings.backup),
      
      update: (data: unknown) => 
        apiClient.patch(API.settings.backup, data),
    },
  },

  // Cache management utilities
  cache: {
    clear: () => apiClient.clearCache(),
    invalidate: (path: string) => apiClient.invalidateCache(path),
    stats: () => globalCache.getStats(),
  },
};

// Export types for convenience
export type { ErrorResponse };
