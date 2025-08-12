import React from 'react';
import { API } from '@hola/shared';
import { globalCache } from '../utils/cache';
import type { 
  GetDeploymentResponse, 
  GetDeploymentHistoryResponse,
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
        data: cached.data as GetDeploymentResponse,
        loading: false,
        error: null,
      });
      return;
    }
    
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const response = await fetch(API.deployments.byId(deploymentId));
      
      if (!response.ok) {
        throw new Error(`Failed to fetch deployment: ${response.status} ${response.statusText}`);
      }
      
      const result: GetDeploymentResponse = await response.json();
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

  // Update configuration
  const updateConfiguration = React.useCallback(async (request: PatchDeploymentRequest) => {
    if (!deploymentId || !cacheKey) throw new Error('No deployment ID');
    
    const response = await fetch(API.deployments.byId(deploymentId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to update deployment: ${response.status} ${response.statusText}`);
    }
    
    // Invalidate cache and refetch
    globalCache.delete(cacheKey);
    await fetchData();
    
    return response.json();
  }, [deploymentId, cacheKey, fetchData]);

  // Execute action
  const executeAction = React.useCallback(async (action: 'start' | 'stop' | 'restart' | 'delete') => {
    if (!deploymentId || !cacheKey) throw new Error('No deployment ID');
    
    const request: PostDeploymentActionRequest = { action };
    const response = await fetch(API.deployments.actions(deploymentId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to ${action} deployment: ${response.status} ${response.statusText}`);
    }
    
    // Invalidate cache and refetch
    globalCache.delete(cacheKey);
    await fetchData();
    
    return response.json();
  }, [deploymentId, cacheKey, fetchData]);

  return { 
    ...state, 
    refetch: fetchData,
    updateConfiguration,
    executeAction
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
      const params = new URLSearchParams({ 
        page: page.toString(), 
        limit: '10' 
      });
      
      const response = await fetch(`${API.deployments.history(deploymentId)}?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch deployment history: ${response.status} ${response.statusText}`);
      }
      
      const result: GetDeploymentHistoryResponse = await response.json();
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
