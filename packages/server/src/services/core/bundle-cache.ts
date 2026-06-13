import { existsSync, rmSync, statSync, readdirSync, utimesSync } from 'fs';
import { join } from 'path';
import { getLogger } from '../../lib/logger';
import { getHolaDataDir } from '../../config/paths';
import { catalogConfig } from '../../config/catalog';

export interface CacheEntry {
  appId: string;
  version: string;
  localPath: string;
  lastAccessed: Date;
  sizeBytes: number;
  inUse: boolean;
}

export interface CacheStats {
  totalEntries: number;
  totalSizeBytes: number;
  inUseEntries: number;
  inUseSizeBytes: number;
  oldestEntry?: Date;
  newestEntry?: Date;
}

/**
 * Bundle cache manager with LRU eviction and retention policies
 * 
 * Policies:
 * - Never evict in-use bundles
 * - Keep 2 prior versions per app in addition to current
 * - Enforce 1GB soft cap with LRU eviction for non-protected bundles
 */
export class BundleCacheManager {
  private logger = getLogger().child({ service: 'BundleCacheManager' });
  private inUseBundles = new Set<string>(); // appId:version keys

  constructor(private baseCache = join(getHolaDataDir(), 'cache', 'bundles')) {}

  /**
   * Mark a bundle as in-use (protected from eviction)
   */
  markInUse(appId: string, version: string): void {
    const key = `${appId}:${version}`;
    this.inUseBundles.add(key);
    this.logger.debug('Bundle marked as in-use', { appId, version });
  }

  /**
   * Mark a bundle as no longer in-use
   */
  markNotInUse(appId: string, version: string): void {
    const key = `${appId}:${version}`;
    this.inUseBundles.delete(key);
    this.logger.debug('Bundle marked as not in-use', { appId, version });
  }

  /**
   * Check if a bundle is marked as in-use
   */
  isInUse(appId: string, version: string): boolean {
    const key = `${appId}:${version}`;
    return this.inUseBundles.has(key);
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const entries = this.getAllEntries();
    const inUseEntries = entries.filter(e => e.inUse);
    
    return {
      totalEntries: entries.length,
      totalSizeBytes: entries.reduce((sum, e) => sum + e.sizeBytes, 0),
      inUseEntries: inUseEntries.length,
      inUseSizeBytes: inUseEntries.reduce((sum, e) => sum + e.sizeBytes, 0),
      oldestEntry: entries.length > 0 ? new Date(Math.min(...entries.map(e => e.lastAccessed.getTime()))) : undefined,
      newestEntry: entries.length > 0 ? new Date(Math.max(...entries.map(e => e.lastAccessed.getTime()))) : undefined,
    };
  }

  /**
   * Get all cache entries with metadata
   */
  getAllEntries(): CacheEntry[] {
    if (!existsSync(this.baseCache)) {
      return [];
    }

    const entries: CacheEntry[] = [];
    
    try {
      const appDirs = readdirSync(this.baseCache, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

      for (const appId of appDirs) {
        const appPath = join(this.baseCache, appId);
        try {
          const versionDirs = readdirSync(appPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

          for (const version of versionDirs) {
            const versionPath = join(appPath, version);
            try {
              const stats = statSync(versionPath);
              const sizeBytes = this.getDirSize(versionPath);
              
              entries.push({
                appId,
                version,
                localPath: versionPath,
                lastAccessed: stats.atime,
                sizeBytes,
                inUse: this.isInUse(appId, version),
              });
            } catch (error) {
              this.logger.warn('Failed to stat bundle directory', { appId, version, error: error instanceof Error ? error.message : String(error) });
            }
          }
        } catch (error) {
          this.logger.warn('Failed to read app directory', { appId, error: error instanceof Error ? error.message : String(error) });
        }
      }
    } catch (error) {
      this.logger.warn('Failed to read cache directory', { error: error instanceof Error ? error.message : String(error) });
    }

    return entries;
  }

  /**
   * Apply retention policy: keep in-use + N prior versions per app
   */
  applyRetentionPolicy(): { evicted: number; freedBytes: number } {
    const entries = this.getAllEntries();
    const retainCount = catalogConfig.retainPriorVersions;
    let evicted = 0;
    let freedBytes = 0;

    // Group by app
    const byApp = entries.reduce((acc, entry) => {
      if (!acc[entry.appId]) acc[entry.appId] = [];
      acc[entry.appId].push(entry);
      return acc;
    }, {} as Record<string, CacheEntry[]>);

    for (const [appId, appEntries] of Object.entries(byApp)) {
      // Sort by last accessed (newest first)
      const sorted = appEntries.sort((a, b) => b.lastAccessed.getTime() - a.lastAccessed.getTime());
      
      // Keep in-use bundles + N most recent non-in-use
      const toKeep = new Set<string>();
      let keptNonInUse = 0;

      for (const entry of sorted) {
        if (entry.inUse) {
          toKeep.add(entry.version);
        } else if (keptNonInUse < retainCount) {
          toKeep.add(entry.version);
          keptNonInUse++;
        }
      }

      // Evict the rest
      for (const entry of sorted) {
        if (!toKeep.has(entry.version)) {
          try {
            rmSync(entry.localPath, { recursive: true, force: true });
            evicted++;
            freedBytes += entry.sizeBytes;
            this.logger.info('Evicted bundle by retention policy', { appId, version: entry.version, sizeBytes: entry.sizeBytes });
          } catch (error) {
            this.logger.warn('Failed to evict bundle', { appId, version: entry.version, error: error instanceof Error ? error.message : String(error) });
          }
        }
      }
    }

    return { evicted, freedBytes };
  }

  /**
   * Apply cache size policy: LRU eviction for non-protected bundles
   */
  applySizePolicy(): { evicted: number; freedBytes: number } {
    const entries = this.getAllEntries();
    const stats = this.getStats();
    let evicted = 0;
    let freedBytes = 0;

    if (stats.totalSizeBytes <= catalogConfig.cacheSoftCapBytes) {
      return { evicted, freedBytes };
    }

    this.logger.info('Cache size exceeds soft cap, applying LRU eviction', {
      currentSize: stats.totalSizeBytes,
      softCap: catalogConfig.cacheSoftCapBytes,
      excess: stats.totalSizeBytes - catalogConfig.cacheSoftCapBytes,
    });

    // Get eviction candidates (non-in-use bundles)
    const candidates = entries
      .filter(e => !e.inUse)
      .sort((a, b) => a.lastAccessed.getTime() - b.lastAccessed.getTime()); // Oldest first

    let currentSize = stats.totalSizeBytes;
    
    for (const entry of candidates) {
      if (currentSize <= catalogConfig.cacheSoftCapBytes) {
        break;
      }

      try {
        rmSync(entry.localPath, { recursive: true, force: true });
        evicted++;
        freedBytes += entry.sizeBytes;
        currentSize -= entry.sizeBytes;
        this.logger.info('Evicted bundle by size policy', { 
          appId: entry.appId, 
          version: entry.version, 
          sizeBytes: entry.sizeBytes,
          remainingSize: currentSize,
        });
      } catch (error) {
        this.logger.warn('Failed to evict bundle', { 
          appId: entry.appId, 
          version: entry.version, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    }

    return { evicted, freedBytes };
  }

  /**
   * Run full cache cleanup (retention + size policies)
   */
  cleanup(): { retention: { evicted: number; freedBytes: number }; size: { evicted: number; freedBytes: number } } {
    this.logger.info('Starting cache cleanup');
    
    const retention = this.applyRetentionPolicy();
    const size = this.applySizePolicy();
    
    this.logger.info('Cache cleanup completed', {
      retention,
      size,
      totalEvicted: retention.evicted + size.evicted,
      totalFreed: retention.freedBytes + size.freedBytes,
    });

    return { retention, size };
  }

  /**
   * Get directory size recursively
   */
  private getDirSize(dirPath: string): number {
    if (!existsSync(dirPath)) return 0;

    let size = 0;
    try {
      const items = readdirSync(dirPath, { withFileTypes: true });
      for (const item of items) {
        const itemPath = join(dirPath, item.name);
        if (item.isDirectory()) {
          size += this.getDirSize(itemPath);
        } else {
          try {
            const stats = statSync(itemPath);
            size += stats.size;
          } catch {
            // Skip files that can't be statted
          }
        }
      }
    } catch {
      // Skip directories that can't be read
    }
    
    return size;
  }

  /**
   * Touch a bundle to update its last accessed time
   */
  touch(appId: string, version: string): void {
    const bundlePath = join(this.baseCache, this.sanitize(appId), this.sanitize(version));
    if (existsSync(bundlePath)) {
      try {
        const now = new Date();
        // Touch a marker file to update access time
        const markerPath = join(bundlePath, '.accessed');
        try {
          utimesSync(markerPath, now, now);
        } catch {
          // If marker doesn't exist, touch the directory itself
          utimesSync(bundlePath, now, now);
        }
      } catch (error) {
        this.logger.debug('Failed to touch bundle', { appId, version, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  private sanitize(s: string): string {
    return s.replace(/[^a-zA-Z0-9._-]/g, '_');
  }
}

// Global cache manager instance
let globalCacheManager: BundleCacheManager | undefined;

export function getBundleCacheManager(baseCache?: string): BundleCacheManager {
  if (baseCache) {
    return new BundleCacheManager(baseCache);
  }
  if (!globalCacheManager) {
    globalCacheManager = new BundleCacheManager();
  }
  return globalCacheManager;
}
