// Deployment mock data and state
import type {
  DeploymentListItem,
  DeploymentDetail,
  DeploymentStatus,
  GetDeploymentsResponse,
  GetDeploymentResponse,
  GetDeploymentHistoryResponse,
  DeploymentHistoryItem
} from '@hola/shared';
import { stateManager, type MockDeployment } from './state-manager';

// Initialize deployment data from web component mock data
const initialDeployments: MockDeployment[] = [
  {
    id: 'nextcloud-prod',
    name: 'Nextcloud',
    app: 'nextcloud',
    icon: '☁️',
    status: 'running',
    version: '28.0.2',
    resources: { cpu: '12%', memory: '256MB' },
    ports: ['8080:80', '8443:443'],
    lastUpdated: '2 days ago',
    url: 'https://nextcloud.local',
    startedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 days ago
  },
  {
    id: 'homeassistant-main',
    name: 'Home Assistant',
    app: 'homeassistant',
    icon: '🏠',
    status: 'running',
    version: '2024.1.5',
    resources: { cpu: '8%', memory: '180MB' },
    ports: ['8123:8123'],
    lastUpdated: '5 days ago',
    url: 'https://hass.local',
    startedAt: new Date(Date.now() - 32 * 24 * 60 * 60 * 1000), // 32 days ago
  },
  {
    id: 'plex-media',
    name: 'Plex Media Server',
    app: 'plex',
    icon: '🎬',
    status: 'installing',
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
    version: '1.30.1',
    resources: { cpu: '3%', memory: '128MB' },
    ports: ['8000:80'],
    lastUpdated: '1 week ago',
    url: 'https://vault.local',
    startedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000), // 45 days ago
  },
];

// Initialize state manager with deployments
for (const deployment of initialDeployments) {
  stateManager.setDeployment(deployment.id, deployment);
}

// Create initial installation job for Plex to demonstrate job simulation
stateManager.createJob({
  id: 'plex-install-job',
  type: 'install',
  deploymentId: 'plex-media',
  status: 'running',
  progress: 65,
});

// Mock deployment history data
const deploymentHistoryData: Record<string, DeploymentHistoryItem[]> = {
  'nextcloud-prod': [
    {
      id: 'h1',
      type: 'install',
      status: 'completed',
      startedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
      finishedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000 + 10 * 60 * 1000).toISOString(),
    },
    {
      id: 'h2',
      type: 'restart',
      status: 'completed',
      startedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      finishedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + 2 * 60 * 1000).toISOString(),
    },
    {
      id: 'h3',
      type: 'update',
      status: 'completed',
      startedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      finishedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 5 * 60 * 1000).toISOString(),
    },
  ],
  'homeassistant-main': [
    {
      id: 'h4',
      type: 'install',
      status: 'completed',
      startedAt: new Date(Date.now() - 32 * 24 * 60 * 60 * 1000).toISOString(),
      finishedAt: new Date(Date.now() - 32 * 24 * 60 * 60 * 1000 + 8 * 60 * 1000).toISOString(),
    },
    {
      id: 'h5',
      type: 'update',
      status: 'completed',
      startedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      finishedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000 + 3 * 60 * 1000).toISOString(),
    },
  ],
  'plex-media': [
    {
      id: 'h6',
      type: 'install',
      status: 'running',
      startedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 minutes ago
    },
  ],
  'grafana-monitoring': [
    {
      id: 'h7',
      type: 'install',
      status: 'completed',
      startedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      finishedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000 + 4 * 60 * 1000).toISOString(),
    },
    {
      id: 'h8',
      type: 'stop',
      status: 'completed',
      startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
      finishedAt: new Date(Date.now() - 60 * 60 * 1000 + 30 * 1000).toISOString(),
    },
  ],
  'bitwarden-vault': [
    {
      id: 'h9',
      type: 'install',
      status: 'completed',
      startedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
      finishedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000 + 6 * 60 * 1000).toISOString(),
    },
  ],
};

// Helper functions
function convertToListItem(deployment: MockDeployment): DeploymentListItem {
  const uptime = deployment.startedAt ? stateManager.getUptime(deployment.startedAt) : '0 days';
  
  return {
    id: deployment.id,
    name: deployment.name,
    app: deployment.app,
    icon: deployment.icon,
    status: deployment.status,
    uptime,
    version: deployment.version,
    resources: deployment.resources,
    ports: deployment.ports,
    lastUpdated: deployment.lastUpdated,
    url: deployment.url,
  };
}

function convertToDetail(deployment: MockDeployment): DeploymentDetail {
  const uptime = deployment.startedAt ? stateManager.getUptime(deployment.startedAt) : '0 days';
  
  return {
    id: deployment.id,
    name: deployment.name,
    app: deployment.app,
    icon: deployment.icon,
    status: deployment.status,
    uptime,
    version: deployment.version,
    url: deployment.url,
    resources: {
      cpu: deployment.resources?.cpu || '0%',
      memory: deployment.resources?.memory || '0MB',
      disk: deployment.resources?.disk,
    },
    ports: deployment.ports,
    lastUpdated: deployment.lastUpdated,
  };
}

function applyFilters(
  deployments: MockDeployment[],
  filters: {
    q?: string;
    status?: DeploymentStatus;
  }
): MockDeployment[] {
  return deployments.filter(deployment => {
    // Search filter
    if (filters.q) {
      const query = filters.q.toLowerCase();
      const matchesName = deployment.name.toLowerCase().includes(query);
      const matchesApp = deployment.app.toLowerCase().includes(query);
      if (!matchesName && !matchesApp) {
        return false;
      }
    }

    // Status filter
    if (filters.status && deployment.status !== filters.status) {
      return false;
    }

    return true;
  });
}

function paginateResults<T>(items: T[], page: number, limit: number): {
  items: T[];
  page: number;
  limit: number;
  total: number;
} {
  const total = items.length;
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  const paginatedItems = items.slice(startIndex, endIndex);

  return {
    items: paginatedItems,
    page,
    limit,
    total,
  };
}

// Export functions for API handlers
export function getDeployments(params: {
  page?: number;
  limit?: number;
  q?: string;
  status?: DeploymentStatus | 'all';
}): GetDeploymentsResponse {
  const { page = 1, limit = 12, q, status } = params;
  
  const allDeployments = stateManager.getAllDeployments();
  const statusFilter = status === 'all' ? undefined : status;
  
  const filteredDeployments = applyFilters(allDeployments, {
    q,
    status: statusFilter,
  });

  const deploymentItems = filteredDeployments.map(convertToListItem);
  
  return paginateResults(deploymentItems, page, limit);
}

export function getDeploymentById(deploymentId: string): GetDeploymentResponse | null {
  const deployment = stateManager.getDeployment(deploymentId);
  if (!deployment) {
    return null;
  }
  
  return convertToDetail(deployment);
}

export function getDeploymentHistory(
  deploymentId: string,
  params: { page?: number; limit?: number }
): GetDeploymentHistoryResponse | null {
  const { page = 1, limit = 10 } = params;
  
  const deployment = stateManager.getDeployment(deploymentId);
  if (!deployment) {
    return null;
  }

  const historyItems = deploymentHistoryData[deploymentId] || [];
  
  return paginateResults(historyItems, page, limit);
}

export function executeDeploymentAction(
  deploymentId: string,
  action: 'start' | 'stop' | 'restart' | 'delete'
): { ok: boolean; jobId?: string } {
  const deployment = stateManager.getDeployment(deploymentId);
  if (!deployment) {
    return { ok: false };
  }

  // For delete action, no job is created
  if (action === 'delete') {
    // In a real system, this would initiate cleanup and removal
    // For now, just mark as stopped
    stateManager.updateDeploymentStatus(deploymentId, 'stopped');
    return { ok: true };
  }

  // Create a job for the action
  const job = stateManager.createJob({
    type: action,
    deploymentId,
  });

  // Update deployment status to reflect the action
  switch (action) {
    case 'start':
      stateManager.updateDeploymentStatus(deploymentId, 'installing'); // Will become 'running' when job completes
      break;
    case 'stop':
      stateManager.updateDeploymentStatus(deploymentId, 'installing'); // Will become 'stopped' when job completes
      break;
    case 'restart':
      stateManager.updateDeploymentStatus(deploymentId, 'installing'); // Will become 'running' when job completes
      break;
  }

  return { ok: true, jobId: job.id };
}

export function createDeploymentFromDraft(_draftId: string): { jobId: string; ok: boolean } {
  // TODO: Use draftId to create deployment from actual draft data
  // Create a new deployment job
  const jobId = crypto.randomUUID();
  const deploymentId = `deployment-${Date.now()}`;
  
  // Create job
  stateManager.createJob({
    id: jobId,
    type: 'install',
    deploymentId,
  });

  // Create placeholder deployment (in real system, this would be created from draft data)
  const newDeployment: MockDeployment = {
    id: deploymentId,
    name: 'New App',
    app: 'unknown',
    icon: '📦',
    status: 'installing',
    version: '1.0.0',
    resources: { cpu: '0%', memory: '0MB' },
    ports: [],
    lastUpdated: 'Now',
  };

  stateManager.setDeployment(deploymentId, newDeployment);

  return { jobId, ok: true };
}
