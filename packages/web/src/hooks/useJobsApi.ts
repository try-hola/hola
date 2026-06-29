import React from 'react';
import { api } from '../utils/api-hybrid'; // Use hybrid API
import { globalCache } from '../utils/cache';
import type { GetJobsResponse, JobStatus } from '@hola/shared';

interface UseJobsApiParams {
  deploymentId?: string;
  status?: JobStatus;
  page?: number;
  limit?: number;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

// StrictMode-compatible API hook for jobs data
export function useJobsApi(params: UseJobsApiParams = {}) {
  const {
    deploymentId,
    status,
    page = 1,
    limit = 20,
    autoRefresh = true,
    refreshInterval = 5000, // 5 seconds for live updates
  } = params;

  const [state, setState] = React.useState<{
    data: GetJobsResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  // Create stable cache key based on parameters
  const cacheKey = React.useMemo(() => {
    const key = `jobs-${JSON.stringify({ deploymentId, status, page, limit })}`;
    return key;
  }, [deploymentId, status, page, limit]);

  // Fetch data with caching and error handling. `force` bypasses the cache read
  // so a manual refresh (and the live poll) always re-fetches instead of
  // re-serving a recently-cached list — otherwise the refresh button looks dead.
  const fetchData = React.useCallback(async (force = false) => {
    const cached = globalCache.get(cacheKey);
    const now = Date.now();

    // Check cache (2 second TTL for live updates) unless forced
    if (!force && cached && (now - cached.timestamp) < 2000) {
      setState({
        data: cached.data as GetJobsResponse,
        loading: false,
        error: null,
      });
      return;
    }
    
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const requestParams: { page: number; limit: number; deploymentId?: string; status?: JobStatus } = { page, limit };
      if (deploymentId) requestParams.deploymentId = deploymentId;
      if (status) requestParams.status = status;
      
      const result = await api.jobs.list(requestParams) as GetJobsResponse;
      
      // Cache the result
      globalCache.set(cacheKey, { data: result, timestamp: now });
      
      setState({
        data: result,
        loading: false,
        error: null,
      });
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, [cacheKey, page, limit, deploymentId, status]); // Include primitive params

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh for live updates — force past the short cache so each tick
  // reflects status transitions rather than re-serving the cached page.
  React.useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => { void fetchData(true); }, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchData, autoRefresh, refreshInterval]);

  return {
    ...state,
    // Manual refresh always bypasses the cache.
    refetch: () => fetchData(true),
  };
}

// Simplified hook for getting jobs for a specific deployment
export function useDeploymentJobs(deploymentId: string, options: Partial<UseJobsApiParams> = {}) {
  return useJobsApi({
    ...options,
    deploymentId,
  });
}

// Simplified hook for getting active jobs across all deployments
export function useActiveJobs(options: Partial<UseJobsApiParams> = {}) {
  return useJobsApi({
    ...options,
    status: 'running',
  });
}
