// Phase 6: Catalog and Bundles configuration

export type SignaturePolicy = 'none' | 'optional' | 'required';

export interface CatalogConfig {
  // Registry and pulling
  registry: 'ghcr';
  registryAllowlist: string[]; // e.g., ['ghcr.io/try-hola/*']
  pullConcurrency: number; // parallel pulls
  signaturePolicy: SignaturePolicy; // verify-if-present by default

  // Remote catalog JSON
  catalogUrl?: string; // public, cached JSON endpoint
  refreshIntervalMs: number; // obey cache headers; fallback refresh cadence
  fetchTimeoutMs?: number; // network fetch timeout for remote catalog

  // Cache/retention
  cacheSoftCapBytes: number; // soft cap for non-active cache (LRU eviction)
  retainPriorVersions: number; // prior versions to keep in addition to in-use images
}

export const defaultCatalogConfig: CatalogConfig = {
  registry: 'ghcr',
  registryAllowlist: (process.env.HOLA_REGISTRY_ALLOWLIST || 'ghcr.io/try-hola/*')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  pullConcurrency: Number(process.env.HOLA_PULL_CONCURRENCY) || 2,
  signaturePolicy: (process.env.HOLA_SIGNATURE_POLICY as SignaturePolicy) || 'optional',

  catalogUrl: process.env.HOLA_CATALOG_URL || undefined,
  refreshIntervalMs: Number(process.env.HOLA_CATALOG_REFRESH_INTERVAL_MS) || 24 * 60 * 60 * 1000, // 24h
  fetchTimeoutMs: Number(process.env.HOLA_CATALOG_FETCH_TIMEOUT_MS) || 3000,

  cacheSoftCapBytes: Number(process.env.HOLA_BUNDLE_CACHE_CAP_BYTES) || 1_000_000_000, // 1 GB
  retainPriorVersions: Number(process.env.HOLA_RETAIN_PRIOR_VERSIONS) || 2,
};

export function loadCatalogConfig(): CatalogConfig {
  return { ...defaultCatalogConfig };
}

export const catalogConfig = loadCatalogConfig();
