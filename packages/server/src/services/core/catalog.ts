import { getLogger } from '../../lib/logger';
import type { ServiceHealth, HealthCheckable } from './types';
import { catalogConfig } from '../../config/catalog';
import { parseComposeDefaults, mergeDefaults } from './compose-parser';
import type {
  GetCatalogAppsRequest,
  GetCatalogAppsResponse,
  GetCatalogAppResponse,
  GetCatalogAppVersionsResponse,
  GetCatalogAppVersionDetailResponse,
  CatalogApp,
  CatalogAppVersion,
} from '@hola/shared';

// Shape of remote catalog JSON (minimal for now)
type RemoteCatalog = {
  apps: Array<{
    id: string;
    name: string;
    description?: string;
    icon?: string;
    category?: string;
    tags?: string[];
    featured?: boolean;
    rating?: number;
    downloads?: number | string;
    versions?: Array<{
      version: string;
      createdAt?: string;
      digest?: string;
      sizeBytes?: number;
      refs?: { oci?: string };
    }>;
  }>;
};

export interface CatalogService {
  listApps(req: GetCatalogAppsRequest): Promise<GetCatalogAppsResponse>;
  getApp(appId: string): Promise<GetCatalogAppResponse>;
  getVersions(appId: string): Promise<GetCatalogAppVersionsResponse>;
  getVersionDetail(appId: string, version: string): Promise<GetCatalogAppVersionDetailResponse>;
  refresh(force?: boolean): Promise<void>;
}

export class RealCatalogService implements CatalogService, HealthCheckable {
  private logger = getLogger().child({ service: 'RealCatalogService' });
  private cache: { data: RemoteCatalog | null; ts: number; etag?: string; lastModified?: string } = { data: null, ts: 0 };
  private inflight?: Promise<void>;

  async healthCheck(): Promise<ServiceHealth> {
    try {
      // If a catalog URL is configured, attempt a HEAD/GET
      if (catalogConfig.catalogUrl) {
        await this.ensureLoaded();
      }
      return { healthy: true, lastCheck: new Date() };
    } catch (error) {
      return { healthy: false, lastCheck: new Date(), error: error instanceof Error ? error.message : String(error) };
    }
  }

  async listApps(req: GetCatalogAppsRequest): Promise<GetCatalogAppsResponse> {
    const data = await this.ensureLoaded();
    const page = req.page ?? 1;
    const limit = req.limit ?? 12;
    const q = (req.q || req.query || '').toLowerCase();
    const category = req.category?.toLowerCase();

    let items = data.apps.map(this.mapApp);

    if (q) {
      items = items.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.tags.some(t => t.toLowerCase().includes(q))
      );
    }
    if (category) {
      items = items.filter(a => a.category.toLowerCase() === category);
    }

    const total = items.length;
    const start = (page - 1) * limit;
    const slice = items.slice(start, start + limit);

    return { items: slice, page, limit, total };
  }

  async getApp(appId: string): Promise<GetCatalogAppResponse> {
    const data = await this.ensureLoaded();
    const app = data.apps.find(a => a.id === appId);
    if (!app) throw new Error('APP_NOT_FOUND');
    const mapped = this.mapApp(app);
    const versions = (app.versions || []).map(v => v.version);
    return { ...mapped, versions };
  }

  async getVersions(appId: string): Promise<GetCatalogAppVersionsResponse> {
    const data = await this.ensureLoaded();
    const app = data.apps.find(a => a.id === appId);
    if (!app) throw new Error('APP_NOT_FOUND');
    const items: CatalogAppVersion[] = (app.versions || []).map(v => ({ version: v.version, createdAt: v.createdAt || new Date().toISOString() }));
    return { items, total: items.length };
  }

  async getVersionDetail(appId: string, version: string): Promise<GetCatalogAppVersionDetailResponse> {
    // Locate app/version with OCI ref
    const data = await this.ensureLoaded();
    const app = data.apps.find(a => a.id === appId);
    if (!app) throw new Error('APP_NOT_FOUND');
    const v = (app.versions || []).find(x => x.version === version);
    if (!v) throw new Error('VERSION_NOT_FOUND');
    const ref = v.refs?.oci;
    if (!ref) throw new Error('NO_OCI_REF');

    // Lazy import to avoid circular deps at module load
    const { getServices } = await import('../simple-factory');
    const bundles = getServices().bundles;

    // Pull and validate bundle
    const info = await bundles.ensurePulled({ appId, version, ociRef: ref });
    const validation = await bundles.validateLayout(info.localPath);
    if (!validation.ok) {
      this.logger.warn('Bundle layout invalid; deferring to mocks', { appId, version, errors: validation.errors });
      throw new Error('INVALID_BUNDLE_LAYOUT');
    }

    // Try to read manifest.json for defaults; if missing or invalid, defer to mocks by throwing
    try {
      const { readFileSync } = await import('fs');
      const { join } = await import('path');
      const manifestPath = join(info.localPath, 'manifest.json');
      const raw = readFileSync(manifestPath, 'utf8');

      // Define a narrow manifest shape we accept
      type Manifest = {
        defaultEnv?: Array<{ key: unknown; value: unknown; isSecret?: unknown; description?: unknown }>;
        defaults?: {
          ports?: Array<{ host?: unknown; container: unknown; protocol?: unknown }>;
          volumes?: Array<{ hostPath?: unknown; containerPath: unknown; readOnly?: unknown }>;
        };
      };

      const manifest: Manifest = JSON.parse(raw) as unknown as Manifest;

      // minimal validation
      if (!manifest || !Array.isArray(manifest.defaultEnv) || typeof manifest.defaults !== 'object') {
        throw new Error('MANIFEST_MISSING_FIELDS');
      }

      // Coerce manifest shapes
      const manifestEnv = manifest.defaultEnv.map((e) => ({
        key: String((e as { key?: unknown }).key ?? ''),
        value: String((e as { value?: unknown }).value ?? ''),
        isSecret: Boolean((e as { isSecret?: unknown }).isSecret),
        description: (e as { description?: unknown }).description ? String((e as { description?: unknown }).description) : undefined,
      }));
      const manifestDefaults = {
        ports: Array.isArray(manifest.defaults?.ports)
          ? manifest.defaults!.ports!.map((p) => ({
              host: typeof (p as { host?: unknown }).host === 'number' ? (p as { host: number }).host : undefined,
              container: Number((p as { container?: unknown }).container ?? 0),
              protocol: (p as { protocol?: unknown }).protocol === 'udp' ? 'udp' as const : 'tcp' as const,
            }))
          : [],
        volumes: Array.isArray(manifest.defaults?.volumes)
          ? manifest.defaults!.volumes!.map((v) => ({
              hostPath: (v as { hostPath?: unknown }).hostPath ? String((v as { hostPath?: unknown }).hostPath) : undefined,
              containerPath: String((v as { containerPath?: unknown }).containerPath ?? ''),
              readOnly: Boolean((v as { readOnly?: unknown }).readOnly),
            }))
          : [],
      };

      // Parse compose.yaml to get additional defaults
      const composeDefaults = parseComposeDefaults(info.localPath);

      // Merge compose and manifest defaults (manifest takes precedence)
      const merged = mergeDefaults(composeDefaults, manifestDefaults, manifestEnv);

      return merged satisfies GetCatalogAppVersionDetailResponse;
    } catch (error) {
      this.logger.warn('Failed to read or parse bundle manifest; deferring to mocks', { appId, version, error: error instanceof Error ? error.message : String(error) });
      throw new Error('MANIFEST_UNAVAILABLE');
    }
  }

  async refresh(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.cache.ts < catalogConfig.refreshIntervalMs) return;
    await this.loadRemoteCatalog();
  }

  // Helpers
  private async ensureLoaded(): Promise<RemoteCatalog> {
    const now = Date.now();
    if (this.cache.data && (now - this.cache.ts < catalogConfig.refreshIntervalMs)) {
      return this.cache.data;
    }
    await this.loadRemoteCatalog();
    if (!this.cache.data) throw new Error('CATALOG_UNAVAILABLE');
    return this.cache.data;
  }

  private async loadRemoteCatalog(): Promise<void> {
    // De-duplicate concurrent fetches
    if (this.inflight) {
      await this.inflight;
      return;
    }

    if (!catalogConfig.catalogUrl) {
      // Without a URL, treat as healthy but empty; callers will fallback if needed
      this.logger.info('No catalog URL configured; real catalog is inert');
      this.cache = { data: { apps: [] }, ts: Date.now() };
      return;
    }

    this.inflight = (async () => {
      this.logger.info('Fetching remote catalog', { url: catalogConfig.catalogUrl });
      const headers: Record<string, string> = {};
      if (this.cache.etag) headers['If-None-Match'] = this.cache.etag;
      if (this.cache.lastModified) headers['If-Modified-Since'] = this.cache.lastModified;

      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), catalogConfig.fetchTimeoutMs || 3000);
      try {
        const res = await fetch(catalogConfig.catalogUrl!, { headers, signal: controller.signal });
        if (res.status === 304 && this.cache.data) {
          this.logger.debug('Catalog not modified');
          this.cache.ts = Date.now();
          return;
        }
        if (!res.ok) throw new Error(`Catalog fetch failed: ${res.status}`);
        const data = (await res.json()) as RemoteCatalog;
        this.cache = {
          data,
            ts: Date.now(),
            etag: res.headers.get('etag') || undefined,
            lastModified: res.headers.get('last-modified') || undefined,
        };
      } catch (error) {
        if ((error instanceof Error && error.name === 'AbortError') || (error instanceof Error && error.message.includes('aborted'))) {
          this.logger.warn('Catalog fetch aborted (timeout)', { timeoutMs: catalogConfig.fetchTimeoutMs });
          // If we have existing cache, treat as not modified
          if (this.cache.data) {
            this.cache.ts = Date.now();
            return;
          }
        }
        // Re-throw for outer callers when no cache exists
        if (!this.cache.data) {
          throw error instanceof Error ? error : new Error(String(error));
        }
        this.logger.warn('Catalog fetch failed; retaining prior cache', { error: error instanceof Error ? error.message : String(error) });
        this.cache.ts = Date.now();
      } finally {
        clearTimeout(tid);
      }
    })();

    try {
      await this.inflight;
    } finally {
      this.inflight = undefined;
    }
  }

  private mapApp(app: RemoteCatalog['apps'][number]): CatalogApp {
    return {
      id: app.id,
      name: app.name,
      description: app.description || '',
      icon: app.icon || '📦',
      category: app.category || 'apps',
      rating: app.rating ?? 0,
      downloads: app.downloads ?? 0,
      tags: app.tags || [],
      featured: !!app.featured,
    };
  }
}

export class MockCatalogService implements CatalogService {
  // Delegate to existing mock-data to preserve contract fidelity
  private modPromise = import('../../mock-data');

  async listApps(req: GetCatalogAppsRequest): Promise<GetCatalogAppsResponse> {
    const { getCatalogApps } = await this.modPromise;
    return getCatalogApps({ page: req.page ?? 1, limit: req.limit ?? 12, query: req.q || req.query, category: req.category });
  }
  async getApp(appId: string): Promise<GetCatalogAppResponse> {
    const { getCatalogAppById } = await this.modPromise;
    const app = getCatalogAppById(appId);
    if (!app) throw new Error('APP_NOT_FOUND');
    return app;
  }
  async getVersions(appId: string): Promise<GetCatalogAppVersionsResponse> {
    const { getCatalogAppVersions } = await this.modPromise;
    const versions = getCatalogAppVersions(appId);
    if (!versions) throw new Error('APP_NOT_FOUND');
    return versions;
  }
  async getVersionDetail(appId: string, version: string): Promise<GetCatalogAppVersionDetailResponse> {
    const { getCatalogAppVersionDetail } = await this.modPromise;
    const detail = getCatalogAppVersionDetail(appId, version);
    if (!detail) throw new Error('VERSION_NOT_FOUND');
    return detail;
  }
  async refresh(): Promise<void> { /* no-op for mocks */ }
}
