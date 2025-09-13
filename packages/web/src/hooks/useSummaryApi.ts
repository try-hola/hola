import React from 'react';
import { api } from '../utils/api-hybrid'; // Use hybrid API
import { globalCache } from '../utils/cache';
import type { GetSummaryResponse } from '@hola/shared';

// This hook will be EXACTLY like VerySimpleStrictTest but extracted
export function useSummaryApi() {
  const [state, setState] = React.useState<{
    data: GetSummaryResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  // EXACTLY the same fetchData as VerySimpleStrictTest
  const fetchData = React.useCallback(async () => {
    console.log('useSummaryApi: fetchData called');
    
    const cacheKey = 'summary-test';
    const cached = globalCache.get(cacheKey);
    const now = Date.now();
    
    // Check cache (5 second TTL for testing)
    if (cached && (now - cached.timestamp) < 5000) {
      console.log('useSummaryApi: Using cached data');
      setState({
        data: cached.data as GetSummaryResponse,
        loading: false,
        error: null,
      });
      return;
    }
    
    console.log('useSummaryApi: Making API call');
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const result = await api.summary() as GetSummaryResponse;
      console.log('useSummaryApi: API call successful:', result);
      
      // Cache the result
      globalCache.set(cacheKey, { data: result, timestamp: now });
      
      setState({
        data: result,
        loading: false,
        error: null,
      });
    } catch (error) {
      console.log('useSummaryApi: API call failed:', error);
      setState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, []); // EXACTLY the same empty dependency array

  // EXACTLY the same useEffect
  React.useEffect(() => {
    console.log('useSummaryApi: useEffect running');
    fetchData();
  }, [fetchData]);

  return {
    ...state,
    refetch: fetchData,
  };
}
