import React, { useState } from 'react';
import { Shield, Clock, Download, RotateCcw, Play, Calendar, ChevronLeft, ChevronRight, Trash2, AlertCircle } from 'lucide-react';
import type {
  BackupStatus
} from '@hola/shared';
import { useBackupsApi } from '../hooks/useBackupsApi';

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
  // API hook for data management
  const { 
    data: backupsData, 
    loading, 
    error, 
    createBackup, 
    restoreBackup, 
    deleteBackup, 
    downloadBackup 
  } = useBackupsApi();

  // Local UI state
  const [currentPage, setCurrentPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<BackupStatus | 'all'>('all');
  
  // Operations state
  const [operationLoading, setOperationLoading] = useState<{ [key: string]: boolean }>({});

  // Handlers for backup operations
  const handleCreateBackup = async (appId?: string) => {
    const operationKey = `create-${appId || 'all'}`;
    setOperationLoading(prev => ({ ...prev, [operationKey]: true }));
    
    try {
      await createBackup(appId);
    } catch (err) {
      console.error('Failed to create backup:', err);
    } finally {
      setOperationLoading(prev => ({ ...prev, [operationKey]: false }));
    }
  };

  const handleRestoreBackup = async (backupId: string) => {
    const operationKey = `restore-${backupId}`;
    setOperationLoading(prev => ({ ...prev, [operationKey]: true }));
    
    try {
      await restoreBackup(backupId);
    } catch (err) {
      console.error('Failed to restore backup:', err);
    } finally {
      setOperationLoading(prev => ({ ...prev, [operationKey]: false }));
    }
  };

  const handleDeleteBackup = async (backupId: string) => {
    const operationKey = `delete-${backupId}`;
    setOperationLoading(prev => ({ ...prev, [operationKey]: true }));
    
    try {
      await deleteBackup(backupId);
    } catch (err) {
      console.error('Failed to delete backup:', err);
    } finally {
      setOperationLoading(prev => ({ ...prev, [operationKey]: false }));
    }
  };

  const handleDownloadBackup = async (backupId: string) => {
    const operationKey = `download-${backupId}`;
    setOperationLoading(prev => ({ ...prev, [operationKey]: true }));
    
    try {
      await downloadBackup(backupId);
    } catch (err) {
      console.error('Failed to download backup:', err);
    } finally {
      setOperationLoading(prev => ({ ...prev, [operationKey]: false }));
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleStatusFilterChange = (status: BackupStatus | 'all') => {
    setStatusFilter(status);
    setCurrentPage(1);
  };

  // Calculate summary stats
  const totalSize = backupsData?.items.reduce((sum, backup) => sum + backup.sizeBytes, 0) || 0;
  const completedBackups = backupsData?.items.filter(backup => backup.status === 'completed').length || 0;
  const lastBackup = backupsData?.items.length ? 
    backupsData.items.reduce((latest, current) =>
      new Date(current.timestamp) > new Date(latest.timestamp) ? current : latest
    ) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">Backups</h1>
        <p className="text-text-muted mt-1">Manage your deployment backups and recovery</p>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-danger/10 border border-danger/20 rounded-lg p-4">
          <div className="flex items-center space-x-3">
            <AlertCircle className="w-5 h-5 text-danger" />
            <div>
              <div className="font-medium text-danger">Error</div>
              <div className="text-sm text-text-muted">{error}</div>
            </div>
          </div>
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-surface-1 rounded-lg border border-border p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Shield className="w-5 h-5 text-success" />
            <h3 className="font-medium">Completed Backups</h3>
          </div>
          <div className="text-2xl font-semibold">{completedBackups}</div>
          <div className="text-sm text-text-muted">
            of {backupsData?.total || 0} total backups
          </div>
        </div>

        <div className="bg-surface-1 rounded-lg border border-border p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Download className="w-5 h-5 text-info" />
            <h3 className="font-medium">Total Storage Used</h3>
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

      {/* Quick Actions */}
      <div className="bg-surface-1 rounded-lg border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <Shield className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-medium">Backup Actions</h2>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => handleCreateBackup()}
            disabled={operationLoading['create-all']}
            className="bg-primary text-primary-contrast px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            <Play className="w-4 h-4" />
            <span>{operationLoading['create-all'] ? 'Creating...' : 'Create Full Backup'}</span>
          </button>

          <button
            onClick={() => setStatusFilter('all')}
            className="bg-surface-2 hover:bg-surface-3 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center space-x-2"
          >
            <Calendar className="w-4 h-4" />
            <span>View All Backups</span>
          </button>
        </div>
      </div>

      {/* Backup List */}
      <div className="bg-surface-1 rounded-lg border border-border">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-lg font-medium">Recent Backups</h2>
          
          {/* Status Filter */}
          <div className="flex items-center space-x-3">
            <label className="text-sm font-medium">Filter by status:</label>
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

        {loading ? (
          <div className="p-6">
            <div className="animate-pulse space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center space-x-4">
                  <div className="w-12 h-12 bg-surface-2 rounded-lg"></div>
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-surface-2 rounded w-1/4"></div>
                    <div className="h-3 bg-surface-2 rounded w-1/2"></div>
                  </div>
                  <div className="w-24 h-8 bg-surface-2 rounded"></div>
                </div>
              ))}
            </div>
          </div>
        ) : backupsData && backupsData.items.length > 0 ? (
          <div className="divide-y divide-border">
            {backupsData.items.map((backup) => (
              <div key={backup.id} className="p-6 hover:bg-surface-2 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="text-2xl">{backup.icon}</div>
                    <div>
                      <div className="font-medium">{backup.app}</div>
                      <div className="text-sm text-text-muted flex items-center space-x-4">
                        <span>{new Date(backup.timestamp).toLocaleString()}</span>
                        <span>{formatBytes(backup.sizeBytes)}</span>
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(backup.status)}`}
                        >
                          {backup.status.charAt(0).toUpperCase() + backup.status.slice(1)}
                        </span>
                        <span className="text-xs">
                          {backup.type === 'automatic' ? 'Auto' : 'Manual'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleDownloadBackup(backup.id)}
                      disabled={operationLoading[`download-${backup.id}`]}
                      className="p-2 text-text-muted hover:text-info transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Download backup"
                    >
                      <Download className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => handleRestoreBackup(backup.id)}
                      disabled={operationLoading[`restore-${backup.id}`] || backup.status !== 'completed'}
                      className="p-2 text-text-muted hover:text-success transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Restore from backup"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => handleDeleteBackup(backup.id)}
                      disabled={operationLoading[`delete-${backup.id}`]}
                      className="p-2 text-text-muted hover:text-danger transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Delete backup"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center">
            <Shield className="w-12 h-12 text-text-muted mx-auto mb-4" />
            <div className="text-lg font-medium mb-2">No backups found</div>
            <div className="text-text-muted mb-6">
              {statusFilter === 'all' 
                ? 'Create your first backup to get started'
                : `No backups with status "${statusFilter}"`
              }
            </div>
            <button
              onClick={() => handleCreateBackup()}
              disabled={operationLoading['create-all']}
              className="bg-primary text-primary-contrast px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2 mx-auto"
            >
              <Play className="w-4 h-4" />
              <span>{operationLoading['create-all'] ? 'Creating...' : 'Create Backup'}</span>
            </button>
          </div>
        )}

        {/* Pagination */}
        {backupsData && Math.ceil(backupsData.total / backupsData.limit) > 1 && (
          <div className="border-t border-border px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-text-muted">
                Page {backupsData.page} of {Math.ceil(backupsData.total / backupsData.limit)} 
                (showing {backupsData.items.length} of {backupsData.total} backups)
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage <= 1 || loading}
                  className="p-2 text-text-muted hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage >= Math.ceil(backupsData.total / backupsData.limit) || loading}
                  className="p-2 text-text-muted hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Next page"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
