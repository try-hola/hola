import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../utils/api-hybrid'; // Use hybrid API
import { queryKeys } from '../state/queryKeys';
import type {
  GetDeploymentResponse,
  GetDeploymentHistoryResponse,
  GetDeploymentConfigResponse,
  PatchDeploymentRequest,
  PostDeploymentActionRequest
} from '@hola/shared';

/**
 * Hook for fetching deployment detail data, backed by TanStack Query.
 * See specs/001-web-state-freshness/contracts/hooks.md.
 */
export function useDeploymentDetailApi(deploymentId: string | undefined) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.deployments.detail(deploymentId ?? ''),
    queryFn: () => api.deployments.byId(deploymentId!) as Promise<GetDeploymentResponse>,
    enabled: !!deploymentId,
    // Fallback poll (T028): while a deployment is mid-transition
    // (installing/updating), poll so the status converges to its terminal state
    // even if the SSE stream isn't driving convergence.
    refetchInterval: (q) => {
      const status = (q.state.data as GetDeploymentResponse | undefined)?.status;
      return status === 'installing' || status === 'updating' ? 4000 : false;
    },
  });

  // Update configuration
  const updateConfigMutation = useMutation({
    mutationFn: (request: PatchDeploymentRequest) => api.deployments.update(deploymentId!, request),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.deployments.detail(deploymentId!) });
      qc.invalidateQueries({ queryKey: queryKeys.deployments.config(deploymentId!) });
      qc.invalidateQueries({ queryKey: queryKeys.deployments.all });
      qc.invalidateQueries({ queryKey: queryKeys.summary });
    },
  });
  const updateConfiguration = (request: PatchDeploymentRequest) => updateConfigMutation.mutateAsync(request);

  // Execute a lifecycle action (start/stop/restart). NOT delete — removal is a
  // full teardown via the DELETE endpoint (see removeDeployment), not a lifecycle
  // action, otherwise the Traefik route stays held and blocks reinstall.
  const executeActionMutation = useMutation({
    mutationFn: (action: 'start' | 'stop' | 'restart') => {
      const request: PostDeploymentActionRequest = { action };
      return api.deployments.action(deploymentId!, request);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.deployments.detail(deploymentId!) });
      qc.invalidateQueries({ queryKey: queryKeys.deployments.all });
      qc.invalidateQueries({ queryKey: queryKeys.jobs.all });
      qc.invalidateQueries({ queryKey: queryKeys.summary });
    },
  });
  const executeAction = (action: 'start' | 'stop' | 'restart') => executeActionMutation.mutateAsync(action);

  // Upgrade to a newer catalog version (#284 Phase 2) via POST
  // /api/deployments/:id/promote. The server carries env/secrets forward and runs
  // the upgrade skip-guard + pre-upgrade snapshot before switching the release.
  const upgradeDeploymentMutation = useMutation({
    mutationFn: (body?: { version?: string; snapshot?: boolean }) => api.deployments.promote(deploymentId!, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.deployments.detail(deploymentId!) });
      qc.invalidateQueries({ queryKey: queryKeys.deployments.all });
      qc.invalidateQueries({ queryKey: queryKeys.jobs.all });
      qc.invalidateQueries({ queryKey: queryKeys.summary });
    },
  });
  const upgradeDeployment = (body?: { version?: string; snapshot?: boolean }) =>
    upgradeDeploymentMutation.mutateAsync(body);

  // Remove the deployment entirely (stop + deprovision auth + release route +
  // delete record + clean storage) via DELETE /api/deployments/:id. The caller
  // navigates away on success since the deployment no longer exists.
  const removeDeploymentMutation = useMutation({
    mutationFn: () => api.deployments.remove(deploymentId!),
    onSuccess: () => {
      qc.removeQueries({ queryKey: queryKeys.deployments.detail(deploymentId!), exact: true });
      qc.invalidateQueries({ queryKey: queryKeys.deployments.all });
      qc.invalidateQueries({ queryKey: queryKeys.summary });
    },
  });
  const removeDeployment = () => removeDeploymentMutation.mutateAsync();

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error ? (query.error instanceof Error ? query.error.message : 'Unknown error') : null,
    refetch: () => query.refetch(),
    updateConfiguration,
    executeAction,
    upgradeDeployment,
    removeDeployment,
  };
}

/**
 * Hook for fetching deployment history with pagination, backed by TanStack Query.
 */
export function useDeploymentHistoryApi(deploymentId: string | undefined, page: number = 1) {
  const query = useQuery({
    queryKey: queryKeys.deployments.history(deploymentId ?? '', page),
    queryFn: () => api.deployments.history(deploymentId!, { page, limit: 10 }) as Promise<GetDeploymentHistoryResponse>,
    enabled: !!deploymentId,
  });

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error ? (query.error instanceof Error ? query.error.message : 'Unknown error') : null,
    refetch: () => query.refetch(),
  };
}

/**
 * Hook for the active release's full config (typed `appEnv` rows + system
 * overrides), backing the DeploymentDetail Configuration tab. Mirrors
 * `useDeploymentDetailApi`'s data/loading/error shape.
 */
export function useDeploymentConfigApi(deploymentId: string | undefined) {
  const query = useQuery({
    queryKey: queryKeys.deployments.config(deploymentId ?? ''),
    queryFn: () => api.deployments.config(deploymentId!) as Promise<GetDeploymentConfigResponse>,
    enabled: !!deploymentId,
  });

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error ? (query.error instanceof Error ? query.error.message : 'Unknown error') : null,
    // `force` accepted for backward compatibility with call sites (e.g.
    // DeploymentDetail's post-save `refetchConfig(true)`); TanStack's refetch
    // always bypasses staleTime and goes to the network, so the boolean is a
    // no-op that satisfies the old "force" semantics. The refetch promise is
    // returned so `await refetchConfig(true)` waits for the fresh config.
    refetch: (force?: boolean) => { void force; return query.refetch(); },
  };
}
