import { readFileSync } from 'fs';
import { join } from 'path';
import { getLogger } from '../../lib/logger';
import type { Logger } from '../../lib/logger';
import type { ServiceHealth, HealthCheckable } from './types';
import type { PullCredentials, BundleService } from './bundles';
import { matchesAllowlist } from './bundles';
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
  CatalogSourceRecord,
  CatalogSourceTrust,
  AppEnvVar,
  ParamType,
  ParamGenerate,
  ParamEnumOption,
  PreviewCatalogSourceResponse,
} from '@hola/shared';
import { suggestRegistryGlob } from '@hola/shared';
import type { CatalogSourceService } from './catalog-sources';
import type { RegistryCredentialService } from './registry-credentials';
import { coerceManifestAuth } from './manifest-auth';
import { coerceManifestSecurity } from './manifest-security';
import { coerceManifestProfiles } from './manifest-profiles';
import { coerceConsumes } from './app-registry';
import { coerceProvides, coerceAccepts, findUndeclaredAcceptorBlocks } from './contracts';
import { coerceManifestUpgrade } from './manifest-upgrade';
import { coerceManifestBackup } from './manifest-backup';
import { coerceManifestPush } from './manifest-push';
import { validateParamSpec, PARAM_TYPES, GENERATE_KINDS } from '@hola/shared/param-validate';
import { BundleError, BundleUnavailableError, ValidationError, assertValidChannelName } from '../../middleware/error-mapping';
import { isValidChannelName, isEligibleOnChannel, newestEligibleVersion, STABLE_CHANNEL } from '@hola/shared';

/**
 * Coerce one raw `manifest.defaultEnv[]` row into an `AppEnvVar`, including the
 * typed-param spec fields added by ADR 0003. Mirrors the narrow-shape coercion
 * style of `coerceManifestAuth`/`coerceManifestUpgrade`/`coerceManifestBackup`:
 * anything malformed is dropped (never thrown), so a sloppy or newer-vocabulary
 * manifest degrades gracefully rather than failing the whole bundle load.
 *
 * `type` is the one field with a genuine forward-compat rule: an unrecognized
 * string (a future type this server build doesn't know about yet) is dropped
 * to `undefined` (degrading the row to untyped/free-text) rather than kept
 * as-is or rejected — see ADR 0003 "unknown type degrades to untyped".
 */
export function coerceManifestEnvVar(e: unknown, logger: Logger, ctx: { appId?: string; version: string }): AppEnvVar {
  const rec = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;

  const row: AppEnvVar = {
    key: String(rec.key ?? ''),
    value: String(rec.value ?? ''),
    isSecret: Boolean(rec.isSecret),
    description: rec.description ? String(rec.description) : undefined,
  };

  if (typeof rec.label === 'string') row.label = rec.label;

  if (typeof rec.type === 'string') {
    if (PARAM_TYPES.has(rec.type)) {
      row.type = rec.type as ParamType;
    } else {
      logger.warn('Unknown env param type; degrading to untyped', {
        appId: ctx.appId, version: ctx.version, key: row.key, type: rec.type,
      });
    }
  }

  if (rec.required === true || rec.required === false) row.required = rec.required;
  if (typeof rec.advanced === 'boolean') row.advanced = rec.advanced;
  if (typeof rec.placeholder === 'string') row.placeholder = rec.placeholder;

  // --- string ---
  if (typeof rec.pattern === 'string') row.pattern = rec.pattern;
  if (typeof rec.minLength === 'number') row.minLength = rec.minLength;
  if (typeof rec.maxLength === 'number') row.maxLength = rec.maxLength;

  // --- integer / port ---
  if (typeof rec.min === 'number') row.min = rec.min;
  if (typeof rec.max === 'number') row.max = rec.max;

  // --- enum ---
  if (Array.isArray(rec.options)) {
    const options: ParamEnumOption[] = [];
    for (const o of rec.options) {
      if (!o || typeof o !== 'object') continue;
      const orec = o as Record<string, unknown>;
      if (typeof orec.value !== 'string') continue;
      options.push({
        value: orec.value,
        label: typeof orec.label === 'string' ? orec.label : undefined,
        description: typeof orec.description === 'string' ? orec.description : undefined,
      });
    }
    if (options.length > 0) row.options = options;
  }

  // --- boolean ---
  if (typeof rec.trueValue === 'string') row.trueValue = rec.trueValue;
  if (typeof rec.falseValue === 'string') row.falseValue = rec.falseValue;

  // --- url ---
  if (typeof rec.httpsOnly === 'boolean') row.httpsOnly = rec.httpsOnly;

  // --- secret generation ---
  if (rec.generate && typeof rec.generate === 'object') {
    const grec = rec.generate as Record<string, unknown>;
    if (typeof grec.kind === 'string' && GENERATE_KINDS.has(grec.kind)) {
      const generate: ParamGenerate = { kind: grec.kind as ParamGenerate['kind'] };
      if (typeof grec.length === 'number') generate.length = grec.length;
      row.generate = generate;
    }
  }

  // Spec lint: never fails the bundle, just logs so an authoring mistake in the
  // apps repo is visible in server logs (the apps repo's manifest CI treats the
  // same check as build-failing).
  const specIssues = validateParamSpec(row);
  if (specIssues.length > 0) {
    logger.warn('Manifest env param spec has issues', {
      appId: ctx.appId, version: ctx.version, key: row.key,
      issues: specIssues.map((i) => i.message),
    });
  }

  return row;
}

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
      // Release channel this version entry is listed on (#428); raw/unvalidated —
      // coerceChannel resolves it (absent ⇒ 'stable'; malformed ⇒ dropped).
      channel?: unknown;
    }>;
  }>;
};

type CatalogVersionEntry = {
  version: string;
  createdAt?: string;
  digest?: string;
  sizeBytes?: number;
  refs?: { oci?: string };
  // Always resolved by wellFormedVersions: never the raw/unvalidated value.
  channel: string;
};

/**
 * Coerce a raw catalog entry's `channel` field (#428): absent (or an explicit
 * `null`, which is how "no channel" round-trips through most JSON generators)
 * → `stable`, today's implicit behaviour; a well-formed channel name → itself;
 * anything else (wrong type, uppercase, empty, too long) → `undefined`, telling
 * the caller to drop the entry. Mirrors the narrow-coercer house style
 * (`coerceManifestEnvVar` et al.): junk is dropped, never thrown or defaulted
 * to `stable` (which would silently promote a typo to the default channel).
 */
function coerceChannel(value: unknown): string | undefined {
  if (value === undefined || value === null) return STABLE_CHANNEL;
  return isValidChannelName(value) ? value : undefined;
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
  getApp(appId: string, source?: string): Promise<GetCatalogAppResponse>;
  getVersions(appId: string, source?: string): Promise<GetCatalogAppVersionsResponse>;
  /**
   * `channel` (#428) restricts which versions `latest`/an unspecified version
   * may resolve to (default `stable`) and which a pinned `version` must be
   * eligible on. `latest` finding nothing eligible throws `BundleUnavailableError`
   * code `NO_VERSION_ON_CHANNEL`; a pinned version that exists but isn't
   * eligible on `channel` throws `ValidationError` code `VERSION_NOT_ON_CHANNEL`.
   */
  getVersionDetail(appId: string, version: string, source?: string, channel?: string): Promise<GetCatalogAppVersionDetailResponse>;
  /**
   * Resolve a version detail directly from an OCI package reference, bypassing
   * the catalog index (Slice 1 install-by-ref). Pulls + validates + coerces the
   * bundle exactly like a catalog install so the strict rules apply to one-offs
   * too. `credentials` authenticate a private-registry pull.
   */
  getVersionDetailByRef(ociRef: string, credentials?: PullCredentials): Promise<GetCatalogAppVersionDetailResponse & { appId: string }>;
  /** Per-source outcome, so one bad source doesn't silently mask the others. */
  refresh(force?: boolean): Promise<Array<{ id: string; name: string; ok: boolean; error?: string }>>;
  /**
   * Probe a catalog.json without storing anything: what apps it lists and which
   * registries they publish bundles from. Lets the operator grant registry
   * consent from the catalog's own contents at add time, instead of discovering
   * a missing `allowRegistries` as a REF_NOT_ALLOWED install failure later.
   */
  previewSource(url: string): Promise<PreviewCatalogSourceResponse>;
}

/**
 * One catalog.json source: encapsulates the HTTP fetch with ETag/Last-Modified
 * conditional requests, a timeout with stale-cache fallback, and concurrent-fetch
 * de-duplication. The aggregator holds one of these per enabled source.
 */
export class SourceCatalog {
  private logger = getLogger().child({ service: 'SourceCatalog' });
  private cache: { data: RemoteCatalog | null; ts: number; etag?: string; lastModified?: string } = { data: null, ts: 0 };
  private inflight?: Promise<void>;

  constructor(readonly url: string) {}

  async ensureLoaded(): Promise<RemoteCatalog> {
    const now = Date.now();
    if (this.cache.data && now - this.cache.ts < catalogConfig.refreshIntervalMs) return this.cache.data;
    await this.load();
    if (!this.cache.data) throw new Error('CATALOG_UNAVAILABLE');
    return this.cache.data;
  }

  async refresh(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.cache.ts < catalogConfig.refreshIntervalMs) return;
    await this.load();
  }

  private async load(): Promise<void> {
    if (this.inflight) { await this.inflight; return; }

    if (!this.url) {
      this.cache = { data: { apps: [] }, ts: Date.now() };
      return;
    }

    this.inflight = (async () => {
      this.logger.info('Fetching catalog source', { url: this.url });
      const headers: Record<string, string> = {};
      if (this.cache.etag) headers['If-None-Match'] = this.cache.etag;
      if (this.cache.lastModified) headers['If-Modified-Since'] = this.cache.lastModified;

      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), catalogConfig.fetchTimeoutMs || 3000);
      try {
        const res = await fetch(this.url, { headers, signal: controller.signal });
        if (res.status === 304 && this.cache.data) {
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
        if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'))) {
          this.logger.warn('Catalog fetch aborted (timeout)', { url: this.url, timeoutMs: catalogConfig.fetchTimeoutMs });
          if (this.cache.data) { this.cache.ts = Date.now(); return; }
        }
        if (!this.cache.data) throw error instanceof Error ? error : new Error(String(error));
        this.logger.warn('Catalog fetch failed; retaining prior cache', { url: this.url, error: error instanceof Error ? error.message : String(error) });
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
}

/**
 * Display/collision key for an app across sources: bare for the built-in `hola`
 * source, `<sourceId>/<appId>` otherwise, so a private app can't collide with a
 * public one. NOTE: this is NOT the wire id — `CatalogApp.id` stays bare and the
 * source travels in a separate `source` field.
 */
export function qualifiedId(source: string, appId: string): string {
  return source === 'hola' ? appId : `${source}/${appId}`;
}

export class RealCatalogService implements CatalogService, HealthCheckable {
  private logger = getLogger().child({ service: 'RealCatalogService' });
  /** Per-source fetchers, keyed by `${id}::${url}` so a URL change re-fetches. */
  private catalogs = new Map<string, SourceCatalog>();

  /**
   * All optional so existing constructions/tests keep working; production resolves
   * bundles/sources/credentials lazily from the service factory to avoid a circular
   * import at module load.
   */
  constructor(
    private bundlesOverride?: BundleService,
    private sourcesOverride?: CatalogSourceService,
    private credentialsOverride?: RegistryCredentialService,
  ) {}

  private async sourcesService(): Promise<CatalogSourceService> {
    return this.sourcesOverride ?? (await import('../simple-factory')).getServices().catalogSources;
  }

  private async credentialsService(): Promise<RegistryCredentialService> {
    return this.credentialsOverride ?? (await import('../simple-factory')).getServices().registryCredentials;
  }

  /** Reuse (or create) the fetcher for a source, re-creating it if the URL changed. */
  private catalogFor(source: CatalogSourceRecord): SourceCatalog {
    const key = `${source.id}::${source.url}`;
    let sc = this.catalogs.get(key);
    if (!sc) {
      // Drop any stale entry for this id under a different URL.
      for (const k of this.catalogs.keys()) if (k.startsWith(`${source.id}::`)) this.catalogs.delete(k);
      sc = new SourceCatalog(source.url);
      this.catalogs.set(key, sc);
    }
    return sc;
  }

  /** The sources to serve: a single one when `source` is given (else all enabled). */
  private async resolveSources(source?: string): Promise<CatalogSourceRecord[]> {
    const svc = await this.sourcesService();
    if (source) {
      const rec = await svc.get(source);
      return rec ? [rec] : [];
    }
    return svc.listEnabled();
  }

  async healthCheck(): Promise<ServiceHealth> {
    // Fetch failures are fail-soft in listApps, so health is about the service
    // being wired, not every source being reachable.
    return { healthy: true, lastCheck: new Date() };
  }

  async listApps(req: GetCatalogAppsRequest): Promise<GetCatalogAppsResponse> {
    const page = req.page ?? 1;
    const limit = req.limit ?? 12;
    const q = (req.q || req.query || '').toLowerCase();
    const category = req.category?.toLowerCase();

    const sources = await this.resolveSources(req.source);
    // Fan out; a slow/broken source must not sink the whole listing.
    const results = await Promise.allSettled(
      sources.map(async (s) => {
        const data = await this.catalogFor(s).ensureLoaded();
        return data.apps.map(a => this.mapApp(a, s));
      })
    );

    // Merge + dedupe by the source-qualified id (an app can appear once per source).
    const seen = new Set<string>();
    let items: CatalogApp[] = [];
    for (const r of results) {
      if (r.status !== 'fulfilled') {
        this.logger.warn('A catalog source failed to load; skipping', { error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
        continue;
      }
      for (const app of r.value) {
        const key = qualifiedId(app.source, app.id);
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(app);
      }
    }

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
    return { items: items.slice(start, start + limit), page, limit, total };
  }

  async getApp(appId: string, source = 'hola'): Promise<GetCatalogAppResponse> {
    const { app, record } = await this.locateApp(appId, source);
    const versions = this.wellFormedVersions(app, record.id);
    const mapped = this.mapAppFromVersions(app, record, versions);
    return { ...mapped, versions: versions.map(v => v.version) };
  }

  async getVersions(appId: string, source = 'hola'): Promise<GetCatalogAppVersionsResponse> {
    const { app, record } = await this.locateApp(appId, source);
    const items: CatalogAppVersion[] = this.wellFormedVersions(app, record.id).map(v => ({
      version: v.version,
      createdAt: v.createdAt || new Date().toISOString(),
      channel: v.channel,
    }));
    return { items, total: items.length };
  }

  /**
   * `channel` is intentionally NOT defaulted via a parameter default: whether it
   * was explicitly supplied matters (FR-009). For `latest`/an unspecified
   * version, an absent channel defaults to `stable` (there's no version to
   * infer one from). For a PINNED version, eligibility is enforced only when
   * `channel` was explicitly given — an operator who pins a pre-release with no
   * channel gets that version, its channel simply becomes the implied channel
   * (US2 acceptance scenario 5 / clarification Q4), not a validation failure.
   */
  async getVersionDetail(appId: string, version: string, source = 'hola', channel?: string): Promise<GetCatalogAppVersionDetailResponse> {
    assertValidChannelName(channel);
    const { app, record } = await this.locateApp(appId, source);
    const versions = this.wellFormedVersions(app, record.id);
    // Resolve the meta-version "latest" (and an unspecified version) to the
    // newest version ELIGIBLE ON `channel` (default `stable`) by version
    // precedence (#428) — never by list position, so a single `-rc` entry can't
    // flip an app's default. Catalog entries pin real versions (e.g. 1.2.1), so
    // a literal "latest" never matches an entry — both the CLI and the web
    // wizard pass "latest" by default, so this resolution is what makes the
    // common "install the newest" path work at all.
    if (!version || version === 'latest') {
      const effectiveChannel = channel ?? STABLE_CHANNEL;
      const newest = newestEligibleVersion(versions, effectiveChannel);
      if (!newest) {
        const channelsWithVersions = [...new Set(versions.map(v => v.channel))].sort();
        throw new BundleUnavailableError(
          `No version of '${appId}' is available on channel '${effectiveChannel}'. Channels with versions: ${channelsWithVersions.length ? channelsWithVersions.join(', ') : 'none'}.`,
          'NO_VERSION_ON_CHANNEL',
        );
      }
      return this.resolveVersionEntry(appId, newest, record);
    }

    const v = versions.find(x => x.version === version);
    // Soft: no bundle to fetch. A caller may legitimately fall back to generic
    // defaults and let the operator supply their own compose.
    if (!v) throw new BundleUnavailableError(`VERSION_NOT_FOUND: ${appId}@${version}`, 'VERSION_NOT_FOUND');
    // A pinned version must be eligible on an EXPLICITLY requested channel
    // (#428, FR-009: "…or a pinned version not eligible on the explicit
    // channel…") — own channel or `stable`. No `channel` argument at all means
    // no constraint was asked for, so the version's own channel is simply
    // reported (implying it), never rejected.
    if (channel !== undefined && !isEligibleOnChannel(v.channel, channel)) {
      const err = new ValidationError(
        `Version ${v.version} of '${appId}' is on channel '${v.channel}', not eligible on channel '${channel}'.`,
      );
      err.code = 'VERSION_NOT_ON_CHANNEL';
      throw err;
    }
    return this.resolveVersionEntry(appId, v, record);
  }

  /** Pull/validate/build the bundle for a resolved catalog version entry and stamp its channel onto the response. */
  private async resolveVersionEntry(appId: string, v: CatalogVersionEntry, record: CatalogSourceRecord): Promise<GetCatalogAppVersionDetailResponse> {
    const ref = v.refs?.oci;
    if (!ref) throw new BundleUnavailableError(`NO_OCI_REF: ${appId}@${v.version}`, 'NO_OCI_REF');

    // Resolve the source's stored credential (if any) for a private package pull.
    let credentials: PullCredentials | undefined;
    if (record.auth?.credentialRef) {
      credentials = await (await this.credentialsService()).resolve(record.auth.credentialRef);
      if (!credentials) {
        throw new BundleError(
          'CREDENTIAL_NOT_FOUND',
          `CREDENTIAL_NOT_FOUND: catalog source '${record.id}' references registry credential '${record.auth.credentialRef}', which no longer exists.`,
          { status: 400 },
        );
      }
    }

    // Key the cache by the RESOLVED concrete version (`v.version`) + source, so a
    // published fix reaches existing servers (a "latest" cache would go stale) and
    // two sources can't alias the same appId/version.
    // Thread the source's `allowRegistries` (operator consent declared at source-add
    // time) through to the bundle pull so a first-party registry namespace is
    // unlocked without registering a credential.
    const detail = await this.pullValidateBuild({ appId, source: record.id, version: v.version, ociRef: ref, credentials, extraAllowlist: record.allowRegistries });
    return { ...detail, channel: v.channel };
  }

  /**
   * Coerce and filter one app's raw `versions[]` into well-formed entries
   * (#428): a malformed `channel` drops the entry (never silently promoted to
   * `stable`); a version string repeated within the same app keeps only the
   * first occurrence. Each drop is logged once, naming the source/app/version.
   * Every "newest"/`channels`/listing resolution reads from this, never the
   * raw `app.versions`.
   */
  private wellFormedVersions(app: RemoteCatalog['apps'][number], source: string): CatalogVersionEntry[] {
    const out: CatalogVersionEntry[] = [];
    const seen = new Set<string>();
    for (const raw of app.versions ?? []) {
      if (seen.has(raw.version)) {
        this.logger.warn('Catalog version entry ignored', {
          source, appId: app.id, version: raw.version, channel: raw.channel, reason: 'duplicate version',
        });
        continue;
      }
      const channel = coerceChannel(raw.channel);
      if (channel === undefined) {
        this.logger.warn('Catalog version entry ignored', {
          source, appId: app.id, version: raw.version, channel: raw.channel, reason: 'malformed channel',
        });
        continue;
      }
      seen.add(raw.version);
      out.push({
        version: raw.version,
        createdAt: raw.createdAt,
        digest: raw.digest,
        sizeBytes: raw.sizeBytes,
        refs: raw.refs,
        channel,
      });
    }
    return out;
  }

  /** Find an app within a specific source's catalog (default the built-in `hola`). */
  private async locateApp(appId: string, source: string): Promise<{ app: RemoteCatalog['apps'][number]; record: CatalogSourceRecord }> {
    const record = await (await this.sourcesService()).get(source);
    if (!record) throw new Error('APP_NOT_FOUND');
    const data = await this.catalogFor(record).ensureLoaded();
    const app = data.apps.find(a => a.id === appId);
    if (!app) throw new Error('APP_NOT_FOUND');
    return { app, record };
  }

  async getVersionDetailByRef(ociRef: string, credentials?: PullCredentials): Promise<GetCatalogAppVersionDetailResponse & { appId: string }> {
    const { appId, version } = parseOciRef(ociRef);
    // A dedicated `(ref)` source namespaces the by-ref bundle cache away from any
    // catalog source and never collides with the reserved `hola` id.
    const detail = await this.pullValidateBuild({ appId, source: '(ref)', version, ociRef, credentials });
    // Install-by-ref bypasses the catalog index entirely (#428): there is no
    // channel to resolve, so it's always `stable`.
    return { ...detail, appId, channel: STABLE_CHANNEL };
  }

  /**
   * Shared pull → validate → coerce for both the catalog and by-ref install
   * paths. Reuses the bundle service (oras pull + allowlist + optional creds) and
   * the strict layout check, so every source is held to the same rules.
   */
  private async pullValidateBuild(opts: { appId: string; source?: string; version: string; ociRef: string; credentials?: PullCredentials; extraAllowlist?: string[] }): Promise<GetCatalogAppVersionDetailResponse> {
    // Injected in tests; otherwise lazy-imported to avoid a circular dep at load.
    const bundles = this.bundlesOverride ?? (await import('../simple-factory')).getServices().bundles;

    const info = await bundles.ensurePulled({ appId: opts.appId, version: opts.version, ociRef: opts.ociRef, source: opts.source, credentials: opts.credentials, extraAllowlist: opts.extraAllowlist });
    const validation = await bundles.validateLayout(info.localPath);
    if (!validation.ok) {
      this.logger.warn('Bundle layout invalid', { appId: opts.appId, version: opts.version, errors: validation.errors });
      throw new BundleError(
        'INVALID_BUNDLE_LAYOUT',
        `INVALID_BUNDLE_LAYOUT: ${opts.ociRef}: ${validation.errors.join('; ')}`,
        { status: 422, details: { errors: validation.errors } },
      );
    }
    return this.buildDetailFromBundle(info.localPath, opts.version, opts.appId);
  }

  /**
   * Read + coerce a pulled bundle's manifest.json/compose.yaml into a version
   * detail. Throws MANIFEST_UNAVAILABLE if the bundle can't be parsed.
   */
  private buildDetailFromBundle(localPath: string, version: string, appId?: string): GetCatalogAppVersionDetailResponse {
    try {
      const manifestPath = join(localPath, 'manifest.json');
      const raw = readFileSync(manifestPath, 'utf8');

      // Define a narrow manifest shape we accept. `defaultEnv` rows are coerced
      // by `coerceManifestEnvVar` (which does its own narrow field-by-field
      // checks), so they're read here as fully unknown.
      type Manifest = {
        defaultEnv?: unknown[];
        defaults?: {
          ports?: Array<{ host?: unknown; container: unknown; protocol?: unknown }>;
          volumes?: Array<{ hostPath?: unknown; containerPath: unknown; readOnly?: unknown }>;
        };
        auth?: unknown;
        consumes?: unknown;
        provides?: unknown;
        accepts?: unknown;
        multiInstance?: unknown;
        security?: unknown;
        upgrade?: unknown;
        backup?: unknown;
        push?: unknown;
        profiles?: unknown;
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
      const manifestEnv = (manifest.defaultEnv ?? []).map((e) => coerceManifestEnvVar(e, this.logger, { appId, version }));
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

      // Capability contract roles (ADR 0004): `provides` = this app performs the
      // capability for others, `accepts` = this app opts in to being a subject of
      // it. Unknown refs are dropped with a warning (forward-compat), never
      // fatal. Acceptance is NOT inferred from the presence of the typed block —
      // an app that needs no hooks must stay distinguishable from one nobody
      // considered — so a block without its declaration is only reported.
      const provides = coerceProvides(manifest.provides, this.logger, { appId, version });
      const accepts = coerceAccepts(manifest.accepts, this.logger, { appId, version });
      for (const ref of findUndeclaredAcceptorBlocks(manifest as Record<string, unknown>, accepts)) {
        this.logger.warn('Manifest declares a contract block without accepting the contract', { appId, version, ref });
      }

      // Whether the app opts into multiple instances (#246). Kept absent unless the
      // manifest explicitly sets `true`, so singleton (the default) stays the clean
      // common case in drafts and deployment records.
      const multiInstance = manifest.multiInstance === true ? true : undefined;

      // Elevated container permissions the app requests (e.g. sudo needs
      // privilege escalation). Coerced narrowly like `auth`; the wizard surfaces
      // each for consent and the deploy lifecycle relaxes the matching hardening.
      const security = coerceManifestSecurity(manifest.security);

      // Upgrade-safety metadata (#284 Phase 0): drives the server-side skip-guard
      // on promote and the dashboard's pre-upgrade warning. Coerced narrowly like
      // `auth`, so unknown fields don't survive into the deploy lifecycle.
      const upgrade = coerceManifestUpgrade(manifest.upgrade);

      // Per-app pre/post-backup hooks (#121): run around a snapshot for
      // transaction-consistent backups. Coerced narrowly like `auth`.
      const backup = coerceManifestBackup(manifest.backup);

      // Directories the app declares as pushable (#409). Coerced narrowly like
      // `auth`; the server resolves each `path` against the deployment's data
      // root (and proves containment) at push time.
      const push = coerceManifestPush(manifest.push);

      // Optional Compose profiles the app declares (#162): each gates an opt-in
      // service (e.g. a heavy dependency). Coerced narrowly like `auth`; the
      // wizard renders a checkbox per profile and the enabled set is threaded into
      // the compose lifecycle as `COMPOSE_PROFILES`.
      const profiles = coerceManifestProfiles(manifest.profiles);

      // Which compose service is the web/ingress one — the app's bundle manifest
      // declares it as `ingress.service`. Lets the server route to / inject auth
      // env into the right service for a multi-service app whose ingress isn't
      // named after the app id (the default heuristic). Non-empty string only.
      const ingressService =
        typeof manifest.ingress?.service === 'string' && manifest.ingress.service.trim()
          ? manifest.ingress.service.trim()
          : undefined;

      return { ...merged, version, composeOverride, auth, consumes, provides, accepts, multiInstance, security, upgrade, backup, push, profiles, ingressService } satisfies GetCatalogAppVersionDetailResponse;
    } catch (error) {
      this.logger.warn('Failed to read or parse bundle manifest', { version, error: error instanceof Error ? error.message : String(error) });
      // Keep the underlying reason in the message, not just the cause: a missing
      // compose.yaml, malformed manifest.json and a bad env spec are all distinct
      // operator problems that used to collapse into one opaque string.
      const detail = error instanceof Error ? error.message : String(error);
      throw new BundleError('MANIFEST_UNAVAILABLE', `MANIFEST_UNAVAILABLE: ${detail}`, { status: 422, cause: error });
    }
  }

  async refresh(force = false): Promise<Array<{ id: string; name: string; ok: boolean; error?: string }>> {
    const sources = await this.resolveSources();
    const results = await Promise.allSettled(sources.map(s => this.catalogFor(s).refresh(force)));
    return sources.map((s, i) => {
      const r = results[i];
      if (r.status === 'fulfilled') return { id: s.id, name: s.name, ok: true };
      const error = r.reason instanceof Error ? r.reason.message : String(r.reason);
      this.logger.warn('Catalog source refresh failed', { source: s.id, error });
      return { id: s.id, name: s.name, ok: false, error };
    });
  }

  async previewSource(url: string): Promise<PreviewCatalogSourceResponse> {
    // A THROWAWAY fetcher: a preview must not seed (or be served by) the shared
    // per-source cache — the URL isn't a source yet, and a stale hit would report
    // a different catalog than the one about to be added.
    let data: RemoteCatalog;
    try {
      data = await new SourceCatalog(url).ensureLoaded();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new BundleError('CATALOG_UNREACHABLE', `CATALOG_UNREACHABLE: ${url}: ${detail}`, { status: 502 });
    }

    // The fetcher casts the parsed JSON straight to RemoteCatalog without
    // checking it, so a non-catalog URL (an HTML page, someone's repo root)
    // parses "fine" and only fails much later. Preview is the one place that can
    // tell the operator now, while they're still looking at the URL field.
    if (!data || !Array.isArray(data.apps)) {
      throw new BundleError(
        'CATALOG_MALFORMED',
        `CATALOG_MALFORMED: ${url} did not return a catalog.json (no "apps" array).`,
        { status: 422 },
      );
    }

    // Count DISTINCT APPS per registry, not versions: "12 apps" is the number an
    // operator can reason about, where "137 versions" is noise.
    const appsByGlob = new Map<string, Set<string>>();
    let appsWithoutRefs = 0;
    for (const app of data.apps) {
      const refs = (app.versions ?? []).map(v => v.refs?.oci).filter((r): r is string => Boolean(r));
      if (refs.length === 0) { appsWithoutRefs++; continue; }
      for (const ref of refs) {
        const glob = suggestRegistryGlob(ref);
        const seen = appsByGlob.get(glob) ?? new Set<string>();
        seen.add(app.id);
        appsByGlob.set(glob, seen);
      }
    }

    const registries = [...appsByGlob.entries()]
      .map(([glob, apps]) => ({
        glob,
        appCount: apps.size,
        // Report coverage with the same matcher that gates the pull, against a
        // representative ref for the glob — never a second opinion about what the
        // allowlist permits.
        covered: catalogConfig.registryAllowlist.some(p => matchesAllowlist(p, glob.replace(/\*$/, 'probe'))),
      }))
      .sort((a, b) => b.appCount - a.appCount || a.glob.localeCompare(b.glob));

    this.logger.info('Catalog source previewed', { url, appCount: data.apps.length, registries: registries.map(r => r.glob) });
    return { appCount: data.apps.length, registries, appsWithoutRefs };
  }

  private mapApp(app: RemoteCatalog['apps'][number], source: CatalogSourceRecord): CatalogApp {
    return this.mapAppFromVersions(app, source, this.wellFormedVersions(app, source.id));
  }

  /**
   * Same mapping as {@link mapApp}, but takes an already-computed well-formed
   * version list — used where a caller (getApp) needs that list for another
   * purpose too, so `wellFormedVersions` (and its warn logging) runs exactly
   * once per request rather than once per caller.
   */
  private mapAppFromVersions(app: RemoteCatalog['apps'][number], source: CatalogSourceRecord, versions: CatalogVersionEntry[]): CatalogApp {
    // Distinct well-formed channels, `stable` first (when present) then
    // alphabetical — so a client can decide whether to offer a channel choice
    // without a versions drill-down (#428, FR-006).
    const channelSet = new Set(versions.map(v => v.channel));
    const channels = [...channelSet].sort((a, b) => {
      if (a === STABLE_CHANNEL) return -1;
      if (b === STABLE_CHANNEL) return 1;
      return a.localeCompare(b);
    });
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
      source: source.id,
      trust: source.trust as CatalogSourceTrust,
      // Newest STABLE version (#428): a pre-release entry must never become the
      // default anywhere. Absent when the app has no stable version at all — it
      // is still listed, via `channels`, with no version shown (spec US1/US5).
      version: newestEligibleVersion(versions, STABLE_CHANNEL)?.version,
      channels,
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
  // Soft, deliberately: the mock catalog is empty, and callers (the draft
  // service) rely on falling back to generic defaults so test/dev installs work
  // without a real bundle. A hard BundleError here would break that path.
  async getVersionDetail(): Promise<GetCatalogAppVersionDetailResponse> {
    throw new BundleUnavailableError('VERSION_NOT_FOUND', 'VERSION_NOT_FOUND');
  }
  async getVersionDetailByRef(): Promise<GetCatalogAppVersionDetailResponse & { appId: string }> {
    throw new BundleUnavailableError('VERSION_NOT_FOUND', 'VERSION_NOT_FOUND');
  }
  async refresh(): Promise<Array<{ id: string; name: string; ok: boolean; error?: string }>> { return []; }
  async previewSource(): Promise<PreviewCatalogSourceResponse> {
    return { appCount: 0, registries: [], appsWithoutRefs: 0 };
  }
}
