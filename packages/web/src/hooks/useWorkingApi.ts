import React from 'react';
import { api } from '../utils/api';
import { globalCache } from '../utils/cache';
import type { GetSummaryResponse } from '@hola/shared';

// StrictMode-compatible API hook for dashboard data
export function useWorkingApi() {
  const [state, setState] = React.useState<{
    data: GetSummaryResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  // Fetch data with caching and error handling
  const fetchData = React.useCallback(async () => {
    const cacheKey = 'dashboard-summary';
    const cached = globalCache.get(cacheKey);
    const now = Date.now();
    
    // Check cache (5 second TTL)
    if (cached && (now - cached.timestamp) < 5000) {
      setState({
        data: cached.data as GetSummaryResponse,
        loading: false,
        error: null,
      });
      return;
    }
    
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const result = await api.summary() as GetSummaryResponse;
      
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
  }, []); // Empty dependency array for StrictMode compatibility

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    ...state,
    refetch: fetchData,
  };
}
