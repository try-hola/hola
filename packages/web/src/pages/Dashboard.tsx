import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Server,
  Activity,
  AlertTriangle,
  HardDrive,
  CheckCircle2,
  Package,
  RefreshCw,
  Download,
  Save,
  Play,
  Square,
  RotateCw,
} from 'lucide-react';
import type { SummaryJob, Job, JobType } from '@hola/shared';
import { useWorkingApi } from '../hooks/useWorkingApi';
import { statusMeta } from '../components/ui/status';

// Helper functions for formatting and display
const formatBytes = (bytes: number): string => {
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${Math.round((bytes / Math.pow(1024, i)) * 100) / 100} ${sizes[i]}`;
};

// Icon for a job type (used in the recent-activity list)
const jobTypeIcon = (type: JobType) => {
  switch (type) {
    case 'install':
      return Download;
    case 'update':
      return RefreshCw;
    case 'backup':
      return Save;
    case 'restore':
      return RotateCw;
    case 'start':
      return Play;
    case 'stop':
      return Square;
    case 'restart':
      return RotateCw;
    default:
      return Activity;
  }
};

// A label/value row with a thin progress meter — shared by the Telemetry panel
// so the bar shell isn't copy-pasted per service.
const MeterRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  pct: number;
  color: string;
}> = ({ icon, label, value, pct, color }) => (
  <div>
    <div className="flex justify-between text-[12.5px] mb-1.5">
      <span className="text-text-muted flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <span className="font-mono text-text-strong font-medium">{value}</span>
    </div>
    <div className="h-[7px] rounded bg-surface-3 overflow-hidden">
      <div className="h-full rounded" style={{ width: `${pct}%`, background: color }} />
    </div>
  </div>
);

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();

  // Load dashboard summary data using working StrictMode-compatible hook
  const {
    data: summary,
    loading: summaryLoading,
    error: summaryError,
    refetch: refetchSummary,
  } = useWorkingApi();

  // TODO: Add system status back with working hook pattern
  const systemStatus = null;
  const statusError = null;

  const handleJobClick = (job: SummaryJob | Job) => {
    // Navigate to deployment detail page with logs tab active
    if ('deploymentId' in job && job.deploymentId) {
      navigate(`/deployments/${job.deploymentId}?tab=logs&jobId=${job.id}`);
    }
  };

  // Use systemStatus from live updates, fallback to summary system data
  const currentSystemStatus = systemStatus || summary?.system;

  // Calculate disk usage percentage
  const usedBytes = currentSystemStatus
    ? currentSystemStatus.disk.totalBytes - currentSystemStatus.disk.freeBytes
    : 0;
  const diskUsagePercent = currentSystemStatus
    ? Math.round((usedBytes / currentSystemStatus.disk.totalBytes) * 100)
    : 0;

  const recentJobs = summary?.recentJobs ?? [];

  // Overall system health derived from real status flags
  const healthOk =
    !!currentSystemStatus &&
    currentSystemStatus.docker.ok &&
    (currentSystemStatus.oras?.ok ?? true) &&
    (currentSystemStatus.authentik?.ok ?? true) &&
    diskUsagePercent <= 90;

  const loading = summaryLoading;
  const error = summaryError || statusError;

  // ----- Loading -----
  if (loading && !summary) {
    return (
      <div className="animate-fadein">
        <div className="mb-[22px]">
          <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em]">Dashboard</h1>
          <p className="mt-1.5 text-text-muted text-sm">Loading operational overview…</p>
        </div>
        <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="bg-surface-1 border border-border rounded-card p-[18px] animate-pulse"
            >
              <div className="h-4 bg-surface-2 rounded w-1/2 mb-4" />
              <div className="h-8 bg-surface-2 rounded w-1/3 mb-3" />
              <div className="h-[7px] bg-surface-2 rounded w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ----- Error -----
  if (error && !summary) {
    return (
      <div className="animate-fadein">
        <div className="mb-[22px]">
          <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em]">Dashboard</h1>
          <p className="mt-1.5 text-text-muted text-sm">
            Operational overview of your server and deployments.
          </p>
        </div>
        <div className="bg-danger-weak border border-danger/20 text-danger rounded-card p-4 text-sm flex items-center justify-between gap-4">
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-none" />
            Failed to load dashboard: {error}
          </span>
          <button
            onClick={refetchSummary}
            className="flex-none inline-flex items-center gap-1.5 px-3 h-8 rounded-[9px] bg-surface-1 border border-border text-text-strong text-[13px] font-medium hover:bg-surface-2 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ----- KPI cards -----
  const kpiCards = summary
    ? [
        {
          label: 'Active Deployments',
          value: summary.deploymentsCount.toString(),
          sub: summary.activeJobsCount > 0 ? `${summary.activeJobsCount} jobs running` : 'All stable',
          subColor: summary.activeJobsCount > 0 ? 'var(--info)' : 'var(--success)',
          icon: Server,
          iconBg: 'var(--primary-weak)',
          iconColor: 'var(--primary)',
        },
        {
          label: 'Active Jobs',
          value: summary.activeJobsCount.toString(),
          sub: summary.activeJobsCount > 0 ? 'Processing…' : 'No active jobs',
          subColor: summary.activeJobsCount > 0 ? 'var(--info)' : 'var(--muted)',
          icon: Activity,
          iconBg: 'var(--primary-weak)',
          iconColor: 'var(--info)',
        },
        {
          label: 'System Alerts',
          value: summary.alertsCount.toString(),
          sub:
            summary.alertsCount > 0
              ? diskUsagePercent > 80
                ? 'Disk space low'
                : 'Needs attention'
              : 'All systems ok',
          subColor: summary.alertsCount > 0 ? 'var(--warn)' : 'var(--success)',
          icon: AlertTriangle,
          iconBg: summary.alertsCount > 0 ? 'var(--warn-weak)' : 'var(--success-weak)',
          iconColor: summary.alertsCount > 0 ? 'var(--warn)' : 'var(--success)',
        },
      ]
    : [];

  const diskColor =
    diskUsagePercent > 90
      ? 'var(--danger)'
      : diskUsagePercent > 80
        ? 'var(--warn)'
        : 'var(--success)';

  return (
    <div className="animate-fadein">
      {/* Header */}
      <div className="mb-[22px]">
        <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em]">Dashboard</h1>
        <p className="mt-1.5 text-text-muted text-sm">
          Operational overview of your server and deployments.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(220px,1fr))] mb-[18px]">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="bg-surface-1 border border-border rounded-card p-[18px]"
            >
              <div className="flex items-center gap-2.5 text-text-muted text-[13px] font-medium">
                <span
                  className="flex w-8 h-8 items-center justify-center rounded-[9px]"
                  style={{ background: card.iconBg, color: card.iconColor }}
                >
                  <Icon className="w-4 h-4" />
                </span>
                {card.label}
              </div>
              <div className="flex items-baseline gap-2 mt-3.5">
                <span className="text-3xl font-bold tracking-[-0.02em] font-mono">
                  {card.value}
                </span>
                <span className="text-[13px] font-medium" style={{ color: card.subColor }}>
                  {card.sub}
                </span>
              </div>
            </div>
          );
        })}

        {/* Disk usage KPI (with progress bar) */}
        {currentSystemStatus && (
          <div className="bg-surface-1 border border-border rounded-card p-[18px]">
            <div className="flex items-center gap-2.5 text-text-muted text-[13px] font-medium">
              <span
                className="flex w-8 h-8 items-center justify-center rounded-[9px]"
                style={{
                  background: diskUsagePercent > 80 ? 'var(--warn-weak)' : 'var(--success-weak)',
                  color: diskColor,
                }}
              >
                <HardDrive className="w-4 h-4" />
              </span>
              Disk Usage
            </div>
            <div className="flex items-baseline gap-2 mt-3.5">
              <span className="text-3xl font-bold tracking-[-0.02em] font-mono">
                {diskUsagePercent}%
              </span>
              <span className="text-[13px] font-medium" style={{ color: diskColor }}>
                {formatBytes(usedBytes)} / {formatBytes(currentSystemStatus.disk.totalBytes)}
              </span>
            </div>
            <div className="mt-3.5 h-[7px] rounded bg-surface-3 overflow-hidden">
              <div
                className="h-full rounded"
                style={{ width: `${diskUsagePercent}%`, background: diskColor }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Lower section: recent activity + (health / telemetry) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
        {/* Recent activity */}
        <div className="bg-surface-1 border border-border rounded-card overflow-hidden">
          <div className="flex items-center justify-between px-[18px] py-4 border-b border-border-soft">
            <div className="font-semibold text-[15px]">Recent activity</div>
            <button
              onClick={() => navigate('/deployments')}
              className="text-[13px] text-primary font-medium hover:underline"
            >
              View all
            </button>
          </div>
          <div>
            {recentJobs.length === 0 ? (
              <div className="px-[18px] py-10 text-center text-text-muted text-sm">
                No recent activity
              </div>
            ) : (
              recentJobs.map((job) => {
                const Icon = jobTypeIcon(job.type);
                const c = statusMeta(job.status);
                return (
                  <div
                    key={job.id}
                    onClick={() => handleJobClick(job)}
                    className="flex items-center gap-[13px] px-[18px] py-[13px] border-b border-border-soft hover:bg-surface-2 cursor-pointer transition-colors"
                  >
                    <span
                      className="flex w-8 h-8 flex-none items-center justify-center rounded-[9px]"
                      style={{ background: c.bg, color: c.color }}
                    >
                      <Icon className="w-4 h-4" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-medium truncate">
                        {job.type.charAt(0).toUpperCase() + job.type.slice(1)} · {job.app}
                      </div>
                      <div className="text-xs" style={{ color: c.color }}>
                        {c.label}
                        {typeof job.progress === 'number' ? ` · ${job.progress}%` : ''}
                      </div>
                    </div>
                    <span className="font-mono text-[11.5px] text-text-faint flex-none">
                      {job.timestamp}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right column: health + telemetry */}
        <div className="flex flex-col gap-4">
          {/* System health */}
          {currentSystemStatus && (
            <div className="bg-surface-1 border border-border rounded-card p-[18px]">
              <div className="font-semibold text-[15px] mb-1">System health</div>
              <div className="flex items-center gap-[9px] my-3.5">
                <span
                  className="flex w-10 h-10 items-center justify-center rounded-[11px]"
                  style={{
                    background: healthOk ? 'var(--success-weak)' : 'var(--warn-weak)',
                    color: healthOk ? 'var(--success)' : 'var(--warn)',
                  }}
                >
                  {healthOk ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : (
                    <AlertTriangle className="w-5 h-5" />
                  )}
                </span>
                <div>
                  <div
                    className="text-[17px] font-semibold"
                    style={{ color: healthOk ? 'var(--success)' : 'var(--warn)' }}
                  >
                    {healthOk ? 'Healthy' : 'Attention'}
                  </div>
                  <div className="text-[12.5px] text-text-faint">
                    {currentSystemStatus.docker.ok ? 'Docker running' : 'Docker unavailable'}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between text-[12.5px] text-text-faint border-t border-border-soft pt-3">
                <span className="font-mono">Hola v{currentSystemStatus.version.hola}</span>
                <span className="font-mono">Compose v{currentSystemStatus.version.compose}</span>
              </div>
            </div>
          )}

          {/* Telemetry — disk is shown above as a KPI card; this panel covers
              the platform services. */}
          {currentSystemStatus && (
            <div className="bg-surface-1 border border-border rounded-card p-[18px] flex-1">
              <div className="font-semibold text-[15px] mb-4">Telemetry</div>
              <div className="space-y-[15px]">
                <MeterRow
                  icon={<Package className="w-3.5 h-3.5" />}
                  label="Docker"
                  value={
                    currentSystemStatus.docker.ok
                      ? `v${currentSystemStatus.docker.version || '—'}`
                      : 'down'
                  }
                  pct={currentSystemStatus.docker.ok ? 100 : 8}
                  color={currentSystemStatus.docker.ok ? 'var(--success)' : 'var(--danger)'}
                />
                {currentSystemStatus.oras && (
                  <MeterRow
                    icon={<Download className="w-3.5 h-3.5" />}
                    label="ORAS"
                    value={
                      currentSystemStatus.oras.ok
                        ? `v${currentSystemStatus.oras.version || '—'}`
                        : 'down'
                    }
                    pct={currentSystemStatus.oras.ok ? 100 : 8}
                    color={currentSystemStatus.oras.ok ? 'var(--success)' : 'var(--danger)'}
                  />
                )}
                {currentSystemStatus.authentik && (
                  <MeterRow
                    icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                    label="Authentik"
                    value={currentSystemStatus.authentik.ok ? 'up' : 'down'}
                    pct={currentSystemStatus.authentik.ok ? 100 : 8}
                    color={currentSystemStatus.authentik.ok ? 'var(--success)' : 'var(--danger)'}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
