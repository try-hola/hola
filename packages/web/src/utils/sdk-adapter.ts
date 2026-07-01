// SDK Adapter: Wraps @hola/sdk with web-specific enhancements
// Preserves caching, deduplication, error handling while using isomorphic SDK

import { HolaSdk } from '@hola/sdk';
import type { 
  // Health and basic
  HealthResponse, GetSummaryResponse, GetMeResponse,
  // Catalog types
  GetCatalogAppsResponse, GetCatalogAppResponse, GetCatalogAppVersionsResponse, GetCatalogAppVersionDetailResponse,
  // Draft types  
  CreateDraftRequest, CreateDraftResponse, GetDraftResponse, 
  PatchDraftRequest, PatchDraftResponse, ValidateDraftResponse, FinalizeDraftResponse,
  UploadDraftFileResponse, DeleteDraftFileResponse,
  // Deployment types
  CreateDeploymentFromDraftRequest, CreateDeploymentFromDraftResponse,
  GetDeploymentsRequest, GetDeploymentsResponse, GetDeploymentResponse,
  PatchDeploymentRequest, PatchDeploymentResponse,
  PostDeploymentActionRequest, PostDeploymentActionResponse,
  PromoteDeploymentRequest, PromoteDeploymentResponse,
  GetDeploymentHistoryResponse,
  // Job types
  GetJobsResponse, GetJobResponse, GetLogsResponse, DeleteJobsRequest, DeleteJobsResponse,
  // Backup types  
  GetBackupsResponse, GetBackupResponse, CreateBackupResponse, RestoreBackupResponse, DeleteBackupResponse,
  // Notification types
  GetNotificationsResponse, NotificationItem, PatchNotificationResponse, PostNotificationsActionResponse,
  // Settings types
  GetSettingsResponse, PatchSettingsRequest, PatchSettingsResponse,
  GetBackupSettingsResponse, PatchBackupSettingsRequest, PatchBackupSettingsResponse,
  // System types
  GetSystemStatusResponse, GetUpdateCheckResponse
} from '@hola/shared';
import { globalCache, CacheTTL } from './cache';
import { safeFetchEnhanced, createEnhancedError, type EnhancedError } from './error-enhanced';

// Environment-based configuration for SDK
export function getWebBaseUrl(): string {
  // Check for explicit Vite environment variable first
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
}

// Request deduplication support
interface PendingRequest {
  promise: Promise<unknown>;
  controller: AbortController;
  timestamp: number;
}

const pendingRequests = new Map<string, PendingRequest>();

// Request deduplication policies - same as original api.ts
const DEDUPE_POLICIES = {
  GET: true,
  PUT: true,
  PATCH: true,
  POST: false,
  DELETE: false,
} as const;

function createCacheKey(method: string, path: string, body?: unknown): string {
  const bodyStr = body ? JSON.stringify(body) : '';
  return `${method}:${path}:${bodyStr}`;
}

// Cache TTL mapping based on endpoint patterns - same as original
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

// Enhanced SDK Adapter class
export class SdkAdapter {
  private sdk: HolaSdk;

  constructor() {
    // Initialize SDK with web-specific configuration
    this.sdk = new HolaSdk({
      baseUrl: getWebBaseUrl(),
      // Web doesn't use token auth - relies on cookies/session
      token: undefined,
      // Provide enhanced fetch that includes our error handling and retry logic
      fetchImpl: this.createEnhancedFetch(),
    });
  }

  // Create enhanced fetch implementation that preserves web enhancements
  private createEnhancedFetch(): typeof fetch {
    const f = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      return safeFetchEnhanced(input, init);
    }) as unknown as typeof fetch;
    return f;
  }

  // Build full URL for direct fetch calls
  private buildFullUrl(path: string): string {
    const baseUrl = getWebBaseUrl();
    return `${baseUrl}${path}`;
  }

  // Enhanced request method with smart deduplication and caching
  private async enhancedRequest<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    sdkCall: () => Promise<T>,
    body?: unknown,
    dedupeEnabled: boolean = true
  ): Promise<T> {
    const cacheKey = createCacheKey(method, path, body);
    
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
          return existingRequest.promise as Promise<T>;
        }
      }
    }

    // Create abort controller for cancellation
    const controller = new AbortController();
    
    // Wrap SDK call with request tracking
    const requestPromise = (async (): Promise<T> => {
      try {
        const result = await sdkCall();
        
        // Cache GET responses with appropriate TTL
        if (method === 'GET') {
          const ttl = getCacheTTL(path);
          globalCache.set(`api:${path}`, result, ttl);
        }
        
        return result;
      } catch (error) {
        // Ensure we throw enhanced errors
        if (error instanceof Error && !(error as EnhancedError).type) {
          throw createEnhancedError(error);
        }
        throw error;
      }
    })();

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

    const result = await requestPromise;
    
    // Handle cache invalidation for mutations
    if (method !== 'GET') {
      this.invalidateCache(path);
    }
    
    return result;
  }

  // Try to get from cache first, then fetch if not available
  private async getWithCache<T>(path: string, sdkCall: () => Promise<T>): Promise<T> {
    const cached = globalCache.get<T>(`api:${path}`);
    
    if (cached !== null) {
      return cached;
    }
    
    return this.enhancedRequest('GET', path, sdkCall, undefined, false);
  }

  // Smart cache invalidation - same logic as original api.ts
  private invalidateCache(path: string): void {
    // Remove exact match
    globalCache.delete(`api:${path}`);
    
    // Remove related cache entries based on path patterns
    if (path.includes('/deployments/')) {
      globalCache.deleteByPattern(/^api:.*\/deployments/);
      globalCache.deleteByPattern(/^api:.*\/summary/); // Dashboard depends on deployments
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

  // === API Methods using SDK with enhancements ===

  // Health and basic endpoints
  health(useCache: boolean = false): Promise<HealthResponse> {
    if (useCache) {
      return this.getWithCache('/api/health', () => this.sdk.get<HealthResponse>('/api/health'));
    }
    return this.enhancedRequest('GET', '/api/health', () => this.sdk.get<HealthResponse>('/api/health'), undefined, false);
  }

  me(): Promise<GetMeResponse> {
    return this.getWithCache('/api/me', () => this.sdk.me());
  }

  summary(): Promise<GetSummaryResponse> {
    return this.getWithCache('/api/summary', () => this.sdk.get<GetSummaryResponse>('/api/summary'));
  }

  // System status
  system = {
    status: (): Promise<GetSystemStatusResponse> =>
      this.getWithCache('/api/system/status', () => this.sdk.get<GetSystemStatusResponse>('/api/system/status')),
    updateCheck: (): Promise<GetUpdateCheckResponse> =>
      this.getWithCache('/api/system/update-check', () => this.sdk.get<GetUpdateCheckResponse>('/api/system/update-check')),
  };

  // Catalog with smart caching
  catalog = {
    apps: (params?: { query?: string; category?: string; page?: number; limit?: number }): Promise<GetCatalogAppsResponse> => {
      const query = this.buildQuery(params || {});
      const path = `/api/catalog/apps${query}`;
      return this.getWithCache(path, () => this.sdk.get<GetCatalogAppsResponse>(path));
    },
    
    appById: (appId: string): Promise<GetCatalogAppResponse> => {
      const path = `/api/catalog/apps/${appId}`;
      return this.getWithCache(path, () => this.sdk.get<GetCatalogAppResponse>(path));
    },
    
    versions: (appId: string): Promise<GetCatalogAppVersionsResponse> => {
      const path = `/api/catalog/apps/${appId}/versions`;
      return this.getWithCache(path, () => this.sdk.get<GetCatalogAppVersionsResponse>(path));
    },
    
    versionDetail: (appId: string, version: string): Promise<GetCatalogAppVersionDetailResponse> => {
      const path = `/api/catalog/apps/${appId}/versions/${encodeURIComponent(version)}`;
      return this.getWithCache(path, () => this.sdk.get<GetCatalogAppVersionDetailResponse>(path));
    },

    // Force an immediate catalog re-fetch (bypasses the server's refresh-interval
    // TTL) so newly-published versions surface as available updates right away.
    // A refresh can change which apps have updates, so drop the cached deployment
    // lists (they carry `updateAvailable`), catalog, and dashboard summary.
    refresh: async (force = true): Promise<{ success: boolean; timestamp: string }> => {
      const res = await this.sdk.catalog.refresh(force);
      globalCache.deleteByPattern(/^api:.*\/deployments/);
      globalCache.deleteByPattern(/^api:.*\/catalog/);
      globalCache.deleteByPattern(/^api:.*\/summary/);
      return res;
    },
  };

  // Drafts (Install Wizard) with cache invalidation
  drafts = {
    create: (data: CreateDraftRequest): Promise<CreateDraftResponse> =>
      this.enhancedRequest('POST', '/api/drafts', () => this.sdk.drafts.create(data), data, false),
    
    byId: (draftId: string): Promise<GetDraftResponse> => {
      const path = `/api/drafts/${draftId}`;
      // Don't cache draft state as it changes frequently
      return this.enhancedRequest('GET', path, () => this.sdk.drafts.byId(draftId), undefined, false);
    },
    
    update: (draftId: string, data: PatchDraftRequest): Promise<PatchDraftResponse> => {
      const path = `/api/drafts/${draftId}`;
      return this.enhancedRequest('PATCH', path, () => this.sdk.drafts.update(draftId, data), data, true);
    },

    remove: (draftId: string): Promise<void> =>
      this.enhancedRequest('DELETE', `/api/drafts/${draftId}`, () => this.sdk.drafts.remove(draftId), undefined, false),

    uploadFile: (draftId: string, formData: FormData): Promise<UploadDraftFileResponse> => {
      const path = `/api/drafts/${draftId}/uploads`;
      // For web file uploads, we need to preserve FormData approach
      // This bypasses the SDK and uses our enhanced fetch directly
      return this.enhancedRequest('POST', path, async () => {
        const response = await this.createEnhancedFetch()(this.buildFullUrl(path), {
          method: 'POST',
          body: formData, // Send FormData directly, not JSON
          headers: {
            // Don't set Content-Type for FormData - let browser set it with boundary
            // No JSON content-type header for FormData
          }
        });
        return response.json();
      }, formData, false);
    },
    
    deleteFile: (draftId: string, uploadId: string): Promise<DeleteDraftFileResponse> => {
      const path = `/api/drafts/${draftId}/uploads/${uploadId}`;
      return this.enhancedRequest('DELETE', path, () => 
        this.sdk.drafts.removeFile(draftId, uploadId), undefined, false);
    },
    
    validate: (draftId: string): Promise<ValidateDraftResponse> => {
      const path = `/api/drafts/${draftId}/validate`;
      return this.enhancedRequest('POST', path, () => this.sdk.drafts.validate(draftId), undefined, false);
    },
    
    preflight: (draftId: string): Promise<ValidateDraftResponse> => {
      const path = `/api/drafts/${draftId}/preflight`;
      return this.enhancedRequest('POST', path, () => this.sdk.drafts.preflight(draftId), undefined, false);
    },
    
    finalize: (draftId: string): Promise<FinalizeDraftResponse> => {
      const path = `/api/drafts/${draftId}/finalize`;
      return this.enhancedRequest('POST', path, () => this.sdk.drafts.finalize(draftId), undefined, false);
    },
  };

  // Deployments with optimistic cache management
  deployments = {
    create: (data: CreateDeploymentFromDraftRequest): Promise<CreateDeploymentFromDraftResponse> =>
      this.enhancedRequest('POST', '/api/deployments', () => this.sdk.deployments.create(data), data, true),

    // Full teardown: stops containers, deprovisions auth, releases the Traefik
    // route, and removes the record (DELETE /api/deployments/:id). The `delete`
    // *action* only stops compose, leaving the route held — use this to remove.
    remove: (deploymentId: string): Promise<void> =>
      this.enhancedRequest('DELETE', `/api/deployments/${deploymentId}`, () => this.sdk.deployments.delete(deploymentId), undefined, true),

    list: (params?: GetDeploymentsRequest): Promise<GetDeploymentsResponse> => {
      const query = this.buildQuery(params || {});
      const path = `/api/deployments${query}`;
      return this.getWithCache(path, () => this.sdk.deployments.list(params));
    },

    byId: (deploymentId: string): Promise<GetDeploymentResponse> => {
      const path = `/api/deployments/${deploymentId}`;
      return this.getWithCache(path, () => this.sdk.deployments.byId(deploymentId));
    },
    
    update: (deploymentId: string, data: PatchDeploymentRequest): Promise<PatchDeploymentResponse> => {
      const path = `/api/deployments/${deploymentId}`;
      return this.enhancedRequest('PATCH', path, () => 
        this.sdk.deployments.update(deploymentId, data), data, true);
    },
    
    history: (deploymentId: string, params?: { page?: number; limit?: number }): Promise<GetDeploymentHistoryResponse> => {
      const query = this.buildQuery(params || {});
      const path = `/api/deployments/${deploymentId}/history${query}`;
      return this.getWithCache(path, () => this.sdk.deployments.history(deploymentId, params));
    },
    
    action: (deploymentId: string, action: PostDeploymentActionRequest): Promise<PostDeploymentActionResponse> => {
      const path = `/api/deployments/${deploymentId}/actions`;
      return this.enhancedRequest('POST', path, () =>
        this.sdk.deployments.action(deploymentId, action), action, false);
    },

    // Upgrade to a newer catalog version (#284 Phase 2). Carries the current
    // env/secrets forward, runs the skip-guard + pre-upgrade snapshot, then
    // switches the active release. Missing here previously meant the hybrid
    // `api` (which routes deployments to this adapter) had no `promote`, so the
    // dashboard's Upgrade button threw "deployments.promote is not a function".
    promote: (deploymentId: string, body: PromoteDeploymentRequest = {}): Promise<PromoteDeploymentResponse> => {
      const path = `/api/deployments/${deploymentId}/promote`;
      return this.enhancedRequest('POST', path, () =>
        this.sdk.deployments.promote(deploymentId, body), body, false);
    },
    
    logs: (deploymentId: string, params?: { since?: string; lines?: number }): Promise<GetLogsResponse> => {
      const query = this.buildQuery(params || {});
      const path = `/api/deployments/${deploymentId}/logs${query}`;
      // Don't cache logs
      return this.enhancedRequest('GET', path, () => 
        this.sdk.deployments.logs(deploymentId, params), undefined, false);
    },
  };

  // Jobs with frequent updates
  jobs = {
    list: (params?: { deploymentId?: string; status?: string; page?: number; limit?: number }): Promise<GetJobsResponse> => {
      const query = this.buildQuery(params || {});
      const path = `/api/jobs${query}`;
      return this.getWithCache(path, () => this.sdk.get<GetJobsResponse>(path));
    },
    
    byId: (jobId: string): Promise<GetJobResponse> => {
      const path = `/api/jobs/${jobId}`;
      // Don't cache job details as they change frequently
      return this.enhancedRequest('GET', path, () => this.sdk.get<GetJobResponse>(path), undefined, false);
    },
    
    logs: (jobId: string, params?: { since?: string; lines?: number }): Promise<GetLogsResponse> => {
      const query = this.buildQuery(params || {});
      const path = `/api/jobs/${jobId}/logs${query}`;
      // Don't cache logs
      return this.enhancedRequest('GET', path, () =>
        this.sdk.jobs.logs(jobId, params), undefined, false);
    },

    // Clear finished (completed/failed/cancelled) jobs, optionally scoped by
    // deployment and/or terminal status. Never removes running/queued jobs.
    clear: async (params?: DeleteJobsRequest): Promise<DeleteJobsResponse> => {
      const res = await this.sdk.jobs.clear(params);
      globalCache.deleteByPattern(/^api:.*\/jobs/);
      globalCache.deleteByPattern(/^api:.*\/summary/);
      return res;
    },
  };

  // Backups with cache management
  backups = {
    list: (params?: { appId?: string; status?: string; page?: number; limit?: number }): Promise<GetBackupsResponse> => {
      const query = this.buildQuery(params || {});
      const path = `/api/backups${query}`;
      return this.getWithCache(path, () => this.sdk.get<GetBackupsResponse>(path));
    },
    
    byId: (backupId: string): Promise<GetBackupResponse> => {
      const path = `/api/backups/${backupId}`;
      return this.getWithCache(path, () => this.sdk.get<GetBackupResponse>(path));
    },
    
    create: (data: { appId?: string }): Promise<CreateBackupResponse> => {
      const path = '/api/backups';
      return this.enhancedRequest('POST', path, () => this.sdk.post<CreateBackupResponse>(path, data), data, false);
    },
    
    restore: (backupId: string, data?: { targetDeploymentId?: string }): Promise<RestoreBackupResponse> => {
      const path = `/api/backups/${backupId}/restore`;
      return this.enhancedRequest('POST', path, () => this.sdk.post<RestoreBackupResponse>(path, data), data, false);
    },
    
    delete: (backupId: string): Promise<DeleteBackupResponse> => {
      const path = `/api/backups/${backupId}`;
      return this.enhancedRequest('DELETE', path, () => this.sdk.delete<DeleteBackupResponse>(path), undefined, false);
    },
  };

  // Notifications with cache management
  notifications = {
    list: (params?: { filter?: string; page?: number; limit?: number }): Promise<GetNotificationsResponse> => {
      const query = this.buildQuery(params || {});
      const path = `/api/notifications${query}`;
      return this.getWithCache(path, () => this.sdk.get<GetNotificationsResponse>(path));
    },
    
    byId: (id: string): Promise<NotificationItem> => {
      const path = `/api/notifications/${id}`;
      return this.getWithCache(path, () => this.sdk.get<NotificationItem>(path));
    },
    
    update: (id: string, data: { read?: boolean; dismiss?: boolean }): Promise<PatchNotificationResponse> => {
      const path = `/api/notifications/${id}`;
      return this.enhancedRequest('PATCH', path, () => this.sdk.patch<PatchNotificationResponse>(path, data), data, true);
    },
    
    actions: (data: { action: 'markAllRead' | 'dismissAll' }): Promise<PostNotificationsActionResponse> => {
      const path = '/api/notifications/actions';
      return this.enhancedRequest('POST', path, () => this.sdk.post<PostNotificationsActionResponse>(path, data), data, false);
    },
  };

  // Settings with cache management
  settings = {
    get: (): Promise<GetSettingsResponse> => {
      const path = '/api/settings';
      return this.getWithCache(path, () => this.sdk.get<GetSettingsResponse>(path));
    },
    
    update: (data: PatchSettingsRequest): Promise<PatchSettingsResponse> => {
      const path = '/api/settings';
      return this.enhancedRequest('PATCH', path, () => this.sdk.patch<PatchSettingsResponse>(path, data), data, true);
    },
    
    backup: {
      get: (): Promise<GetBackupSettingsResponse> => {
        const path = '/api/settings/backup';
        return this.getWithCache(path, () => this.sdk.get<GetBackupSettingsResponse>(path));
      },
      
      update: (data: PatchBackupSettingsRequest): Promise<PatchBackupSettingsResponse> => {
        const path = '/api/settings/backup';
        return this.enhancedRequest('PATCH', path, () => this.sdk.patch<PatchBackupSettingsResponse>(path, data), data, true);
      },
    },
  };

  // Cache management utilities
  cache = {
    clear: () => this.clearCache(),
    invalidate: (path: string) => this.invalidateCache(path),
    stats: () => globalCache.getStats(),
  };
}

// Default SDK adapter instance
export const sdkAdapter = new SdkAdapter();