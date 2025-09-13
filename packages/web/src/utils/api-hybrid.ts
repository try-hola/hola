// Hybrid API interface for gradual migration to SDK adapter
// This allows us to migrate endpoints incrementally while preserving all behavior

import { api as originalApi } from './api';
import { sdkAdapter } from './sdk-adapter';

// Migration flags to control which endpoints use the SDK adapter
const USE_SDK_FOR = {
  health: true,   // ✅ Migrated - simple and safe
  me: true,       // ✅ Migrated - simple user info  
  summary: true,  // ✅ Migrated - dashboard data
  catalog: true,  // ✅ Migrated - read-only catalog data
  system: true,   // ✅ Migrating now - system status reads
  drafts: false,  // Not migrated yet
  deployments: false, // Not migrated yet
  jobs: false,    // Not migrated yet
  backups: false, // Not migrated yet
  notifications: false, // Not migrated yet
  settings: false, // Not migrated yet
} as const;

// Hybrid API that gradually switches to SDK adapter
export const api = {
  // Health endpoint - migrated to SDK adapter
  health: USE_SDK_FOR.health 
    ? () => sdkAdapter.health(false) // Don't cache health checks
    : originalApi.health,

  // Me endpoint - not migrated yet  
  me: USE_SDK_FOR.me
    ? () => sdkAdapter.me()
    : originalApi.me,

  // Summary endpoint - not migrated yet
  summary: USE_SDK_FOR.summary
    ? () => sdkAdapter.summary()
    : originalApi.summary,

  // System endpoints - not migrated yet
  system: USE_SDK_FOR.system
    ? sdkAdapter.system
    : originalApi.system,

  // Catalog endpoints - not migrated yet
  catalog: USE_SDK_FOR.catalog
    ? sdkAdapter.catalog
    : originalApi.catalog,

  // Draft endpoints - not migrated yet
  drafts: USE_SDK_FOR.drafts
    ? sdkAdapter.drafts
    : originalApi.drafts,

  // Deployment endpoints - not migrated yet
  deployments: USE_SDK_FOR.deployments
    ? sdkAdapter.deployments
    : originalApi.deployments,

  // Job endpoints - not migrated yet
  jobs: USE_SDK_FOR.jobs
    ? sdkAdapter.jobs
    : originalApi.jobs,

  // Backup endpoints - not migrated yet
  backups: USE_SDK_FOR.backups
    ? sdkAdapter.backups
    : originalApi.backups,

  // Notification endpoints - not migrated yet
  notifications: USE_SDK_FOR.notifications
    ? sdkAdapter.notifications
    : originalApi.notifications,

  // Settings endpoints - not migrated yet
  settings: USE_SDK_FOR.settings
    ? sdkAdapter.settings
    : originalApi.settings,

  // Cache management - delegate to appropriate implementation
  cache: {
    clear: () => {
      originalApi.cache.clear();
      sdkAdapter.cache.clear();
    },
    invalidate: (path: string) => {
      originalApi.cache.invalidate(path);
      sdkAdapter.cache.invalidate(path);
    },
    stats: () => {
      // For now, return original stats, but we could merge them later
      return originalApi.cache.stats();
    },
  },
};

// Re-export everything else for convenience
export { apiClient } from './api';
export type { ErrorResponse } from './api';