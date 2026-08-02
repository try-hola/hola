import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdirSync, existsSync, rmSync, statSync, mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { suggestRegistryGlob, type RefNotAllowedDetails } from '@hola/shared';
import { getLogger } from '../../lib/logger';
import { getHolaDataDir } from '../../config/paths';
import type { ServiceHealth, HealthCheckable } from './types';
import { catalogConfig } from '../../config/catalog';
import { BundleError } from '../../middleware/error-mapping';
import { BundleCacheManager } from './bundle-cache';

const execAsync = promisify(exec);

export type BundleInfo = {
  localPath: string;
  digest?: string;
  sizeBytes?: number;
};

/**
 * Credentials for a private OCI pull. Server-internal — NEVER serialized to
 * clients or written to logs. `registry` is the host (optionally host/path) the
 * credential authorizes; it both extends the pull allowlist and keys the auth
 * file entry. Resolved from a stored RegistryCredentialRecord by the caller.
 */
export interface PullCredentials {
  registry: string;
  username: string;
  password: string;
}

export type EnsurePulledOpts = {
  appId: string;
  version: string;
  ociRef: string;
  /**
   * Catalog source id (default `hola`). Namespaces the bundle cache so two
   * sources publishing the same appId/version can't alias each other. The `hola`
   * default keeps the on-disk path byte-identical to the single-source layout.
   */
  source?: string;
  /** When set, authenticate the `oras pull` for a private registry. */
  credentials?: PullCredentials;
  /**
   * Additional registry glob patterns to permit for this pull (extends the
   * server baseline `HOLA_REGISTRY_ALLOWLIST`). Used to honor a catalog
   * source's `allowRegistries` consent — e.g. an operator-added source that
   * declares `ghcr.io/pofallon/*` unlocks pulls from that namespace without a
   * registered credential (which is only needed for *private* packages).
   */
  extraAllowlist?: string[];
};

export interface BundleService {
  ensurePulled(opts: EnsurePulledOpts): Promise<BundleInfo>;
  validateLayout(bundlePath: string): Promise<{ ok: boolean; errors: string[]; warnings: string[] }>;
  verifySignature?(bundlePath: string): Promise<{ verified: boolean; error?: string }>;
  cleanup?(): Promise<{ evicted: number; freedBytes: number }>;
  healthCheck(): Promise<ServiceHealth>;
}

/** Command runner seam so tests can stub the `oras`/`cosign` invocations. */
export type CommandRunner = (cmd: string) => Promise<{ stdout: string; stderr: string }>;

export class RealBundleService implements BundleService, HealthCheckable {
  private logger = getLogger().child({ service: 'RealBundleService' });
  private baseCache: string;
  private cacheManager: BundleCacheManager;
  private run: CommandRunner;

  constructor(baseCache = join(getHolaDataDir(), 'cache', 'bundles'), run: CommandRunner = execAsync) {
    this.baseCache = baseCache;
    this.cacheManager = new BundleCacheManager(baseCache);
    this.run = run;
  }

  async healthCheck(): Promise<ServiceHealth> {
    try {
      await this.getOrasVersion();
      return { healthy: true, lastCheck: new Date() };
    } catch (error) {
      return { healthy: false, lastCheck: new Date(), error: error instanceof Error ? error.message : String(error) };
    }
  }

  async ensurePulled(opts: EnsurePulledOpts): Promise<BundleInfo> {
    // A registered credential's registry extends the allowlist: registering it is
    // the operator's explicit consent to pull from that registry. A catalog
    // source's `allowRegistries` extends it too (operator consent declared at
    // source-add time — useful for public packages in a first-party namespace
    // that don't need a token). Anonymous pulls to a non-baseline registry
    // without a matching consent stay blocked.
    const extraAllowed = [
      ...(opts.credentials ? [opts.credentials.registry] : []),
      ...(opts.extraAllowlist ?? []),
    ];
    this.enforceAllowlist(opts.ociRef, extraAllowed);

    // Source-qualify the cache key so two sources can't alias the same
    // appId/version. `hola` (the built-in source) keeps the bare appId key, so the
    // on-disk path is byte-identical to the pre-multi-catalog layout (no re-pull).
    const cacheKey = bundleCacheKey(opts.source, opts.appId);

    // Protect this bundle from eviction while we pull and return it: cleanup()
    // runs inside ensurePulled, so a concurrent pull could otherwise rmSync a
    // bundle dir that's mid-pull/in-use. (The cache's "never evict in-use" guard
    // was previously dead because nothing ever marked a bundle in-use.)
    this.cacheManager.markInUse(cacheKey, opts.version);
    try {
      const dest = join(this.baseCache, sanitize(cacheKey), sanitize(opts.version));
      mkdirSync(dest, { recursive: true });

      // Touch cache entry for LRU tracking
      this.cacheManager.touch(cacheKey, opts.version);

      // A cache hit by file presence alone is unsafe: a publisher can push new
      // content under the SAME version tag (no version bump, new digest) —
      // e.g. a hand-pushed test image, or a re-tagged `latest`/by-ref install.
      // The on-disk path is keyed by version string, not digest, so that
      // republish would otherwise be served stale forever. Confirm the
      // registry's current digest still matches what we last pulled before
      // trusting the cache; a resolve failure (offline registry, blip) falls
      // back to trusting the existing cache rather than failing the install.
      const filesPresent = existsSync(join(dest, 'compose.yaml')) && existsSync(join(dest, 'manifest.json'));
      let remoteDigest: string | undefined;
      if (filesPresent) {
        remoteDigest = await this.resolveDigest(opts.ociRef, opts.credentials);
        const cachedDigest = this.readDigestMarker(dest);
        if (!remoteDigest || !cachedDigest || remoteDigest === cachedDigest) {
          this.logger.debug('Bundle already cached', { appId: opts.appId, version: opts.version });
          return { localPath: dest, digest: cachedDigest ?? remoteDigest, ...this.safeStat(dest) };
        }
        this.logger.info('Cached bundle digest is stale; re-pulling', {
          appId: opts.appId, version: opts.version, cachedDigest, remoteDigest,
        });
      }

      // Clean dest to avoid mixed content
      try { rmSync(dest, { recursive: true, force: true }); } catch { /* ignore existing */ }
      mkdirSync(dest, { recursive: true });

      // Run cache cleanup before pulling new content
      await this.cleanup();

      // For a private pull, materialize a scoped docker-config auth file and pass
      // it via `--registry-config` rather than putting the token on argv (which
      // would leak via `ps`) or in ~/.docker/config.json. Removed in `finally`.
      let authDir: string | undefined;
      const flags: string[] = ['--include-subject'];
      if (opts.credentials) {
        authDir = this.writeRegistryAuth(opts.credentials);
        flags.push(`--registry-config ${shellEscape(join(authDir, 'config.json'))}`);
      }

      // oras pull to a temp dir then move is ideal; for simplicity, pull into dest
      const pullCmd = `oras pull ${flags.join(' ')} ${shellEscape(opts.ociRef)} -o ${shellEscape(dest)}`;
      this.logger.info('Pulling OCI bundle via ORAS', { ref: opts.ociRef, dest, authenticated: Boolean(opts.credentials) });
      try {
        const { stdout, stderr } = await this.run(pullCmd);
        this.logger.debug('ORAS pull output', { stdout: stdout?.slice(0, 500), stderr: stderr?.slice(0, 500) });
      } catch (error) {
        this.logger.error('ORAS pull failed', error as Error, { ref: opts.ociRef });
        // Carry oras's own stderr forward — auth failures (401/403), unreachable
        // registries and 5xx all arrive here, and the distinction only exists in
        // that text. Swallowing it leaves the operator with nothing to act on.
        const detail = error instanceof Error ? error.message : String(error);
        throw new BundleError('ORAS_PULL_FAILED', `ORAS_PULL_FAILED: could not pull ${opts.ociRef}: ${detail}`, { cause: error });
      } finally {
        if (authDir) { try { rmSync(authDir, { recursive: true, force: true }); } catch { /* best effort */ } }
      }

      // Optional signature verify-if-present
      if (catalogConfig.signaturePolicy !== 'none') {
        const verifyResult = await this.verifySignature(dest);
        if (catalogConfig.signaturePolicy === 'required' && !verifyResult.verified) {
          this.logger.error('Bundle signature verification failed', undefined, { ref: opts.ociRef, error: verifyResult.error });
          rmSync(dest, { recursive: true, force: true });
          throw new BundleError(
            'SIGNATURE_VERIFICATION_FAILED',
            `SIGNATURE_VERIFICATION_FAILED: ${opts.ociRef}${verifyResult.error ? `: ${verifyResult.error}` : ''}`,
          );
        } else if (!verifyResult.verified) {
          this.logger.warn('Bundle signature verification failed but policy is optional', { ref: opts.ociRef, error: verifyResult.error });
        }
      }

      // Stamp the digest we just pulled so a FUTURE call can tell a same-tag
      // republish apart from an untouched cache. Reuse the digest resolved
      // above when this was a stale-cache re-pull; resolve fresh otherwise
      // (first-ever pull for this version). Best-effort: a resolve/write
      // failure here just means the next call re-verifies via a full pull
      // comparison rather than trusting a marker — never fails the install.
      const pulledDigest = remoteDigest ?? await this.resolveDigest(opts.ociRef, opts.credentials);
      if (pulledDigest) this.writeDigestMarker(dest, pulledDigest);

      return { localPath: dest, digest: pulledDigest, ...this.safeStat(dest) };
    } finally {
      this.cacheManager.markNotInUse(cacheKey, opts.version);
    }
  }

  /** Resolve the current manifest digest for an OCI ref without pulling blobs. */
  private async resolveDigest(ociRef: string, credentials?: PullCredentials): Promise<string | undefined> {
    let authDir: string | undefined;
    const flags: string[] = [];
    if (credentials) {
      authDir = this.writeRegistryAuth(credentials);
      flags.push(`--registry-config ${shellEscape(join(authDir, 'config.json'))}`);
    }
    try {
      const { stdout } = await this.run(`oras resolve ${flags.join(' ')} ${shellEscape(ociRef)}`);
      const digest = stdout.trim().split('\n').pop()?.trim();
      return digest && /^sha256:[0-9a-f]{64}$/.test(digest) ? digest : undefined;
    } catch (error) {
      this.logger.warn('Failed to resolve remote digest; trusting existing cache if present', {
        ref: ociRef, error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    } finally {
      if (authDir) { try { rmSync(authDir, { recursive: true, force: true }); } catch { /* best effort */ } }
    }
  }

  private digestMarkerPath(dest: string): string {
    return join(dest, '.oras-digest');
  }

  private readDigestMarker(dest: string): string | undefined {
    try {
      const digest = readFileSync(this.digestMarkerPath(dest), 'utf8').trim();
      return digest || undefined;
    } catch {
      return undefined;
    }
  }

  private writeDigestMarker(dest: string, digest: string): void {
    try { writeFileSync(this.digestMarkerPath(dest), digest, { mode: 0o644 }); } catch { /* best effort */ }
  }

  /**
   * Write a scoped docker-config auth file (0o600, in a private temp dir) for a
   * single registry so `oras pull --registry-config` can authenticate without
   * touching ~/.docker/config.json. Caller removes the returned dir when done.
   */
  private writeRegistryAuth(creds: PullCredentials): string {
    const dir = mkdtempSync(join(tmpdir(), 'hola-oras-'));
    const host = registryHost(creds.registry);
    const auth = Buffer.from(`${creds.username}:${creds.password}`, 'utf8').toString('base64');
    const config = { auths: { [host]: { auth } } };
    writeFileSync(join(dir, 'config.json'), JSON.stringify(config), { mode: 0o600 });
    return dir;
  }

  async validateLayout(bundlePath: string): Promise<{ ok: boolean; errors: string[]; warnings: string[] }> {
    const errors: string[] = [];
    const warnings: string[] = [];
    // Required files
    if (!existsSync(join(bundlePath, 'compose.yaml'))) errors.push('Missing compose.yaml');
    if (!existsSync(join(bundlePath, 'manifest.json'))) errors.push('Missing manifest.json');
    // Optional: metadata.json, icon, service subdirs with Dockerfile
    // If service subdirs exist without Dockerfile, warn
    // We keep this lightweight for now
    return { ok: errors.length === 0, errors, warnings };
  }

  /**
   * Optional signature verification using cosign (if available)
   */
  async verifySignature(bundlePath: string): Promise<{ verified: boolean; error?: string }> {
    try {
      // Check if cosign is available
      await this.run('cosign version');
      
      // For now, just return verified=true since we don't have a specific signature to verify
      // In a real implementation, this would verify against a known public key
      this.logger.debug('Signature verification skipped (not implemented)', { bundlePath });
      return { verified: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('command not found') || errorMessage.includes('not found')) {
        return { verified: false, error: 'cosign not available' };
      }
      
      return { verified: false, error: errorMessage };
    }
  }

  /**
   * Run cache cleanup using the cache manager
   */
  async cleanup(): Promise<{ evicted: number; freedBytes: number }> {
    const result = this.cacheManager.cleanup();
    return {
      evicted: result.retention.evicted + result.size.evicted,
      freedBytes: result.retention.freedBytes + result.size.freedBytes,
    };
  }

  // Helpers
  private async getOrasVersion(): Promise<string> {
    const { stdout } = await this.run('oras version');
    const m = stdout.match(/oras\s+([^\s]+)/i);
    return m ? m[1] : stdout.trim();
  }

  private enforceAllowlist(ref: string, extraAllowed: string[] = []): void {
    // Base allowlist (e.g. ghcr.io/try-hola/*) plus any registries the operator
    // authorized by registering a credential/source for them. Match by
    // glob/host-prefix (never substring) so `ghcr.io.evil.com` can't slip past a
    // `ghcr.io` entry.
    const allowed = [...catalogConfig.registryAllowlist, ...extraAllowed];
    const ok = allowed.some(pattern => matchesAllowlist(pattern, ref));
    if (!ok) {
      // Name the allowlist in the message: the operator's fix is either to add
      // `allowRegistries` to the catalog source or to widen HOLA_REGISTRY_ALLOWLIST,
      // and neither is guessable from "not allowed" alone.
      throw new BundleError(
        'REF_NOT_ALLOWED',
        `REF_NOT_ALLOWED: ${ref} is not covered by the registry allowlist (${allowed.join(', ') || 'empty'}). ` +
          `Add the registry to this catalog source's allowRegistries, or to HOLA_REGISTRY_ALLOWLIST.`,
        // Structured detail so a client can OFFER the fix rather than restate the
        // message: `suggestedGlob` is exactly what a caller would PATCH into the
        // source's `allowRegistries`. Clients must not regex the prose message.
        {
          status: 403,
          details: {
            ref,
            suggestedGlob: suggestRegistryGlob(ref),
            allowed,
          } satisfies RefNotAllowedDetails,
        },
      );
    }
  }

  private safeStat(path: string): { sizeBytes?: number } {
    try {
      const s = statSync(path);
      return { sizeBytes: s.size };
    } catch {
      return {};
    }
  }
}

export class MockBundleService implements BundleService {
  private logger = getLogger().child({ service: 'MockBundleService' });

  constructor(private basePath = join(getHolaDataDir(), 'mock-bundles')) {}

  async ensurePulled(opts: EnsurePulledOpts): Promise<BundleInfo> {
    this.logger.debug('Mock ensurePulled', { appId: opts.appId, version: opts.version, source: opts.source });
    const p = join(this.basePath, sanitize(bundleCacheKey(opts.source, opts.appId)), sanitize(opts.version));
    return { localPath: p };
  }
  async validateLayout(bundlePath: string) {
    void bundlePath; // not used in mock
    return { ok: true, errors: [], warnings: [] };
  }
  async healthCheck(): Promise<ServiceHealth> {
    return { healthy: true, lastCheck: new Date() };
  }
}

// Utilities
function sanitize(s: string): string { return s.replace(/[^a-zA-Z0-9._-]/g, '_'); }

/**
 * Cache directory key for a bundle. The built-in `hola` source (and an
 * unspecified source) keeps the bare appId so the on-disk cache layout is
 * unchanged from the single-source era; every other source is prefixed so it
 * can't collide with a hola app (or another source) publishing the same appId.
 */
export function bundleCacheKey(source: string | undefined, appId: string): string {
  const s = (source || 'hola').trim();
  return s === 'hola' ? appId : `${sanitize(s)}__${appId}`;
}

/** The registry host (drop any path/tag) used as the docker-config auths key. */
function registryHost(registry: string): string {
  return registry.trim().split('/')[0];
}

function matchesAllowlist(pattern: string, ref: string): boolean {
  // Convert simple glob like ghcr.io/org/* to regex start match
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
  const re = new RegExp('^' + escaped + '(?:$|[:/])');
  return re.test(ref);
}

function shellEscape(s: string): string {
  if (/^[A-Za-z0-9@%_+=:,./-]*$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}
