// Advanced caching system with TTL, LRU eviction, and cache statistics

export interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
  ttl: number;
  accessCount: number;
  lastAccessed: number;
}

export interface CacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: string;
}

export interface CacheConfig {
  maxSize: number;
  defaultTTL: number;
  enableStats: boolean;
}

export class AdvancedCache {
  private cache = new Map<string, CacheEntry>();
  private config: CacheConfig;
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      maxSize: 100,
      defaultTTL: 30000, // 30 seconds
      enableStats: true,
      ...config,
    };
  }

  // Get data from cache with TTL and LRU update
  get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    
    if (!entry) {
      if (this.config.enableStats) this.stats.misses++;
      return null;
    }

    const now = Date.now();
    
    // Check if entry has expired
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      if (this.config.enableStats) this.stats.misses++;
      return null;
    }

    // Update LRU data
    entry.accessCount++;
    entry.lastAccessed = now;
    
    if (this.config.enableStats) this.stats.hits++;
    return entry.data;
  }

  // Set data in cache with optional TTL
  set<T>(key: string, data: T, ttl?: number): void {
    const now = Date.now();
    const entry: CacheEntry<T> = {
      data,
      timestamp: now,
      ttl: ttl ?? this.config.defaultTTL,
      accessCount: 1,
      lastAccessed: now,
    };

    // Check if we need to evict before adding
    if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    this.cache.set(key, entry);
  }

  // Delete specific key
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  // Clear all cache entries
  clear(): void {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }

  // Delete entries by key pattern
  deleteByPattern(pattern: string | RegExp): number {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    let deletedCount = 0;
    
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        deletedCount++;
      }
    }
    
    return deletedCount;
  }

  // Evict least recently used entry
  private evictLRU(): void {
    let lruKey: string | null = null;
    let lruTime = Date.now();
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < lruTime) {
        lruTime = entry.lastAccessed;
        lruKey = key;
      }
    }
    
    if (lruKey) {
      this.cache.delete(lruKey);
      if (this.config.enableStats) this.stats.evictions++;
    }
  }

  // Get cache statistics
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(2) + '%' : '0%';
    
    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      hitRate,
    };
  }

  // Cache warming - preload data
  async warmCache<T>(
    key: string, 
    dataLoader: () => Promise<T>, 
    ttl?: number
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }
    
    const data = await dataLoader();
    this.set(key, data, ttl);
    return data;
  }

  // Get all keys matching a pattern
  getKeysByPattern(pattern: string | RegExp): string[] {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    return Array.from(this.cache.keys()).filter(key => regex.test(key));
  }

  // Get cache entry metadata (for debugging)
  getMetadata(key: string): Omit<CacheEntry, 'data'> | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    return {
      timestamp: entry.timestamp,
      ttl: entry.ttl,
      accessCount: entry.accessCount,
      lastAccessed: entry.lastAccessed,
    };
  }
}

// TTL configurations for different data types
export const CacheTTL = {
  // Fast-changing data
  dashboard: 5000,        // 5 seconds
  system_status: 10000,   // 10 seconds
  job_status: 3000,       // 3 seconds
  
  // Medium-changing data
  deployments: 30000,     // 30 seconds
  notifications: 30000,   // 30 seconds
  
  // Slow-changing data  
  catalog: 300000,        // 5 minutes
  settings: 60000,        // 1 minute
  backups: 60000,         // 1 minute
  
  // Static-like data
  user_info: 600000,      // 10 minutes
  system_info: 600000,    // 10 minutes
} as const;

// Global cache instance with advanced features
export const globalCache = new AdvancedCache({
  maxSize: 150,
  defaultTTL: CacheTTL.deployments,
  enableStats: true,
});

// Convenience function for backward compatibility
export const legacyGlobalCache = {
  get: (key: string) => {
    const result = globalCache.get(key);
    return result ? { data: result, timestamp: Date.now() } : undefined;
  },
  set: (key: string, value: { data: unknown; timestamp: number }) => {
    globalCache.set(key, value.data);
  },
  delete: (key: string) => globalCache.delete(key),
  clear: () => globalCache.clear(),
};
