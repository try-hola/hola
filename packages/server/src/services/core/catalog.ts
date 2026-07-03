import { readFileSync } from 'fs';
import { join } from 'path';
import { getLogger } from '../../lib/logger';
import type { ServiceHealth, HealthCheckable } from './types';
import type { PullCredentials, BundleService } from './bundles';
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
import { coerceManifestAuth } from './manifest-auth';
import { coerceConsumes } from './app-registry';
import { coerceManifestUpgrade } from './manifest-upgrade';
import { coerceManifestBackup } from './manifest-backup';

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

type CatalogVersionEntry = {
  version: string;
  createdAt?: string;
  digest?: string;
  sizeBytes?: number;
  refs?: { oci?: string };
};

/**
 * Resolve "latest" to the newest concrete version. Sorts by semver descending
 * (numeric dot-segments); if any version doesn't parse as semver, falls back to
 * the catalog's listed order (last entry). Returns undefined for an empty list.
 */
function pickLatestVersion(versions: CatalogVersionEntry[]): CatalogVersionEntry | undefined {
  if (!versions.length) return undefined;
  const isSemver = (s: string) => /^\d+(\.\d+)*$/.test(s);
  if (!versions.every(v => isSemver(v.version))) {
    return versions[versions.length - 1];
  }
  const parse = (s: string) => s.split('.').map(p => parseInt(p, 10));
  return [...versions].sort((a, b) => {
    const pa = parse(a.version);
    const pb = parse(b.version);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const diff = (pb[i] || 0) - (pa[i] || 0);
      if (diff) return diff;
    }
    return 0;
  })[0];
}

/**
 * Derive an appId slug + version from an OCI package reference. e.g.
 * `ghcr.io/acme/hola-cms:0.1.0` → `{ appId: 'hola-cms', version: '0.1.0' }`.
 * A digest-only ref (`…@sha256:…`) yields version `latest`; an untagged ref too.
 */
export function parseOciRef(ref: string): { appId: string; version: string } {
  let s = ref.trim();
  let version = 'latest';
  const at = s.indexOf('@');
  if (at >= 0) s = s.slice(0, at); // ignore digest for the version label
  const lastSlash = s.lastIndexOf('/');
  const lastColon = s.lastIndexOf(':');
  if (lastColon > lastSlash) {
    version = s.slice(lastColon + 1) || 'latest';
    s = s.slice(0, lastColon);
  }
  const name = s.slice(s.lastIndexOf('/') + 1);
  const appId = name.replace(/[^a-zA-Z0-9._-]/g, '-') || 'app';
  return { appId, version };
}

export interface CatalogService {
  listApps(req: GetCatalogAppsRequest): Promise<GetCatalogAppsResponse>;
  getApp(appId: string): Promise<GetCatalogAppResponse>;
  getVersions(appId: string): Promise<GetCatalogAppVersionsResponse>;
  getVersionDetail(appId: string, version: string): Promise<GetCatalogAppVersionDetailResponse>;
  /**
   * Resolve a version detail directly from an OCI package reference, bypassing
   * the catalog index (Slice 1 install-by-ref). Pulls + validates + coerces the
   * bundle exactly like a catalog install so the strict rules apply to one-offs
   * too. `credentials` authenticate a private-registry pull.
   */
  getVersionDetailByRef(ociRef: string, credentials?: PullCredentials): Promise<GetCatalogAppVersionDetailResponse & { appId: string }>;
  refresh(force?: boolean): Promise<void>;
}

export class RealCatalogService implements CatalogService, HealthCheckable {
  private logger = getLogger().child({ service: 'RealCatalogService' });
  private cache: { data: RemoteCatalog | null; ts: number; etag?: string; lastModified?: string } = { data: null, ts: 0 };
  private inflight?: Promise<void>;

  /** Optional injected bundle service (tests). Production resolves it lazily from
   *  the service factory to avoid a circular import at module load. */
  constructor(private bundlesOverride?: BundleService) {}

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

  async getVersionDetail(appId: string, version: string, credentials?: PullCredentials, source?: string): Promise<GetCatalogAppVersionDetailResponse> {
    // Locate app/version with OCI ref
    const data = await this.ensureLoaded();
    const app = data.apps.find(a => a.id === appId);
    if (!app) throw new Error('APP_NOT_FOUND');
    const versions = app.versions || [];
    // Resolve the meta-version "latest" (and an unspecified version) to the
    // newest concrete release. Catalog entries pin real versions (e.g. 1.2.1),
    // so a literal "latest" never matches an entry — both the CLI and the web
    // wizard pass "latest" by default, so this resolution is what makes the
    // common "install the newest" path work at all.
    const v = (!version || version === 'latest')
      ? pickLatestVersion(versions)
      : versions.find(x => x.version === version);
    if (!v) throw new Error('VERSION_NOT_FOUND');
    const ref = v.refs?.oci;
    if (!ref) throw new Error('NO_OCI_REF');

    // Pull and validate bundle. Key the cache by the RESOLVED concrete version
    // (`v.version`), NOT the meta-version `version` ("latest"). ensurePulled skips
    // the OCI pull when a cached bundle's compose.yaml+manifest.json already exist,
    // so caching under `<app>/latest` means a server that installed an app before a
    // fix was published keeps serving that stale `latest` bundle forever — the new
    // concrete version never gets pulled. Keying by the concrete version makes every
    // new release a cache miss, so published fixes actually reach existing servers.
    return this.pullValidateBuild({ appId, source, version: v.version, ociRef: ref, credentials });
  }

  async getVersionDetailByRef(ociRef: string, credentials?: PullCredentials): Promise<GetCatalogAppVersionDetailResponse & { appId: string }> {
    const { appId, version } = parseOciRef(ociRef);
    // A dedicated `(ref)` source namespaces the by-ref bundle cache away from any
    // catalog source and never collides with the reserved `hola` id.
    const detail = await this.pullValidateBuild({ appId, source: '(ref)', version, ociRef, credentials });
    return { ...detail, appId };
  }

  /**
   * Shared pull → validate → coerce for both the catalog and by-ref install
   * paths. Reuses the bundle service (oras pull + allowlist + optional creds) and
   * the strict layout check, so every source is held to the same rules.
   */
  private async pullValidateBuild(opts: { appId: string; source?: string; version: string; ociRef: string; credentials?: PullCredentials }): Promise<GetCatalogAppVersionDetailResponse> {
    // Injected in tests; otherwise lazy-imported to avoid a circular dep at load.
    const bundles = this.bundlesOverride ?? (await import('../simple-factory')).getServices().bundles;

    const info = await bundles.ensurePulled({ appId: opts.appId, version: opts.version, ociRef: opts.ociRef, source: opts.source, credentials: opts.credentials });
    const validation = await bundles.validateLayout(info.localPath);
    if (!validation.ok) {
      this.logger.warn('Bundle layout invalid', { appId: opts.appId, version: opts.version, errors: validation.errors });
      throw new Error('INVALID_BUNDLE_LAYOUT');
    }
    return this.buildDetailFromBundle(info.localPath, opts.version);
  }

  /**
   * Read + coerce a pulled bundle's manifest.json/compose.yaml into a version
   * detail. Throws MANIFEST_UNAVAILABLE if the bundle can't be parsed.
   */
  private buildDetailFromBundle(localPath: string, version: string): GetCatalogAppVersionDetailResponse {
    try {
      const manifestPath = join(localPath, 'manifest.json');
      const raw = readFileSync(manifestPath, 'utf8');

      // Define a narrow manifest shape we accept
      type Manifest = {
        defaultEnv?: Array<{ key: unknown; value: unknown; isSecret?: unknown; description?: unknown }>;
        defaults?: {
          ports?: Array<{ host?: unknown; container: unknown; protocol?: unknown }>;
          volumes?: Array<{ hostPath?: unknown; containerPath: unknown; readOnly?: unknown }>;
        };
        auth?: unknown;
        consumes?: unknown;
        upgrade?: unknown;
        backup?: unknown;
        ingress?: { service?: unknown; port?: unknown };
      };

      const manifest: Manifest = JSON.parse(raw) as unknown as Manifest;

      // minimal validation. `defaults` is optional (an app may declare only
      // defaultEnv with no extra ports/volumes), so only reject it when present
      // but malformed — `typeof undefined !== 'object'` must not fail a valid
      // manifest. Downstream reads already use `manifest.defaults?.…`.
      // `defaultEnv` is OPTIONAL (the package README documents it as such): an app
      // with no user-facing env — e.g. one whose only secret is a self-contained
      // internal DB password — legitimately omits it. Treat a missing value as an
      // empty list rather than rejecting the whole manifest (which silently dropped
      // the bundle's compose and made the app undeployable). Only a PRESENT-but-not-
      // -an-array `defaultEnv`, or a malformed `defaults`, is a real error.
      if (
        !manifest ||
        (manifest.defaultEnv !== undefined && !Array.isArray(manifest.defaultEnv)) ||
        (manifest.defaults !== undefined && typeof manifest.defaults !== 'object')
      ) {
        throw new Error('MANIFEST_MISSING_FIELDS');
      }

      // Coerce manifest shapes
      const manifestEnv = (manifest.defaultEnv ?? []).map((e) => ({
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
      const composeDefaults = parseComposeDefaults(localPath);

      // Carry the raw compose.yaml through so a catalog-created draft can be
      // deployed without the user pasting compose. Same file the parser reads;
      // a missing/unreadable compose throws here and falls through to the same
      // catch (MANIFEST_UNAVAILABLE) + draft-side fallback — no new failure mode.
      const composeOverride = readFileSync(join(localPath, 'compose.yaml'), 'utf8');

      // Merge compose and manifest defaults (manifest takes precedence)
      const merged = mergeDefaults(composeDefaults, manifestDefaults, manifestEnv);

      // Coerce the optional auth block (drives SSO provisioning at deploy time).
      // Unknown manifest fields are dropped here unless explicitly carried — so
      // the auth block must be coerced or it silently vanishes downstream.
      const auth = coerceManifestAuth(manifest.auth);

      // Cross-app capabilities the app consumes (e.g. `app-registry`); generic,
      // so new capability names need no server change (ADR 0002).
      const consumes = coerceConsumes(manifest.consumes);

      // Upgrade-safety metadata (#284 Phase 0): drives the server-side skip-guard
      // on promote and the dashboard's pre-upgrade warning. Coerced narrowly like
      // `auth`, so unknown fields don't survive into the deploy lifecycle.
      const upgrade = coerceManifestUpgrade(manifest.upgrade);

      // Per-app pre/post-backup hooks (#121): run around a snapshot for
      // transaction-consistent backups. Coerced narrowly like `auth`.
      const backup = coerceManifestBackup(manifest.backup);

      // Which compose service is the web/ingress one — the app's bundle manifest
      // declares it as `ingress.service`. Lets the server route to / inject auth
      // env into the right service for a multi-service app whose ingress isn't
      // named after the app id (the default heuristic). Non-empty string only.
      const ingressService =
        typeof manifest.ingress?.service === 'string' && manifest.ingress.service.trim()
          ? manifest.ingress.service.trim()
          : undefined;

      return { ...merged, version, composeOverride, auth, consumes, upgrade, backup, ingressService } satisfies GetCatalogAppVersionDetailResponse;
    } catch (error) {
      this.logger.warn('Failed to read or parse bundle manifest', { version, error: error instanceof Error ? error.message : String(error) });
      throw new Error('MANIFEST_UNAVAILABLE', { cause: error });
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

/**
 * Empty catalog for the test environment. There is no bundled catalog — the only
 * catalog is the remote one at try-hola/apps (RealCatalogService + HOLA_CATALOG_URL).
 * Tests that need catalog data inject their own stub.
 */
export class MockCatalogService implements CatalogService {
  async listApps(req: GetCatalogAppsRequest): Promise<GetCatalogAppsResponse> {
    return { items: [], page: req.page ?? 1, limit: req.limit ?? 12, total: 0 };
  }
  async getApp(): Promise<GetCatalogAppResponse> {
    throw new Error('APP_NOT_FOUND');
  }
  async getVersions(): Promise<GetCatalogAppVersionsResponse> {
    throw new Error('APP_NOT_FOUND');
  }
  async getVersionDetail(): Promise<GetCatalogAppVersionDetailResponse> {
    throw new Error('VERSION_NOT_FOUND');
  }
  async getVersionDetailByRef(): Promise<GetCatalogAppVersionDetailResponse & { appId: string }> {
    throw new Error('VERSION_NOT_FOUND');
  }
  async refresh(): Promise<void> { /* no-op */ }
}
