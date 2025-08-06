import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogsViewer } from '../components/LogsViewer';
import { JobTracker } from '../components/JobTracker';
import {
  Server,
  Play,
  Square,
  RotateCcw,
  Trash2,
  ExternalLink,
  Search,
  MoreVertical,
  Activity,
  Settings,
  Download,
  Copy,
  Archive,
  ChevronLeft,
  ChevronRight,
  AlertTriangle
} from 'lucide-react';
import { API } from '@hola/shared';
import type { 
  DeploymentListItem, 
  DeploymentStatus, 
  PostDeploymentActionRequest,
  PostDeploymentActionResponse,
  GetDeploymentsRequest,
  GetDeploymentsResponse,
  ErrorResponse
} from '@hola/shared';



const getStatusColor = (status: DeploymentStatus) => {
  switch (status) {
    case 'running':
      return 'text-success bg-success/10 border-success/20';
    case 'stopped':
      return 'text-text-muted bg-surface-2 border-border';
    case 'updating':
    case 'installing':
      return 'text-warning bg-warning/10 border-warning/20';
    case 'error':
      return 'text-danger bg-danger/10 border-danger/20';
    default:
      return 'text-text-muted bg-surface-2 border-border';
  }
};

const getStatusIcon = (status: DeploymentStatus) => {
  switch (status) {
    case 'running':
      return <div className="w-2 h-2 bg-success rounded-full animate-pulse" />;
    case 'stopped':
      return <div className="w-2 h-2 bg-text-muted rounded-full" />;
    case 'updating':
    case 'installing':
      return <div className="w-2 h-2 bg-warning rounded-full animate-pulse" />;
    case 'error':
      return <div className="w-2 h-2 bg-danger rounded-full animate-pulse" />;
    default:
      return <div className="w-2 h-2 bg-text-muted rounded-full" />;
  }
};

export const Deployments: React.FC = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<DeploymentStatus | 'all'>('all');
  const [showLogsFor, setShowLogsFor] = useState<string | null>(null);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  
  // Pagination state
  const [page, setPage] = useState(1);
  const [limit] = useState(12); // Number of deployments per page
  const [deployments, setDeployments] = useState<DeploymentListItem[]>([]);
  const [totalDeployments, setTotalDeployments] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Job tracking state
  // TODO: Add job tracking functionality in future iterations

  // Mock data fallback (to be removed when API is fully implemented)
  const mockDeployments = useMemo<DeploymentListItem[]>(() => [
    {
      id: 'nextcloud-prod',
      name: 'Nextcloud',
      app: 'nextcloud',
      icon: '☁️',
      status: 'running',
      uptime: '15 days',
      version: '28.0.2',
      resources: { cpu: '12%', memory: '256MB' },
      ports: ['8080:80', '8443:443'],
      lastUpdated: '2 days ago',
      url: 'https://nextcloud.local',
    },
    {
      id: 'homeassistant-main',
      name: 'Home Assistant',
      app: 'homeassistant',
      icon: '🏠',
      status: 'running',
      uptime: '32 days',
      version: '2024.1.5',
      resources: { cpu: '8%', memory: '180MB' },
      ports: ['8123:8123'],
      lastUpdated: '5 days ago',
      url: 'https://hass.local',
    },
    {
      id: 'plex-media',
      name: 'Plex Media Server',
      app: 'plex',
      icon: '🎬',
      status: 'installing',
      uptime: '8 days',
      version: '1.40.1',
      resources: { cpu: '25%', memory: '512MB' },
      ports: ['32400:32400'],
      lastUpdated: 'Now',
      url: 'https://plex.local',
    },
    {
      id: 'grafana-monitoring',
      name: 'Grafana',
      app: 'grafana',
      icon: '📊',
      status: 'stopped',
      uptime: '0 days',
      version: '10.3.1',
      resources: { cpu: '0%', memory: '0MB' },
      ports: ['3000:3000'],
      lastUpdated: '1 hour ago',
      url: 'https://grafana.local',
    },
    {
      id: 'bitwarden-vault',
      name: 'Bitwarden',
      app: 'bitwarden',
      icon: '🔐',
      status: 'running',
      uptime: '45 days',
      version: '1.30.1',
      resources: { cpu: '3%', memory: '128MB' },
      ports: ['8000:80'],
      lastUpdated: '1 week ago',
      url: 'https://vault.local',
    },
  ], []);

  // Load deployments from API
  const loadDeployments = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const request: GetDeploymentsRequest = {
        page,
        limit,
        q: searchTerm || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter
      };

      // Build query string
      const params = new URLSearchParams();
      if (request.page) params.append('page', request.page.toString());
      if (request.limit) params.append('limit', request.limit.toString());
      if (request.q) params.append('q', request.q);
      if (request.status) params.append('status', request.status);

      const response = await fetch(`${API.deployments.base}?${params.toString()}`);
      
      if (!response.ok) {
        const errorData: ErrorResponse = await response.json();
        throw new Error(errorData.error.message);
      }
      
      const data: GetDeploymentsResponse = await response.json();
      setDeployments(data.items);
      setTotalDeployments(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deployments');
      // Fallback to mock data for development
      setDeployments([...mockDeployments]);
      setTotalDeployments(mockDeployments.length);
    } finally {
      setLoading(false);
    }
  }, [page, limit, searchTerm, statusFilter, mockDeployments]);

  useEffect(() => {
    loadDeployments();
  }, [loadDeployments]);

  const handleAction = async (deploymentId: string, action: 'start' | 'stop' | 'restart' | 'delete') => {
    try {
      const request: PostDeploymentActionRequest = { action };
      const response = await fetch(API.deployments.actions(deploymentId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      });
      
      if (!response.ok) {
        const errorData: ErrorResponse = await response.json();
        throw new Error(errorData.error.message);
      }
      
      const result: PostDeploymentActionResponse = await response.json();
      
      // If a job was created, track it
      if (result.jobId) {
        // In a real app, you'd poll the job status
        console.log(`Job ${result.jobId} started for ${action} on ${deploymentId}`);
      }
      
      // Refresh deployments list
      await loadDeployments();
    } catch (error) {
      console.error(`Error performing ${action}:`, error);
      setError(error instanceof Error ? error.message : `Failed to ${action} deployment`);
    }
  };

  // Calculate pagination info
  const totalPages = Math.ceil(totalDeployments / limit);
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;

  const filteredDeployments = searchTerm || statusFilter !== 'all' 
    ? deployments.filter(deployment => {
        const matchesSearch = deployment.name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = statusFilter === 'all' || deployment.status === statusFilter;
        return matchesSearch && matchesStatus;
      })
    : deployments;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Deployments</h1>
          <p className="text-text-muted mt-1">Manage your deployed applications</p>
        </div>
        <Link
          to="/catalog"
          className="bg-primary text-primary-contrast px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Deploy New App
        </Link>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4">
        <div className="relative flex-grow">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search deployments..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-surface-1 border border-border rounded-lg text-sm placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as DeploymentStatus | 'all')}
          className="px-3 py-2 bg-surface-1 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
        >
          <option value="all">All Status</option>
          <option value="running">Running</option>
          <option value="stopped">Stopped</option>
          <option value="installing">Installing</option>
          <option value="updating">Updating</option>
          <option value="error">Error</option>
        </select>
      </div>

      {/* Job Tracker */}
      <div className="mb-6">
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
        <div className="bg-danger/10 border border-danger/20 text-danger rounded-lg p-4 mb-6">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-5 h-5" />
            <span className="font-medium">Error loading deployments</span>
          </div>
          <p className="text-sm mt-1">{error}</p>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-text-muted">Loading deployments...</p>
        </div>
      )}

      {/* Deployments Grid */}
      {!loading && (
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredDeployments.map(deployment => (
          <div key={deployment.id} className="bg-surface-1 rounded-lg border border-border overflow-hidden hover:border-primary/50 transition-colors">
            {/* Header */}
            <div className="p-4 border-b border-border">
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                  <div className="text-xl">{deployment.icon}</div>
                  <div>
                    <h3 className="font-medium">{deployment.name}</h3>
                    <div className="flex items-center space-x-2 mt-1">
                      {getStatusIcon(deployment.status)}
                      <span className={`text-xs px-2 py-1 rounded border capitalize ${getStatusColor(deployment.status)}`}>
                        {deployment.status}
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center space-x-1">
                  {deployment.url && (
                    <a 
                      href={deployment.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 text-text-muted hover:text-text-strong transition-colors"
                      title="Open App"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                  <div className="relative">
                    <button 
                      onClick={() => setOpenDropdown(openDropdown === deployment.id ? null : deployment.id)}
                      className="p-1.5 text-text-muted hover:text-text-strong transition-colors"
                    >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                    
                    {openDropdown === deployment.id && (
                      <div className="absolute right-0 top-8 w-48 bg-surface-1 border border-border rounded-lg shadow-lg z-10">
                        <div className="py-1">
                          <Link
                            to={`/deployments/${deployment.id}?tab=configuration`}
                            className="flex items-center space-x-2 px-3 py-2 text-sm hover:bg-surface-2 transition-colors"
                            onClick={() => setOpenDropdown(null)}
                          >
                            <Settings className="w-4 h-4" />
                            <span>Edit Configuration</span>
                          </Link>
                          
                          <button
                            onClick={() => {
                              // TODO: Implement duplicate functionality
                              setOpenDropdown(null);
                            }}
                            className="flex items-center space-x-2 px-3 py-2 text-sm hover:bg-surface-2 transition-colors w-full text-left"
                          >
                            <Copy className="w-4 h-4" />
                            <span>Duplicate</span>
                          </button>
                          
                          <button
                            onClick={() => {
                              // TODO: Implement export functionality
                              setOpenDropdown(null);
                            }}
                            className="flex items-center space-x-2 px-3 py-2 text-sm hover:bg-surface-2 transition-colors w-full text-left"
                          >
                            <Download className="w-4 h-4" />
                            <span>Export Config</span>
                          </button>
                          
                          <div className="border-t border-border my-1"></div>
                          
                          <button
                            onClick={() => {
                              // TODO: Implement archive functionality
                              setOpenDropdown(null);
                            }}
                            className="flex items-center space-x-2 px-3 py-2 text-sm hover:bg-surface-2 transition-colors w-full text-left text-warning"
                          >
                            <Archive className="w-4 h-4" />
                            <span>Archive</span>
                          </button>
                          
                          <button
                            onClick={() => {
                              handleAction(deployment.id, 'delete');
                              setOpenDropdown(null);
                            }}
                            className="flex items-center space-x-2 px-3 py-2 text-sm hover:bg-surface-2 transition-colors w-full text-left text-danger"
                          >
                            <Trash2 className="w-4 h-4" />
                            <span>Delete</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-text-muted">Uptime</span>
                  <div className="font-medium">{deployment.uptime}</div>
                </div>
                <div>
                  <span className="text-text-muted">Version</span>
                  <div className="font-medium">{deployment.version}</div>
                </div>
                <div>
                  <span className="text-text-muted">CPU</span>
                  <div className="font-medium">{deployment.resources?.cpu ?? '—'}</div>
                </div>
                <div>
                  <span className="text-text-muted">Memory</span>
                  <div className="font-medium">{deployment.resources?.memory ?? '—'}</div>
                </div>
              </div>

              {/* Ports */}
              <div>
                <span className="text-text-muted text-sm">Ports</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {deployment.ports.map((port: string) => (
                    <span key={port} className="text-xs bg-surface-2 px-2 py-1 rounded">
                      {port}
                    </span>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-2 border-t border-border">
                <div className="flex space-x-2">
                  {deployment.status === 'running' ? (
                    <button 
                      onClick={() => handleAction(deployment.id, 'stop')}
                      className="p-1.5 text-text-muted hover:text-danger transition-colors" 
                      title="Stop"
                    >
                      <Square className="w-4 h-4" />
                    </button>
                  ) : (
                    <button 
                      onClick={() => handleAction(deployment.id, 'start')}
                      className="p-1.5 text-text-muted hover:text-success transition-colors" 
                      title="Start"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  )}
                  <button 
                    onClick={() => handleAction(deployment.id, 'restart')}
                    className="p-1.5 text-text-muted hover:text-info transition-colors" 
                    title="Restart"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => handleAction(deployment.id, 'delete')}
                    className="p-1.5 text-text-muted hover:text-danger transition-colors" 
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => setShowLogsFor(showLogsFor === deployment.id ? null : deployment.id)}
                    className="p-1.5 text-text-muted hover:text-info transition-colors" 
                    title="View Logs"
                  >
                    <Activity className="w-4 h-4" />
                  </button>
                </div>

                <Link
                  to={`/deployments/${deployment.id}`}
                  className="text-sm text-primary hover:text-primary/90 font-medium"
                >
                  View Details
                </Link>
              </div>
            </div>

            {/* Footer */}
            <div className="px-4 py-2 bg-surface-2 text-xs text-text-muted">
              Last updated: {deployment.lastUpdated}
            </div>
          </div>

        ))}
      </div>
      )}

      {/* Pagination */}
      {!loading && totalDeployments > limit && (
        <div className="flex items-center justify-between mt-6">
          <div className="text-sm text-text-muted">
            Showing {((page - 1) * limit) + 1} to {Math.min(page * limit, totalDeployments)} of {totalDeployments} deployments
          </div>
          
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setPage(page - 1)}
              disabled={!hasPrevPage}
              className="p-2 text-text-muted hover:text-text-strong disabled:opacity-50 disabled:cursor-not-allowed"
              title="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            
            <span className="px-3 py-1 text-sm">
              Page {page} of {totalPages}
            </span>
            
            <button
              onClick={() => setPage(page + 1)}
              disabled={!hasNextPage}
              className="p-2 text-text-muted hover:text-text-strong disabled:opacity-50 disabled:cursor-not-allowed"
              title="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Inline Logs Viewer */}
      {showLogsFor && (
        <div className="mt-6">
          <LogsViewer 
            deploymentId={showLogsFor}
            title={`${deployments.find(d => d.id === showLogsFor)?.name} Logs`}
            maxHeight="max-h-96"
          />
        </div>
      )}

      {filteredDeployments.length === 0 && (
        <div className="text-center py-12">
          <Server className="w-12 h-12 text-text-muted mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No deployments found</h3>
          <p className="text-text-muted mb-4">Try adjusting your search criteria or deploy your first app</p>
          <Link
            to="/catalog"
            className="bg-primary text-primary-contrast px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors inline-flex items-center space-x-2"
          >
            <span>Browse Catalog</span>
          </Link>
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