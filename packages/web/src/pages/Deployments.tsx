import React, { useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { JobTracker } from '../components/JobTracker';
import {
  Plus,
  Search,
  RefreshCw,
  Trash2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  ArrowUp
} from 'lucide-react';
import type {
  DeploymentStatus,
  PostDeploymentActionRequest,
  PostDeploymentActionResponse,
  GetDeploymentsRequest
} from '@hola/shared';
import { api } from '../utils/api';
import { useDeploymentsApi } from '../hooks/useDeploymentsApi';
import { AppIcon } from '../components/ui/AppIcon';
import { StatusBadge } from '../components/ui/StatusBadge';

const STATUS_FILTERS: { value: DeploymentStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'installing', label: 'Installing' },
  { value: 'stopped', label: 'Stopped' },
  { value: 'updating', label: 'Updating' },
  { value: 'error', label: 'Error' }
];

const GRID_COLS =
  'grid grid-cols-[2.4fr_1.1fr_0.9fr_1.9fr_0.9fr_130px] gap-[14px] px-[18px]';

export const Deployments: React.FC = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<DeploymentStatus | 'all'>('all');
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  // Pagination state
  const [page, setPage] = useState(1);
  const [limit] = useState(12); // Number of deployments per page

  // Load deployments from API with search and filters using working StrictMode-compatible hook
  const params: GetDeploymentsRequest = React.useMemo(() => ({
    page,
    limit,
    q: searchTerm || undefined,
    status: statusFilter === 'all' ? undefined : statusFilter
  }), [page, limit, searchTerm, statusFilter]);

  const {
    data: deploymentsResponse,
    loading,
    error,
    refetch
  } = useDeploymentsApi(params);

  const deployments = deploymentsResponse?.items || [];
  const totalDeployments = deploymentsResponse?.total || 0;

  const handleAction = useCallback(async (deploymentId: string, action: 'start' | 'stop' | 'restart') => {
    try {
      const request: PostDeploymentActionRequest = { action };
      const result = await api.deployments.action(deploymentId, request) as PostDeploymentActionResponse;

      // If a job was created, track it
      if (result.jobId) {
        console.log(`Job ${result.jobId} started for ${action} on ${deploymentId}`);
      }

      // Refresh deployments list
      await refetch();
    } catch (error) {
      console.error(`Error performing ${action}:`, error);
      // In a real app, you'd show a toast notification here
    }
  }, [refetch]);

  // Removal is destructive (full teardown + record deletion), so it's gated
  // behind a confirmation dialog rather than firing on the first click.
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Removal is a full teardown (stop + deprovision + release route + remove
  // record), distinct from the `stop` action — so it uses the DELETE endpoint,
  // not a lifecycle action, otherwise the route stays held and blocks reinstall.
  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deployments.remove(pendingDelete.id);
      setPendingDelete(null);
      await refetch();
    } catch (error) {
      // A 404 means the deployment is already gone — which is exactly the goal of
      // remove. The DELETE is idempotent and the client retries it during the slow
      // teardown, so a retry can land after the record was removed; treat that as
      // success rather than showing a spurious "deployment not found" in the dialog.
      if ((error as { statusCode?: number })?.statusCode === 404) {
        setPendingDelete(null);
        await refetch();
      } else {
        console.error('Error deleting deployment:', error);
        setDeleteError(error instanceof Error ? error.message : 'Failed to remove deployment');
      }
    } finally {
      setDeleting(false);
    }
  }, [pendingDelete, refetch]);

  // Force an immediate catalog re-check so newly-published app versions surface as
  // available updates without waiting out the server's refresh-interval TTL. After
  // the refresh we refetch the (cache-bypassing) deployments list so the server
  // re-computes each app's `updateAvailable` against the freshly-pulled catalog.
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);
  const handleCheckUpdates = useCallback(async () => {
    setCheckingUpdates(true);
    setCheckResult(null);
    try {
      await api.catalog.refresh(true);
      await refetch();
      setCheckResult('Catalog up to date');
    } catch {
      setCheckResult('Check failed');
    } finally {
      setCheckingUpdates(false);
      setTimeout(() => setCheckResult(null), 4000);
    }
  }, [refetch]);

  // Calculate pagination info
  const totalPages = Math.ceil(totalDeployments / limit);
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;

  return (
    <div className="animate-fadein">
      {/* Removal confirmation dialog */}
      {pendingDelete && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => { if (!deleting) setPendingDelete(null); }}
        >
          <div
            className="bg-surface-0 rounded-xl border border-border w-full max-w-md overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-dialog-title"
          >
            <div className="p-6">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full bg-danger-weak text-danger">
                  <AlertTriangle className="w-[18px] h-[18px]" />
                </div>
                <div className="min-w-0">
                  <h2 id="remove-dialog-title" className="text-lg font-semibold m-0">Remove {pendingDelete.name}?</h2>
                  <p className="mt-1.5 text-sm text-text-muted">
                    This permanently removes the deployment: it stops and deletes the
                    containers, deprovisions SSO, releases the route, and deletes its
                    data. This can't be undone.
                  </p>
                </div>
              </div>

              {deleteError && (
                <div className="mt-4 flex items-start gap-2 text-sm text-danger bg-danger-weak rounded-[9px] p-3">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{deleteError}</span>
                </div>
              )}

              <div className="mt-6 flex justify-end gap-2.5">
                <button
                  onClick={() => setPendingDelete(null)}
                  disabled={deleting}
                  className="h-[38px] px-[14px] flex items-center bg-surface-2 text-text-strong border border-border rounded-[9px] text-[13.5px] font-semibold hover:border-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={deleting}
                  className="h-[38px] px-[14px] flex items-center gap-[7px] bg-danger text-white border border-transparent rounded-[9px] text-[13.5px] font-semibold hover:brightness-110 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {deleting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  {deleting ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-end gap-3.5 mb-[18px] flex-wrap">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em]">Deployments</h1>
          <p className="mt-1.5 text-text-muted text-sm">
            Status, logs, and lifecycle controls for all {totalDeployments} installed apps. To just
            open an app, head to <Link to="/apps" className="text-primary hover:underline">Your apps</Link>.
          </p>
        </div>
        <div className="flex-1" />
        {checkResult && (
          <span className="self-center text-[12.5px] text-text-muted mr-1">{checkResult}</span>
        )}
        <button
          onClick={handleCheckUpdates}
          disabled={checkingUpdates}
          title="Re-check the catalog for newer versions of your installed apps"
          className="flex items-center gap-2 h-10 px-3.5 bg-surface-1 text-text-strong border border-border rounded-[10px] text-sm font-semibold hover:border-primary transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-[16px] h-[16px] ${checkingUpdates ? 'animate-spin' : ''}`} />
          <span>{checkingUpdates ? 'Checking…' : 'Check for updates'}</span>
        </button>
        <Link
          to="/catalog"
          className="flex items-center gap-2 h-10 px-4 bg-primary text-white rounded-[10px] text-sm font-semibold shadow-primary-glow hover:brightness-110 transition"
        >
          <Plus className="w-[18px] h-[18px]" />
          <span>Install app</span>
        </Link>
      </div>

      {/* Toolbar: search + segmented status filter */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex items-center">
          <span className="absolute left-[11px] flex text-text-faint">
            <Search className="w-4 h-4" />
          </span>
          <input
            type="text"
            placeholder="Search deployments…"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setPage(1); // Reset to first page when searching
            }}
            className="h-[38px] w-60 bg-surface-1 border border-border rounded-[9px] text-text-strong pl-[34px] pr-3 text-[13.5px] outline-none focus:border-primary"
          />
        </div>

        <div className="flex gap-[3px] p-[3px] bg-surface-1 border border-border rounded-[9px]">
          {STATUS_FILTERS.map((f) => {
            const active = statusFilter === f.value;
            return (
              <div
                key={f.value}
                onClick={() => {
                  setStatusFilter(f.value);
                  setPage(1); // Reset to first page when filtering
                }}
                className={`h-[30px] px-[13px] flex items-center rounded-[7px] text-[13px] font-medium cursor-pointer ${
                  active
                    ? 'bg-primary-weak text-primary'
                    : 'text-text-muted hover:text-text-strong'
                }`}
              >
                {f.label}
              </div>
            );
          })}
        </div>
      </div>

      {/* Job Tracker */}
      <div className="mb-4">
        <JobTracker
          maxJobs={5}
          autoRefresh={true}
          onJobClick={(job) => {
            if ('deploymentId' in job && job.deploymentId) {
              navigate(`/deployments/${job.deploymentId}?tab=logs&jobId=${job.id}`);
            }
          }}
        />
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-danger-weak border border-danger/20 text-danger rounded-card p-4 text-sm mb-4">
          <div className="font-medium">Error loading deployments</div>
          <p className="mt-1">{error}</p>
          <button
            onClick={refetch}
            className="mt-2 px-3 py-1 bg-danger text-white rounded-[7px] text-sm hover:brightness-110 transition"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && deployments.length === 0 && (
        <div className="text-text-muted text-sm">Loading deployments…</div>
      )}

      {/* Deployments table */}
      {!loading && (
        <div className="bg-surface-1 border border-border rounded-card overflow-hidden">
          {/* Header row */}
          <div
            className={`${GRID_COLS} py-3 border-b border-border text-[11.5px] font-semibold text-text-faint uppercase tracking-[0.04em]`}
          >
            <div>App</div>
            <div>Status</div>
            <div>Version</div>
            <div>URL</div>
            <div>Updated</div>
            <div className="text-right">Actions</div>
          </div>

          {/* Body rows */}
          {deployments.map((deployment) => {
            // Name + icon are persisted on the deployment (seeded from the catalog
            // at install), falling back to the app id for older records.
            const displayName = deployment.name || deployment.app;
            const displayIcon = deployment.icon;
            return (
            <div
              key={deployment.id}
              onClick={() => navigate(`/deployments/${deployment.id}`)}
              className={`${GRID_COLS} py-[13px] border-b border-border-soft items-center cursor-pointer hover:bg-surface-2`}
            >
              <div className="flex items-center gap-[11px] min-w-0">
                <AppIcon name={displayName} emoji={displayIcon} size={34} />
                <span className="font-semibold text-sm truncate">{displayName}</span>
              </div>
              <div>
                <StatusBadge status={deployment.status} />
              </div>
              <div className="font-mono text-[12.5px] text-text-muted truncate flex items-center gap-1.5">
                <span className="truncate">{deployment.version || '—'}</span>
                {deployment.updateAvailable && deployment.latestVersion && (
                  <span
                    title={`Update available: ${deployment.latestVersion}`}
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-primary-weak text-primary text-[10.5px] font-semibold whitespace-nowrap"
                  >
                    <ArrowUp className="w-3 h-3" />
                    {deployment.latestVersion}
                  </span>
                )}
              </div>
              <div className="font-mono text-[12px] text-text-muted truncate">
                {deployment.url || '—'}
              </div>
              <div className="text-[12.5px] text-text-faint truncate">
                {deployment.lastUpdated}
              </div>
              <div className="flex items-center gap-1 justify-end">
                {deployment.status === 'running' && deployment.url && (
                  <a
                    href={deployment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open"
                    onClick={(e) => e.stopPropagation()}
                    className="w-[30px] h-[30px] flex items-center justify-center rounded-[7px] text-text-muted hover:text-primary hover:bg-primary-weak transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
                <button
                  title="Restart"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAction(deployment.id, 'restart');
                  }}
                  className="w-[30px] h-[30px] flex items-center justify-center rounded-[7px] text-text-muted hover:text-text-strong hover:bg-surface-3 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  title="Remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteError(null);
                    setPendingDelete({ id: deployment.id, name: deployment.name });
                  }}
                  className="w-[30px] h-[30px] flex items-center justify-center rounded-[7px] text-text-muted hover:text-danger hover:bg-danger-weak transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            );
          })}

          {/* Empty state */}
          {deployments.length === 0 && (
            <div className="px-12 py-[50px] text-center text-text-muted text-sm">
              {searchTerm || statusFilter !== 'all'
                ? 'No deployments match your filter.'
                : 'No deployments yet. Install an app to get started.'}
            </div>
          )}

          {/* Footer / pager */}
          <div className="flex items-center justify-between px-[18px] py-[13px] text-[12.5px] text-text-faint">
            <span className="font-mono">
              Showing {deployments.length} of {totalDeployments}
            </span>
            <div className="flex gap-[6px]">
              <button
                onClick={() => setPage(page - 1)}
                disabled={!hasPrevPage}
                title="Previous page"
                className="w-7 h-7 flex items-center justify-center border border-border rounded-[7px] text-text-faint hover:text-text-strong disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={!hasNextPage}
                title="Next page"
                className="w-7 h-7 flex items-center justify-center border border-border rounded-[7px] text-text-faint hover:text-text-strong disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Click outside to close dropdown */}
      {openDropdown && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setOpenDropdown(null)}
        />
      )}
    </div>
  );
};
