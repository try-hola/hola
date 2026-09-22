// Hybrid API interface for the SDK migration.
//
// Every endpoint below is served by the SDK adapter. This module used to
// dispatch each one through a `USE_SDK_FOR.<name> ? sdk : legacy` ternary so
// endpoints could be cut over one at a time; the cutover finished with every
// flag set to `true`, and the leftover ternaries were actively harmful — a
// conditional expression is typed as the union of BOTH branches even when the
// condition is the literal `true`, so `api.deployments` was typed as the
// intersection-free union of the SDK surface and the legacy surface and every
// SDK-only method (`drafts.remove`, `deployments.config`,
// `deployments.subdomainAvailable`, ...) looked like it did not exist. The
// legacy client is still used for the shared cache controls below.

import { api as originalApi } from './api';
import { sdkAdapter } from './sdk-adapter';

export const api = {
  health: () => sdkAdapter.health(false), // Don't cache health checks
  me: () => sdkAdapter.me(),
  summary: () => sdkAdapter.summary(),
  system: sdkAdapter.system,
  catalog: sdkAdapter.catalog,
  drafts: sdkAdapter.drafts,

  // Capability contract rollup (ADR 0004 Phase 4) — SDK-only, read-only.
  contracts: sdkAdapter.contracts,

  // Registry credentials + install-by-ref (multi-catalog Slice 1) — SDK-only.
  registryCredentials: sdkAdapter.registryCredentials,
  installFromRef: sdkAdapter.installFromRef,
  // Restore-on-install (spec 007) — SDK-only.
  restoreCandidates: sdkAdapter.restoreCandidates,
  // Catalog sources (multi-catalog Slice 2) — SDK-only.
  catalogSources: sdkAdapter.catalogSources,

  deployments: sdkAdapter.deployments,
  jobs: sdkAdapter.jobs,
  backups: sdkAdapter.backups,
  notifications: sdkAdapter.notifications,
  settings: sdkAdapter.settings,

  // Cache management - both implementations keep their own cache, so clearing
  // one without the other leaves stale reads behind.
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
