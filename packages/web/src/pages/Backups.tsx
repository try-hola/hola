import React, { useState } from 'react';
import {
  Box,
  History,
  Download,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { BackupStatus } from '@hola/shared';
import { BACKUP_CONTRACT_REF } from '@hola/shared/contracts';
import { useBackupsApi } from '../hooks/useBackupsApi';
import { contractByRef, useContractsApi } from '../hooks/useContractsApi';
import { BackupCoverage } from '../components/BackupCoverage';

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Backup statuses carry their own vocabulary ('running' = in progress, so info
// rather than the green a *deployment* 'running' gets), hence a local map that
// still draws on the shared theme tokens (no hard-coded colours).
const STATUS_PILL: Record<BackupStatus | 'default', { label: string; cls: string }> = {
  completed: { label: 'Completed', cls: 'text-success bg-success-weak' },
  running: { label: 'Running', cls: 'text-info bg-info-weak' },
  failed: { label: 'Failed', cls: 'text-danger bg-danger-weak' },
  default: { label: 'Unknown', cls: 'text-text-muted bg-surface-2' },
};

const statusPill = (status: BackupStatus) => STATUS_PILL[status] ?? STATUS_PILL.default;

const GRID = 'grid grid-cols-[2.4fr_1.3fr_0.8fr_1.2fr_1fr_110px] gap-[14px] px-[18px]';

export const Backups: React.FC = () => {
  // API hook for data management
  const {
    data: backupsData,
    loading,
    error,
    restoreBackup,
    deleteBackup,
    downloadBackup,
  } = useBackupsApi();

  // Who provides backup, and which installed apps the provider actually covers
  // (ADR 0004 Phase 4). This is the page's primary content: Hola brokers backups,
  // it doesn't perform them, so "what is protected right now" is the question it
  // can answer — and the one an operator otherwise answers by reading manifests.
  const { data: contractsData, loading: contractsLoading, error: contractsError } = useContractsApi();
  const backupContract = contractByRef(contractsData, BACKUP_CONTRACT_REF);

  // Local UI state
  const [currentPage, setCurrentPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<BackupStatus | 'all'>('all');

  // Operations state
  const [operationLoading, setOperationLoading] = useState<{ [key: string]: boolean }>({});

  const handleRestoreBackup = async (backupId: string) => {
    const operationKey = `restore-${backupId}`;
    setOperationLoading((prev) => ({ ...prev, [operationKey]: true }));

    try {
      await restoreBackup(backupId);
    } catch (err) {
      console.error('Failed to restore backup:', err);
    } finally {
      setOperationLoading((prev) => ({ ...prev, [operationKey]: false }));
    }
  };

  const handleDeleteBackup = async (backupId: string) => {
    const operationKey = `delete-${backupId}`;
    setOperationLoading((prev) => ({ ...prev, [operationKey]: true }));

    try {
      await deleteBackup(backupId);
    } catch (err) {
      console.error('Failed to delete backup:', err);
    } finally {
      setOperationLoading((prev) => ({ ...prev, [operationKey]: false }));
    }
  };

  const handleDownloadBackup = async (backupId: string) => {
    const operationKey = `download-${backupId}`;
    setOperationLoading((prev) => ({ ...prev, [operationKey]: true }));

    try {
      await downloadBackup(backupId);
    } catch (err) {
      console.error('Failed to download backup:', err);
    } finally {
      setOperationLoading((prev) => ({ ...prev, [operationKey]: false }));
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleStatusFilterChange = (status: BackupStatus | 'all') => {
    setStatusFilter(status);
    setCurrentPage(1);
  };

  const items = backupsData?.items ?? [];
  const totalPages = backupsData ? Math.ceil(backupsData.total / backupsData.limit) : 0;

  return (
    <div className="animate-fadein">
      {/* Header. No "Create backup" action: Hola has no backup engine of its own —
          the provider app runs on its own schedule and Hola quiesces apps around it
          (ADR 0004). A button that posted to a stub and reported success was worse
          than no button, because it read as a backup that had been taken. */}
      <div className="flex items-end gap-3.5 mb-[18px] flex-wrap">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em]">Backups</h1>
          <p className="mt-1.5 text-text-muted text-sm">
            Backups are taken by an installed provider app. Hola quiesces every app that
            accepts the backup contract before each run.
          </p>
        </div>
        <div className="flex-1" />
        {items.length > 0 && (
          <select
            value={statusFilter}
            onChange={(e) => handleStatusFilterChange(e.target.value as BackupStatus | 'all')}
            className="h-10 px-3 bg-surface-1 border border-border rounded-[10px] text-sm text-text-muted focus:outline-none focus:border-primary"
          >
            <option value="all">All status</option>
            <option value="completed">Completed</option>
            <option value="running">Running</option>
            <option value="failed">Failed</option>
          </select>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-danger-weak border border-danger/20 text-danger rounded-card p-4 text-sm mb-4">
          {error}
        </div>
      )}

      <BackupCoverage
        rollup={backupContract}
        loading={contractsLoading}
        error={contractsError}
      />

      {/* Backup history. Empty until the provider's own snapshots are surfaced
          here (#160); the coverage view above is what the page answers today, so
          this stays out of the way rather than showing an empty table. */}
      {items.length > 0 ? (
        <div className="mt-[18px] bg-surface-1 border border-border rounded-card overflow-hidden">
          {/* Header row */}
          <div
            className={`${GRID} py-3 border-b border-border text-[11.5px] font-semibold text-text-faint uppercase tracking-[0.04em]`}
          >
            <div>Backup</div>
            <div>Scope</div>
            <div>Size</div>
            <div>Created</div>
            <div>Status</div>
            <div className="text-right">Actions</div>
          </div>

          {/* Body rows */}
          {items.map((backup) => {
            const pill = statusPill(backup.status);
            return (
              <div
                key={backup.id}
                className={`${GRID} py-[14px] border-b border-border-soft items-center`}
              >
                {/* Backup name */}
                <div className="flex items-center gap-[11px]">
                  <span className="w-8 h-8 flex-none rounded-lg bg-surface-2 text-text-muted flex items-center justify-center">
                    <Box className="w-[18px] h-[18px]" />
                  </span>
                  <span className="font-medium text-[13.5px]">{backup.app}</span>
                </div>

                {/* Scope */}
                <div className="text-[13px] text-text-muted">
                  {backup.type === 'automatic' ? 'Automatic' : 'Manual'}
                </div>

                {/* Size */}
                <div className="font-mono text-[12.5px] text-text-muted">
                  {formatBytes(backup.sizeBytes)}
                </div>

                {/* Created */}
                <div className="text-[12.5px] text-text-faint">
                  {new Date(backup.timestamp).toLocaleString()}
                </div>

                {/* Status */}
                <div>
                  <span
                    className={`inline-flex items-center h-6 px-[9px] rounded-[7px] text-xs font-semibold ${pill.cls}`}
                  >
                    {pill.label}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 justify-end">
                  <button
                    onClick={() => handleRestoreBackup(backup.id)}
                    disabled={
                      operationLoading[`restore-${backup.id}`] || backup.status !== 'completed'
                    }
                    title="Restore"
                    className="w-[30px] h-[30px] flex items-center justify-center rounded-[7px] text-text-muted hover:text-text-strong hover:bg-surface-3 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-muted"
                  >
                    <History className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDownloadBackup(backup.id)}
                    disabled={operationLoading[`download-${backup.id}`]}
                    title="Download"
                    className="w-[30px] h-[30px] flex items-center justify-center rounded-[7px] text-text-muted hover:text-text-strong hover:bg-surface-3 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteBackup(backup.id)}
                    disabled={operationLoading[`delete-${backup.id}`]}
                    title="Delete"
                    className="w-[30px] h-[30px] flex items-center justify-center rounded-[7px] text-text-muted hover:text-danger hover:bg-danger-weak transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}

          {/* Pagination */}
          {totalPages > 1 && backupsData && (
            <div className="flex items-center justify-between px-[18px] py-4">
              <div className="text-sm text-text-muted">
                Page {backupsData.page} of {totalPages} (showing {items.length} of{' '}
                {backupsData.total})
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage <= 1 || loading}
                  title="Previous page"
                  className="w-[30px] h-[30px] flex items-center justify-center rounded-[7px] text-text-muted hover:text-text-strong hover:bg-surface-3 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage >= totalPages || loading}
                  title="Next page"
                  className="w-[30px] h-[30px] flex items-center justify-center rounded-[7px] text-text-muted hover:text-text-strong hover:bg-surface-3 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};
