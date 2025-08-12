import React from 'react';
import { API } from '@hola/shared';
import { globalCache } from '../utils/cache';
import type { 
  GetBackupsResponse,
  BackupStatus,
  CreateBackupRequest,
  RestoreBackupRequest
} from '@hola/shared';

/**
 * Hook for fetching backups with filtering and pagination
 * Follows StrictMode-compatible patterns with parameterized requests
 */
export function useBackupsApi(
  statusFilter: BackupStatus | 'all' = 'all',
  appFilter: string = '',
  page: number = 1
) {
  const [state, setState] = React.useState<{
    data: GetBackupsResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  // Use useMemo for stable cache key based on params
  const cacheKey = React.useMemo(() => {
    const filters = [];
    if (statusFilter !== 'all') filters.push(`status-${statusFilter}`);
    if (appFilter) filters.push(`app-${appFilter}`);
    filters.push(`page-${page}`);
    return `backups-${filters.join('-')}`;
  }, [statusFilter, appFilter, page]);

  const fetchData = React.useCallback(async () => {
    const cached = globalCache.get(cacheKey);
    const now = Date.now();
    
    // Check cache first
    if (cached && (now - cached.timestamp) < 30000) {
      setState({
        data: cached.data as GetBackupsResponse,
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
      
      if (statusFilter && statusFilter !== 'all') {
        params.append('status', statusFilter);
      }
      
      if (appFilter) {
        params.append('appId', appFilter);
      }

      const response = await fetch(`${API.backups.base}?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch backups: ${response.status} ${response.statusText}`);
      }
      
      const result: GetBackupsResponse = await response.json();
      globalCache.set(cacheKey, { data: result, timestamp: now });
      setState({ data: result, loading: false, error: null });
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, [cacheKey, statusFilter, appFilter, page]); // Include params to refetch when they change

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Create backup
  const createBackup = React.useCallback(async (appId?: string) => {
    const request: CreateBackupRequest = { appId };
    const response = await fetch(API.backups.base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to create backup: ${response.status} ${response.statusText}`);
    }
    
    // Invalidate backup caches and refetch
    for (const key of globalCache.keys()) {
      if (key.startsWith('backups-')) {
        globalCache.delete(key);
      }
    }
    await fetchData();
    
    return response.json();
  }, [fetchData]);

  // Restore backup
  const restoreBackup = React.useCallback(async (backupId: string, targetDeploymentId?: string) => {
    const request: RestoreBackupRequest = { targetDeploymentId };
    const response = await fetch(API.backups.restore(backupId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to restore backup: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
  }, []);

  // Delete backup
  const deleteBackup = React.useCallback(async (backupId: string) => {
    const response = await fetch(API.backups.byId(backupId), {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error(`Failed to delete backup: ${response.status} ${response.statusText}`);
    }
    
    // Invalidate backup caches and refetch
    for (const key of globalCache.keys()) {
      if (key.startsWith('backups-')) {
        globalCache.delete(key);
      }
    }
    await fetchData();
    
    return response.json();
  }, [fetchData]);

  // Download backup
  const downloadBackup = React.useCallback(async (backupId: string) => {
    const response = await fetch(API.backups.byId(backupId));
    
    if (!response.ok) {
      throw new Error(`Failed to download backup: ${response.status} ${response.statusText}`);
    }
    
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup-${backupId}.tar.gz`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, []);

  return { 
    ...state, 
    refetch: fetchData,
    createBackup,
    restoreBackup,
    deleteBackup,
    downloadBackup
  };
}
