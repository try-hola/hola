// Test fixture builders for common API responses
// This provides consistent test data across the test suite

import type {
  HealthResponse,
  GetSummaryResponse,
  GetJobResponse,
  GetDeploymentResponse,
  GetCatalogAppsResponse,
  CatalogApp,
  DeploymentListItem,
  SummaryJob,
  SystemStatus,
  JobStatus,
  DeploymentStatus,
  Job,
  JobType
} from '@hola/shared';

// Health fixture
export function createHealthResponseFixture(overrides?: Partial<HealthResponse>): HealthResponse {
  return {
    ok: true,
    ts: new Date().toISOString(),
    ...overrides
  };
}

// Summary fixture
export function createSummaryResponseFixture(overrides?: Partial<GetSummaryResponse>): GetSummaryResponse {
  const defaultSystemStatus: SystemStatus = {
    docker: { ok: true, version: '24.0.0' },
    disk: { freeBytes: 500000000000, totalBytes: 1000000000000 },
    version: { hola: '1.0.0', compose: '2.20.0' }
  };

  const defaultSummaryJob: SummaryJob = {
    id: 'job-123',
    deploymentId: 'deployment-456',
    type: 'install',
    app: 'nginx',
    status: 'running',
    progress: 50,
    timestamp: '2 minutes ago'
  };

  return {
    deploymentsCount: 3,
    activeJobsCount: 1,
    alertsCount: 0,
    recentJobs: [defaultSummaryJob],
    system: defaultSystemStatus,
    ...overrides
  };
}

// Job fixture
export function createJobFixture(overrides?: Partial<Job>): Job {
  return {
    id: 'job-123',
    type: 'install' as JobType,
    status: 'running' as JobStatus,
    startedAt: new Date(Date.now() - 300000).toISOString(), // 5 minutes ago
    progress: 50,
    deploymentId: 'deployment-456',
    ...overrides
  };
}

export function createGetJobResponseFixture(overrides?: Partial<GetJobResponse>): GetJobResponse {
  return createJobFixture(overrides);
}

// Deployment fixtures
export function createDeploymentListItemFixture(overrides?: Partial<DeploymentListItem>): DeploymentListItem {
  return {
    id: 'deployment-123',
    name: 'nginx-web',
    app: 'nginx',
    icon: 'https://cdn.jsdelivr.net/gh/selfhosted/selfhosted.dev/img/logos/nginx.png',
    status: 'running' as DeploymentStatus,
    uptime: '2 days',
    version: '1.21.0',
    resources: { cpu: '0.1 cores', memory: '128 MB' },
    ports: ['80:80', '443:443'],
    lastUpdated: '2 minutes ago',
    url: 'https://nginx.example.com',
    ...overrides
  };
}

export function createGetDeploymentResponseFixture(overrides?: Partial<GetDeploymentResponse>): GetDeploymentResponse {
  return {
    id: 'deployment-123',
    name: 'nginx-web',
    app: 'nginx',
    icon: 'https://cdn.jsdelivr.net/gh/selfhosted/selfhosted.dev/img/logos/nginx.png',
    status: 'running' as DeploymentStatus,
    uptime: '2 days',
    version: '1.21.0',
    url: 'https://nginx.example.com',
    resources: { cpu: '0.1 cores', memory: '128 MB', disk: '1 GB' },
    ports: ['80:80', '443:443'],
    lastUpdated: '2 minutes ago',
    ...overrides
  };
}

// Catalog fixtures
export function createCatalogAppFixture(overrides?: Partial<CatalogApp>): CatalogApp {
  return {
    id: 'nginx',
    name: 'Nginx',
    description: 'High performance web server and reverse proxy',
    icon: 'https://cdn.jsdelivr.net/gh/selfhosted/selfhosted.dev/img/logos/nginx.png',
    category: 'Web',
    rating: 4.8,
    downloads: '10M+',
    tags: ['web-server', 'reverse-proxy', 'load-balancer'],
    featured: true,
    ...overrides
  };
}

export function createGetCatalogAppsResponseFixture(
  itemCount: number = 3,
  overrides?: Partial<GetCatalogAppsResponse>
): GetCatalogAppsResponse {
  const items = Array.from({ length: itemCount }, (_, index) =>
    createCatalogAppFixture({
      id: `app-${index + 1}`,
      name: `App ${index + 1}`,
      description: `Description for app ${index + 1}`,
    })
  );

  return {
    items,
    page: 1,
    limit: 12,
    total: itemCount,
    ...overrides
  };
}

// Job status fixtures for different states
export function createJobFixtures() {
  return {
    queued: createJobFixture({ status: 'queued', progress: undefined }),
    running: createJobFixture({ status: 'running', progress: 42 }),
    completed: createJobFixture({ 
      status: 'completed', 
      progress: 100, 
      finishedAt: new Date().toISOString() 
    }),
    failed: createJobFixture({ 
      status: 'failed', 
      progress: 25, 
      finishedAt: new Date().toISOString() 
    })
  };
}

// Deployment status fixtures
export function createDeploymentFixtures() {
  return {
    running: createDeploymentListItemFixture({ status: 'running' }),
    stopped: createDeploymentListItemFixture({ status: 'stopped', uptime: undefined }),
    installing: createDeploymentListItemFixture({ status: 'installing', uptime: undefined }),
    updating: createDeploymentListItemFixture({ status: 'updating' }),
    error: createDeploymentListItemFixture({ status: 'error', uptime: undefined })
  };
}

// Common API error responses
export function createApiErrorResponse(code: string, message: string, status: number = 500) {
  return {
    status,
    ok: false,
    json: async () => ({
      error: {
        code,
        message
      }
    })
  };
}

// Network error for testing
export function createNetworkError(message: string = 'Network request failed') {
  const error = new Error(message);
  error.name = 'NetworkError';
  return error;
}