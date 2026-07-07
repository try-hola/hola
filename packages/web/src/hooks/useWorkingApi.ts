import { useQuery } from '@tanstack/react-query';
import { api } from '../utils/api-hybrid'; // Use hybrid API
import { queryKeys } from '../state/queryKeys';
import type { GetSummaryResponse } from '@hola/shared';

// Dashboard summary hook backed by TanStack Query. Freshness comes from the
// query's own staleTime (see state/queryClient.ts) plus targeted invalidation
// of queryKeys.summary driven by useGlobalQueryEvents on deployment/job events.
export function useWorkingApi() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.summary,
    queryFn: () => api.summary() as Promise<GetSummaryResponse>,
  });

  return {
    data: data ?? null,
    loading: isLoading,
    error: error instanceof Error ? error.message : error ? 'Unknown error' : null,
    // Return the refetch promise (matches the detail hooks) so `await refetch()`
    // call sites actually wait for fresh data.
    refetch: () => refetch(),
  };
}
