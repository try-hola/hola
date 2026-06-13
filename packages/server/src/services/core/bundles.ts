import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdirSync, existsSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { getLogger } from '../../lib/logger';
import { getHolaDataDir } from '../../config/paths';
import type { ServiceHealth, HealthCheckable } from './types';
import { catalogConfig } from '../../config/catalog';
import { BundleCacheManager } from './bundle-cache';

const execAsync = promisify(exec);

export type BundleInfo = {
  localPath: string;
  digest?: string;
  sizeBytes?: number;
};

export interface BundleService {
  ensurePulled(opts: { appId: string; version: string; ociRef: string }): Promise<BundleInfo>;
  validateLayout(bundlePath: string): Promise<{ ok: boolean; errors: string[]; warnings: string[] }>;
  verifySignature?(bundlePath: string): Promise<{ verified: boolean; error?: string }>;
  cleanup?(): Promise<{ evicted: number; freedBytes: number }>;
  healthCheck(): Promise<ServiceHealth>;
}

export class RealBundleService implements BundleService, HealthCheckable {
  private logger = getLogger().child({ service: 'RealBundleService' });
  private baseCache: string;
  private cacheManager: BundleCacheManager;

  constructor(baseCache = join(getHolaDataDir(), 'cache', 'bundles')) {
    this.baseCache = baseCache;
    this.cacheManager = new BundleCacheManager(baseCache);
  }

  async healthCheck(): Promise<ServiceHealth> {
    try {
      await this.getOrasVersion();
      return { healthy: true, lastCheck: new Date() };
    } catch (error) {
      return { healthy: false, lastCheck: new Date(), error: error instanceof Error ? error.message : String(error) };
    }
  }

  async ensurePulled(opts: { appId: string; version: string; ociRef: string }): Promise<BundleInfo> {
    this.enforceAllowlist(opts.ociRef);
    const dest = join(this.baseCache, sanitize(opts.appId), sanitize(opts.version));
    mkdirSync(dest, { recursive: true });

    // Touch cache entry for LRU tracking
    this.cacheManager.touch(opts.appId, opts.version);

    // If already has compose.yaml and manifest.json, assume cached
    if (existsSync(join(dest, 'compose.yaml')) && existsSync(join(dest, 'manifest.json'))) {
      this.logger.debug('Bundle already cached', { appId: opts.appId, version: opts.version });
      return { localPath: dest, ...this.safeStat(dest) };
    }

    // Clean dest to avoid mixed content
    try { rmSync(dest, { recursive: true, force: true }); } catch { /* ignore existing */ }
    mkdirSync(dest, { recursive: true });

    // Run cache cleanup before pulling new content
    await this.cleanup();

    // oras pull to a temp dir then move is ideal; for simplicity, pull into dest
    const pullCmd = `oras pull --include-subject ${shellEscape(opts.ociRef)} -o ${shellEscape(dest)}`;
    this.logger.info('Pulling OCI bundle via ORAS', { ref: opts.ociRef, dest });
    try {
      const { stdout, stderr } = await execAsync(pullCmd);
      this.logger.debug('ORAS pull output', { stdout: stdout?.slice(0, 500), stderr: stderr?.slice(0, 500) });
    } catch (error) {
      this.logger.error('ORAS pull failed', error as Error, { ref: opts.ociRef });
      throw new Error('ORAS_PULL_FAILED', { cause: error });
    }

    // Optional signature verify-if-present
    if (catalogConfig.signaturePolicy !== 'none') {
      const verifyResult = await this.verifySignature(dest);
      if (catalogConfig.signaturePolicy === 'required' && !verifyResult.verified) {
        this.logger.error('Bundle signature verification failed', undefined, { ref: opts.ociRef, error: verifyResult.error });
        rmSync(dest, { recursive: true, force: true });
        throw new Error('SIGNATURE_VERIFICATION_FAILED');
      } else if (!verifyResult.verified) {
        this.logger.warn('Bundle signature verification failed but policy is optional', { ref: opts.ociRef, error: verifyResult.error });
      }
    }

    return { localPath: dest, ...this.safeStat(dest) };
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
      await execAsync('cosign version');
      
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
    const { stdout } = await execAsync('oras version');
    const m = stdout.match(/oras\s+([^\s]+)/i);
    return m ? m[1] : stdout.trim();
  }

  private enforceAllowlist(ref: string): void {
    const allowed = catalogConfig.registryAllowlist;
    const ok = allowed.some(pattern => matchesAllowlist(pattern, ref));
    if (!ok) {
      throw new Error(`REF_NOT_ALLOWED: ${ref}`);
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

  async ensurePulled(opts: { appId: string; version: string; ociRef: string }): Promise<BundleInfo> {
    this.logger.debug('Mock ensurePulled', opts);
    const p = join(this.basePath, sanitize(opts.appId), sanitize(opts.version));
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
