import React from 'react';
import { api } from '../utils/api-hybrid'; // Use hybrid API
import { globalCache } from '../utils/cache';
import type { 
  GetSettingsResponse,
  PatchSettingsRequest,
  GetBackupSettingsResponse,
  PatchBackupSettingsRequest,
  GetSystemStatusResponse
} from '@hola/shared';

/**
 * Hook for fetching system settings
 * Follows StrictMode-compatible patterns from useWorkingApi.ts
 */
export function useSettingsApi() {
  const [state, setState] = React.useState<{
    data: GetSettingsResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  const cacheKey = 'settings-system';

  const fetchData = React.useCallback(async () => {
    const cached = globalCache.get(cacheKey);
    const now = Date.now();
    
    // Check cache first
    if (cached && (now - cached.timestamp) < 30000) {
      setState({
        data: cached.data as GetSettingsResponse,
        loading: false,
        error: null,
      });
      return;
    }
    
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const response = await fetch(API.settings.base);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch settings: ${response.status} ${response.statusText}`);
      }
      
      const result: GetSettingsResponse = await response.json();
      globalCache.set(cacheKey, { data: result, timestamp: now });
      setState({ data: result, loading: false, error: null });
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, []); // Empty dependency array for basic fetch

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Update settings
  const updateSettings = React.useCallback(async (request: PatchSettingsRequest) => {
    const response = await fetch(API.settings.base, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to update settings: ${response.status} ${response.statusText}`);
    }
    
    // Invalidate cache and refetch
    globalCache.delete(cacheKey);
    await fetchData();
    
    return response.json();
  }, [fetchData]);

  return { 
    ...state, 
    refetch: fetchData,
    updateSettings
  };
}

/**
 * Hook for fetching backup settings
 */
export function useBackupSettingsApi() {
  const [state, setState] = React.useState<{
    data: GetBackupSettingsResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  const cacheKey = 'settings-backup';

  const fetchData = React.useCallback(async () => {
    const cached = globalCache.get(cacheKey);
    const now = Date.now();
    
    // Check cache first
    if (cached && (now - cached.timestamp) < 30000) {
      setState({
        data: cached.data as GetBackupSettingsResponse,
        loading: false,
        error: null,
      });
      return;
    }
    
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const response = await fetch(API.settings.backup);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch backup settings: ${response.status} ${response.statusText}`);
      }
      
      const result: GetBackupSettingsResponse = await response.json();
      globalCache.set(cacheKey, { data: result, timestamp: now });
      setState({ data: result, loading: false, error: null });
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, []); // Empty dependency array for basic fetch

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Update backup settings
  const updateBackupSettings = React.useCallback(async (request: PatchBackupSettingsRequest) => {
    const response = await fetch(API.settings.backup, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to update backup settings: ${response.status} ${response.statusText}`);
    }
    
    // Invalidate cache and refetch
    globalCache.delete(cacheKey);
    await fetchData();
    
    return response.json();
  }, [fetchData]);

  return { 
    ...state, 
    refetch: fetchData,
    updateBackupSettings
  };
}

/**
 * Hook for fetching system status
 */
export function useSystemStatusApi() {
  const [state, setState] = React.useState<{
    data: GetSystemStatusResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  const cacheKey = 'system-status';

  const fetchData = React.useCallback(async () => {
    const cached = globalCache.get(cacheKey);
    const now = Date.now();
    
    // Check cache first
    if (cached && (now - cached.timestamp) < 30000) {
      setState({
        data: cached.data as GetSystemStatusResponse,
        loading: false,
        error: null,
      });
      return;
    }
    
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const response = await fetch(API.system.status);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch system status: ${response.status} ${response.statusText}`);
      }
      
      const result: GetSystemStatusResponse = await response.json();
      globalCache.set(cacheKey, { data: result, timestamp: now });
      setState({ data: result, loading: false, error: null });
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, []); // Empty dependency array for basic fetch

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { 
    ...state, 
    refetch: fetchData
  };
}
