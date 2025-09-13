import React from 'react';
import { api } from '../utils/api-hybrid'; // Use hybrid API
import { globalCache } from '../utils/cache';
import type { GetCatalogAppsRequest, GetCatalogAppsResponse, GetCatalogAppVersionsResponse } from '@hola/shared';

// StrictMode-compatible hook for catalog apps using the same proven pattern
export function useCatalogAppsApi(params: GetCatalogAppsRequest) {
  const [state, setState] = React.useState<{
    data: GetCatalogAppsResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  // Create a stable cache key based on the parameters
  const cacheKey = React.useMemo(() => {
    return `catalog-apps-${JSON.stringify(params)}`;
  }, [params]);

  // EXACTLY the same fetchData pattern that works for deployments
  const fetchData = React.useCallback(async () => {
    const cached = globalCache.get(cacheKey);
    const now = Date.now();
    
    // Check cache (30 second TTL for catalog)
    if (cached && (now - cached.timestamp) < 30000) {
      setState({
        data: cached.data as GetCatalogAppsResponse,
        loading: false,
        error: null,
      });
      return;
    }
    
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const result = await api.catalog.apps(params) as GetCatalogAppsResponse;
      
      // Cache the result
      globalCache.set(cacheKey, { data: result, timestamp: now });
      
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
  }, [cacheKey, params]); // Include params in dependency to refetch when they change

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    ...state,
    refetch: fetchData,
  };
}

// StrictMode-compatible hook for app versions
export function useCatalogAppVersionsApi(appId: string) {
  const [state, setState] = React.useState<{
    data: GetCatalogAppVersionsResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  // Create cache key for app versions
  const cacheKey = React.useMemo(() => {
    return `catalog-versions-${appId}`;
  }, [appId]);

  const fetchData = React.useCallback(async () => {
    if (!appId) return;
    
    const cached = globalCache.get(cacheKey);
    const now = Date.now();
    
    // Check cache (60 second TTL for versions)
    if (cached && (now - cached.timestamp) < 60000) {
      setState({
        data: cached.data as GetCatalogAppVersionsResponse,
        loading: false,
        error: null,
      });
      return;
    }
    
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const result = await api.catalog.versions(appId) as GetCatalogAppVersionsResponse;
      
      // Cache the result
      globalCache.set(cacheKey, { data: result, timestamp: now });
      
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
  }, [cacheKey, appId]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    ...state,
    refetch: fetchData,
  };
}
