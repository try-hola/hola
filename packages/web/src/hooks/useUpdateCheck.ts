import React from 'react';
import { api } from '../utils/api-hybrid'; // Use hybrid API
import type { UpdateCheckResult } from '@hola/shared';

// Fetches the server's update-check result once on mount. Failures are tolerated
// silently — the banner simply won't show when there's no data.
export function useUpdateCheck() {
  const [state, setState] = React.useState<{
    data: UpdateCheckResult | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  const fetchData = React.useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const result = await api.system.updateCheck() as UpdateCheckResult;
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

  return state;
}
