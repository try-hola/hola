import React from 'react';
import { api } from '../utils/api';
import { globalCache } from '../utils/cache';
import type { GetSummaryResponse } from '@hola/shared';

export const VerySimpleStrictTest: React.FC = () => {
  const [state, setState] = React.useState<{
    data: GetSummaryResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  const fetchData = React.useCallback(async () => {
    console.log('VerySimpleStrictTest: fetchData called');
    
    const cacheKey = 'summary-test';
    const cached = globalCache.get(cacheKey);
    const now = Date.now();
    
    // Check cache (5 second TTL for testing)
    if (cached && (now - cached.timestamp) < 5000) {
      console.log('VerySimpleStrictTest: Using cached data');
      setState({
        data: cached.data as GetSummaryResponse,
        loading: false,
        error: null,
      });
      return;
    }
    
    console.log('VerySimpleStrictTest: Making API call');
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const result = await api.summary() as GetSummaryResponse;
      console.log('VerySimpleStrictTest: API call successful:', result);
      
      // Cache the result
      globalCache.set(cacheKey, { data: result, timestamp: now });
      
      setState({
        data: result,
        loading: false,
        error: null,
      });
    } catch (error) {
      console.log('VerySimpleStrictTest: API call failed:', error);
      setState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, []);

  React.useEffect(() => {
    console.log('VerySimpleStrictTest: useEffect running');
    fetchData();
  }, [fetchData]);

  console.log('VerySimpleStrictTest: Rendering with state:', state);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Very Simple StrictMode Test</h1>
      
      <div className="mb-4 space-y-2">
        <div><strong>Loading:</strong> {state.loading ? 'true' : 'false'}</div>
        <div><strong>Error:</strong> {state.error || 'none'}</div>
        <div><strong>Data:</strong> {state.data ? `${state.data.deploymentsCount} deployments` : 'null'}</div>
      </div>
      
      {state.loading && (
        <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded mb-4">
          Loading API data...
        </div>
      )}
      
      {state.error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          <strong>Error:</strong> {state.error}
        </div>
      )}
      
      {state.data && (
        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
          <strong>Success!</strong> Got {state.data.deploymentsCount} deployments, {state.data.activeJobsCount} active jobs
        </div>
      )}
      
      <button 
        onClick={fetchData}
        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        Refetch Data
      </button>
      
      <div className="mt-4 text-sm text-gray-600">
        <p>This test uses a simple cache with 5-second TTL.</p>
        <p>Check browser console for detailed logs.</p>
      </div>
    </div>
  );
};
