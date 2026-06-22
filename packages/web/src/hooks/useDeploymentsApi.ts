import React from 'react';
import { api } from '../utils/api-hybrid'; // Use hybrid API
import { globalCache } from '../utils/cache';
import type { GetDeploymentsRequest, GetDeploymentsResponse } from '@hola/shared';

// Working StrictMode-compatible hook for deployments using the same pattern as useWorkingApi
export function useDeploymentsApi(params: GetDeploymentsRequest) {
  const [state, setState] = React.useState<{
    data: GetDeploymentsResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  // Create a stable cache key based on the parameters
  const cacheKey = React.useMemo(() => {
    return `deployments-${JSON.stringify(params)}`;
  }, [params]);

  // StrictMode-compatible fetchData pattern. `force` bypasses the cache read so
  // polling reflects status changes instead of re-serving stale cached rows.
  const fetchData = React.useCallback(async (force = false) => {
    const cached = globalCache.get(cacheKey);
    const now = Date.now();

    // Check cache (30 second TTL for deployments) unless forced
    if (!force && cached && (now - cached.timestamp) < 30000) {
      setState({
        data: cached.data as GetDeploymentsResponse,
        loading: false,
        error: null,
      });
      return;
    }

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      // Use the current params directly from closure
      const result = await api.deployments.list(params) as GetDeploymentsResponse;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]); // Only include cacheKey to avoid infinite loops, params is accessed via closure

  // EXACTLY the same useEffect pattern
  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  // While any deployment is mid-transition (installing/updating), poll so the
  // list reflects the terminal state without a manual reload.
  const hasTransitional = state.data?.items?.some(
    d => d.status === 'installing' || d.status === 'updating'
  ) ?? false;
  React.useEffect(() => {
    if (!hasTransitional) return;
    const interval = setInterval(() => { void fetchData(true); }, 4000);
    return () => clearInterval(interval);
  }, [hasTransitional, fetchData]);

  return {
    ...state,
    refetch: fetchData,
  };
}
