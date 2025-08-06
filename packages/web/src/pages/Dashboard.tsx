import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  Server, 
  Activity, 
  AlertTriangle, 
  Package, 
  Clock,
  CheckCircle,
  XCircle,
  Play
} from 'lucide-react';

const kpiCards = [
  {
    title: 'Active Deployments',
    value: '5',
    subtitle: '2 updating',
    icon: Server,
    color: 'text-success',
  },
  {
    title: 'Jobs Running',
    value: '2',
    subtitle: 'Install in progress',
    icon: Activity,
    color: 'text-info',
  },
  {
    title: 'Alerts',
    value: '1',
    subtitle: 'Low disk space',
    icon: AlertTriangle,
    color: 'text-warning',
  },
];

const recentJobs = [
  {
    id: '1',
    deploymentId: 'nextcloud-prod',
    type: 'install',
    app: 'Nextcloud',
    status: 'running',
    progress: 65,
    timestamp: '2 minutes ago',
  },
  {
    id: '2',
    deploymentId: 'homeassistant-main',
    type: 'update',
    app: 'Home Assistant',
    status: 'completed',
    progress: 100,
    timestamp: '15 minutes ago',
  },
  {
    id: '3',
    deploymentId: 'plex-media',
    type: 'backup',
    app: 'Plex Media Server',
    status: 'failed',
    progress: 0,
    timestamp: '1 hour ago',
  },
  {
    id: '4',
    deploymentId: 'grafana-monitoring',
    type: 'install',
    app: 'Grafana',
    status: 'completed',
    progress: 100,
    timestamp: '2 hours ago',
  },
];

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'running':
      return <Activity className="w-4 h-4 text-info animate-pulse" />;
    case 'completed':
      return <CheckCircle className="w-4 h-4 text-success" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-danger" />;
    default:
      return <Clock className="w-4 h-4 text-text-muted" />;
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'running':
      return 'text-info';
    case 'completed':
      return 'text-success';
    case 'failed':
      return 'text-danger';
    default:
      return 'text-text-muted';
  }
};

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();

  const handleJobClick = (job: typeof recentJobs[0]) => {
    // Navigate to deployment detail page with logs tab active
    navigate(`/deployments/${job.deploymentId}?tab=logs`);
  };

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

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 gap-6">
        {/* Recent Jobs */}
        <div className="bg-surface-1 rounded-lg border border-border max-w-2xl">
          <div className="p-6 border-b border-border">
            <h2 className="text-lg font-medium">Recent Jobs</h2>
            <p className="text-text-muted text-sm mt-1">Latest deployment and maintenance activities</p>
          </div>
          
          <div className="p-6">
            <div className="space-y-4">
              {recentJobs.map((job) => (
                <div 
                  key={job.id} 
                  className="flex items-center space-x-4 p-4 bg-surface-2 rounded-lg hover:bg-surface-1 transition-colors cursor-pointer"
                  onClick={() => handleJobClick(job)}
                >
                  <div className="flex-shrink-0">
                    {getStatusIcon(job.status)}
                  </div>
                  
                  <div className="flex-grow min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium truncate">
                        {job.type === 'install' ? 'Installing' : job.type === 'update' ? 'Updating' : 'Backing up'} {job.app}
                      </p>
                      <span className={`text-xs font-medium ${getStatusColor(job.status)} capitalize`}>
                        {job.status}
                      </span>
                    </div>
                    
                    {job.status === 'running' && (
                      <div className="mt-2">
                        <div className="flex justify-between text-xs text-text-muted mb-1">
                          <span>Progress</span>
                          <span>{job.progress}%</span>
                        </div>
                        <div className="w-full bg-surface-0 rounded-full h-2">
                          <div 
                            className="bg-info h-2 rounded-full transition-all duration-300"
                            style={{ width: `${job.progress}%` }}
                          />
                        </div>
                      </div>
                    )}
                    
                    <p className="text-xs text-text-muted mt-1">{job.timestamp}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

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