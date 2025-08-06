import React, { useState, useEffect, useCallback } from 'react';
import { Shield, Clock, Download, RotateCcw, Play, Calendar, ChevronLeft, ChevronRight, Trash2, AlertCircle } from 'lucide-react';
import type { 
  BackupStatus, 
  GetBackupsResponse
} from '@hola/shared';

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Mock data that conforms to shared types
const mockBackupsResponse: GetBackupsResponse = {
  items: [
    {
      id: '1',
      app: 'Nextcloud',
      appId: 'nextcloud',
      icon: '☁️',
      timestamp: '2024-01-15T14:30:00Z',
      sizeBytes: 2577924710, // 2.4 GB in bytes
      status: 'completed',
      type: 'automatic',
    },
    {
      id: '2',
      app: 'Home Assistant',
      appId: 'homeassistant',
      icon: '🏠',
      timestamp: '2024-01-15T02:00:00Z',
      sizeBytes: 152043520, // 145 MB in bytes
      status: 'completed',
      type: 'automatic',
    },
    {
      id: '3',
      app: 'Bitwarden',
      appId: 'bitwarden',
      icon: '🔐',
      timestamp: '2024-01-14T18:45:00Z',
      sizeBytes: 85983232, // 82 MB in bytes
      status: 'completed',
      type: 'manual',
    },
    {
      id: '4',
      app: 'Plex Media Server',
      appId: 'plex',
      icon: '🎬',
      timestamp: '2024-01-14T03:20:00Z',
      sizeBytes: 1288490189, // 1.2 GB in bytes
      status: 'failed',
      type: 'automatic',
    },
    {
      id: '5',
      app: 'Jellyfin',
      appId: 'jellyfin',
      icon: '📺',
      timestamp: '2024-01-13T23:15:00Z',
      sizeBytes: 967458816, // 923 MB in bytes
      status: 'completed',
      type: 'manual',
    },
  ],
  page: 1,
  limit: 10,
  total: 5
};

const getStatusColor = (status: BackupStatus) => {
  switch (status) {
    case 'completed':
      return 'text-success bg-success/10 border-success/20';
    case 'failed':
      return 'text-danger bg-danger/10 border-danger/20';
    case 'running':
      return 'text-info bg-info/10 border-info/20';
    default:
      return 'text-text-muted bg-surface-2 border-border';
  }
};

export const Backups: React.FC = () => {
  // State management
  const [backupsData, setBackupsData] = useState<GetBackupsResponse>(mockBackupsResponse);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<BackupStatus | 'all'>('all');
  const [appFilter] = useState<string>(''); // Keep for future use
  
  // Schedule settings
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [scheduleTime, setScheduleTime] = useState('02:00');
  const [retention, setRetention] = useState(7);
  
  // Operations state
  const [operationLoading, setOperationLoading] = useState<{ [key: string]: boolean }>({});

  // Fetch backups from API
  const fetchBackups = useCallback(async (page: number = 1, statusFilterValue?: BackupStatus, appId?: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '10'
      });
      
      if (statusFilterValue) {
        params.append('status', statusFilterValue);
      }
      
      if (appId) {
        params.append('appId', appId);
      }

      // In a real implementation, this would be an actual API call
      // const response = await fetch(`${API.backups.base}?${params}`);
      // if (!response.ok) throw new Error('Failed to fetch backups');
      // const data: GetBackupsResponse = await response.json();
      
      // For now, simulate API call with filtered mock data
      await new Promise(resolve => setTimeout(resolve, 500)); // Simulate API delay
      
      let filteredItems = mockBackupsResponse.items;
      
      if (statusFilterValue) {
        filteredItems = filteredItems.filter(backup => backup.status === statusFilterValue);
      }
      
      if (appId) {
        filteredItems = filteredItems.filter(backup => backup.appId === appId);
      }
      
      const data: GetBackupsResponse = {
        items: filteredItems,
        page,
        limit: 10,
        total: filteredItems.length
      };
      
      setBackupsData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch backups');
    } finally {
      setLoading(false);
    }
  }, []);

  // Create backup
  const createBackup = useCallback(async (appId?: string) => {
    const operationKey = `create-${appId || 'all'}`;
    setOperationLoading(prev => ({ ...prev, [operationKey]: true }));
    
    try {
      // In a real implementation, we would use this request:
      // const request: CreateBackupRequest = { appId };
      // const response = await fetch(API.backups.base, {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(request)
      // });
      // if (!response.ok) throw new Error('Failed to create backup');
      // const result: CreateBackupResponse = await response.json();
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Refresh backups after creation
      const filterValue = statusFilter === 'all' ? undefined : statusFilter;
      await fetchBackups(currentPage, filterValue, appFilter || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create backup');
    } finally {
      setOperationLoading(prev => ({ ...prev, [operationKey]: false }));
    }
  }, [currentPage, statusFilter, appFilter, fetchBackups]);

  // Restore backup
  const restoreBackup = useCallback(async (backupId: string) => {
    const operationKey = `restore-${backupId}`;
    setOperationLoading(prev => ({ ...prev, [operationKey]: true }));
    
    try {
      // In a real implementation, we would use this request:
      // const request: RestoreBackupRequest = { targetDeploymentId };
      // const response = await fetch(API.backups.restore(backupId), {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(request)
      // });
      // if (!response.ok) throw new Error('Failed to restore backup');
      // const result: RestoreBackupResponse = await response.json();
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Show success message or update UI as needed
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore backup');
    } finally {
      setOperationLoading(prev => ({ ...prev, [operationKey]: false }));
    }
  }, []);

  // Delete backup
  const deleteBackup = useCallback(async (backupId: string) => {
    const operationKey = `delete-${backupId}`;
    setOperationLoading(prev => ({ ...prev, [operationKey]: true }));
    
    try {
      // In a real implementation:
      // const response = await fetch(API.backups.byId(backupId), {
      //   method: 'DELETE'
      // });
      // if (!response.ok) throw new Error('Failed to delete backup');
      // const result: DeleteBackupResponse = await response.json();
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Refresh backups after deletion
      const filterValue = statusFilter === 'all' ? undefined : statusFilter;
      await fetchBackups(currentPage, filterValue, appFilter || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete backup');
    } finally {
      setOperationLoading(prev => ({ ...prev, [operationKey]: false }));
    }
  }, [currentPage, statusFilter, appFilter, fetchBackups]);

  // Download backup
  const downloadBackup = useCallback(async (backupId: string) => {
    const operationKey = `download-${backupId}`;
    setOperationLoading(prev => ({ ...prev, [operationKey]: true }));
    
    try {
      // In a real implementation:
      // const response = await fetch(API.backups.byId(backupId));
      // if (!response.ok) throw new Error('Failed to download backup');
      // const blob = await response.blob();
      // const url = window.URL.createObjectURL(blob);
      // const a = document.createElement('a');
      // a.href = url;
      // a.download = `backup-${backupId}.tar.gz`;
      // a.click();
      // window.URL.revokeObjectURL(url);
      
      // Simulate download
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download backup');
    } finally {
      setOperationLoading(prev => ({ ...prev, [operationKey]: false }));
    }
  }, []);

  // Load initial data
  useEffect(() => {
    fetchBackups(1);
  }, [fetchBackups]);

  // Handle page change
  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    const filterValue = statusFilter === 'all' ? undefined : statusFilter;
    fetchBackups(page, filterValue, appFilter || undefined);
  }, [statusFilter, appFilter, fetchBackups]);

  // Handle filter changes
  const handleStatusFilterChange = useCallback((status: BackupStatus | 'all') => {
    setStatusFilter(status);
    setCurrentPage(1);
    const filterValue = status === 'all' ? undefined : status;
    fetchBackups(1, filterValue, appFilter || undefined);
  }, [appFilter, fetchBackups]);

  // Calculate stats
  const totalSize = backupsData.items.reduce((sum, backup) => sum + backup.sizeBytes, 0);
  const completedBackups = backupsData.items.filter(backup => backup.status === 'completed').length;
  const lastBackup = backupsData.items.length > 0 ? 
    backupsData.items.reduce((latest, current) => 
      new Date(current.timestamp) > new Date(latest.timestamp) ? current : latest
    ) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">Backups</h1>
        <p className="text-text-muted mt-1">Manage automated backups and restore your applications</p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-danger/10 border border-danger/20 text-danger px-4 py-3 rounded-lg flex items-center space-x-2">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      {/* Global Schedule */}
      <div className="bg-surface-1 rounded-lg border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium">Global Backup Schedule</h2>
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={scheduleEnabled}
              onChange={(e) => setScheduleEnabled(e.target.checked)}
              className="w-4 h-4 text-primary bg-surface-0 border-border rounded focus:ring-primary/50"
            />
            <span className="text-sm">Enable automatic backups</span>
          </label>
        </div>

        {scheduleEnabled && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium mb-2">Backup Time</label>
              <input
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                className="w-full px-3 py-2 bg-surface-0 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Retention (days)</label>
              <input
                type="number"
                min="1"
                max="30"
                value={retention}
                onChange={(e) => setRetention(parseInt(e.target.value))}
                className="w-full px-3 py-2 bg-surface-0 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="flex items-end">
              <button className="w-full bg-primary text-primary-contrast py-2 px-4 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
                Save Schedule
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Filters and Controls */}
      <div className="bg-surface-1 rounded-lg border border-border p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
          <div className="flex flex-col sm:flex-row sm:items-center space-y-4 sm:space-y-0 sm:space-x-4">
            <div>
              <label className="block text-sm font-medium mb-2">Filter by Status</label>
              <select
                value={statusFilter}
                onChange={(e) => handleStatusFilterChange(e.target.value as BackupStatus | 'all')}
                className="px-3 py-2 bg-surface-0 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="all">All Status</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="running">Running</option>
              </select>
            </div>
          </div>

          <button
            onClick={() => createBackup()}
            disabled={operationLoading['create-all']}
            className="bg-primary text-primary-contrast px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors flex items-center space-x-2 disabled:opacity-50"
          >
            <Play className="w-4 h-4" />
            <span>{operationLoading['create-all'] ? 'Creating...' : 'Run All Backups'}</span>
          </button>
        </div>
      </div>

      {/* Backup History */}
      <div className="bg-surface-1 rounded-lg border border-border">
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Backup History</h2>
            <div className="text-sm text-text-muted">
              Showing {backupsData.items.length} of {backupsData.total} backups
            </div>
          </div>
        </div>

        {loading ? (
          <div className="p-6">
            <div className="animate-pulse space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center space-x-4">
                  <div className="w-8 h-8 bg-surface-2 rounded"></div>
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-surface-2 rounded w-1/4"></div>
                    <div className="h-3 bg-surface-2 rounded w-1/2"></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {backupsData.items.map((backup) => (
              <div key={backup.id} className="p-6 hover:bg-surface-2/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="text-xl">{backup.icon}</div>
                    
                    <div>
                      <div className="flex items-center space-x-3">
                        <h3 className="font-medium">{backup.app}</h3>
                        <span className={`text-xs px-2 py-1 rounded border capitalize ${getStatusColor(backup.status)}`}>
                          {backup.status}
                        </span>
                        <span className="text-xs text-text-muted bg-surface-2 px-2 py-1 rounded">
                          {backup.type}
                        </span>
                      </div>
                      
                      <div className="flex items-center space-x-4 mt-1 text-sm text-text-muted">
                        <span className="flex items-center space-x-1">
                          <Clock className="w-3 h-3" />
                          <span>{new Date(backup.timestamp).toLocaleString()}</span>
                        </span>
                        <span>Size: {formatBytes(backup.sizeBytes)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    {backup.status === 'completed' && (
                      <>
                        <button
                          onClick={() => downloadBackup(backup.id)}
                          disabled={operationLoading[`download-${backup.id}`]}
                          className="p-2 text-text-muted hover:text-info transition-colors disabled:opacity-50"
                          title="Download"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => restoreBackup(backup.id)}
                          disabled={operationLoading[`restore-${backup.id}`]}
                          className="p-2 text-text-muted hover:text-warning transition-colors disabled:opacity-50"
                          title="Restore"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => createBackup(backup.appId)}
                      disabled={operationLoading[`create-${backup.appId}`]}
                      className="p-2 text-text-muted hover:text-primary transition-colors disabled:opacity-50"
                      title="Run Backup"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteBackup(backup.id)}
                      disabled={operationLoading[`delete-${backup.id}`]}
                      className="p-2 text-text-muted hover:text-danger transition-colors disabled:opacity-50"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {Math.ceil(backupsData.total / backupsData.limit) > 1 && (
          <div className="px-6 py-4 border-t border-border">
            <div className="flex items-center justify-between">
              <div className="text-sm text-text-muted">
                Page {backupsData.page} of {Math.ceil(backupsData.total / backupsData.limit)}
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handlePageChange(backupsData.page - 1)}
                  disabled={backupsData.page <= 1}
                  className="p-2 text-text-muted hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handlePageChange(backupsData.page + 1)}
                  disabled={backupsData.page >= Math.ceil(backupsData.total / backupsData.limit)}
                  className="p-2 text-text-muted hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Storage Usage */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-surface-1 rounded-lg border border-border p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Shield className="w-5 h-5 text-primary" />
            <h3 className="font-medium">Total Backups</h3>
          </div>
          <div className="text-2xl font-semibold">{completedBackups}</div>
          <div className="text-sm text-text-muted">Successful backups</div>
        </div>

        <div className="bg-surface-1 rounded-lg border border-border p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Calendar className="w-5 h-5 text-success" />
            <h3 className="font-medium">Storage Used</h3>
          </div>
          <div className="text-2xl font-semibold">{formatBytes(totalSize)}</div>
          <div className="text-sm text-text-muted">Total backup size</div>
        </div>

        <div className="bg-surface-1 rounded-lg border border-border p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Clock className="w-5 h-5 text-info" />
            <h3 className="font-medium">Last Backup</h3>
          </div>
          {lastBackup ? (
            <>
              <div className="text-2xl font-semibold">
                {Math.round((Date.now() - new Date(lastBackup.timestamp).getTime()) / (1000 * 60 * 60))} hrs
              </div>
              <div className="text-sm text-text-muted">ago ({lastBackup.app})</div>
            </>
          ) : (
            <>
              <div className="text-2xl font-semibold">-</div>
              <div className="text-sm text-text-muted">No backups yet</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};