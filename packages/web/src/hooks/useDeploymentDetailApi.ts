import React from 'react';
import { api } from '../utils/api-hybrid'; // Use hybrid API
import { globalCache } from '../utils/cache';
import type {
  GetDeploymentResponse,
  GetDeploymentHistoryResponse,
  GetDeploymentConfigResponse,
  PatchDeploymentRequest,
  PostDeploymentActionRequest
} from '@hola/shared';

/**
 * Hook for fetching deployment detail data
 * Follows StrictMode-compatible patterns from useWorkingApi.ts
 */
export function useDeploymentDetailApi(deploymentId: string | undefined) {
  const [state, setState] = React.useState<{
    data: GetDeploymentResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  // Use useMemo for stable cache key based on deploymentId
  const cacheKey = React.useMemo(() => {
    if (!deploymentId) return null;
    return `deployment-detail-${deploymentId}`;
  }, [deploymentId]);

  // `force` bypasses the 30s cache read — required for polling, since a status
  // mid-transition (installing/updating) would otherwise be served stale for up
  // to 30s and never appear to progress.
  const fetchData = React.useCallback(async (force = false) => {
    if (!deploymentId || !cacheKey) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    const now = Date.now();
    const cached = globalCache.get(cacheKey);

    // Check cache first (unless forced)
    if (!force && cached && (now - cached.timestamp) < 30000) {
      setState({
        data: cached.data as GetDeploymentResponse,
        loading: false,
        error: null,
      });
      return;
    }

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const result = await api.deployments.byId(deploymentId) as GetDeploymentResponse;
      globalCache.set(cacheKey, { data: result, timestamp: now });
      setState({ data: result, loading: false, error: null });
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, [cacheKey, deploymentId]); // Include params to refetch when they change

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh while a deployment is mid-transition so the status badge moves
  // from "Installing"/"Updating" to its terminal state without a manual reload
  // (the deploy lifecycle runs asynchronously server-side).
  const status = state.data?.status;
  const isTransitional = status === 'installing' || status === 'updating';
  React.useEffect(() => {
    if (!isTransitional) return;
    const interval = setInterval(() => { void fetchData(true); }, 4000);
    return () => clearInterval(interval);
  }, [isTransitional, fetchData]);

  // Update configuration
  const updateConfiguration = React.useCallback(async (request: PatchDeploymentRequest) => {
    if (!deploymentId || !cacheKey) throw new Error('No deployment ID');
    
    const result = await api.deployments.update(deploymentId, request);
    
    // Invalidate cache and refetch
    globalCache.delete(cacheKey);
    await fetchData();
    
    return result;
  }, [deploymentId, cacheKey, fetchData]);

  // Execute a lifecycle action (start/stop/restart). NOT delete — removal is a
  // full teardown via the DELETE endpoint (see removeDeployment), not a lifecycle
  // action, otherwise the Traefik route stays held and blocks reinstall.
  const executeAction = React.useCallback(async (action: 'start' | 'stop' | 'restart') => {
    if (!deploymentId || !cacheKey) throw new Error('No deployment ID');

    const request: PostDeploymentActionRequest = { action };
    const result = await api.deployments.action(deploymentId, request);

    // Invalidate cache and refetch
    globalCache.delete(cacheKey);
    await fetchData();

    return result;
  }, [deploymentId, cacheKey, fetchData]);

  // Upgrade to a newer catalog version (#284 Phase 2) via POST
  // /api/deployments/:id/promote. The server carries env/secrets forward and runs
  // the upgrade skip-guard + pre-upgrade snapshot before switching the release.
  const upgradeDeployment = React.useCallback(async (body?: { version?: string; snapshot?: boolean }) => {
    if (!deploymentId || !cacheKey) throw new Error('No deployment ID');

    const result = await api.deployments.promote(deploymentId, body);
    globalCache.delete(cacheKey);
    await fetchData();
    return result;
  }, [deploymentId, cacheKey, fetchData]);

  // Remove the deployment entirely (stop + deprovision auth + release route +
  // delete record + clean storage) via DELETE /api/deployments/:id. The caller
  // navigates away on success since the deployment no longer exists.
  const removeDeployment = React.useCallback(async () => {
    if (!deploymentId || !cacheKey) throw new Error('No deployment ID');

    await api.deployments.remove(deploymentId);
    globalCache.delete(cacheKey);
  }, [deploymentId, cacheKey]);

  return {
    ...state,
    refetch: fetchData,
    updateConfiguration,
    executeAction,
    upgradeDeployment,
    removeDeployment
  };
}

/**
 * Hook for fetching deployment history with pagination
 * Follows parameterized API hook patterns from useDeploymentsApi.ts
 */
export function useDeploymentHistoryApi(deploymentId: string | undefined, page: number = 1) {
  const [state, setState] = React.useState<{
    data: GetDeploymentHistoryResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  // Use useMemo for stable cache key based on params
  const cacheKey = React.useMemo(() => {
    if (!deploymentId) return null;
    return `deployment-history-${deploymentId}-page-${page}`;
  }, [deploymentId, page]);

  const fetchData = React.useCallback(async () => {
    if (!deploymentId || !cacheKey) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    const cached = globalCache.get(cacheKey);
    const now = Date.now();
    
    // Check cache first
    if (cached && (now - cached.timestamp) < 30000) {
      setState({
        data: cached.data as GetDeploymentHistoryResponse,
        loading: false,
        error: null,
      });
      return;
    }
    
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const result = await api.deployments.history(deploymentId, { page, limit: 10 }) as GetDeploymentHistoryResponse;
      globalCache.set(cacheKey, { data: result, timestamp: now });
      setState({ data: result, loading: false, error: null });
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, [cacheKey, deploymentId, page]); // Include params to refetch when they change

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    ...state,
    refetch: fetchData
  };
}

/**
 * Hook for the active release's full config (typed `appEnv` rows + system
 * overrides), backing the DeploymentDetail Configuration tab. Mirrors
 * `useDeploymentDetailApi`'s cache/loading/error shape.
 */
export function useDeploymentConfigApi(deploymentId: string | undefined) {
  const [state, setState] = React.useState<{
    data: GetDeploymentConfigResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  const cacheKey = React.useMemo(() => {
    if (!deploymentId) return null;
    return `deployment-config-${deploymentId}`;
  }, [deploymentId]);

  const fetchData = React.useCallback(async (force = false) => {
    if (!deploymentId || !cacheKey) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    const now = Date.now();
    const cached = globalCache.get(cacheKey);
    if (!force && cached && (now - cached.timestamp) < 30000) {
      setState({ data: cached.data as GetDeploymentConfigResponse, loading: false, error: null });
      return;
    }

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const result = await api.deployments.config(deploymentId) as GetDeploymentConfigResponse;
      globalCache.set(cacheKey, { data: result, timestamp: now });
      setState({ data: result, loading: false, error: null });
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, [cacheKey, deploymentId]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    ...state,
    refetch: fetchData
  };
}
