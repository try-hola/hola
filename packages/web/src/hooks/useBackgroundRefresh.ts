import React from 'react';
import { globalCache } from '../utils/cache';

/**
 * Configuration for background refresh behavior
 */
export interface BackgroundRefreshConfig {
  // Base interval in milliseconds
  interval: number;
  // Whether to pause when page is not visible
  pauseWhenHidden: boolean;
  // Whether to pause when network is offline
  pauseWhenOffline: boolean;
  // Exponential backoff multiplier on errors
  backoffMultiplier: number;
  // Maximum interval after backoff
  maxInterval: number;
  // Enable refresh priority system
  enablePriority: boolean;
}

/**
 * Priority levels for background refresh
 */
export type RefreshPriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * Background refresh job definition
 */
export interface RefreshJob {
  id: string;
  cacheKey: string;
  refreshFn: () => Promise<unknown>;
  priority: RefreshPriority;
  interval: number;
  lastRefresh: number;
  errorCount: number;
  enabled: boolean;
}

/**
 * Hook for managing background data refresh with smart policies
 */
export function useBackgroundRefresh(config: Partial<BackgroundRefreshConfig> = {}) {
  const fullConfig: BackgroundRefreshConfig = React.useMemo(() => ({
    interval: 30000, // 30 seconds default
    pauseWhenHidden: true,
    pauseWhenOffline: true,
    backoffMultiplier: 2,
    maxInterval: 300000, // 5 minutes max
    enablePriority: true,
    ...config,
  }), [config]);

  const [jobs, setJobs] = React.useState<Map<string, RefreshJob>>(new Map());
  const [isRunning, setIsRunning] = React.useState(false);
  const [isVisible, setIsVisible] = React.useState(!document.hidden);
  const [isOnline, setIsOnline] = React.useState(navigator.onLine);
  
  // Track page visibility
  React.useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Track network status
  React.useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Determine if background refresh should be active
  const shouldRefresh = React.useMemo(() => {
    if (!isRunning) return false;
    if (fullConfig.pauseWhenHidden && !isVisible) return false;
    if (fullConfig.pauseWhenOffline && !isOnline) return false;
    return true;
  }, [isRunning, isVisible, isOnline, fullConfig.pauseWhenHidden, fullConfig.pauseWhenOffline]);

  // Priority order for refresh jobs
  const priorityOrder: RefreshPriority[] = React.useMemo(
    () => ['critical', 'high', 'medium', 'low'],
    []
  );

  // Get jobs sorted by priority and last refresh time
  const getSortedJobs = React.useCallback(() => {
    const jobList = Array.from(jobs.values()).filter(job => job.enabled);
    
    if (!fullConfig.enablePriority) {
      return jobList.sort((a, b) => a.lastRefresh - b.lastRefresh);
    }

    return jobList.sort((a, b) => {
      // First sort by priority
      const aPriorityIndex = priorityOrder.indexOf(a.priority);
      const bPriorityIndex = priorityOrder.indexOf(b.priority);
      
      if (aPriorityIndex !== bPriorityIndex) {
        return aPriorityIndex - bPriorityIndex;
      }
      
      // Then by staleness (how long since last refresh)
      return a.lastRefresh - b.lastRefresh;
    });
  }, [jobs, fullConfig.enablePriority, priorityOrder]);

  // Calculate interval with exponential backoff
  const getEffectiveInterval = React.useCallback((job: RefreshJob) => {
    if (job.errorCount === 0) return job.interval;
    
    const backoffInterval = job.interval * Math.pow(fullConfig.backoffMultiplier, job.errorCount);
    return Math.min(backoffInterval, fullConfig.maxInterval);
  }, [fullConfig.backoffMultiplier, fullConfig.maxInterval]);

  // Execute a refresh job
  const executeJob = React.useCallback(async (job: RefreshJob) => {
    try {
      const data = await job.refreshFn();
      
      // Update cache with fresh data
      globalCache.set(job.cacheKey, data);
      
      // Reset error count and update last refresh time
      setJobs(prev => {
        const next = new Map(prev);
        const updatedJob = { ...job, lastRefresh: Date.now(), errorCount: 0 };
        next.set(job.id, updatedJob);
        return next;
      });
      
      return true;
    } catch (error) {
      console.warn(`Background refresh failed for ${job.id}:`, error);
      
      // Increment error count for backoff
      setJobs(prev => {
        const next = new Map(prev);
        const updatedJob = { ...job, errorCount: job.errorCount + 1 };
        next.set(job.id, updatedJob);
        return next;
      });
      
      return false;
    }
  }, []);

  // Background refresh loop
  React.useEffect(() => {
    if (!shouldRefresh) return;

    const refreshInterval = setInterval(() => {
      const sortedJobs = getSortedJobs();
      const now = Date.now();
      
      for (const job of sortedJobs) {
        const effectiveInterval = getEffectiveInterval(job);
        const timeSinceLastRefresh = now - job.lastRefresh;
        
        if (timeSinceLastRefresh >= effectiveInterval) {
          executeJob(job);
          break; // Only execute one job per interval to avoid overwhelming
        }
      }
    }, Math.min(fullConfig.interval / 4, 5000)); // Check more frequently than the base interval

    return () => clearInterval(refreshInterval);
  }, [shouldRefresh, getSortedJobs, getEffectiveInterval, executeJob, fullConfig.interval]);

  // Register a background refresh job
  const registerJob = React.useCallback((
    id: string,
    cacheKey: string,
    refreshFn: () => Promise<unknown>,
    priority: RefreshPriority = 'medium',
    customInterval?: number
  ) => {
    const job: RefreshJob = {
      id,
      cacheKey,
      refreshFn,
      priority,
      interval: customInterval || fullConfig.interval,
      lastRefresh: 0,
      errorCount: 0,
      enabled: true,
    };

    setJobs(prev => new Map(prev.set(id, job)));
    
    return () => {
      setJobs(prev => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    };
  }, [fullConfig.interval]);

  // Unregister a job
  const unregisterJob = React.useCallback((id: string) => {
    setJobs(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Enable/disable a job
  const toggleJob = React.useCallback((id: string, enabled: boolean) => {
    setJobs(prev => {
      const job = prev.get(id);
      if (!job) return prev;
      
      const next = new Map(prev);
      next.set(id, { ...job, enabled });
      return next;
    });
  }, []);

  // Manually trigger a job
  const triggerJob = React.useCallback(async (id: string) => {
    const job = jobs.get(id);
    if (!job) return false;
    
    return executeJob(job);
  }, [jobs, executeJob]);

  // Trigger refresh for all jobs of a specific priority
  const triggerByPriority = React.useCallback(async (priority: RefreshPriority) => {
    const jobsToRefresh = Array.from(jobs.values())
      .filter(job => job.priority === priority && job.enabled);
    
    const results = await Promise.allSettled(
      jobsToRefresh.map(job => executeJob(job))
    );
    
    return results.every(result => result.status === 'fulfilled' && result.value);
  }, [jobs, executeJob]);

  // Start background refresh system
  const start = React.useCallback(() => {
    setIsRunning(true);
  }, []);

  // Stop background refresh system
  const stop = React.useCallback(() => {
    setIsRunning(false);
  }, []);

  // Get status information
  const getStatus = React.useCallback(() => {
    const jobList = Array.from(jobs.values());
    const enabledJobs = jobList.filter(job => job.enabled);
    const jobsWithErrors = jobList.filter(job => job.errorCount > 0);
    
    return {
      isRunning,
      isVisible,
      isOnline,
      shouldRefresh,
      totalJobs: jobList.length,
      enabledJobs: enabledJobs.length,
      jobsWithErrors: jobsWithErrors.length,
      nextRefreshTime: Math.min(
        ...enabledJobs.map(job => {
          const effectiveInterval = getEffectiveInterval(job);
          return job.lastRefresh + effectiveInterval;
        })
      ),
    };
  }, [jobs, isRunning, isVisible, isOnline, shouldRefresh, getEffectiveInterval]);

  return {
    registerJob,
    unregisterJob,
    toggleJob,
    triggerJob,
    triggerByPriority,
    start,
    stop,
    getStatus,
    jobs: Array.from(jobs.values()),
  };
}

/**
 * Hook for auto-registering a background refresh job
 */
export function useAutoRefresh(
  id: string,
  cacheKey: string,
  refreshFn: () => Promise<unknown>,
  priority: RefreshPriority = 'medium',
  interval?: number
) {
  const { registerJob } = useBackgroundRefresh();
  
  React.useEffect(() => {
    const unregister = registerJob(id, cacheKey, refreshFn, priority, interval);
    return unregister;
  }, [id, cacheKey, refreshFn, priority, interval, registerJob]);
}

/**
 * Common refresh configurations
 */
export const RefreshConfigs = {
  // Critical system data
  critical: {
    interval: 5000,   // 5 seconds
    priority: 'critical' as RefreshPriority,
  },
  
  // Frequently changing data
  frequent: {
    interval: 15000,  // 15 seconds  
    priority: 'high' as RefreshPriority,
  },
  
  // Standard data
  standard: {
    interval: 30000,  // 30 seconds
    priority: 'medium' as RefreshPriority,
  },
  
  // Slowly changing data
  infrequent: {
    interval: 120000, // 2 minutes
    priority: 'low' as RefreshPriority,
  },
} as const;
