import { useQuery } from '@tanstack/react-query';
import { api } from '../utils/api-hybrid'; // Use hybrid API
import { queryKeys } from '../state/queryKeys';
import type { GetJobsResponse, JobStatus } from '@hola/shared';

interface UseJobsApiParams {
  deploymentId?: string;
  status?: JobStatus;
  page?: number;
  limit?: number;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

// TanStack Query-backed hook for jobs data (#291 / T024).
export function useJobsApi(params: UseJobsApiParams = {}) {
  const {
    deploymentId,
    status,
    page = 1,
    limit = 20,
    autoRefresh = true,
    refreshInterval = 5000, // 5 seconds for live updates
  } = params;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.jobs.list({ deploymentId, status, page, limit }),
    queryFn: () =>
      api.jobs.list({
        page,
        limit,
        ...(deploymentId && { deploymentId }),
        ...(status && { status }),
      }) as Promise<GetJobsResponse>,
    // Live updates (#291) invalidate this query from the global event stream, so
    // that's the primary freshness driver. The poll is a bounded fallback that
    // only runs while there's actually an active job to converge (contracts/
    // hooks.md: "while autoRefresh and active jobs exist") — mirroring how the
    // deployment hooks gate on transitional status, rather than polling at rest.
    refetchInterval: (query) => {
      if (!autoRefresh) return false;
      const current = query.state.data as GetJobsResponse | undefined;
      const hasActive = current?.items?.some(
        j => j.status === 'queued' || j.status === 'running'
      ) ?? false;
      return hasActive ? refreshInterval : false;
    },
  });

  return {
    data: data ?? null,
    loading: isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    // Return the refetch promise (matches the detail hooks) so `await refetch()`
    // call sites actually wait for fresh data before proceeding.
    refetch: () => refetch(),
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
