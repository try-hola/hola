import React from 'react';
import { api } from '../utils/api-hybrid'; // Use hybrid API
import { globalCache } from '../utils/cache';
import type { GetCatalogAppsRequest, GetCatalogAppsResponse, GetCatalogAppVersionsResponse, GetCatalogAppResponse } from '@hola/shared';

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
    // Only depend on cacheKey, not the `params` object: callers often pass an inline
    // object literal (e.g. `useCatalogAppsApi({ page: 1, limit: 100 })`), whose identity
    // changes every render. Including `params` here would recreate fetchData each render,
    // re-fire the effect, setState, and loop forever — freezing the tab. cacheKey is a
    // stable string derived from the param values, and `params` is read via closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

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

// #428: single catalog app summary, used by DeploymentDetail's Channel select
// (`channels`) — the app's declared channels beyond the running deployment's
// own. Same StrictMode-compatible manual-fetch pattern as the hooks above.
//
// `source` selects which catalog source the app comes from (default `hola`).
// Without it an app installed from a custom source 404s here and the caller
// silently loses its channel list; it's also part of the cache key, since two
// sources can publish the same appId.
export function useCatalogAppApi(appId: string, source?: string) {
  const [state, setState] = React.useState<{
    data: GetCatalogAppResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  const cacheKey = React.useMemo(() => `catalog-app-${source ?? 'hola'}-${appId}`, [appId, source]);

  const fetchData = React.useCallback(async () => {
    if (!appId) return;

    const cached = globalCache.get(cacheKey);
    const now = Date.now();

    // 60 second TTL, same as versions — this is listing metadata, not
    // per-install state.
    if (cached && (now - cached.timestamp) < 60000) {
      setState({ data: cached.data as GetCatalogAppResponse, loading: false, error: null });
      return;
    }

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const result = await api.catalog.appById(appId, source) as GetCatalogAppResponse;
      globalCache.set(cacheKey, { data: result, timestamp: now });
      setState({ data: result, loading: false, error: null });
    } catch (error) {
      // Fail soft: the catalog being unavailable must not break the deployment
      // page — callers fall back to `[current channel]` when `data` is null.
      setState({ data: null, loading: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }, [cacheKey, appId, source]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    ...state,
    refetch: fetchData,
  };
}
