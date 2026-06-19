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
  ChevronRight
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

  const handleAction = useCallback(async (deploymentId: string, action: 'start' | 'stop' | 'restart' | 'delete') => {
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

  // Calculate pagination info
  const totalPages = Math.ceil(totalDeployments / limit);
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;

  return (
    <div className="animate-fadein">
      {/* Header */}
      <div className="flex items-end gap-3.5 mb-[18px] flex-wrap">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em]">Deployments</h1>
          <p className="mt-1.5 text-text-muted text-sm">
            {totalDeployments} deployments across your server.
          </p>
        </div>
        <div className="flex-1" />
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
          {deployments.map((deployment) => (
            <div
              key={deployment.id}
              onClick={() => navigate(`/deployments/${deployment.id}`)}
              className={`${GRID_COLS} py-[13px] border-b border-border-soft items-center cursor-pointer hover:bg-surface-2`}
            >
              <div className="flex items-center gap-[11px] min-w-0">
                <AppIcon name={deployment.name} emoji={deployment.icon} size={34} />
                <span className="font-semibold text-sm truncate">{deployment.name}</span>
              </div>
              <div>
                <StatusBadge status={deployment.status} />
              </div>
              <div className="font-mono text-[12.5px] text-text-muted truncate">
                {deployment.version || '—'}
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
                    handleAction(deployment.id, 'delete');
                  }}
                  className="w-[30px] h-[30px] flex items-center justify-center rounded-[7px] text-text-muted hover:text-danger hover:bg-danger-weak transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}

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
