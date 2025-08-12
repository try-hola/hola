import React from 'react';
import { api } from '../utils/api';
import { globalCache } from '../utils/cache';
import { useOptimisticList, useOptimisticEntity } from './useOptimisticUpdates';
import { useAutoRefresh, RefreshConfigs } from './useBackgroundRefresh';
import type { 
  GetDeploymentsResponse,
  DeploymentListItem,
  DeploymentDetail,
  DeploymentStatus,
  PostDeploymentActionRequest
} from '@hola/shared';

/**
 * Enhanced deployments hook with optimistic updates and background refresh
 * Demonstrates Phase 3.1 performance optimizations
 */
export function useEnhancedDeploymentsApi(
  statusFilter: string = '',
  searchQuery: string = '',
  page: number = 1
) {
  const [state, setState] = React.useState<{
    data: GetDeploymentsResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  // Create stable cache key based on parameters
  const cacheKey = React.useMemo(() => {
    const filters = [];
    if (statusFilter) filters.push(`status-${statusFilter}`);
    if (searchQuery) filters.push(`search-${searchQuery}`);
    filters.push(`page-${page}`);
    return `deployments-enhanced-${filters.join('-')}`;
  }, [statusFilter, searchQuery, page]);

  // Set up optimistic updates for deployment list
  const optimisticList = useOptimisticList<DeploymentListItem>();

  // Fetch function for API calls
  const fetchDeployments = React.useCallback(async () => {
    const params = { page, limit: 10 };
    if (statusFilter) Object.assign(params, { status: statusFilter });
    if (searchQuery) Object.assign(params, { q: searchQuery });
    
    return api.deployments.list(params) as Promise<GetDeploymentsResponse>;
  }, [statusFilter, searchQuery, page]);

  // Auto-refresh with background system
  useAutoRefresh(
    `deployments-${cacheKey}`,
    cacheKey,
    fetchDeployments,
    RefreshConfigs.standard.priority,
    RefreshConfigs.standard.interval
  );

  // Load data with enhanced caching
  const loadData = React.useCallback(async () => {
    // Check cache first
    const cached = globalCache.get<GetDeploymentsResponse>(cacheKey);
    if (cached !== null) {
      setState({
        data: cached,
        loading: false,
        error: null,
      });
      return;
    }

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const result = await fetchDeployments();
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
  }, [cacheKey, fetchDeployments]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  // Optimistic deployment action with immediate UI feedback
  const performAction = React.useCallback(
    async (
      deploymentId: string,
      action: 'start' | 'stop' | 'restart' | 'delete'
    ) => {
      if (!state.data) return;

      // Determine optimistic status change
      const getOptimisticStatus = (currentStatus: string, action: string): string => {
        switch (action) {
          case 'start': return 'installing'; // Use 'installing' as transitional state
          case 'stop': return 'stopped';
          case 'restart': return 'updating'; // Use 'updating' as transitional state
          case 'delete': return 'stopped'; // Delete action results in stopped
          default: return currentStatus;
        }
      };

      try {
        // Find current deployment to get its status
        const currentDeployment = state.data.items?.find((d: DeploymentListItem) => d.id === deploymentId);
        const currentStatus = currentDeployment?.status || 'unknown';

        // Apply optimistic update to the deployment list
        await optimisticList.updateItem(
          cacheKey,
          deploymentId,
          { status: getOptimisticStatus(currentStatus, action) as DeploymentStatus },
          async () => {
            const request: PostDeploymentActionRequest = { action };
            await api.deployments.action(deploymentId, request);
            // Return the updated deployment item (this is a simplified example)
            return { ...currentDeployment, status: getOptimisticStatus(currentStatus, action) } as DeploymentListItem;
          }
        );

        // Refresh list after successful action
        await loadData();
      } catch (error) {
        console.error(`Failed to ${action} deployment:`, error);
        throw error;
      }
    },
    [state.data, cacheKey, optimisticList, loadData]
  );

  // Force refresh (bypasses cache)
  const forceRefresh = React.useCallback(async () => {
    // Clear cache and reload
    globalCache.delete(cacheKey);
    await loadData();
  }, [cacheKey, loadData]);

  // Get cache metadata for debugging
  const getCacheInfo = React.useCallback(() => {
    const metadata = globalCache.getMetadata(cacheKey);
    const stats = globalCache.getStats();
    
    return {
      cacheKey,
      metadata,
      stats,
      hasPendingUpdates: optimisticList.hasPendingUpdates(cacheKey),
      pendingCount: optimisticList.pendingCount,
    };
  }, [cacheKey, optimisticList]);

  return {
    ...state,
    performAction,
    refetch: loadData,
    forceRefresh,
    getCacheInfo,
    // Expose optimistic update utilities
    rollbackPendingUpdates: optimisticList.rollbackAll,
    pendingUpdatesCount: optimisticList.pendingCount,
  };
}

/**
 * Enhanced deployment detail hook with optimistic updates
 */
export function useEnhancedDeploymentDetailApi(deploymentId: string) {
  const [state, setState] = React.useState<{
    data: DeploymentDetail | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  const cacheKey = `deployment-detail-${deploymentId}`;
  const optimisticEntity = useOptimisticEntity<DeploymentDetail>();

  // Fetch function
  const fetchDetail = React.useCallback(async () => {
    return api.deployments.byId(deploymentId);
  }, [deploymentId]);

  // Auto-refresh with higher frequency for detail view
  useAutoRefresh(
    `deployment-detail-${deploymentId}`,
    cacheKey,
    fetchDetail,
    RefreshConfigs.frequent.priority,
    RefreshConfigs.frequent.interval
  );

  // Load data
  const loadData = React.useCallback(async () => {
    const cached = globalCache.get<DeploymentDetail>(cacheKey);
    if (cached !== null) {
      setState({
        data: cached,
        loading: false,
        error: null,
      });
      return;
    }

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const result = await fetchDetail() as DeploymentDetail;
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
  }, [cacheKey, fetchDetail]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  // Optimistic configuration update
  const updateConfiguration = React.useCallback(
    async (updates: Partial<DeploymentDetail>) => {
      if (!state.data) return;

      try {
        await optimisticEntity.updateEntity(
          cacheKey,
          updates,
          async () => {
            const result = await api.deployments.update(deploymentId, updates);
            return result as DeploymentDetail;
          }
        );

        // Refresh after successful update
        await loadData();
      } catch (error) {
        console.error('Failed to update deployment configuration:', error);
        throw error;
      }
    },
    [state.data, cacheKey, deploymentId, optimisticEntity, loadData]
  );

  return {
    ...state,
    updateConfiguration,
    refetch: loadData,
    forceRefresh: () => {
      globalCache.delete(cacheKey);
      loadData();
    },
  };
}
