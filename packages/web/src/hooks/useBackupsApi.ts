import React from 'react';
import { API } from '@hola/shared';
import { globalCache } from '../utils/cache';
import { safeFetchEnhanced } from '../utils/error-enhanced';
import type {
  GetBackupsResponse,
  BackupStatus
} from '@hola/shared';

/**
 * Hook for fetching backups with filtering and pagination
 * Follows StrictMode-compatible patterns with parameterized requests
 *
 * Read-only, deliberately (F12). `createBackup` and `deleteBackup` used to live
 * here, posting to routes that reported success without taking or deleting
 * anything — `createBackup` was never even wired to a control, and `deleteBackup`
 * drove a button. Hola brokers backups rather than performing them (ADR 0004),
 * so there is no server verb for either to call; both went with the routes.
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
    const cached = globalCache.get<GetBackupsResponse>(cacheKey);
    // Check cache first
    if (cached !== null) {
      setState({ data: cached, loading: false, error: null });
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

      const response = await safeFetchEnhanced(`${API.backups.base}?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch backups: ${response.status} ${response.statusText}`);
      }
      
      const result: GetBackupsResponse = await response.json();
      globalCache.set<GetBackupsResponse>(cacheKey, result);
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

  // Download backup
  const downloadBackup = React.useCallback(async (backupId: string) => {
    const response = await safeFetchEnhanced(API.backups.byId(backupId));
    
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
    downloadBackup
  };
}
