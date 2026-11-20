import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import type {
  GetTailscaleIngressResponse,
  SetTailscaleIngressRequest,
  SetTailscaleIngressResponse,
  DisableTailscaleIngressResponse,
} from '@hola/shared';

import { api } from '../utils/api-hybrid';
import { queryKeys } from '../state/queryKeys';

/**
 * Opt-in private Tailscale ingress for one deployment (spec 010): the setting,
 * live status and operator guidance, plus enable/replace and disable.
 *
 * The joining credential only ever travels in the `set` mutation's request; no
 * response contains it, and nothing here stores it. The mutation's variables
 * are dropped on settle (`reset`) so TanStack Query does not keep them in its
 * mutation cache longer than the request.
 */
export function useTailscaleIngressApi(deploymentId: string | undefined) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.deployments.tailscaleIngress(deploymentId ?? ''),
    queryFn: () => api.deployments.tailscaleIngress.get(deploymentId!) as Promise<GetTailscaleIngressResponse>,
    enabled: !!deploymentId,
    // Status is observed live (the operator is usually waiting on an approval
    // in another tab), so keep it fresh while the page is open.
    refetchInterval: 30_000,
    // gcTime 0 on the mutation side is set below; the read carries no secret.
    retry: false,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: queryKeys.deployments.tailscaleIngress(deploymentId!) });
    qc.invalidateQueries({ queryKey: queryKeys.deployments.detail(deploymentId!) });
    qc.invalidateQueries({ queryKey: queryKeys.deployments.all });
    qc.invalidateQueries({ queryKey: queryKeys.jobs.all });
  };

  const setMutation = useMutation({
    mutationFn: (body: SetTailscaleIngressRequest) =>
      api.deployments.tailscaleIngress.set(deploymentId!, body) as Promise<SetTailscaleIngressResponse>,
    gcTime: 0,
    onSuccess: invalidate,
  });

  const disableMutation = useMutation({
    mutationFn: () =>
      api.deployments.tailscaleIngress.disable(deploymentId!) as Promise<DisableTailscaleIngressResponse>,
    gcTime: 0,
    onSuccess: invalidate,
  });

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error ? (query.error instanceof Error ? query.error.message : 'Failed to load private ingress') : null,
    refetch: () => query.refetch(),
    setIngress: (body: SetTailscaleIngressRequest) => setMutation.mutateAsync(body),
    disableIngress: () => disableMutation.mutateAsync(),
    saving: setMutation.isPending,
    disabling: disableMutation.isPending,
    /** Drop the last mutation's variables (and so any credential) from memory. */
    resetSet: () => setMutation.reset(),
  };
}
