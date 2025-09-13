import React from 'react';
import { api } from '../utils/api-hybrid'; // Use hybrid API
import { globalCache } from '../utils/cache';
import type { GetSummaryResponse } from '@hola/shared';

// StrictMode-compatible API hook for dashboard data with enhanced caching
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

  // Fetch data with enhanced caching and error handling
  const fetchData = React.useCallback(async () => {
    const cacheKey = 'dashboard-summary';
    const cached = globalCache.get<GetSummaryResponse>(cacheKey);
    
    // Check cache first
    if (cached !== null) {
      setState({
        data: cached,
        loading: false,
        error: null,
      });
      return;
    }
    
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const result = await api.summary() as GetSummaryResponse;
      
      // Cache is handled automatically by the enhanced API client
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
