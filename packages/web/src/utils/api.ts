import { API } from '@hola/shared';
import type { ErrorResponse } from '@hola/shared';
import { safeFetch } from './error';

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

// Request deduplication cache
const pendingRequests = new Map<string, Promise<Response>>();

// Create cache key for request deduplication
function createCacheKey(url: string, options: RequestInit = {}): string {
  const method = options.method || 'GET';
  const body = options.body || '';
  return `${method}:${url}:${body}`;
}

// Type-safe API client with error handling and request deduplication
export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = BASE_URL) {
    this.baseUrl = baseUrl;
  }

  // Build full URL from API path
  private buildUrl(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  // Generic request method with deduplication
  private async request<T>(
    path: string,
    options: RequestInit = {},
    dedupeEnabled: boolean = true
  ): Promise<T> {
    const url = this.buildUrl(path);
    const cacheKey = createCacheKey(url, options);

    // Check for existing request for GET operations
    if (dedupeEnabled && (!options.method || options.method === 'GET')) {
      const existingRequest = pendingRequests.get(cacheKey);
      if (existingRequest) {
        const response = await existingRequest;
        return response.clone().json();
      }
    }

    // Set default headers
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Create request promise
    const requestPromise = safeFetch(url, {
      ...options,
      headers,
    });

    // Cache GET requests
    if (dedupeEnabled && (!options.method || options.method === 'GET')) {
      pendingRequests.set(cacheKey, requestPromise);

      // Clean up cache after request completes
      requestPromise
        .then(() => pendingRequests.delete(cacheKey))
        .catch(() => pendingRequests.delete(cacheKey));
    }

    const response = await requestPromise;
    return response.json();
  }

  // HTTP method helpers
  async get<T>(path: string, dedupeEnabled: boolean = true): Promise<T> {
    return this.request<T>(path, { method: 'GET' }, dedupeEnabled);
  }

  async post<T>(path: string, data?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }, false);
  }

  async patch<T>(path: string, data?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    }, false);
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' }, false);
  }

  // Specialized methods for file uploads
  async upload<T>(path: string, formData: FormData): Promise<T> {
    const url = this.buildUrl(path);
    
    // Don't set Content-Type for FormData - let browser set it with boundary
    const response = await safeFetch(url, {
      method: 'POST',
      body: formData,
    });

    return response.json();
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

  // Clear request cache (useful for forced refreshes)
  clearCache(): void {
    pendingRequests.clear();
  }
}

// Default API client instance
export const apiClient = new ApiClient();

// Convenience API methods using shared API constants
export const api = {
  // Health and basic endpoints
  health: () => apiClient.get(API.health),
  me: () => apiClient.get(API.me),
  summary: () => apiClient.get(API.summary),

  // System status
  system: {
    status: () => apiClient.get(API.system.status),
  },

  // Catalog
  catalog: {
    apps: (params?: { query?: string; category?: string; page?: number; limit?: number }) => {
      const query = apiClient.buildQuery(params || {});
      return apiClient.get(`${API.catalog.apps}${query}`);
    },
    
    appById: (appId: string) => apiClient.get(API.catalog.appById(appId)),
    
    versions: (appId: string) => apiClient.get(API.catalog.versions(appId)),
    
    versionDetail: (appId: string, version: string) => 
      apiClient.get(API.catalog.versionDetail(appId, version)),
  },

  // Drafts (Install Wizard)
  drafts: {
    create: (data: { appId: string; version?: string }) => 
      apiClient.post(API.drafts.create, data),
    
    byId: (draftId: string) => apiClient.get(API.drafts.byId(draftId)),
    
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

  // Deployments
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
    
    logs: (deploymentId: string, params?: { since?: string; lines?: number }) => {
      const query = apiClient.buildQuery(params || {});
      return apiClient.get(`${API.deployments.logs(deploymentId)}${query}`);
    },
  },

  // Jobs
  jobs: {
    byId: (jobId: string) => apiClient.get(API.jobs.byId(jobId)),
    
    logs: (jobId: string, params?: { since?: string; lines?: number }) => {
      const query = apiClient.buildQuery(params || {});
      return apiClient.get(`${API.jobs.logs(jobId)}${query}`);
    },
  },

  // Backups
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

  // Notifications
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

  // Settings
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
};

// Export types for convenience
export type { ErrorResponse };
