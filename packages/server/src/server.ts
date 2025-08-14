import {
  API,
  type HealthResponse,
  type HelloResponse,
  type GetMeResponse,
  type GetSummaryResponse,
  type GetCatalogAppsResponse,
  type GetCatalogAppResponse,
  type GetCatalogAppVersionsResponse,
  type GetCatalogAppVersionDetailResponse,
  type CreateDraftRequest,
  type CreateDraftResponse,
  type GetDraftResponse,
  type PatchDraftRequest,
  type PatchDraftResponse,
  type UploadDraftFileResponse,
  type DeleteDraftFileResponse,
  type ValidateDraftResponse,
  type PreflightResponse,
  type FinalizeDraftResponse,
  type GetDeploymentsResponse,
  type GetDeploymentResponse,
  type GetDeploymentHistoryResponse,
  type PatchDeploymentRequest,
  type PatchDeploymentResponse,
  type PostDeploymentActionRequest,
  type PostDeploymentActionResponse,
  type GetLogsResponse,
  type GetJobsRequest,
  type GetJobsResponse,
  type GetJobResponse,
  type GetBackupsResponse,
  type CreateBackupRequest,
  type CreateBackupResponse,
  type GetBackupResponse,
  type RestoreBackupRequest,
  type RestoreBackupResponse,
  type DeleteBackupResponse,
  type GetNotificationsResponse,
  type PatchNotificationRequest,
  type PatchNotificationResponse,
  type PostNotificationsActionRequest,
  type PostNotificationsActionResponse,
  type GetSettingsResponse,
  type PatchSettingsRequest,
  type PatchSettingsResponse,
  type GetBackupSettingsResponse,
  type PatchBackupSettingsRequest,
  type PatchBackupSettingsResponse,
  type GetSystemStatusResponse,
  type Job,
  type JobStatus,
} from '@hola/shared';

// Phase 0: Infrastructure imports
import { appConfig, featureFlags } from './config/features';
import { initializeLogger, getLogger } from './lib/logger';
import { initializeMetrics } from './lib/metrics';
import { createRequestMiddleware, createHealthMiddleware, getRequestContext } from './middleware/request';
import { initializeServices, shutdownServices } from './services/factory';

// Import enhanced mock data
import {
  // Deployments
  getDeployments,
  getDeploymentById,
  getDeploymentHistory,
  executeDeploymentAction,
  createDeploymentFromDraft,
  // Catalog
  getCatalogApps,
  getCatalogAppById,
  getCatalogAppVersions,
  getCatalogAppVersionDetail,
  // Jobs
  getJobById,
  getAllJobs,
  getJobsByDeployment,
  getActiveJobs,
  // System
  getSummary,
  getSystemStatus,
  updateSystemHealth,
  // Notifications
  getNotifications,
  updateNotification,
  executeNotificationAction,
  generateJobNotifications,
  // Backups
  getBackups,
  getBackupById,
  createBackup,
  restoreBackup,
  deleteBackup,
  scheduleAutomaticBackups,
  // Settings
  getSettings,
  updateSettings,
  getBackupSettings,
  updateBackupSettings,
  // Configuration
  config,
} from './mock-data';

// Import development tools
import { developmentToolsEndpoints, createApiMonitoringMiddleware } from './config/development-api';
import { initializeDevelopmentEnvironment } from './config/development';

// Phase 0: Initialize infrastructure
const logger = getLogger().child({ service: 'HolaServer' });
initializeLogger(appConfig.logLevel, appConfig.logFormat);
initializeMetrics();
initializeServices();

// Phase 0: Startup messaging
console.log('🚀 Starting Hola Server - Phase 0 Implementation');
console.log('📋 Phase 0 Deliverables:');
console.log('  ✅ Feature flag scaffolding and service factory');
console.log('  ✅ Request ID middleware, structured logging, basic metrics');
console.log('  ✅ Health and readiness endpoints (/healthz, /readyz, /metrics)');
console.log('  ✅ Contract test infrastructure');
console.log('');

logger.info('Phase 0 infrastructure initialized', {
  featureFlags,
  config: appConfig,
});

const PORT = appConfig.port;

// Phase 0: Initialize middleware
const requestMiddleware = createRequestMiddleware();
const healthMiddleware = createHealthMiddleware();

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...init?.headers,
    },
    status: init?.status ?? 200,
    statusText: init?.statusText,
  });
}

function text(body: string, init?: ResponseInit) {
  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      ...init?.headers,
    },
    status: init?.status ?? 200,
    statusText: init?.statusText,
  });
}

function notFound() {
  return json({ error: { code: 'NOT_FOUND', message: 'Not Found' } }, { status: 404 });
}

function withCors(res: Response) {
  const headers = new Headers(res.headers);
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  headers.set('access-control-allow-headers', 'content-type,authorization,x-request-id');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function handlePreflight(req: Request) {
  if (req.method === 'OPTIONS') {
    return withCors(new Response(null, { status: 204 }));
  }
  return null;
}

// Simple header-derived identity mock
function getIdentity(req: Request): GetMeResponse | null {
  const id = req.headers.get('x-user-id') || 'demo-user';
  const email = req.headers.get('x-user-email') || 'demo@example.com';
  const name = req.headers.get('x-user-name') || 'Demo User';
  if (!id) return null;
  return { id, email, name, roles: ['user'] };
}

// SSE helper
function sse(headers?: HeadersInit) {
  const h = new Headers(headers);
  h.set('content-type', 'text/event-stream');
  h.set('cache-control', 'no-cache');
  h.set('connection', 'keep-alive');
  return h;
}

// Router
async function route(url: URL, req: Request): Promise<Response> {
  const { pathname, searchParams } = url;

  // Health
  if (pathname === API.health && req.method === 'GET') {
    const payload: HealthResponse = { ok: true, ts: new Date().toISOString() };
    return json(payload);
  }

  // Phase 0: Health endpoints  
  if (pathname === '/healthz' && req.method === 'GET') {
    return healthMiddleware.healthCheck();
  }

  if (pathname === '/readyz' && req.method === 'GET') {
    return healthMiddleware.readinessCheck();
  }

  if (pathname === '/metrics' && req.method === 'GET') {
    return healthMiddleware.metricsEndpoint();
  }

  // Phase 0: Feature flags and service info
  if (pathname === '/api/phase0/features' && req.method === 'GET') {
    return json({
      phase: 'Phase 0 - Foundations',
      featureFlags,
      config: appConfig,
      services: {
        logging: true,
        metrics: true,
        healthChecks: true,
        serviceFactory: true,
      },
    });
  }

  // Phase 0: Service factory status
  if (pathname === '/api/phase0/services' && req.method === 'GET') {
    const serviceFactory = await import('./services/factory').then(m => m.getServiceFactory());
    return json({
      healthStatus: serviceFactory.getHealthStatus(),
      activatedServices: [],
    });
  }

  // Hello
  if (pathname === API.hello && req.method === 'GET') {
    const payload: HelloResponse = { message: 'Hello from Hola server (Phase 0 - Foundations)' };
    return json(payload);
  }

  // Echo (dev)
  if (pathname === API.echo && req.method === 'POST') {
    try {
      const body = await req.json();
      // Phase 0: Use request context to access the request ID
      const context = getRequestContext(req);
      return json({ 
        received: body,
        timestamp: new Date().toISOString(),
        requestId: context?.requestId || req.headers.get('x-request-id'),
      });
    } catch {
      return json({ error: { code: 'BAD_JSON', message: 'Invalid JSON' } }, { status: 400 });
    }
  }

  // Identity
  if (pathname === API.me && req.method === 'GET') {
    const me = getIdentity(req);
    if (!me) return json({ error: { code: 'UNAUTHENTICATED', message: 'No identity' } }, { status: 401 });
    return json(me);
  }

  // Summary
  if (pathname === API.summary && req.method === 'GET') {
    const payload: GetSummaryResponse = getSummary();
    return json(payload);
  }

  // Catalog
  if (pathname === API.catalog.apps && req.method === 'GET') {
    const page = Number(searchParams.get('page')) || 1;
    const limit = Number(searchParams.get('limit')) || 12;
    const query = searchParams.get('query') || undefined;
    const category = searchParams.get('category') || undefined;
    
    const payload: GetCatalogAppsResponse = getCatalogApps({ page, limit, query, category });
    return json(payload);
  }

  const catalogAppMatch = pathname.match(/^\/api\/catalog\/apps\/([^/]+)$/);
  if (catalogAppMatch && req.method === 'GET') {
    const appId = decodeURIComponent(catalogAppMatch[1]);
    const payload = getCatalogAppById(appId);
    if (!payload) {
      return notFound();
    }
    return json(payload);
  }

  const catalogVersionsMatch = pathname.match(/^\/api\/catalog\/apps\/([^/]+)\/versions$/);
  if (catalogVersionsMatch && req.method === 'GET') {
    const appId = decodeURIComponent(catalogVersionsMatch[1]);
    const payload = getCatalogAppVersions(appId);
    if (!payload) {
      return notFound();
    }
    return json(payload);
  }

  const catalogVersionDetailMatch = pathname.match(/^\/api\/catalog\/apps\/([^/]+)\/versions\/(.+)$/);
  if (catalogVersionDetailMatch && req.method === 'GET') {
    const appId = decodeURIComponent(catalogVersionDetailMatch[1]);
    const version = decodeURIComponent(catalogVersionDetailMatch[2]);
    const payload = getCatalogAppVersionDetail(appId, version);
    if (!payload) {
      return notFound();
    }
    return json(payload);
  }

  // Drafts
  if (pathname === API.drafts.create && req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as Partial<CreateDraftRequest>;
    const payload: CreateDraftResponse = {
      draftId: crypto.randomUUID(),
      app: { id: body.appId || 'unknown', name: 'App', icon: '📦' },
      systemEnv: [
        { key: 'DOMAIN', value: 'localhost', isSecret: false, description: 'Base domain' },
        { key: 'SMTP_PASSWORD', value: '', isSecret: true, description: 'SMTP password' },
      ],
      appEnv: [
        { key: 'POSTGRES_DB', value: 'nextcloud', isSecret: false, description: 'Database name' },
        { key: 'POSTGRES_PASSWORD', value: '', isSecret: true, description: 'Database password' },
      ],
      defaults: {
        ports: [{ host: 8080, container: 80, protocol: 'tcp' }],
        volumes: [{ hostPath: './data', containerPath: '/var/www/html', readOnly: false }],
      },
    };
    return json(payload);
  }

  const draftMatch = pathname.match(/^\/api\/drafts\/([^/]+)$/);
  if (draftMatch && req.method === 'GET') {
    const draftId = draftMatch[1];
    const payload: GetDraftResponse = {
      draftId,
      appId: 'nextcloud',
      version: '1.0.0',
      systemOverrides: {},
      appEnv: [
        { key: 'POSTGRES_DB', value: 'nextcloud', isSecret: false, description: 'Database name' },
        { key: 'POSTGRES_PASSWORD', value: '', isSecret: true, description: 'Database password' },
      ],
      ports: [{ host: 8080, container: 80, protocol: 'tcp' }],
      composeOverride: '',
      files: [],
    };
    return json(payload);
  }

  if (draftMatch && req.method === 'PATCH') {
    const payload: PatchDraftResponse = {
      ok: true,
      draft: {
        draftId: draftMatch[1],
        appId: 'nextcloud',
        version: '1.0.0',
        systemOverrides: {},
        appEnv: [],
        ports: [],
        composeOverride: '',
        files: [],
      },
    };
    return json(payload);
  }

  const draftUploadsMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/uploads$/);
  if (draftUploadsMatch && req.method === 'POST') {
    const payload: UploadDraftFileResponse = { uploadId: crypto.randomUUID(), name: 'file', size: 1234, kind: (new URL(req.url)).searchParams.get('kind') === 'composeOverride' ? 'composeOverride' : 'additionalFile' };
    return json(payload);
  }

  const draftUploadByIdMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/uploads\/([^/]+)$/);
  if (draftUploadByIdMatch && req.method === 'DELETE') {
    const payload: DeleteDraftFileResponse = { ok: true };
    return json(payload);
  }

  const draftValidateMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/validate$/);
  if (draftValidateMatch && req.method === 'POST') {
    const payload: ValidateDraftResponse = { ok: true, errors: [], warnings: [] };
    return json(payload);
  }

  const draftPreflightMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/preflight$/);
  if (draftPreflightMatch && req.method === 'POST') {
    const payload: PreflightResponse = {
      ok: true,
      checks: [
        { name: 'env', status: 'pass' },
        { name: 'docker', status: 'pass' },
        { name: 'disk', status: 'warn', detail: 'Low disk space' },
      ],
    };
    return json(payload);
  }

  const draftFinalizeMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/finalize$/);
  if (draftFinalizeMatch && req.method === 'POST') {
    const payload: FinalizeDraftResponse = { spec: { services: {} }, checksum: crypto.randomUUID() };
    return json(payload);
  }

  // Deployments
  if (pathname === API.deployments.base && req.method === 'GET') {
    const page = Number(searchParams.get('page')) || 1;
    const limit = Number(searchParams.get('limit')) || 12;
    const q = searchParams.get('q') || undefined;
    const statusParam = searchParams.get('status') || 'all';
    
    const payload: GetDeploymentsResponse = getDeployments({ 
      page, 
      limit, 
      q, 
      status: statusParam === 'all' ? 'all' : statusParam as 'running' | 'stopped' | 'installing' | 'updating' | 'error'
    });
    return json(payload);
  }

  if (pathname === API.deployments.base && req.method === 'POST') {
    // create from draft
    const body = await req.json().catch(() => ({}));
    const draftId = body.draftId || crypto.randomUUID();
    const payload: PostDeploymentActionResponse = createDeploymentFromDraft(draftId);
    return json(payload);
  }

  const deploymentMatch = pathname.match(/^\/api\/deployments\/([^/]+)$/);
  if (deploymentMatch && req.method === 'GET') {
    const id = deploymentMatch[1];
    const payload = getDeploymentById(id);
    if (!payload) {
      return notFound();
    }
    return json(payload);
  }

  if (deploymentMatch && req.method === 'PATCH') {
    const _body = (await req.json().catch(() => ({}))) as PatchDeploymentRequest;
    const payload: PatchDeploymentResponse = { ok: true };
    return json(payload);
  }

  const deploymentActionsMatch = pathname.match(/^\/api\/deployments\/([^/]+)\/actions$/);
  if (deploymentActionsMatch && req.method === 'POST') {
    const deploymentId = deploymentActionsMatch[1];
    const body = (await req.json().catch(() => ({}))) as Partial<PostDeploymentActionRequest>;
    const action = body.action;
    
    if (!action || !['start', 'stop', 'restart', 'delete'].includes(action)) {
      return json({ error: { code: 'INVALID_ACTION', message: 'Invalid action' } }, { status: 400 });
    }
    
    const payload: PostDeploymentActionResponse = executeDeploymentAction(deploymentId, action);
    return json(payload);
  }

  const deploymentHistoryMatch = pathname.match(/^\/api\/deployments\/([^/]+)\/history$/);
  if (deploymentHistoryMatch && req.method === 'GET') {
    const deploymentId = deploymentHistoryMatch[1];
    const page = Number(searchParams.get('page')) || 1;
    const limit = Number(searchParams.get('limit')) || 10;
    
    const payload = getDeploymentHistory(deploymentId, { page, limit });
    if (!payload) {
      return notFound();
    }
    return json(payload);
  }

  // Logs SSE (deployment)
  const deploymentLogsMatch = pathname.match(/^\/api\/deployments\/([^/]+)\/logs$/);
  if (deploymentLogsMatch && req.method === 'GET') {
    const stream = new ReadableStream({
      start(controller) {
        let i = 0;
        const timer = setInterval(() => {
          i++;
          const evt = `id: ${i}\nevent: message\ndata: ${JSON.stringify({ timestamp: new Date().toISOString(), service: ['nextcloud','postgres','redis'][i%3], level: ['info','warn','error','debug'][i%4], message: 'Log line ' + i })}\n\n`;
          controller.enqueue(new TextEncoder().encode(evt));
          if (i % 8 === 0) {
            controller.enqueue(new TextEncoder().encode(`event: heartbeat\ndata: {}\n\n`));
          }
          // keep alive
        }, 1000);
        // Close after 60s in stub
        setTimeout(() => { clearInterval(timer); controller.close(); }, 60000);
      }
    });
    return new Response(stream, { headers: sse() });
  }

  // Logs SSE Stream (deployment) - new endpoint for real-time logs
  const deploymentLogsStreamMatch = pathname.match(/^\/api\/deployments\/([^/]+)\/logs\/stream$/);
  if (deploymentLogsStreamMatch && req.method === 'GET') {
    const deploymentId = deploymentLogsStreamMatch[1];
    const stream = new ReadableStream({
      start(controller) {
        let i = 0;
        const timer = setInterval(() => {
          i++;
          
          // Send log events
          const logEvent = {
            type: 'log',
            data: {
              timestamp: new Date().toISOString(),
              service: ['nextcloud', 'postgres', 'redis'][i % 3],
              level: ['info', 'warn', 'error', 'debug'][i % 4],
              message: `Deployment ${deploymentId} log entry ${i}: ${['Starting service', 'Processing request', 'Cache operation', 'Database query'][i % 4]}`
            }
          };
          
          const evt = `id: ${i}\nevent: message\ndata: ${JSON.stringify(logEvent)}\n\n`;
          controller.enqueue(new TextEncoder().encode(evt));
          
          // Occasional deployment status updates
          if (i % 15 === 0) {
            const deploymentUpdate = {
              type: 'deployment_update',
              data: {
                deploymentId,
                status: 'running',
                uptime: `${Math.floor(i / 60)}m ${i % 60}s`,
                lastUpdated: new Date().toISOString()
              }
            };
            const deploymentEvt = `id: ${i}-dep\nevent: message\ndata: ${JSON.stringify(deploymentUpdate)}\n\n`;
            controller.enqueue(new TextEncoder().encode(deploymentEvt));
          }
          
          // Heartbeat
          if (i % 30 === 0) {
            controller.enqueue(new TextEncoder().encode(`event: heartbeat\ndata: {}\n\n`));
          }
        }, 2000);
        
        // Close after 300s in development
        setTimeout(() => { clearInterval(timer); controller.close(); }, 300000);
      }
    });
    return new Response(stream, { headers: sse() });
  }

  // Jobs + logs SSE
  // List jobs
  if (pathname === API.jobs.base && req.method === 'GET') {
    const url = new URL(req.url);
    const deploymentId = url.searchParams.get('deploymentId');
    const status = url.searchParams.get('status') as JobStatus | null;
    const page = parseInt(url.searchParams.get('page') ?? '1', 10);
    const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);

    let jobs: Job[];
    if (deploymentId) {
      jobs = getJobsByDeployment(deploymentId);
    } else {
      jobs = getAllJobs();
    }

    // Filter by status if provided
    if (status && status !== 'all') {
      jobs = jobs.filter(job => job.status === status);
    }

    // Apply pagination
    const total = jobs.length;
    const startIndex = (page - 1) * limit;
    const paginatedJobs = jobs.slice(startIndex, startIndex + limit);

    const payload: GetJobsResponse = {
      items: paginatedJobs,
      page,
      limit,
      total,
    };
    return json(payload);
  }

  // Get job by ID
  const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (jobMatch && req.method === 'GET') {
    const jobId = jobMatch[1];
    const payload = getJobById(jobId);
    if (!payload) {
      return notFound();
    }
    return json(payload);
  }

  const jobLogsMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/logs$/);
  if (jobLogsMatch && req.method === 'GET') {
    const stream = new ReadableStream({
      start(controller) {
        let i = 0;
        const timer = setInterval(() => {
          i++;
          const evt = `id: ${i}\nevent: message\ndata: ${JSON.stringify({ timestamp: new Date().toISOString(), service: 'job', level: ['info','warn','error','debug'][i%4], message: 'Job log ' + i })}\n\n`;
          controller.enqueue(new TextEncoder().encode(evt));
          if (i % 8 === 0) controller.enqueue(new TextEncoder().encode(`event: heartbeat\ndata: {}\n\n`));
        }, 1000);
        setTimeout(() => { clearInterval(timer); controller.close(); }, 60000);
      }
    });
    return new Response(stream, { headers: sse() });
  }

  // Job Logs SSE Stream - new endpoint for real-time job logs and updates
  const jobLogsStreamMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/logs\/stream$/);
  if (jobLogsStreamMatch && req.method === 'GET') {
    const jobId = jobLogsStreamMatch[1];
    const stream = new ReadableStream({
      start(controller) {
        let i = 0;
        let progress = 0;
        const timer = setInterval(() => {
          i++;
          progress = Math.min(progress + Math.random() * 5, 100);
          
          // Send log events
          const logEvent = {
            type: 'log',
            data: {
              timestamp: new Date().toISOString(),
              service: 'job-runner',
              level: ['info', 'warn', 'debug'][i % 3],
              message: `Job ${jobId} step ${i}: ${[
                'Initializing task',
                'Downloading container image',
                'Setting up volumes',
                'Starting services',
                'Running health checks',
                'Finalizing installation'
              ][i % 6]}`
            }
          };
          
          const evt = `id: ${i}\nevent: message\ndata: ${JSON.stringify(logEvent)}\n\n`;
          controller.enqueue(new TextEncoder().encode(evt));
          
          // Job progress updates
          if (i % 5 === 0) {
            const jobUpdate = {
              type: 'job_update',
              data: {
                jobId,
                status: progress >= 100 ? 'completed' : 'running',
                progress: Math.floor(progress),
                ...(progress >= 100 ? { finishedAt: new Date().toISOString() } : {})
              }
            };
            const jobEvt = `id: ${i}-job\nevent: message\ndata: ${JSON.stringify(jobUpdate)}\n\n`;
            controller.enqueue(new TextEncoder().encode(jobEvt));
            
            // Complete job after 100% progress
            if (progress >= 100) {
              setTimeout(() => {
                clearInterval(timer);
                controller.close();
              }, 5000);
            }
          }
          
          // Heartbeat
          if (i % 20 === 0) {
            controller.enqueue(new TextEncoder().encode(`event: heartbeat\ndata: {}\n\n`));
          }
        }, 1500);
        
        // Timeout after 200s
        setTimeout(() => { clearInterval(timer); controller.close(); }, 200000);
      }
    });
    return new Response(stream, { headers: sse() });
  }

  // Backups
  if (pathname === API.backups.base && req.method === 'GET') {
    const payload: GetBackupsResponse = {
      items: [
        { id: '1', app: 'Nextcloud', icon: '☁️', timestamp: new Date().toISOString(), sizeBytes: 2_400_000_000, status: 'completed', type: 'automatic' },
        { id: '2', app: 'Home Assistant', icon: '🏠', timestamp: new Date(Date.now()-12*3600e3).toISOString(), sizeBytes: 145_000_000, status: 'completed', type: 'automatic' },
      ],
      page: 1, limit: 2, total: 2,
    };
    return json(payload);
  }

  if (pathname === API.backups.base && req.method === 'POST') {
    const _body = (await req.json().catch(() => ({}))) as Partial<CreateBackupRequest>;
    const payload: CreateBackupResponse = { jobId: crypto.randomUUID(), backupId: crypto.randomUUID() };
    return json(payload);
  }

  const backupByIdMatch = pathname.match(/^\/api\/backups\/([^/]+)$/);
  if (backupByIdMatch && req.method === 'GET') {
    const payload: GetBackupResponse = {
      id: backupByIdMatch[1],
      app: 'Nextcloud',
      appId: 'nextcloud',
      icon: '☁️',
      timestamp: new Date().toISOString(),
      sizeBytes: 2_400_000_000,
      status: 'completed',
      type: 'automatic',
      files: [{ path: 'backup.tar.gz', sizeBytes: 2_400_000_000 }],
    };
    return json(payload);
  }

  const backupRestoreMatch = pathname.match(/^\/api\/backups\/([^/]+)\/restore$/);
  if (backupRestoreMatch && req.method === 'POST') {
    const _body = (await req.json().catch(() => ({}))) as Partial<RestoreBackupRequest>;
    const payload: RestoreBackupResponse = { jobId: crypto.randomUUID() };
    return json(payload);
  }

  if (backupByIdMatch && req.method === 'DELETE') {
    const payload: DeleteBackupResponse = { ok: true };
    return json(payload);
  }

  // Notifications
  if (pathname === API.notifications.base && req.method === 'GET') {
    const payload: GetNotificationsResponse = {
      items: [
        { id: '1', type: 'update', title: 'Update Available: Nextcloud 28.0.3', message: 'Security improvements.', timestamp: '2 hours ago', read: false, priority: 'medium' },
        { id: '2', type: 'error', title: 'Backup Failed: Plex', message: 'Insufficient disk space.', timestamp: '4 hours ago', read: false, priority: 'high' },
      ],
      page: 1, limit: 2, total: 2, unreadCount: 2,
    };
    return json(payload);
  }

  const notificationByIdMatch = pathname.match(/^\/api\/notifications\/([^/]+)$/);
  if (notificationByIdMatch && req.method === 'PATCH') {
    const _body = (await req.json().catch(() => ({}))) as Partial<PatchNotificationRequest>;
    const payload: PatchNotificationResponse = { id: notificationByIdMatch[1], read: true };
    return json(payload);
  }

  if (pathname === API.notifications.actions && req.method === 'POST') {
    const _body = (await req.json().catch(() => ({}))) as Partial<PostNotificationsActionRequest>;
    const payload: PostNotificationsActionResponse = { ok: true };
    return json(payload);
  }

  // Settings
  if (pathname === API.settings.base && req.method === 'GET') {
    const payload: GetSettingsResponse = {
      systemEnv: [
        { key: 'DOMAIN', value: 'localhost', isSecret: false, description: 'Base domain' },
        { key: 'SMTP_PASSWORD', value: '', isSecret: true, description: 'SMTP password' },
      ],
      docker: { host: '/var/run/docker.sock' },
      tls: { email: '' },
      notifications: { smtpHost: '', smtpUser: '', smtpPassword: '' },
    };
    return json(payload);
  }

  if (pathname === API.settings.base && req.method === 'PATCH') {
    const _body = (await req.json().catch(() => ({}))) as Partial<PatchSettingsRequest>;
    const payload: PatchSettingsResponse = {
      systemEnv: [],
      docker: {},
      tls: {},
      notifications: {},
    };
    return json(payload);
  }

  if (pathname === API.settings.backup && req.method === 'GET') {
    const payload: GetBackupSettingsResponse = { scheduleEnabled: true, scheduleTime: '02:00', retentionDays: 7 };
    return json(payload);
  }

  if (pathname === API.settings.backup && req.method === 'PATCH') {
    const _body = (await req.json().catch(() => ({}))) as Partial<PatchBackupSettingsRequest>;
    const payload: PatchBackupSettingsResponse = { scheduleEnabled: true, scheduleTime: '02:00', retentionDays: 7 };
    return json(payload);
  }

  // System status
  if (pathname === API.system.status && req.method === 'GET') {
    const payload: GetSystemStatusResponse = getSystemStatus();
    return json(payload);
  }

  // System Status SSE Stream - new endpoint for real-time system updates
  if (pathname === '/api/system/status/stream' && req.method === 'GET') {
    const stream = new ReadableStream({
      start(controller) {
        let i = 0;
        const timer = setInterval(() => {
          i++;
          
          // Occasionally send system updates
          if (i % 10 === 0) {
            const systemUpdate = {
              type: 'system_update',
              data: {
                docker: { 
                  ok: true, 
                  version: '24.0.5' 
                },
                disk: { 
                  freeBytes: Math.floor(50_000_000_000 - (i * 1000000)), // Slowly decreasing
                  totalBytes: 100_000_000_000 
                },
                version: { 
                  hola: '1.0.0', 
                  compose: '2.20.0' 
                },
                oras: { 
                  ok: true, 
                  version: '1.1.0' 
                },
                authentik: { 
                  ok: Math.random() > 0.1 // Occasionally false to simulate issues
                }
              }
            };
            
            const evt = `id: ${i}\nevent: message\ndata: ${JSON.stringify(systemUpdate)}\n\n`;
            controller.enqueue(new TextEncoder().encode(evt));
          }
          
          // Heartbeat
          if (i % 30 === 0) {
            controller.enqueue(new TextEncoder().encode(`event: heartbeat\ndata: {}\n\n`));
          }
        }, 5000); // Every 5 seconds
        
        // Keep alive for a long time for system monitoring
        setTimeout(() => { clearInterval(timer); controller.close(); }, 600000); // 10 minutes
      }
    });
    return new Response(stream, { headers: sse() });
  }

  // ===== DEVELOPMENT TOOLS ROUTES =====
  
  // Development configuration
  if (pathname === '/api/dev/config' && req.method === 'GET') {
    return developmentToolsEndpoints.getConfig();
  }
  
  // Available scenarios
  if (pathname === '/api/dev/scenarios' && req.method === 'GET') {
    return developmentToolsEndpoints.getScenarios();
  }
  
  // Apply scenario
  if (pathname === '/api/dev/scenarios/apply' && req.method === 'POST') {
    return await developmentToolsEndpoints.applyScenario(req);
  }
  
  // Update customization
  if (pathname === '/api/dev/customization' && req.method === 'PATCH') {
    return await developmentToolsEndpoints.updateCustomization(req);
  }
  
  // Reset mock data
  if (pathname === '/api/dev/mock-data/reset' && req.method === 'POST') {
    return developmentToolsEndpoints.resetMockData();
  }
  
  // API call history
  if (pathname === '/api/dev/api-calls' && req.method === 'GET') {
    return developmentToolsEndpoints.getApiCallHistory(req);
  }
  
  // Clear API call history
  if (pathname === '/api/dev/api-calls/clear' && req.method === 'DELETE') {
    return developmentToolsEndpoints.clearApiCallHistory();
  }
  
  // Performance metrics
  if (pathname === '/api/dev/performance' && req.method === 'GET') {
    return developmentToolsEndpoints.getPerformanceMetrics();
  }
  
  // State debugging info
  if (pathname === '/api/dev/state' && req.method === 'GET') {
    return developmentToolsEndpoints.getStateDebugInfo();
  }
  
  // Benchmark endpoint
  if (pathname === '/api/dev/benchmark' && req.method === 'POST') {
    return await developmentToolsEndpoints.benchmark(req);
  }
  
  // Network simulation
  if (pathname === '/api/dev/network/simulate' && req.method === 'POST') {
    return await developmentToolsEndpoints.simulateNetworkCondition(req);
  }

  // ===== API DOCUMENTATION ROUTES =====
  
  // OpenAPI JSON specification
  if (pathname === '/api/openapi.json' && req.method === 'GET') {
    const { generateOpenAPISpec } = await import('@hola/shared');
    const spec = generateOpenAPISpec();
    return json(spec);
  }

  // Swagger UI
  if (pathname === '/docs' && req.method === 'GET') {
    const { generateSwaggerUI } = await import('@hola/shared');
    const html = generateSwaggerUI('/api/openapi.json');
    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  }

  // ReDoc UI
  if (pathname === '/redoc' && req.method === 'GET') {
    const { generateReDocUI } = await import('@hola/shared');
    const html = generateReDocUI('/api/openapi.json');
    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  }

  // API Examples
  if (pathname === '/docs/examples' && req.method === 'GET') {
    const { generateExamplesHTML } = await import('@hola/shared');
    const html = generateExamplesHTML();
    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  }

  // API Changelog
  if (pathname === '/docs/changelog' && req.method === 'GET') {
    const { generateChangelogHTML } = await import('@hola/shared');
    const html = generateChangelogHTML();
    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  }

  // API Changelog (raw markdown)
  if (pathname === '/docs/changelog.md' && req.method === 'GET') {
    const { generateChangelog } = await import('@hola/shared');
    const changelog = generateChangelog();
    return new Response(changelog, {
      headers: { 'content-type': 'text/markdown; charset=utf-8' }
    });
  }

  // Type Browser
  if (pathname === '/docs/types' && req.method === 'GET') {
    const { generateTypeBrowserHTML } = await import('@hola/shared');
    const html = generateTypeBrowserHTML();
    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  }

  // Migration Guide Generator
  if (pathname === '/docs/migration' && req.method === 'GET') {
    const fromVersion = searchParams.get('from');
    const toVersion = searchParams.get('to');
    
    if (!fromVersion || !toVersion) {
      return json({ error: { code: 'MISSING_PARAMS', message: 'from and to version parameters required' } }, { status: 400 });
    }

    const { generateMigrationGuide } = await import('@hola/shared');
    const guide = generateMigrationGuide(fromVersion, toVersion);
    
    if (!guide) {
      return json({ error: { code: 'INVALID_VERSIONS', message: 'Invalid version numbers or migration not available' } }, { status: 404 });
    }
    
    return json(guide);
  }

  // Documentation Home Page
  if (pathname === '/docs/home' && req.method === 'GET') {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hola API Documentation</title>
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      max-width: 800px; 
      margin: 0 auto; 
      padding: 2rem;
      line-height: 1.6;
    }
    h1 { color: #3b82f6; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
    .links { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin: 2rem 0; }
    .link-card { 
      border: 1px solid #e5e7eb; 
      border-radius: 8px; 
      padding: 1.5rem; 
      text-decoration: none; 
      color: inherit;
      transition: border-color 0.2s;
    }
    .link-card:hover { border-color: #3b82f6; }
    .link-card h3 { margin: 0 0 0.5rem 0; color: #1f2937; }
    .link-card p { margin: 0; color: #6b7280; font-size: 0.9rem; }
    .badge { 
      background: #dbeafe; 
      color: #1e40af; 
      padding: 0.25rem 0.5rem; 
      border-radius: 4px; 
      font-size: 0.75rem;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <h1>🚀 Hola API Documentation</h1>
  <p>Welcome to the comprehensive API documentation for the Hola Application Platform. Choose from the interactive documentation options below:</p>
  
  <div class="links">
    <a href="/docs" class="link-card">
      <h3>📊 Swagger UI <span class="badge">Interactive</span></h3>
      <p>Interactive API explorer with live testing capabilities. Try endpoints directly from your browser.</p>
    </a>
    
    <a href="/redoc" class="link-card">
      <h3>📖 ReDoc <span class="badge">Clean</span></h3>
      <p>Beautiful, responsive API documentation with improved organization and readability.</p>
    </a>
    
    <a href="/docs/examples" class="link-card">
      <h3>💡 Code Examples <span class="badge">Comprehensive</span></h3>
      <p>Complete code examples including React hooks, error handling, testing patterns, and real-time features.</p>
    </a>
    
    <a href="/docs/types" class="link-card">
      <h3>🔍 Type Browser <span class="badge">Reference</span></h3>
      <p>Explore TypeScript types, their relationships, and usage patterns throughout the API.</p>
    </a>
    
    <a href="/docs/changelog" class="link-card">
      <h3>📋 Changelog <span class="badge">History</span></h3>
      <p>Track all API changes, breaking changes, and migration requirements across versions.</p>
    </a>
  </div>
  
  <h2>🔗 Quick Links</h2>
  <ul>
    <li><strong>OpenAPI Spec:</strong> <a href="/api/openapi.json">/api/openapi.json</a></li>
    <li><strong>Health Check:</strong> <a href="/api/health">/api/health</a></li>
    <li><strong>API Base:</strong> <code>${API.base}</code></li>
  </ul>
  
  <h2>🔑 Authentication</h2>
  <p>All API endpoints require authentication via the <code>X-API-Key</code> header:</p>
  <pre style="background: #f3f4f6; padding: 1rem; border-radius: 4px; overflow-x: auto;">curl -H "X-API-Key: your-api-key" http://localhost:3001/api/health</pre>
  
  <h2>📚 Getting Started</h2>
  <ol>
    <li>Explore the <a href="/docs">interactive API documentation</a></li>
    <li>Check out <a href="/docs/examples">code examples</a> for your language</li>
    <li>Review the <a href="/docs/types">type definitions</a> for proper integration</li>
    <li>Read the <a href="/docs/changelog">changelog</a> for version updates</li>
  </ol>
</body>
</html>`;
    
    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  }

  return notFound();
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const pre = handlePreflight(req);
    if (pre) return withCors(pre);

    const url = new URL(req.url);
    
    // Phase 0: Apply request middleware first, then API monitoring
    const response = await requestMiddleware(req, async () => {
      // Apply API monitoring middleware
      const apiMonitoringMiddleware = createApiMonitoringMiddleware();
      return await apiMonitoringMiddleware(req, async () => {
        return await route(url, req);
      });
    });
    
    return withCors(response);
  },
});

logger.info('Hola server started successfully', {
  port: server.port,
  apiBase: `http://localhost:${server.port}${API.base}`,
  phase0Endpoints: {
    healthz: `http://localhost:${server.port}/healthz`,
    readyz: `http://localhost:${server.port}/readyz`,
    metrics: `http://localhost:${server.port}/metrics`,
    features: `http://localhost:${server.port}/api/phase0/features`,
    services: `http://localhost:${server.port}/api/phase0/services`,
  },
});

// Initialize development environment
initializeDevelopmentEnvironment();

// Phase 0: Graceful shutdown handling
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  shutdownServices();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully');
  shutdownServices();
  process.exit(0);
});

// Initialize periodic tasks for mock data enhancement
if (config.USE_MOCK_DATA) {
  console.log('[server] Starting mock data enhancement tasks...');
  
  // Update system health occasionally
  setInterval(() => {
    updateSystemHealth();
  }, 30000); // Every 30 seconds
  
  // Generate notifications for job events
  setInterval(() => {
    generateJobNotifications();
  }, 10000); // Every 10 seconds
  
  // Schedule automatic backups occasionally
  setInterval(() => {
    scheduleAutomaticBackups();
  }, 60000); // Every minute
  
  console.log('[server] Mock data enhancement tasks started');
}