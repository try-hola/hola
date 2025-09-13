import React from 'react';
import { api } from '../utils/api-hybrid';
import type { HealthResponse } from '@hola/shared';

// Simple hook to test health endpoint migration
// This is a test hook to verify SDK adapter integration works
export function useHealthApi() {
  const [state, setState] = React.useState<{
    data: HealthResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  const fetchHealth = React.useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const result = await api.health() as HealthResponse;
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
    fetchHealth();
  }, [fetchHealth]);

  return {
    ...state,
    refetch: fetchHealth,
  };
}