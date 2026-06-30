import React, { useState } from 'react';
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom';
import { LogsViewer } from '../components/LogsViewer';
import { JobTracker } from '../components/JobTracker';
import {
  Play,
  Square,
  RotateCcw,
  Trash2,
  ExternalLink,
  Globe,
  Settings,
  Activity,
  BarChart3,
  Shield,
  Clock,
  Edit,
  Eye,
  EyeOff,
  Plus,
  X,
  RotateCw,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Copy,
  ArrowUpCircle
} from 'lucide-react';
import type {
  AppEnvVar,
  SystemEnvVar
} from '@hola/shared';
import { AppIcon } from '../components/ui/AppIcon';
import { StatusDot, StatusBadge } from '../components/ui/StatusBadge';
import { useDeploymentDetailApi, useDeploymentHistoryApi } from '../hooks/useDeploymentDetailApi';

// Decorative sparkline bar heights — computed once at module load (the values
// are illustrative, not real time-series data).
const SPARK_BARS = Array.from({ length: 34 }, (_, i) => 30 + ((i * 37) % 70));

// A resource value is only renderable as a progress bar when it's a percentage;
// otherwise we show the raw value without a misleading fixed-width bar.
const percentWidth = (val: string): string | null => {
  const m = /^\s*(\d+(?:\.\d+)?)\s*%\s*$/.exec(val);
  if (!m) return null;
  return `${Math.max(0, Math.min(100, parseFloat(m[1])))}%`;
};

const formatDateTime = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
};

const getDuration = (startedAt: string, finishedAt: string): string => {
  const start = new Date(startedAt);
  const end = new Date(finishedAt);
  const diffMs = end.getTime() - start.getTime();
  const diffSecs = Math.round(diffMs / 1000);

  if (diffSecs < 60) {
    return `${diffSecs}s`;
  } else if (diffSecs < 3600) {
    const mins = Math.floor(diffSecs / 60);
    const secs = diffSecs % 60;
    return `${mins}m ${secs}s`;
  } else {
    const hours = Math.floor(diffSecs / 3600);
    const mins = Math.floor((diffSecs % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
};

const tabs = [
  { id: 'overview', name: 'Overview', icon: Activity },
  { id: 'logs', name: 'Logs', icon: Activity },
  { id: 'metrics', name: 'Metrics', icon: BarChart3 },
  { id: 'backups', name: 'Backups', icon: Shield },
  { id: 'configuration', name: 'Configuration', icon: Settings },
  { id: 'history', name: 'History', icon: Clock },
];

export const DeploymentDetail: React.FC = () => {
  const { deploymentId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'overview');
  const [historyPage, setHistoryPage] = useState(1);

  // Use API hooks for data fetching
  const {
    data: deployment,
    loading,
    error,
    refetch: refetchDeployment,
    updateConfiguration,
    executeAction,
    upgradeDeployment,
    removeDeployment
  } = useDeploymentDetailApi(deploymentId);

  const navigate = useNavigate();

  // Removal confirmation dialog state. Removal is destructive (full teardown +
  // record deletion), so it's gated behind a confirm step rather than firing on
  // the first click.
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [showUpgradeConfirm, setShowUpgradeConfirm] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  const {
    data: historyData,
    loading: historyLoading,
    refetch: refetchHistory
  } = useDeploymentHistoryApi(deploymentId, historyPage);

  // Form state
  const [isEditing, setIsEditing] = useState(false);
  const [showSecrets, setShowSecrets] = useState<{[key: string]: boolean}>({});
  const [operationLoading, setOperationLoading] = useState<{[key: string]: boolean}>({});

  // System-wide environment variables (would come from API/context)
  const systemEnvVars: SystemEnvVar[] = [
    { key: 'DOMAIN', value: 'localhost', isSecret: false, description: 'Base domain for all services' },
    { key: 'TIMEZONE', value: 'UTC', isSecret: false, description: 'System timezone' },
    { key: 'BACKUP_RETENTION_DAYS', value: '30', isSecret: false, description: 'Default backup retention period' },
    { key: 'SMTP_HOST', value: '', isSecret: false, description: 'SMTP server for notifications' },
    { key: 'SMTP_USER', value: '', isSecret: false, description: 'SMTP username' },
    { key: 'SMTP_PASSWORD', value: '', isSecret: true, description: 'SMTP password' },
    { key: 'SSL_EMAIL', value: '', isSecret: false, description: 'Email for SSL certificates' },
  ];

  // Deployment-specific overrides (would come from API)
  const [deploymentOverrides, setDeploymentOverrides] = useState<{[key: string]: string}>({
    'DOMAIN': 'nextcloud.example.com', // This deployment overrides the domain
  });

  // Deployment-specific environment variables
  const [deploymentEnvVars, setDeploymentEnvVars] = useState<AppEnvVar[]>([
    { key: 'POSTGRES_DB', value: 'nextcloud', isSecret: false, description: 'Database name' },
    { key: 'POSTGRES_USER', value: 'nextcloud', isSecret: false, description: 'Database user' },
    { key: 'POSTGRES_PASSWORD', value: 'secure_password_123', isSecret: true, description: 'Database password' },
    { key: 'NEXTCLOUD_ADMIN_USER', value: 'admin', isSecret: false, description: 'Admin username' },
    { key: 'NEXTCLOUD_ADMIN_PASSWORD', value: 'admin_password_456', isSecret: true, description: 'Admin password' },
  ]);

  // Handle tab changes
  // Note: handleTabChange was unused; tabs update via inline onClick handlers above.

  // Early return for loading/error states
  if (loading && !deployment) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-text-muted">Loading deployment details...</p>
        </div>
      </div>
    );
  }

  if (error && !deployment) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-danger mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">Failed to load deployment</h3>
          <p className="text-text-muted mb-4">{error}</p>
          <button
            onClick={() => refetchDeployment()}
            className="bg-primary text-primary-contrast px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!deployment) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <h3 className="text-lg font-medium mb-2">Deployment not found</h3>
          <p className="text-text-muted mb-4">The requested deployment could not be found.</p>
          <Link
            to="/deployments"
            className="bg-primary text-primary-contrast px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Back to Deployments
          </Link>
        </div>
      </div>
    );
  }

  const addDeploymentEnvVar = () => {
    setDeploymentEnvVars([...deploymentEnvVars, { key: '', value: '', isSecret: false, description: '' }]);
  };

  const updateDeploymentEnvVar = <K extends keyof AppEnvVar>(index: number, field: K, value: AppEnvVar[K]) => {
    const updated = [...deploymentEnvVars];
    updated[index] = { ...updated[index], [field]: value };
    setDeploymentEnvVars(updated);
  };

  const removeDeploymentEnvVar = (index: number) => {
    setDeploymentEnvVars(deploymentEnvVars.filter((_, i) => i !== index));
  };

  const toggleSecretVisibility = (key: string) => {
    setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const updateSystemOverride = (key: string, value: string) => {
    if (value === systemEnvVars.find(v => v.key === key)?.value) {
      // If value matches system default, remove override
      const newOverrides = { ...deploymentOverrides };
      delete newOverrides[key];
      setDeploymentOverrides(newOverrides);
    } else {
      // Set override
      setDeploymentOverrides({ ...deploymentOverrides, [key]: value });
    }
  };

  const resetSystemOverride = (key: string) => {
    const newOverrides = { ...deploymentOverrides };
    delete newOverrides[key];
    setDeploymentOverrides(newOverrides);
  };

  const handleAction = async (action: 'start' | 'stop' | 'restart') => {
    if (!deployment) return;

    const operationKey = `action-${action}`;
    setOperationLoading(prev => ({ ...prev, [operationKey]: true }));

    try {
      await executeAction(action);
      // TODO: Show success message
    } catch (error) {
      console.error(`Error performing ${action}:`, error);
      // TODO: Show error message to user
    } finally {
      setOperationLoading(prev => ({ ...prev, [operationKey]: false }));
    }
  };

  // Confirmed upgrade to the latest catalog version. The server carries env/secrets +
  // system overrides forward and snapshots first when the target requires it.
  const confirmUpgrade = async () => {
    if (!deployment || !deployment.updateAvailable) return;
    setUpgradeError(null);
    setOperationLoading(prev => ({ ...prev, upgrade: true }));
    try {
      await upgradeDeployment();
      setShowUpgradeConfirm(false);
    } catch (error) {
      console.error('Error upgrading deployment:', error);
      setUpgradeError(error instanceof Error ? error.message : 'Upgrade failed');
    } finally {
      setOperationLoading(prev => ({ ...prev, upgrade: false }));
    }
  };

  // Confirmed removal: full teardown via the DELETE endpoint, then back to the
  // deployments list (the deployment no longer exists, so there's nothing to
  // show here). On failure we keep the dialog open and surface the error inline.
  const handleRemove = async () => {
    if (!deployment) return;

    setRemoving(true);
    setRemoveError(null);
    try {
      await removeDeployment();
      navigate('/deployments');
    } catch (error) {
      console.error('Error removing deployment:', error);
      setRemoveError(error instanceof Error ? error.message : 'Failed to remove deployment');
    } finally {
      setRemoving(false);
    }
  };

  const saveConfiguration = async () => {
    if (!deployment) return;

    setOperationLoading(prev => ({ ...prev, 'save-config': true }));

    try {
      await updateConfiguration({
        env: deploymentEnvVars,
        systemOverrides: deploymentOverrides
      });
      setIsEditing(false);
      // TODO: Show success message
    } catch (error) {
      console.error('Error saving configuration:', error);
      // TODO: Show error message to user
    } finally {
      setOperationLoading(prev => ({ ...prev, 'save-config': false }));
    }
  };

  const isRunning = deployment.status === 'running';

  // Real facts for the Overview "Details" card.
  const facts: { label: string; value: string; mono?: boolean }[] = [
    { label: 'App', value: deployment.app, mono: true },
    { label: 'Deployment ID', value: deployment.id, mono: true },
    { label: 'Status', value: deployment.status },
    ...(deployment.version ? [{ label: 'Version', value: deployment.version, mono: true }] : []),
    ...(deployment.updateAvailable && deployment.latestVersion
      ? [{ label: 'Latest', value: `${deployment.latestVersion} (update available)`, mono: true }]
      : []),
    ...(deployment.uptime ? [{ label: 'Uptime', value: deployment.uptime }] : []),
    { label: 'Last updated', value: deployment.lastUpdated },
    ...(deployment.url ? [{ label: 'URL', value: deployment.url, mono: true }] : []),
    ...(deployment.ports.length
      ? [{ label: 'Ports', value: deployment.ports.join(', '), mono: true }]
      : []),
  ];

  // Resource usage rows (real values from the deployment). Bars render only when
  // the value is a percentage; `resources` may be absent on a malformed payload.
  const res = deployment.resources;
  const resourceBars: { label: string; val: string; color: string }[] = res
    ? [
        { label: 'CPU', val: res.cpu, color: 'var(--info)' },
        { label: 'Memory', val: res.memory, color: 'var(--warning)' },
        ...(res.disk ? [{ label: 'Disk', val: res.disk, color: 'var(--success)' }] : []),
      ]
    : [];

  // Single source for the read-only compose preview that is both shown and copied.
  const composePreview = `services:\n  ${deployment.app}:\n    image: ${deployment.app}:${deployment.version ?? 'latest'}\n    # ingress routed by Traefik (no host ports)`;

  const openApp = () => {
    if (deployment.url) window.open(deployment.url, '_blank', 'noopener,noreferrer');
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <div className="animate-fadein space-y-4">
            <div className="grid grid-cols-[1.5fr_1fr] gap-4">
              {/* Details */}
              <div className="bg-surface-1 border border-border rounded-card p-5">
                <div className="font-semibold text-[15px] mb-4">Details</div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                  {facts.map((f) => (
                    <div key={f.label}>
                      <div className="text-xs text-text-faint mb-1">{f.label}</div>
                      <div
                        className={`text-[13.5px] font-medium break-all ${f.mono ? 'font-mono' : ''}`}
                      >
                        {f.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Resources */}
              <div className="bg-surface-1 border border-border rounded-card p-5">
                <div className="font-semibold text-[15px] mb-[18px]">Resources</div>
                {resourceBars.map((m) => (
                  <div key={m.label} className="mb-[15px]">
                    <div className="flex justify-between text-[12.5px] mb-1.5">
                      <span className="text-text-muted">{m.label}</span>
                      <span className="font-mono font-medium">{m.val}</span>
                    </div>
                    {percentWidth(m.val) && (
                      <div className="h-[7px] rounded bg-surface-3 overflow-hidden">
                        <div
                          className="h-full rounded"
                          style={{ width: percentWidth(m.val)!, background: m.color }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Jobs */}
            <JobTracker
              deploymentId={deployment.id}
              maxJobs={3}
              autoRefresh={true}
              onJobClick={(job) => {
                // Switch to logs tab and show job logs if available
                setActiveTab('logs');
                setSearchParams({ tab: 'logs', jobId: job.id });
              }}
            />
          </div>
        );

      case 'logs': {
        const jobId = searchParams.get('jobId');
        return (
          <div className="animate-fadein bg-surface-1 border border-border rounded-card overflow-hidden">
            <div className="flex items-center gap-[10px] px-4 py-3 border-b border-border-soft">
              <span className="relative flex w-2 h-2">
                <span className="absolute inset-0 rounded-full bg-success" />
                <span className="absolute inset-0 rounded-full bg-success animate-ping-fast" />
              </span>
              <span className="text-[13px] font-semibold">Live logs</span>
              <div className="flex-1" />
            </div>
            <LogsViewer
              deploymentId={deployment.id}
              jobId={jobId || undefined}
              title={jobId ? `Job ${jobId} Logs` : 'Application Logs'}
              maxHeight="max-h-[600px]"
              showJobStatus={!!jobId}
            />
          </div>
        );
      }

      case 'metrics':
        return (
          <div className="animate-fadein grid grid-cols-2 gap-4">
            {resourceBars.map((m) => (
              <div
                key={m.label}
                className="bg-surface-1 border border-border rounded-card p-[18px]"
              >
                <div className="flex justify-between items-baseline mb-[14px]">
                  <span className="text-[13.5px] text-text-muted font-medium">{m.label}</span>
                  <span
                    className="font-mono text-base font-semibold"
                    style={{ color: m.color }}
                  >
                    {m.val}
                  </span>
                </div>
                <div className="flex items-end gap-[3px] h-20">
                  {SPARK_BARS.map((h, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-[2px] opacity-55"
                      style={{ height: `${h}%`, background: m.color }}
                    />
                  ))}
                </div>
                <div className="flex justify-between text-[11px] text-text-faint mt-2 font-mono">
                  <span>-5m</span>
                  <span>now</span>
                </div>
              </div>
            ))}
          </div>
        );

      case 'backups':
        return (
          <div className="animate-fadein bg-surface-1 border border-border rounded-card overflow-hidden">
            <div className="flex items-center justify-between px-[18px] py-4 border-b border-border-soft">
              <div className="font-semibold text-[15px]">Backups for this app</div>
              <button
                onClick={() => setActiveTab('history')}
                className="h-[34px] px-[13px] flex items-center gap-[7px] bg-primary-weak text-primary rounded-lg text-[13px] font-semibold hover:bg-primary hover:text-white transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create backup
              </button>
            </div>
            <div className="flex flex-col items-center justify-center text-center px-5 py-16">
              <Shield className="w-10 h-10 text-text-faint mb-4" />
              <h3 className="text-[15px] font-semibold mb-1">No backups yet</h3>
              <p className="text-text-muted text-sm max-w-[360px]">
                Backups for this app will appear here once they have been created.
              </p>
            </div>
          </div>
        );

      case 'configuration':
        return (
          <div className="animate-fadein flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[15px]">Current Configuration</h3>
              <button
                onClick={() => {
                  if (isEditing) {
                    saveConfiguration();
                  } else {
                    setIsEditing(true);
                  }
                }}
                disabled={operationLoading['save-config']}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center space-x-2 disabled:opacity-50 ${
                  isEditing
                    ? 'bg-success text-primary-contrast hover:bg-success/90'
                    : 'bg-primary text-primary-contrast hover:bg-primary/90'
                }`}
              >
                <Edit className="w-4 h-4" />
                <span>
                  {operationLoading['save-config'] ? 'Saving...' : (isEditing ? 'Save Changes' : 'Edit Configuration')}
                </span>
              </button>
            </div>

            {/* Environment variables */}
            <div className="bg-surface-1 border border-border rounded-card overflow-hidden">
              <div className="flex items-center justify-between px-[18px] py-[14px] border-b border-border-soft">
                <div className="font-semibold text-[15px]">Environment variables</div>
                {isEditing && (
                  <button
                    onClick={addDeploymentEnvVar}
                    className="h-[34px] px-[13px] flex items-center gap-[7px] bg-surface-2 text-text-strong border border-border rounded-lg text-[13px] font-semibold hover:border-primary transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Variable</span>
                  </button>
                )}
              </div>

              {deploymentEnvVars.map((envVar, index) => {
                const showValue = envVar.isSecret && !showSecrets[envVar.key];
                return (
                  <div
                    key={index}
                    className="flex items-center gap-[14px] px-[18px] py-[11px] border-b border-border-soft"
                  >
                    {isEditing ? (
                      <>
                        <input
                          type="text"
                          placeholder="VARIABLE_NAME"
                          value={envVar.key}
                          onChange={(e) => updateDeploymentEnvVar(index, 'key', e.target.value)}
                          className="w-[170px] flex-none px-3 py-1 bg-surface-0 border border-border rounded text-[12.5px] font-mono"
                        />
                        <input
                          type={showValue ? 'password' : 'text'}
                          value={envVar.value}
                          onChange={(e) => updateDeploymentEnvVar(index, 'value', e.target.value)}
                          className="flex-1 px-3 py-1 bg-surface-0 border border-border rounded text-[12.5px] font-mono"
                        />
                        <label className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={envVar.isSecret}
                            onChange={(e) => updateDeploymentEnvVar(index, 'isSecret', e.target.checked)}
                            className="w-4 h-4 text-primary bg-surface-0 border-border rounded focus:ring-primary/50"
                          />
                          <span className="text-xs text-text-muted">Secret</span>
                        </label>
                        {envVar.isSecret && (
                          <button
                            type="button"
                            onClick={() => toggleSecretVisibility(envVar.key)}
                            className="flex text-text-faint hover:text-text-strong transition-colors"
                          >
                            {showSecrets[envVar.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        )}
                        <button
                          onClick={() => removeDeploymentEnvVar(index)}
                          className="flex text-text-muted hover:text-danger transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="font-mono text-[12.5px] text-text-muted w-[170px] flex-none break-all">
                          {envVar.key}
                        </span>
                        <span className="flex-1 font-mono text-[12.5px] break-all">
                          {showValue ? '••••••••' : envVar.value}
                        </span>
                        {envVar.isSecret && (
                          <button
                            type="button"
                            onClick={() => toggleSecretVisibility(envVar.key)}
                            className="flex text-text-faint hover:text-text-strong transition-colors"
                          >
                            {showSecrets[envVar.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {/* System Environment Variables */}
            <div className="bg-surface-1 border border-border rounded-card overflow-hidden">
              <div className="flex items-center justify-between px-[18px] py-[14px] border-b border-border-soft">
                <div className="font-semibold text-[15px]">System Environment Variables</div>
                <div className="text-xs text-text-faint">
                  Inherited from system settings · Override only when needed
                </div>
              </div>

              {systemEnvVars.map((envVar) => {
                const isOverridden = Object.prototype.hasOwnProperty.call(deploymentOverrides, envVar.key);
                const currentValue = isOverridden ? deploymentOverrides[envVar.key] : envVar.value;
                const showValue = envVar.isSecret && !showSecrets[envVar.key];

                return (
                  <div
                    key={envVar.key}
                    className="flex items-center gap-[14px] px-[18px] py-[11px] border-b border-border-soft"
                  >
                    <span className="font-mono text-[12.5px] text-text-muted w-[170px] flex-none flex items-center gap-2 break-all">
                      {envVar.key}
                      {isOverridden && (
                        <span className="text-[10px] bg-warning text-primary-contrast px-1.5 py-0.5 rounded font-semibold">
                          OVERRIDDEN
                        </span>
                      )}
                    </span>
                    {isEditing ? (
                      <>
                        <input
                          type={showValue ? 'password' : 'text'}
                          value={currentValue}
                          onChange={(e) => updateSystemOverride(envVar.key, e.target.value)}
                          className="flex-1 px-3 py-1 bg-surface-0 border border-border rounded text-[12.5px] font-mono"
                          placeholder={envVar.value || 'Enter value...'}
                        />
                        {envVar.isSecret && (
                          <button
                            type="button"
                            onClick={() => toggleSecretVisibility(envVar.key)}
                            className="flex text-text-faint hover:text-text-strong transition-colors"
                          >
                            {showSecrets[envVar.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        )}
                        {isOverridden && (
                          <button
                            onClick={() => resetSystemOverride(envVar.key)}
                            className="flex text-text-muted hover:text-warning transition-colors"
                            title="Reset to system default"
                          >
                            <RotateCw className="w-4 h-4" />
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="flex-1 font-mono text-[12.5px] break-all">
                          {showValue ? '••••••••' : (currentValue || '(empty)')}
                        </span>
                        {envVar.isSecret && (
                          <button
                            type="button"
                            onClick={() => toggleSecretVisibility(envVar.key)}
                            className="flex text-text-faint hover:text-text-strong transition-colors"
                          >
                            {showSecrets[envVar.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}

              {Object.keys(deploymentOverrides).length > 0 && (
                <div className="m-[18px] bg-warning/10 border border-warning/20 rounded-lg p-4">
                  <div className="flex items-start space-x-3">
                    <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <div className="font-medium text-warning">System Variable Overrides</div>
                      <div className="text-text-muted mt-1">
                        This deployment overrides {Object.keys(deploymentOverrides).length} system variable(s).
                        Changes will only affect this deployment.
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Materialized Compose · read-only */}
            <div className="bg-surface-1 border border-border rounded-card overflow-hidden">
              <div className="flex items-center justify-between px-[18px] py-[14px] border-b border-border-soft">
                <div className="font-semibold text-[15px]">
                  Materialized Compose{' '}
                  <span className="text-xs text-text-faint font-normal">· read-only</span>
                </div>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(composePreview)}
                  className="flex items-center gap-1.5 text-[12.5px] text-text-muted hover:text-text-strong transition-colors"
                >
                  <Copy className="w-4 h-4" />
                  Copy
                </button>
              </div>
              <pre className="m-0 p-[16px_18px] font-mono text-[12.5px] leading-relaxed text-text-muted overflow-x-auto">
                {composePreview}
              </pre>
            </div>

            {/* Port Mappings */}
            <div className="bg-surface-1 border border-border rounded-card overflow-hidden">
              <div className="px-[18px] py-[14px] border-b border-border-soft font-semibold text-[15px]">
                Port Mappings
              </div>
              {deployment.ports.map((port) => (
                <div
                  key={port}
                  className="flex items-center justify-between px-[18px] py-[11px] border-b border-border-soft"
                >
                  <span className="font-mono text-[12.5px]">{port}</span>
                  <span className="text-xs text-success">Available</span>
                </div>
              ))}
            </div>
          </div>
        );

      case 'history':
        return (
          <div className="animate-fadein flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[15px]">Release &amp; job history</h3>
              <button
                onClick={() => refetchHistory()}
                className="px-4 py-2 bg-primary text-primary-contrast rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors flex items-center space-x-2"
              >
                <RotateCw className="w-4 h-4" />
                <span>Refresh</span>
              </button>
            </div>

            {historyLoading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
                <p className="text-text-muted">Loading history...</p>
              </div>
            ) : (
              <div className="bg-surface-1 border border-border rounded-card overflow-hidden">
                {historyData?.items?.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-[14px] px-[18px] py-[14px] border-b border-border-soft"
                  >
                    <span className="w-[34px] h-[34px] flex-none rounded-[9px] bg-surface-2 flex items-center justify-center">
                      <StatusDot status={item.status} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-medium capitalize">
                        {item.type} {item.status === 'failed' ? 'failed' : 'completed'}
                      </div>
                      <div className="text-xs text-text-faint mt-0.5">
                        Started {formatDateTime(item.startedAt)}
                      </div>
                    </div>
                    {item.finishedAt && (
                      <span className="font-mono text-xs text-text-faint">
                        {getDuration(item.startedAt, item.finishedAt)}
                      </span>
                    )}
                    <StatusBadge status={item.status} dot={false} />
                    {item.finishedAt && (
                      <span className="text-[12.5px] text-text-faint w-24 text-right">
                        {formatDateTime(item.finishedAt)}
                      </span>
                    )}
                  </div>
                ))}

                {historyData?.items?.length === 0 && !historyLoading && (
                  <div className="text-center py-12">
                    <Clock className="w-12 h-12 text-text-muted mx-auto mb-4" />
                    <h3 className="text-lg font-medium mb-2">No history found</h3>
                    <p className="text-text-muted">No deployment activities have been recorded yet.</p>
                  </div>
                )}

                {/* Pagination */}
                {historyData && historyData.total > 10 && (
                  <div className="px-4 py-3 bg-surface-2 border-t border-border flex items-center justify-between">
                    <div className="text-sm text-text-muted">
                      Showing {((historyPage - 1) * 10) + 1} to {Math.min(historyPage * 10, historyData.total)} of {historyData.total} activities
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => setHistoryPage(historyPage - 1)}
                        disabled={historyPage <= 1}
                        className="p-2 text-text-muted hover:text-text-strong disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>

                      <span className="px-3 py-1 text-sm">
                        Page {historyPage} of {Math.ceil(historyData.total / 10)}
                      </span>

                      <button
                        onClick={() => setHistoryPage(historyPage + 1)}
                        disabled={historyPage >= Math.ceil(historyData.total / 10)}
                        className="p-2 text-text-muted hover:text-text-strong disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );

      default:
        return (
          <div className="text-center py-12">
            <div className="text-text-muted">Content for {activeTab} tab coming soon...</div>
          </div>
        );
    }
  };

  return (
    <div className="animate-fadein">
      {/* Removal confirmation dialog */}
      {showUpgradeConfirm && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => { if (!operationLoading.upgrade) setShowUpgradeConfirm(false); }}
        >
          <div
            className="bg-surface-0 rounded-xl border border-border w-full max-w-md overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="upgrade-dialog-title"
          >
            <div className="p-6">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full bg-primary-weak text-primary">
                  <ArrowUpCircle className="w-[18px] h-[18px]" />
                </div>
                <div className="min-w-0">
                  <h2 id="upgrade-dialog-title" className="text-lg font-semibold m-0">
                    Upgrade {deployment.name} to {deployment.latestVersion}?
                  </h2>
                  <p className="mt-1.5 text-sm text-text-muted">
                    Your settings and secrets carry forward. If this release is marked breaking or
                    requires a backup, Hola takes a pre-upgrade snapshot first — you can roll back to it.
                  </p>
                </div>
              </div>

              {upgradeError && (
                <div className="mt-4 flex items-start gap-2 text-sm text-danger bg-danger-weak rounded-[9px] p-3">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{upgradeError}</span>
                </div>
              )}

              <div className="mt-6 flex justify-end gap-2.5">
                <button
                  onClick={() => setShowUpgradeConfirm(false)}
                  disabled={operationLoading.upgrade}
                  className="h-[38px] px-[14px] flex items-center bg-surface-2 text-text-strong border border-border rounded-[9px] text-[13.5px] font-semibold hover:border-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmUpgrade}
                  disabled={operationLoading.upgrade}
                  className="h-[38px] px-[14px] flex items-center gap-[7px] bg-primary text-white border border-transparent rounded-[9px] text-[13.5px] font-semibold hover:brightness-110 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {operationLoading.upgrade ? <RotateCw className="w-4 h-4 animate-spin" /> : <ArrowUpCircle className="w-4 h-4" />}
                  {operationLoading.upgrade ? 'Upgrading…' : `Upgrade to ${deployment.latestVersion}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRemoveConfirm && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => { if (!removing) setShowRemoveConfirm(false); }}
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
                  <h2 id="remove-dialog-title" className="text-lg font-semibold m-0">Remove {deployment.name}?</h2>
                  <p className="mt-1.5 text-sm text-text-muted">
                    This permanently removes the deployment: it stops and deletes the
                    containers, deprovisions SSO, releases the route, and deletes its
                    data. This can't be undone.
                  </p>
                </div>
              </div>

              {removeError && (
                <div className="mt-4 flex items-start gap-2 text-sm text-danger bg-danger-weak rounded-[9px] p-3">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{removeError}</span>
                </div>
              )}

              <div className="mt-6 flex justify-end gap-2.5">
                <button
                  onClick={() => setShowRemoveConfirm(false)}
                  disabled={removing}
                  className="h-[38px] px-[14px] flex items-center bg-surface-2 text-text-strong border border-border rounded-[9px] text-[13.5px] font-semibold hover:border-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRemove}
                  disabled={removing}
                  className="h-[38px] px-[14px] flex items-center gap-[7px] bg-danger text-white border border-transparent rounded-[9px] text-[13.5px] font-semibold hover:brightness-110 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {removing ? <RotateCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  {removing ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header card */}
      <div className="bg-surface-1 border border-border rounded-[14px] p-[20px_22px] mb-4">
        <div className="flex items-center gap-[15px] flex-wrap">
          <AppIcon name={deployment.name} emoji={deployment.icon} size={52} />
          <div className="min-w-0">
            <div className="flex items-center gap-[10px]">
              <span className="text-[21px] font-semibold tracking-[-0.02em]">{deployment.name}</span>
              <StatusDot status={deployment.status} />
              <StatusBadge status={deployment.status} dot={false} />
            </div>
            {deployment.url && (
              <div
                onClick={openApp}
                className="inline-flex items-center gap-1.5 mt-[5px] font-mono text-[12.5px] text-primary cursor-pointer"
              >
                <Globe className="w-3.5 h-3.5" />
                {deployment.url}
                <ExternalLink className="w-3.5 h-3.5" />
              </div>
            )}
          </div>

          <div className="flex-1" />

          {/* Actions */}
          <div className="flex gap-2 flex-wrap">
            {deployment.updateAvailable && deployment.latestVersion && (
              <button
                onClick={() => { setUpgradeError(null); setShowUpgradeConfirm(true); }}
                disabled={operationLoading.upgrade}
                title={`Upgrade to ${deployment.latestVersion}`}
                className="h-[38px] px-[14px] flex items-center gap-[7px] bg-primary text-white border border-primary rounded-[9px] text-[13.5px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                <ArrowUpCircle className="w-4 h-4" />
                {operationLoading.upgrade ? 'Upgrading…' : `Upgrade to ${deployment.latestVersion}`}
              </button>
            )}
            <button
              onClick={() => handleAction('restart')}
              className="h-[38px] px-[14px] flex items-center gap-[7px] bg-surface-2 text-text-strong border border-border rounded-[9px] text-[13.5px] font-semibold hover:border-primary transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Restart
            </button>
            <button
              onClick={() => handleAction(isRunning ? 'stop' : 'start')}
              className="h-[38px] px-[14px] flex items-center gap-[7px] bg-surface-2 text-text-strong border border-border rounded-[9px] text-[13.5px] font-semibold hover:border-primary transition-colors"
            >
              {isRunning ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {isRunning ? 'Stop' : 'Start'}
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className="h-[38px] px-[14px] flex items-center gap-[7px] bg-surface-2 text-text-strong border border-border rounded-[9px] text-[13.5px] font-semibold hover:border-primary transition-colors"
            >
              <RotateCw className="w-4 h-4" />
              Rollback
            </button>
            <button
              onClick={() => { setRemoveError(null); setShowRemoveConfirm(true); }}
              className="h-[38px] px-[14px] flex items-center gap-[7px] bg-danger-weak text-danger border border-transparent rounded-[9px] text-[13.5px] font-semibold hover:bg-danger hover:text-white transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Remove
            </button>
          </div>
        </div>

        {/* Tab bar seated on the card's bottom border */}
        <div className="flex gap-1 border-b border-border-soft -mb-5 -mx-[22px] px-[22px] mt-[18px]">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <div
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-[14px] py-[11px] text-[13.5px] font-semibold cursor-pointer border-b-2 -mb-px ${
                  isActive
                    ? 'text-text-strong border-primary'
                    : 'text-text-muted border-transparent hover:text-text-strong'
                }`}
              >
                {tab.name}
              </div>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div>{renderTabContent()}</div>
    </div>
  );
};
