import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { JobTracker } from '../components/JobTracker';
import { 
  Server, 
  Activity, 
  AlertTriangle, 
  Package, 
  Play,
  HardDrive,
  Wifi,
  WifiOff
} from 'lucide-react';
import type { 
  SummaryJob, 
  Job
} from '@hola/shared';
import { useWorkingApi } from '../hooks/useWorkingApi';

// Helper functions for formatting and display
const formatBytes = (bytes: number): string => {
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${Math.round(bytes / Math.pow(1024, i) * 100) / 100} ${sizes[i]}`;
};

const getSystemStatusIcon = (isHealthy: boolean) => {
  return isHealthy ? (
    <Wifi className="w-4 h-4 text-success" />
  ) : (
    <WifiOff className="w-4 h-4 text-danger" />
  );
};

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();

  // Load dashboard summary data using working StrictMode-compatible hook
  const {
    data: summary,
    loading: summaryLoading,
    error: summaryError,
    refetch: refetchSummary
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
  const diskUsagePercent = currentSystemStatus 
    ? Math.round(((currentSystemStatus.disk.totalBytes - currentSystemStatus.disk.freeBytes) / currentSystemStatus.disk.totalBytes) * 100)
    : 0;

  // Generate KPI cards from summary data
  const kpiCards = summary ? [
    {
      title: 'Active Deployments',
      value: summary.deploymentsCount.toString(),
      subtitle: summary.activeJobsCount > 0 ? `${summary.activeJobsCount} jobs running` : 'All stable',
      icon: Server,
      color: summary.activeJobsCount > 0 ? 'text-info' : 'text-success',
    },
    {
      title: 'Active Jobs',
      value: summary.activeJobsCount.toString(),
      subtitle: summary.activeJobsCount > 0 ? 'Processing...' : 'No active jobs',
      icon: Activity,
      color: summary.activeJobsCount > 0 ? 'text-info' : 'text-text-muted',
    },
    {
      title: 'System Alerts',
      value: summary.alertsCount.toString(),
      subtitle: summary.alertsCount > 0 ? (diskUsagePercent > 80 ? 'Disk space low' : 'Needs attention') : 'All systems ok',
      icon: AlertTriangle,
      color: summary.alertsCount > 0 ? 'text-warning' : 'text-success',
    },
  ] : [];

  const loading = summaryLoading;
  const error = summaryError || statusError;

  if (loading && !summary) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-text-muted mt-1">Loading...</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-surface-1 rounded-lg border border-border p-6 animate-pulse">
              <div className="h-4 bg-surface-2 rounded w-1/2 mb-2"></div>
              <div className="h-8 bg-surface-2 rounded w-1/3 mb-2"></div>
              <div className="h-4 bg-surface-2 rounded w-2/3"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-text-muted mt-1">Overview of your home lab deployment platform</p>
        </div>
        <div className="bg-surface-1 rounded-lg border border-border p-6">
          <div className="text-center">
            <AlertTriangle className="w-12 h-12 text-warning mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">Failed to load dashboard</h3>
            <p className="text-text-muted mb-4">{error}</p>
            <button 
              onClick={refetchSummary}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-text-muted mt-1">Overview of your home lab deployment platform</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.title} className="bg-surface-1 rounded-lg border border-border p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-text-muted text-sm">{card.title}</p>
                  <p className="text-2xl font-semibold mt-1">{card.value}</p>
                  <p className="text-text-muted text-sm mt-1">{card.subtitle}</p>
                </div>
                <Icon className={`w-8 h-8 ${card.color}`} />
              </div>
            </div>
          );
        })}
      </div>

      {/* System Status */}
      {currentSystemStatus && (
        <div className="bg-surface-1 rounded-lg border border-border">
          <div className="p-6 border-b border-border">
            <h2 className="text-lg font-medium">System Status</h2>
            <p className="text-text-muted text-sm mt-1">Platform health and resources</p>
          </div>
          
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Docker Status */}
              <div className="flex items-center space-x-3">
                <div className="flex-shrink-0">
                  {getSystemStatusIcon(currentSystemStatus.docker.ok)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">Docker</p>
                  <p className="text-xs text-text-muted truncate">
                    {currentSystemStatus.docker.ok ? 
                      `v${currentSystemStatus.docker.version || 'Unknown'}` : 
                      'Unavailable'
                    }
                  </p>
                </div>
              </div>

              {/* Disk Usage */}
              <div className="flex items-center space-x-3">
                <div className="flex-shrink-0">
                  <HardDrive className={`w-4 h-4 ${diskUsagePercent > 80 ? 'text-warning' : 'text-success'}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">Disk Usage</p>
                  <p className="text-xs text-text-muted">
                    {formatBytes(currentSystemStatus.disk.totalBytes - currentSystemStatus.disk.freeBytes)} / {formatBytes(currentSystemStatus.disk.totalBytes)} ({diskUsagePercent}%)
                  </p>
                </div>
              </div>

              {/* ORAS Status */}
              {currentSystemStatus.oras && (
                <div className="flex items-center space-x-3">
                  <div className="flex-shrink-0">
                    {getSystemStatusIcon(currentSystemStatus.oras.ok)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">ORAS</p>
                    <p className="text-xs text-text-muted truncate">
                      {currentSystemStatus.oras.ok ? 
                        `v${currentSystemStatus.oras.version || 'Unknown'}` : 
                        'Unavailable'
                      }
                    </p>
                  </div>
                </div>
              )}

              {/* Authentik Status */}
              {currentSystemStatus.authentik && (
                <div className="flex items-center space-x-3">
                  <div className="flex-shrink-0">
                    {getSystemStatusIcon(currentSystemStatus.authentik.ok)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Authentik</p>
                    <p className="text-xs text-text-muted">
                      {currentSystemStatus.authentik.ok ? 'Running' : 'Unavailable'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Version Info */}
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-center justify-between text-xs text-text-muted">
                <span>Hola Platform v{currentSystemStatus.version.hola}</span>
                <span>Docker Compose v{currentSystemStatus.version.compose}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 gap-6">
        {/* Recent Jobs */}
        <JobTracker 
          maxJobs={5}
          autoRefresh={true}
          onJobClick={(job) => handleJobClick(job)}
          className="max-w-2xl"
        />

        {/* Quick Actions */}
        <div className="bg-surface-1 rounded-lg border border-border max-w-2xl">
          <div className="p-6 border-b border-border">
            <h2 className="text-lg font-medium">Quick Actions</h2>
            <p className="text-text-muted text-sm mt-1">Common tasks and shortcuts</p>
          </div>
          
          <div className="p-6 space-y-4">
            <Link 
              to="/catalog"
              className="flex items-center space-x-4 p-4 bg-surface-2 rounded-lg hover:bg-surface-2/80 transition-colors group"
            >
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                <Package className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-medium">Browse Catalog</h3>
                <p className="text-sm text-text-muted">Discover and install new apps</p>
              </div>
            </Link>

            <Link 
              to="/deployments"
              className="flex items-center space-x-4 p-4 bg-surface-2 rounded-lg hover:bg-surface-2/80 transition-colors group"
            >
              <div className="w-10 h-10 bg-success/10 rounded-lg flex items-center justify-center group-hover:bg-success/20 transition-colors">
                <Server className="w-5 h-5 text-success" />
              </div>
              <div>
                <h3 className="font-medium">Manage Deployments</h3>
                <p className="text-sm text-text-muted">Monitor and control your apps</p>
              </div>
            </Link>

            <Link 
              to="/backups"
              className="flex items-center space-x-4 p-4 bg-surface-2 rounded-lg hover:bg-surface-2/80 transition-colors group"
            >
              <div className="w-10 h-10 bg-warning/10 rounded-lg flex items-center justify-center group-hover:bg-warning/20 transition-colors">
                <Play className="w-5 h-5 text-warning" />
              </div>
              <div>
                <h3 className="font-medium">Run Backup</h3>
                <p className="text-sm text-text-muted">Secure your data now</p>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};