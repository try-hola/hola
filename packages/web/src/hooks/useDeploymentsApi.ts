import { useQuery } from '@tanstack/react-query';
import { api } from '../utils/api-hybrid'; // Use hybrid API
import { queryKeys } from '../state/queryKeys';
import type { GetDeploymentsRequest, GetDeploymentsResponse } from '@hola/shared';

export function useDeploymentsApi(params: GetDeploymentsRequest) {
  const query = useQuery({
    queryKey: queryKeys.deployments.list(params),
    queryFn: () => api.deployments.list(params) as Promise<GetDeploymentsResponse>,
    // Live freshness comes from SSE invalidation (state/useGlobalQueryEvents.ts);
    // this is just the fallback poll while a deployment is mid-transition.
    refetchInterval: (query) => {
      const data = query.state.data as GetDeploymentsResponse | undefined;
      const hasTransitional = data?.items?.some(
        d => d.status === 'installing' || d.status === 'updating'
      ) ?? false;
      return hasTransitional ? 4000 : false;
    },
  });

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error ? (query.error instanceof Error ? query.error.message : String(query.error)) : null,
    // Return the refetch promise (matches the detail hooks) so `await refetch()`
    // call sites (e.g. Deployments' check-for-updates / post-action refresh)
    // actually wait for the fresh list before advancing their own UI state.
    refetch: () => query.refetch(),
  };
}
