import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { LogsViewer } from '../components/LogsViewer';
import { JobTracker } from '../components/JobTracker';
import {
  ArrowLeft,
  Play,
  Square,
  RotateCcw,
  Trash2,
  ExternalLink,
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
  ChevronRight
} from 'lucide-react';
import { API } from '@hola/shared';
import type {
  DeploymentDetail as DeploymentDetailType,
  AppEnvVar,
  SystemEnvVar,
  PostDeploymentActionRequest,
  PatchDeploymentRequest,
  GetDeploymentResponse,
  GetDeploymentHistoryResponse,
  DeploymentHistoryItem,
  JobStatus
} from '@hola/shared';
import { ensureOk } from '../utils/error';

// Helper functions for history tab
const getJobStatusColor = (status: JobStatus): string => {
  switch (status) {
    case 'completed':
      return 'bg-success';
    case 'running':
      return 'bg-info animate-pulse';
    case 'failed':
      return 'bg-danger';
    case 'queued':
      return 'bg-warning';
    default:
      return 'bg-text-muted';
  }
};

const getJobStatusStyle = (status: JobStatus): string => {
  switch (status) {
    case 'completed':
      return 'text-success bg-success/10 border-success/20';
    case 'running':
      return 'text-info bg-info/10 border-info/20';
    case 'failed':
      return 'text-danger bg-danger/10 border-danger/20';
    case 'queued':
      return 'text-warning bg-warning/10 border-warning/20';
    default:
      return 'text-text-muted bg-surface-2 border-border';
  }
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
  
  // Deployment data state
  const [deployment, setDeployment] = useState<DeploymentDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // History state
  const [history, setHistory] = useState<DeploymentHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  
    // Form state
  const [isEditing, setIsEditing] = useState(false);
  const [showSecrets, setShowSecrets] = useState<{[key: string]: boolean}>({});

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

  // Mock data - memoized to avoid recreating on every render
  const mockDeployment = useMemo<DeploymentDetailType>(() => ({
    id: deploymentId || '',
    name: 'Nextcloud',
    app: 'nextcloud',
    icon: '☁️',
    status: 'running',
    uptime: '15 days',
    version: '28.0.2',
    url: 'https://nextcloud.local',
    resources: { cpu: '12%', memory: '256MB', disk: '2.4GB' },
    ports: ['8080:80', '8443:443'],
    lastUpdated: '2 days ago',
  }), [deploymentId]);

  const mockHistory = useMemo<DeploymentHistoryItem[]>(() => [
    {
      id: 'job-001',
      type: 'restart',
      status: 'completed',
      startedAt: '2024-08-06T10:30:00Z',
      finishedAt: '2024-08-06T10:31:15Z'
    },
    {
      id: 'job-002',
      type: 'update',
      status: 'completed',
      startedAt: '2024-08-05T14:20:00Z',
      finishedAt: '2024-08-05T14:25:30Z'
    },
    {
      id: 'job-003',
      type: 'backup',
      status: 'completed',
      startedAt: '2024-08-04T02:00:00Z',
      finishedAt: '2024-08-04T02:05:45Z'
    },
    {
      id: 'job-004',
      type: 'start',
      status: 'failed',
      startedAt: '2024-08-03T16:45:00Z',
      finishedAt: '2024-08-03T16:45:30Z'
    }
  ], []);

  // Load deployment data from API
  const loadDeployment = useCallback(async () => {
    if (!deploymentId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(API.deployments.byId(deploymentId));
      await ensureOk(response);
      const data: GetDeploymentResponse = await response.json();
      setDeployment(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deployment');
      // Fallback to mock data for development
      setDeployment(mockDeployment);
    } finally {
      setLoading(false);
    }
  }, [deploymentId, mockDeployment]);

  // Load deployment history from API
  const loadHistory = useCallback(async (page = 1) => {
    if (!deploymentId) return;
    
    setHistoryLoading(true);
    
    try {
      const params = new URLSearchParams({ page: page.toString(), limit: '10' });
      const response = await fetch(`${API.deployments.history(deploymentId)}?${params.toString()}`);
      await ensureOk(response);
      const data: GetDeploymentHistoryResponse = await response.json();
      setHistory(data.items);
      setHistoryTotal(data.total);
      setHistoryPage(page);
    } catch (err) {
      console.error('Failed to load deployment history:', err);
      // Fallback to mock data for development
      setHistory(mockHistory);
      setHistoryTotal(mockHistory.length);
    } finally {
      setHistoryLoading(false);
    }
  }, [deploymentId, mockHistory]);

  // Load data on component mount
  useEffect(() => {
    loadDeployment();
    if (activeTab === 'history') {
      loadHistory();
    }
  }, [loadDeployment, loadHistory, activeTab]);

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
            onClick={() => loadDeployment()}
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

  const handleAction = async (action: 'start' | 'stop' | 'restart' | 'delete') => {
    try {
      const request: PostDeploymentActionRequest = { action };
      const response = await fetch(API.deployments.actions(deployment.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      });
      
      await ensureOk(response);
      // TODO: Handle response, update UI state, show success message
    } catch (error) {
      console.error(`Error performing ${action}:`, error);
      // TODO: Show error message to user
    }
  };

  const saveConfiguration = async () => {
    try {
      const request: PatchDeploymentRequest = {
        env: deploymentEnvVars,
        systemOverrides: deploymentOverrides
      };
      
      const response = await fetch(API.deployments.byId(deployment.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      });
      
      await ensureOk(response);
      setIsEditing(false);
      // TODO: Show success message
    } catch (error) {
      console.error('Error saving configuration:', error);
      // TODO: Show error message to user
    }
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <div className="space-y-6">
            {/* Endpoints */}
            <div className="bg-surface-1 rounded-lg border border-border p-6">
              <h3 className="text-lg font-medium mb-4">Service Endpoints</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-surface-2 rounded-lg">
                  <div>
                    <div className="font-medium">Web Interface</div>
                    <div className="text-sm text-text-muted">{deployment.url}</div>
                  </div>
                  {deployment.url && (
                    <a
                      href={deployment.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 bg-primary text-primary-contrast rounded-lg hover:bg-primary/90 transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Resource Usage */}
            <div className="bg-surface-1 rounded-lg border border-border p-6">
              <h3 className="text-lg font-medium mb-4">Resource Usage</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <div className="text-sm text-text-muted mb-2">CPU Usage</div>
                  <div className="text-2xl font-semibold text-info">{deployment.resources.cpu}</div>
                  <div className="w-full bg-surface-2 rounded-full h-2 mt-2">
                    <div className="bg-info h-2 rounded-full" style={{width: '12%'}}></div>
                  </div>
                </div>
                <div>
                  <div className="text-sm text-text-muted mb-2">Memory Usage</div>
                  <div className="text-2xl font-semibold text-warning">{deployment.resources.memory}</div>
                  <div className="w-full bg-surface-2 rounded-full h-2 mt-2">
                    <div className="bg-warning h-2 rounded-full" style={{width: '32%'}}></div>
                  </div>
                </div>
                <div>
                  <div className="text-sm text-text-muted mb-2">Disk Usage</div>
                  <div className="text-2xl font-semibold text-success">{deployment.resources.disk}</div>
                  <div className="w-full bg-surface-2 rounded-full h-2 mt-2">
                    <div className="bg-success h-2 rounded-full" style={{width: '24%'}}></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-surface-1 rounded-lg border border-border p-4">
                <div className="text-sm text-text-muted">Status</div>
                <div className="flex items-center space-x-2 mt-1">
                  <div className="w-2 h-2 bg-success rounded-full animate-pulse"></div>
                  <span className="font-medium capitalize">{deployment.status}</span>
                </div>
              </div>
              <div className="bg-surface-1 rounded-lg border border-border p-4">
                <div className="text-sm text-text-muted">Uptime</div>
                <div className="font-medium mt-1">{deployment.uptime}</div>
              </div>
              <div className="bg-surface-1 rounded-lg border border-border p-4">
                <div className="text-sm text-text-muted">Version</div>
                <div className="font-medium mt-1">{deployment.version}</div>
              </div>
              <div className="bg-surface-1 rounded-lg border border-border p-4">
                <div className="text-sm text-text-muted">Last Updated</div>
                <div className="font-medium mt-1">{deployment.lastUpdated}</div>
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
          <LogsViewer 
            deploymentId={deployment.id}
            jobId={jobId || undefined}
            title={jobId ? `Job ${jobId} Logs` : "Application Logs"}
            maxHeight="max-h-[600px]"
            showJobStatus={!!jobId}
          />
        );
      }

      case 'configuration':
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Current Configuration</h3>
              <button 
                onClick={() => {
                  if (isEditing) {
                    saveConfiguration();
                  } else {
                    setIsEditing(true);
                  }
                }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center space-x-2 ${
                  isEditing 
                    ? 'bg-success text-primary-contrast hover:bg-success/90' 
                    : 'bg-primary text-primary-contrast hover:bg-primary/90'
                }`}
              >
                <Edit className="w-4 h-4" />
                <span>{isEditing ? 'Save Changes' : 'Edit Configuration'}</span>
              </button>
            </div>

            {/* Deployment-Specific Environment Variables */}
            <div className="bg-surface-1 rounded-lg border border-border p-6">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-medium">Deployment-Specific Variables</h4>
                {isEditing && (
                  <button
                    onClick={addDeploymentEnvVar}
                    className="bg-surface-2 text-text-strong px-3 py-2 rounded-lg text-sm font-medium hover:bg-surface-0 transition-colors flex items-center space-x-2"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Variable</span>
                  </button>
                )}
              </div>
              
              <div className="space-y-3">
                {deploymentEnvVars.map((envVar, index) => {
                  const showValue = envVar.isSecret && !showSecrets[envVar.key];
                  
                  return (
                    <div key={index} className="p-3 border border-border rounded-lg bg-surface-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3 flex-grow">
                          <div className="min-w-0 flex-grow">
                            {isEditing ? (
                              <div className="space-y-2">
                                <input
                                  type="text"
                                  placeholder="VARIABLE_NAME"
                                  value={envVar.key}
                                  onChange={(e) => updateDeploymentEnvVar(index, 'key', e.target.value)}
                                  className="w-full px-3 py-1 bg-surface-0 border border-border rounded text-sm font-mono"
                                />
                                <input
                                  type="text"
                                  placeholder="Description (optional)"
                                  value={envVar.description}
                                  onChange={(e) => updateDeploymentEnvVar(index, 'description', e.target.value)}
                                  className="w-full px-3 py-1 bg-surface-0 border border-border rounded text-xs"
                                />
                              </div>
                            ) : (
                              <div>
                                <div className="font-mono text-sm font-medium">{envVar.key}</div>
                                {envVar.description && (
                                  <div className="text-xs text-text-muted mt-1">{envVar.description}</div>
                                )}
                              </div>
                            )}
                          </div>
                          
                          <div className="flex items-center space-x-2">
                            {isEditing ? (
                              <div className="flex items-center space-x-2">
                                <input
                                  type={showValue ? 'password' : 'text'}
                                  value={envVar.value}
                                  onChange={(e) => updateDeploymentEnvVar(index, 'value', e.target.value)}
                                  className="px-3 py-1 bg-surface-0 border border-border rounded text-sm font-mono w-48"
                                />
                                <label className="flex items-center space-x-1">
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
                                    className="p-1 text-text-muted hover:text-text-strong transition-colors"
                                  >
                                    {showSecrets[envVar.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                  </button>
                                )}
                                <button
                                  onClick={() => removeDeploymentEnvVar(index)}
                                  className="p-1 text-text-muted hover:text-danger transition-colors"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center space-x-2">
                                <span className="text-sm font-mono">
                                  {showValue ? '••••••••' : envVar.value}
                                </span>
                                {envVar.isSecret && (
                                  <button
                                    type="button"
                                    onClick={() => toggleSecretVisibility(envVar.key)}
                                    className="p-1 text-text-muted hover:text-text-strong transition-colors"
                                  >
                                    {showSecrets[envVar.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* System Environment Variables */}
            <div className="bg-surface-1 rounded-lg border border-border p-6">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-medium">System Environment Variables</h4>
                <div className="text-sm text-text-muted">
                  Inherited from system settings • Override only when needed
                </div>
              </div>
              
              <div className="space-y-3">
                {systemEnvVars.map((envVar) => {
                  const isOverridden = Object.prototype.hasOwnProperty.call(deploymentOverrides, envVar.key);
                  const currentValue = isOverridden ? deploymentOverrides[envVar.key] : envVar.value;
                  const showValue = envVar.isSecret && !showSecrets[envVar.key];
                  
                  return (
                    <div key={envVar.key} className={`p-3 border rounded-lg ${
                      isOverridden ? 'border-warning/50 bg-warning/5' : 'border-border bg-surface-2'
                    }`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3 flex-grow">
                          <div className="min-w-0 flex-grow">
                            <div className="flex items-center space-x-2">
                              <span className="font-mono text-sm font-medium">{envVar.key}</span>
                              {isOverridden && (
                                <span className="text-xs bg-warning text-primary-contrast px-2 py-0.5 rounded">
                                  OVERRIDDEN
                                </span>
                              )}
                            </div>
                            {envVar.description && (
                              <div className="text-xs text-text-muted mt-1">{envVar.description}</div>
                            )}
                          </div>
                          
                          <div className="flex items-center space-x-2">
                            {isEditing ? (
                              <div className="flex items-center space-x-2">
                                <input
                                  type={showValue ? 'password' : 'text'}
                                  value={currentValue}
                                  onChange={(e) => updateSystemOverride(envVar.key, e.target.value)}
                                  className="px-3 py-1 bg-surface-0 border border-border rounded text-sm font-mono w-48"
                                  placeholder={envVar.value || 'Enter value...'}
                                />
                                {envVar.isSecret && (
                                  <button
                                    type="button"
                                    onClick={() => toggleSecretVisibility(envVar.key)}
                                    className="p-1 text-text-muted hover:text-text-strong transition-colors"
                                  >
                                    {showSecrets[envVar.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                  </button>
                                )}
                                {isOverridden && (
                                  <button
                                    onClick={() => resetSystemOverride(envVar.key)}
                                    className="p-1 text-text-muted hover:text-warning transition-colors"
                                    title="Reset to system default"
                                  >
                                    <RotateCw className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center space-x-2">
                                <span className="text-sm font-mono">
                                  {showValue ? '••••••••' : (currentValue || '(empty)')}
                                </span>
                                {envVar.isSecret && (
                                  <button
                                    type="button"
                                    onClick={() => toggleSecretVisibility(envVar.key)}
                                    className="p-1 text-text-muted hover:text-text-strong transition-colors"
                                  >
                                    {showSecrets[envVar.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {Object.keys(deploymentOverrides).length > 0 && (
                <div className="mt-4 bg-warning/10 border border-warning/20 rounded-lg p-4">
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

            {/* Port Mappings */}
            <div className="bg-surface-1 rounded-lg border border-border p-6">
              <h4 className="font-medium mb-4">Port Mappings</h4>
              <div className="space-y-2">
                {deployment.ports.map(port => (
                  <div key={port} className="flex items-center justify-between p-3 border border-border rounded bg-surface-2">
                    <span className="font-mono text-sm">{port}</span>
                    <span className="text-xs text-success">Available</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );

      case 'history':
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Deployment History</h3>
              <button 
                onClick={() => loadHistory(1)}
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
              <div className="bg-surface-1 rounded-lg border border-border overflow-hidden">
                <div className="divide-y divide-border">
                  {history.map((item) => (
                    <div key={item.id} className="p-4 hover:bg-surface-2 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className={`w-2 h-2 rounded-full ${getJobStatusColor(item.status)}`} />
                          <div>
                            <div className="font-medium capitalize">
                              {item.type} {item.status === 'failed' ? 'failed' : 'completed'}
                            </div>
                            <div className="text-sm text-text-muted">
                              Started: {formatDateTime(item.startedAt)}
                              {item.finishedAt && (
                                <span> • Finished: {formatDateTime(item.finishedAt)}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className={`px-2 py-1 text-xs rounded border capitalize ${getJobStatusStyle(item.status)}`}>
                            {item.status}
                          </span>
                          {item.finishedAt && (
                            <span className="text-xs text-text-muted">
                              {getDuration(item.startedAt, item.finishedAt)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {history.length === 0 && !historyLoading && (
                  <div className="text-center py-12">
                    <Clock className="w-12 h-12 text-text-muted mx-auto mb-4" />
                    <h3 className="text-lg font-medium mb-2">No history found</h3>
                    <p className="text-text-muted">No deployment activities have been recorded yet.</p>
                  </div>
                )}

                {/* Pagination */}
                {historyTotal > 10 && (
                  <div className="px-4 py-3 bg-surface-2 border-t border-border flex items-center justify-between">
                    <div className="text-sm text-text-muted">
                      Showing {((historyPage - 1) * 10) + 1} to {Math.min(historyPage * 10, historyTotal)} of {historyTotal} activities
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => loadHistory(historyPage - 1)}
                        disabled={historyPage <= 1}
                        className="p-2 text-text-muted hover:text-text-strong disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      
                      <span className="px-3 py-1 text-sm">
                        Page {historyPage} of {Math.ceil(historyTotal / 10)}
                      </span>
                      
                      <button
                        onClick={() => loadHistory(historyPage + 1)}
                        disabled={historyPage >= Math.ceil(historyTotal / 10)}
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-4">
        <Link to="/deployments" className="p-2 hover:bg-surface-1 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        
        <div className="flex items-center space-x-3 flex-grow">
          <div className="text-2xl">{deployment.icon}</div>
          <div>
            <h1 className="text-2xl font-semibold">{deployment.name}</h1>
            <div className="flex items-center space-x-2 mt-1">
              <div className="w-2 h-2 bg-success rounded-full animate-pulse"></div>
              <span className="text-sm text-text-muted capitalize">{deployment.status}</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex space-x-2">
          <button 
            onClick={() => handleAction('start')}
            className="p-2 bg-surface-1 border border-border rounded-lg hover:bg-surface-2 transition-colors" 
            title="Start"
          >
            <Play className="w-4 h-4" />
          </button>
          <button 
            onClick={() => handleAction('stop')}
            className="p-2 bg-surface-1 border border-border rounded-lg hover:bg-surface-2 transition-colors" 
            title="Stop"
          >
            <Square className="w-4 h-4" />
          </button>
          <button 
            onClick={() => handleAction('restart')}
            className="p-2 bg-surface-1 border border-border rounded-lg hover:bg-surface-2 transition-colors" 
            title="Restart"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button 
            onClick={() => handleAction('delete')}
            className="p-2 bg-surface-1 border border-border rounded-lg hover:bg-surface-2 transition-colors text-danger" 
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="flex space-x-8">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-text-muted hover:text-text-strong hover:border-border'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.name}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div>
        {renderTabContent()}
      </div>
    </div>
  );
};