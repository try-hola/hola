import {
  API,
  AUTH_API,
  type GetAuthMeResponse,
  type AuthConfigResponse,
  type AuthLoginResponse,
  type HealthResponse,
  type HelloResponse,
  type GetMeResponse,
  type GetSummaryResponse,
  type SummaryJob,
  type GetCatalogAppsResponse,
  type CreateDraftRequest,
  type PatchDraftRequest,
  type DraftFile,
  type GetDeploymentsResponse,
  
  type PatchDeploymentRequest,
  type PatchDeploymentResponse,
  type GetDeploymentConfigResponse,
  type PostDeploymentActionRequest,
  type PostDeploymentActionResponse,
  type GetJobsResponse,
  type DeleteJobsResponse,
  type GetBackupsResponse,
  type CreateBackupRequest,
  type CreateBackupResponse,
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
  type GetUpdateCheckResponse,
  type Job,
  type JobStatus,
  type RollbackRequest,
  type RollbackResponse,
  type PromoteDeploymentRequest,
  type PromoteDeploymentResponse,
  type AddRegistryCredentialRequest,
  type ListRegistryCredentialsResponse,
  type InstallFromRefRequest,
  type InstallFromRefResponse,
  type AddCatalogSourceRequest,
  type UpdateCatalogSourceRequest,
  type ListCatalogSourcesResponse,
  type RefreshCatalogResponse,
} from '@hola/shared';

// Error interface for proper typing
interface ServiceError extends Error {
  code?: string;
}

// Phase 0: Infrastructure imports
import { appConfig, featureFlags } from './config/features';
import { initializeLogger, getLogger } from './lib/logger';
import { initializeMetrics } from './lib/metrics';
import { createRequestMiddleware, createHealthMiddleware, getRequestContext, type RequestContext } from './middleware/request';
import { getServices, resetServices } from './services/simple-factory';
import { coreRoutesFromEnv } from './services/core/routing';
import { createSSEStream, createSSEHeaders } from './utils/sse';

// Phase 1: Enhanced observability imports
import { mapErrorToResponse, asPromoteValidationError } from './middleware/error-mapping';

// Phase 3: Authentication imports
import { createAuthMiddleware, getPrincipal, SESSION_COOKIE } from './middleware/auth';
import { resolveOidcConfig, setProvisionedOidc } from './config/oidc';
import { authConfig } from './config/auth';


// Import development tools
import { initializeDevelopmentEnvironment } from './config/development';

// Phase 0: Initialize infrastructure with fail-fast validation
const logger = getLogger().child({ service: 'HolaServer' });
const shouldAutoStart = process.env.HOLA_DISABLE_AUTOSTART !== 'true';

const backgroundTimers: Array<() => void> = [];

async function initializeInfrastructure() {
  initializeLogger(appConfig.logLevel, appConfig.logFormat);
  initializeMetrics();
  
  try {
    // Initialize services using simplified factory
    const services = getServices();
    // Emit the platform's own Traefik routes (UI, dashboard, Authentik) into the
    // file provider so Traefik needs neither the Docker provider nor the socket.
    // Mock routing (test/dev) no-ops; production writes /data/runtime/traefik/core.yml.
    await services.routing.emitCoreRoutes(coreRoutesFromEnv());
  } catch (error) {
    console.error('');
    console.error('❌ Server startup failed:');
    console.error(error instanceof Error ? error.message : String(error));
    console.error('');
    if (shouldAutoStart) {
      process.exit(1);
    }
    throw error instanceof Error ? error : new Error(String(error));
  }

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
}

// Start infrastructure initialization (this will exit on failure)
await initializeInfrastructure();

const PORT = appConfig.port;

// Phase 0: Initialize middleware
const requestMiddleware = createRequestMiddleware();
const healthMiddleware = createHealthMiddleware();

// Phase 3: Initialize auth middleware
const authMiddleware = createAuthMiddleware();

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

// Plain text response helper (unused currently)

function notFound() {
  return json({ error: { code: 'NOT_FOUND', message: 'Not Found' } }, { status: 404 });
}

// Centralized error -> HTTP mapping for service-backed routes. Typed service
// errors (NotFoundError, ValidationError, ConflictError, ...) map to consistent
// status codes and response bodies; CORS headers are applied by handleRequest.
function errorResponse(req: Request, error: unknown) {
  const requestId = getRequestContext(req)?.requestId;
  const { status, body } = mapErrorToResponse(error, requestId);
  return json(body, { status });
}

function withCors(res: Response) {
  const headers = new Headers(res.headers);
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  headers.set('access-control-allow-headers', 'content-type,authorization,x-request-id');
  // Re-copying headers via the Headers constructor can drop Set-Cookie on some
  // runtimes; restore it explicitly so the login/logout cookie survives.
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (setCookies.length > 0) {
    headers.delete('set-cookie');
    for (const c of setCookies) headers.append('set-cookie', c);
  }
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
  return { 
    id, 
    email, 
    name, 
    type: 'user',
    roles: ['user'],
    capabilities: ['read:system', 'read:deployments']
  };
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

  // Phase 0 compatibility: features endpoint
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

  // System: Service factory health status
  if (pathname === '/api/system/health' && req.method === 'GET') {
    const services = getServices();
    const serviceEntries = Object.keys(services).map(name => ({
      name,
      status: 'healthy',
      type: services[name as keyof typeof services].constructor.name
    }));
    
    return json({
      status: 'healthy',
      services: serviceEntries,
      // Legacy fields for backward compatibility
      healthStatus: Object.fromEntries(
        serviceEntries.map(s => [s.name, { healthy: true, lastCheck: new Date() }])
      ),
      activatedServices: serviceEntries.map(s => s.name)
    });
  }

  // Phase 0 compatibility: services endpoint
  if (pathname === '/api/phase0/services' && req.method === 'GET') {
    const services = getServices();
    return json({
      status: 'healthy',
      services: Object.keys(services).map(name => ({
        name,
        status: 'healthy',
        type: services[name as keyof typeof services].constructor.name
      }))
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

  // Current authenticated principal (resolved by the auth middleware).
  if (pathname === AUTH_API.me && req.method === 'GET') {
    const principal = getPrincipal(req);
    if (principal) {
      return json(principal as GetAuthMeResponse);
    }
    const me = getIdentity(req);
    if (!me) return json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, { status: 401 });
    return json(me);
  }

  // Public: tell the dashboard how to authenticate (OIDC vs admin-key vs none).
  if (pathname === AUTH_API.config && req.method === 'GET') {
    const authRequired = featureFlags.useAuth;
    if (!authRequired) {
      return json({ authRequired: false, mode: 'none' } satisfies AuthConfigResponse);
    }
    const oidc = resolveOidcConfig();
    if (oidc.enabled && oidc.issuer && oidc.clientId && oidc.redirectUri) {
      return json({
        authRequired: true,
        mode: 'oidc',
        oidc: {
          issuer: oidc.issuer,
          clientId: oidc.clientId,
          redirectUri: oidc.redirectUri,
          audience: oidc.audience ?? oidc.clientId,
          scopes: oidc.scopes,
        },
      } satisfies AuthConfigResponse);
    }
    return json({ authRequired: true, mode: 'apikey' } satisfies AuthConfigResponse);
  }

  // Public: admin-key login fallback. Validates the key via the auth service and,
  // on success, sets an HttpOnly session cookie so the SPA never stores the raw key.
  if (pathname === AUTH_API.login && req.method === 'POST') {
    if (!featureFlags.useAuth) {
      // Nothing to log into; report success so the SPA proceeds.
      return json({ ok: true, principal: getPrincipal(req) } as AuthLoginResponse);
    }
    let body: { key?: string };
    try {
      body = (await req.json()) as { key?: string };
    } catch {
      return json({ error: { code: 'BAD_JSON', message: 'Invalid JSON' } }, { status: 400 });
    }
    const key = body.key?.trim();
    if (!key) {
      return json({ error: { code: 'BAD_REQUEST', message: 'key is required' } }, { status: 400 });
    }
    const { auth } = getServices();
    const result = await auth.authenticate(key, { path: pathname, method: req.method });
    if (!result.success || !result.principal) {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Invalid key' } }, { status: 401 });
    }
    // Session cookie carries the key itself; it's HttpOnly+Secure+SameSite=Strict
    // and same-origin with /api, so it can't be read by JS or sent cross-site.
    const cookie = `${SESSION_COOKIE}=${encodeURIComponent(key)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`;
    return json({ ok: true, principal: result.principal } satisfies AuthLoginResponse, {
      headers: { 'set-cookie': cookie },
    });
  }

  // Public: clear the admin-key session cookie.
  if (pathname === AUTH_API.logout && req.method === 'POST') {
    const cookie = `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
    return json({ ok: true }, { headers: { 'set-cookie': cookie } });
  }

  // Summary — computed from real deployments, jobs, and system status.
  if (pathname === API.summary && req.method === 'GET') {
    try {
      const services = getServices();
      const [systemStatus, deploymentsResp, jobs] = await Promise.all([
        services.systemMonitoring.getSystemStatus(),
        services.deployments.listDeployments({ page: 1, limit: 1000 }),
        services.jobs.listJobs(),
      ]);

      const deployments = deploymentsResp.items;
      const appByDeployment = new Map(deployments.map(d => [d.id, d.app]));

      const activeJobsCount = jobs.filter(j => j.status === 'running' || j.status === 'queued').length;
      const recentJobs: SummaryJob[] = [...jobs]
        .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
        .slice(0, 5)
        .map(j => ({
          id: j.id,
          deploymentId: j.deploymentId ?? '',
          type: j.type,
          app: (j.deploymentId && appByDeployment.get(j.deploymentId)) || j.deploymentId || 'system',
          status: j.status,
          ...(j.progress !== undefined ? { progress: j.progress } : {}),
          timestamp: j.finishedAt ?? j.startedAt,
        }));

      // One incident, one alert: a failed install surfaces as BOTH an errored
      // deployment and a failed job — fold the job into its deployment so it
      // isn't double-counted. Standalone failed jobs (no errored deployment,
      // e.g. system jobs) still count on their own.
      const erroredDeploymentIds = new Set(deployments.filter(d => d.status === 'error').map(d => d.id));
      const unattributedFailedJobs = recentJobs.filter(
        j => j.status === 'failed' && !(j.deploymentId && erroredDeploymentIds.has(j.deploymentId))
      ).length;

      const payload: GetSummaryResponse = {
        deploymentsCount: deployments.length,
        activeJobsCount,
        alertsCount: erroredDeploymentIds.size + unattributedFailedJobs,
        recentJobs,
        system: systemStatus,
      };
      return json(payload);
    } catch (error) {
      return errorResponse(req, error);
    }
  }

  // Catalog
  if (pathname === API.catalog.apps && req.method === 'GET') {
    const page = Number(searchParams.get('page')) || 1;
    const limit = Number(searchParams.get('limit')) || 12;
    const query = searchParams.get('query') || undefined;
    const category = searchParams.get('category') || undefined;
    const source = searchParams.get('source') || undefined;
    try {
      const services = getServices();
      const catalog = services.catalog;
      const payload = await catalog.listApps({ page, limit, q: query, category, source });
      return json(payload);
    } catch (error) {
      // No bundled fallback — the only catalog is the remote one (HOLA_CATALOG_URL).
      // When it's unset/unreachable the catalog is simply empty.
      logger.warn('Catalog list failed; returning empty catalog', { error: error instanceof Error ? error.message : String(error) });
      return json({ items: [], page, limit, total: 0 } satisfies GetCatalogAppsResponse);
    }
  }

  const catalogAppMatch = pathname.match(/^\/api\/catalog\/apps\/([^/]+)$/);
  if (catalogAppMatch && req.method === 'GET') {
    const appId = decodeURIComponent(catalogAppMatch[1]);
    const source = searchParams.get('source') || undefined;
    try {
      const services = getServices();
      const catalog = services.catalog;
      const payload = await catalog.getApp(appId, source);
      return json(payload);
    } catch {
      return notFound();
    }
  }

  const catalogVersionsMatch = pathname.match(/^\/api\/catalog\/apps\/([^/]+)\/versions$/);
  if (catalogVersionsMatch && req.method === 'GET') {
    const appId = decodeURIComponent(catalogVersionsMatch[1]);
    const source = searchParams.get('source') || undefined;
    try {
      const services = getServices();
      const catalog = services.catalog;
      const payload = await catalog.getVersions(appId, source);
      return json(payload);
    } catch {
      return notFound();
    }
  }

  const catalogVersionDetailMatch = pathname.match(/^\/api\/catalog\/apps\/([^/]+)\/versions\/(.+)$/);
  if (catalogVersionDetailMatch && req.method === 'GET') {
    const appId = decodeURIComponent(catalogVersionDetailMatch[1]);
    const version = decodeURIComponent(catalogVersionDetailMatch[2]);
    const source = searchParams.get('source') || undefined;
    try {
      const services = getServices();
      const catalog = services.catalog;
      const payload = await catalog.getVersionDetail(appId, version, source);
      return json(payload);
    } catch (error) {
      logger.warn('Catalog version detail failed', { appId, version, error: error instanceof Error ? error.message : String(error) });
      // A blanket 404 told the operator the version doesn't exist when the real
      // cause was a blocked registry, a bad credential or an unreachable pull.
      // BundleUnavailableError still maps to 404 (it genuinely is "not there");
      // BundleError carries its own status and reason.
      return errorResponse(req, error);
    }
  }

  // Catalog refresh
  if (pathname === API.catalog.refresh && req.method === 'POST') {
    try {
      const force = searchParams.get('force') === 'true';
      const services = getServices();
      const catalog = services.catalog;
      const sources = await catalog.refresh(force);
      const response: RefreshCatalogResponse = { success: true, timestamp: new Date().toISOString(), sources };
      return json(response);
    } catch (error) {
      logger.warn('Catalog refresh failed', { error: error instanceof Error ? error.message : String(error) });
      return json({ error: { code: 'REFRESH_FAILED', message: 'Catalog refresh failed' } }, { status: 500 });
    }
  }

  // ===== REGISTRY CREDENTIAL ROUTES =====
  // Instance-level, admin-gated (behind the same auth middleware as every /api
  // route). Secrets are write-only: the token is never returned to clients.
  if (pathname === API.registryCredentials.base && req.method === 'GET') {
    try {
      const items = await getServices().registryCredentials.list();
      return json({ items } satisfies ListRegistryCredentialsResponse);
    } catch (error) {
      logger.error('Failed to list registry credentials', error as Error);
      return json({ error: { code: 'CREDENTIAL_LIST_FAILED', message: 'Failed to list registry credentials' } }, { status: 500 });
    }
  }

  if (pathname === API.registryCredentials.base && req.method === 'POST') {
    try {
      const body = (await req.json().catch(() => ({}))) as Partial<AddRegistryCredentialRequest>;
      if (!body.registry || !body.username || !body.password) {
        return json({ error: { code: 'MISSING_FIELDS', message: 'registry, username and password are required' } }, { status: 400 });
      }
      const record = await getServices().registryCredentials.add(body as AddRegistryCredentialRequest);
      return json(record, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === 'CREDENTIAL_ID_EXISTS' ? 409 : 500;
      logger.warn('Failed to add registry credential', { error: message });
      return json({ error: { code: 'CREDENTIAL_ADD_FAILED', message } }, { status });
    }
  }

  const credMatch = pathname.match(/^\/api\/registry-credentials\/([^/]+)$/);
  if (credMatch && req.method === 'DELETE') {
    const id = decodeURIComponent(credMatch[1]);
    try {
      await getServices().registryCredentials.remove(id);
      return json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'CREDENTIAL_NOT_FOUND') return notFound();
      logger.error('Failed to remove registry credential', error as Error);
      return json({ error: { code: 'CREDENTIAL_REMOVE_FAILED', message: 'Failed to remove registry credential' } }, { status: 500 });
    }
  }

  // ===== CATALOG SOURCE ROUTES =====
  // Managed list of catalog.json sources (Homebrew-tap model). Instance-level,
  // admin-gated. The built-in `hola` source is synthesized (not stored) and can't
  // be removed.
  if (pathname === API.catalogSources.base && req.method === 'GET') {
    try {
      const items = await getServices().catalogSources.list();
      return json({ items } satisfies ListCatalogSourcesResponse);
    } catch (error) {
      logger.error('Failed to list catalog sources', error as Error);
      return json({ error: { code: 'SOURCE_LIST_FAILED', message: 'Failed to list catalog sources' } }, { status: 500 });
    }
  }

  if (pathname === API.catalogSources.base && req.method === 'POST') {
    try {
      const body = (await req.json().catch(() => ({}))) as Partial<AddCatalogSourceRequest>;
      if (!body.id || !body.url) {
        return json({ error: { code: 'MISSING_FIELDS', message: 'id and url are required' } }, { status: 400 });
      }
      const record = await getServices().catalogSources.add(body as AddCatalogSourceRequest);
      return json(record, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === 'SOURCE_ID_EXISTS' ? 409 : 400;
      logger.warn('Failed to add catalog source', { error: message });
      return json({ error: { code: 'SOURCE_ADD_FAILED', message } }, { status });
    }
  }

  const sourceMatch = pathname.match(/^\/api\/catalog-sources\/([^/]+)$/);
  // PATCH a source in place. Chiefly so `allowRegistries` can be added after the
  // fact — the usual fix for a REF_NOT_ALLOWED pull — without delete-and-re-add.
  if (sourceMatch && (req.method === 'PATCH' || req.method === 'PUT')) {
    const id = decodeURIComponent(sourceMatch[1]);
    try {
      const body = (await req.json().catch(() => ({}))) as UpdateCatalogSourceRequest;
      const record = await getServices().catalogSources.update(id, body);
      return json(record);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SOURCE_NOT_FOUND') return notFound();
      const status = message === 'SOURCE_ID_RESERVED' ? 400
        : message.startsWith('SOURCE_') ? 400
        : 500;
      logger.warn('Failed to update catalog source', { id, error: message });
      return json({ error: { code: 'SOURCE_UPDATE_FAILED', message } }, { status });
    }
  }

  if (sourceMatch && req.method === 'DELETE') {
    const id = decodeURIComponent(sourceMatch[1]);
    try {
      await getServices().catalogSources.remove(id);
      return json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SOURCE_NOT_FOUND') return notFound();
      const status = message === 'SOURCE_ID_RESERVED' ? 400 : 500;
      logger.warn('Failed to remove catalog source', { error: message });
      return json({ error: { code: 'SOURCE_REMOVE_FAILED', message } }, { status });
    }
  }

  // ===== INSTALL FROM OCI REFERENCE =====
  // The escape hatch for one-off private/first-party packages. Builds a by-ref
  // draft (pull → validate → seed) via the same primitive catalog installs use;
  // the caller then finalizes + deploys the returned draft like any other.
  if (pathname === API.installFromRef && req.method === 'POST') {
    try {
      const body = (await req.json().catch(() => ({}))) as Partial<InstallFromRefRequest>;
      if (!body.ociRef) {
        return json({ error: { code: 'MISSING_OCI_REF', message: 'ociRef is required' } }, { status: 400 });
      }
      const payload = await getServices().drafts.createDraft({
        ociRef: body.ociRef,
        credentialRef: body.credentialRef,
        version: body.version,
      });
      return json({ draftId: payload.draftId } satisfies InstallFromRefResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('Install-from-ref failed', { error: message });
      return json({ error: { code: 'INSTALL_FROM_REF_FAILED', message } }, { status: 400 });
    }
  }

  // ===== DRAFT ROUTES =====
  // Draft creation
  if (pathname === API.drafts.create && req.method === 'POST') {
    let body: Partial<CreateDraftRequest> | undefined;
    let context: RequestContext | undefined;
    
    try {
      body = (await req.json().catch(() => ({}))) as Partial<CreateDraftRequest>;
      context = getRequestContext(req);
      logger.info('Creating draft', { 
        requestId: context?.requestId, 
        appId: body.appId, 
        version: body.version 
      });

      if (!body.appId && !body.ociRef) {
        return json({ error: { code: 'MISSING_APP_ID', message: 'appId or ociRef is required' } }, { status: 400 });
      }

      const services = getServices();
      const payload = await services.drafts.createDraft(body as CreateDraftRequest);
      
      logger.info('Draft created successfully', { 
        requestId: context?.requestId, 
        draftId: payload.draftId 
      });
      return json(payload);
    } catch (error) {
      logger.error('Failed to create draft', error instanceof Error ? error : new Error(String(error)), {
        requestId: context?.requestId,
        appId: body?.appId,
      });
      // Surface the real reason. A blanket "Failed to create draft"/500 hid
      // actionable failures (registry not in the allowlist, bad credential,
      // unreachable registry) behind a message the operator can do nothing with.
      // Typed errors map to their own status + code; anything untyped still
      // lands as a 500, so this only ever adds information.
      return errorResponse(req, error);
    }
  }

  // Draft by ID operations
  const draftMatch = pathname.match(/^\/api\/drafts\/([^/]+)$/);
  if (draftMatch && req.method === 'GET') {
    try {
      const draftId = draftMatch[1];
      const context = getRequestContext(req);
      logger.info('Getting draft', { requestId: context?.requestId, draftId });

      const services = getServices();
      const payload = await services.drafts.getDraft(draftId);
      
      logger.info('Draft retrieved successfully', { 
        requestId: context?.requestId, 
        draftId 
      });
      return json(payload);
    } catch (error) {
      logger.error('Failed to get draft', error as Error);
      return json(
        { error: { code: 'DRAFT_NOT_FOUND', message: 'Draft not found' } },
        { status: 404 }
      );
    }
  }

  if (draftMatch && (req.method === 'PATCH' || req.method === 'PUT')) {
    try {
      const draftId = draftMatch[1];
      const body = (await req.json().catch(() => ({}))) as PatchDraftRequest;
      const context = getRequestContext(req);
      logger.info('Updating draft', { requestId: context?.requestId, draftId });

      const services = getServices();
      const payload = await services.drafts.updateDraft(draftId, body);
      
      logger.info('Draft updated successfully', { 
        requestId: context?.requestId, 
        draftId 
      });
      return json(payload);
    } catch (error) {
      const draftId = draftMatch[1];
      const status = (error as ServiceError)?.code === 'NOT_FOUND' ? 404 : 500;
      logger.error('Failed to update draft', error instanceof Error ? error : new Error(String(error)), { 
        draftId, 
        status 
      });
      return json(
        { 
          error: { 
            code: status === 404 ? 'DRAFT_NOT_FOUND' : 'DRAFT_UPDATE_FAILED', 
            message: status === 404 ? 'Draft not found' : 'Failed to update draft' 
          } 
        },
        { status }
      );
    }
  }

  if (draftMatch && req.method === 'DELETE') {
    try {
      const draftId = draftMatch[1];
      const context = getRequestContext(req);
      logger.info('Deleting draft', { requestId: context?.requestId, draftId });

      const services = getServices();
      await services.drafts.deleteDraft(draftId);
      
      logger.info('Draft deleted successfully', { 
        requestId: context?.requestId, 
        draftId 
      });
      return new Response(null, { status: 204 });
    } catch (error) {
      const draftId = draftMatch[1];
      const status = (error as ServiceError)?.code === 'NOT_FOUND' ? 404 : 500;
      logger.error('Failed to delete draft', error instanceof Error ? error : new Error(String(error)), { 
        draftId, 
        status 
      });
      return json(
        { 
          error: { 
            code: status === 404 ? 'DRAFT_NOT_FOUND' : 'DRAFT_DELETE_FAILED', 
            message: status === 404 ? 'Draft not found' : 'Failed to delete draft' 
          } 
        }, 
        { status }
      );
    }
  }

  // Draft uploads
  const draftUploadsMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/uploads$/);
  if (draftUploadsMatch && req.method === 'POST') {
    try {
      const draftId = draftUploadsMatch[1];
      const context = getRequestContext(req);
      logger.info('Uploading file to draft', { requestId: context?.requestId, draftId });

      // Handle multipart form data or JSON body with file content
      const contentType = req.headers.get('content-type') || '';
      let fileData: { name: string; content: Buffer; kind: DraftFile['kind']; path?: string };

      if (contentType.includes('multipart/form-data')) {
        const form = await req.formData();
        const filePart = form.get('file');
        if (!(filePart instanceof File)) {
          return json({ error: { code: 'BAD_UPLOAD', message: 'multipart/form-data must include a file field' } }, { status: 400 });
        }
        const buf = Buffer.from(await filePart.arrayBuffer());
        const name = (form.get('name') as string) || filePart.name || 'upload';
        const kindStr = (form.get('kind') as string) || 'additionalFile';
        const validKinds: DraftFile['kind'][] = ['composeOverride', 'additionalFile', 'env', 'secret'];
        const kind = (validKinds.includes(kindStr as DraftFile['kind']) ? (kindStr as DraftFile['kind']) : 'additionalFile');
        const path = (form.get('path') as string) || undefined;
        if (path && (path.startsWith('/') || path.split('/').some(seg => seg === '..'))) {
          return json({ error: { code: 'INVALID_PATH', message: 'Path must be relative and must not contain ".."' } }, { status: 400 });
        }
        fileData = { name, content: buf, kind, path };
      } else {
        // Handle JSON-encoded file content
        const body = await req.json();
        const validKinds: DraftFile['kind'][] = ['composeOverride', 'additionalFile', 'env', 'secret'];
        const kind = (validKinds.includes(body.kind)) ? body.kind : 'additionalFile';
        if (typeof body.content !== 'string') {
          return json({ error: { code: 'BAD_UPLOAD', message: 'JSON body must provide base64 content' } }, { status: 400 });
        }
        if (body.path && (body.path.startsWith('/') || String(body.path).split('/').some((seg: string) => seg === '..'))) {
          return json({ error: { code: 'INVALID_PATH', message: 'Path must be relative and must not contain ".."' } }, { status: 400 });
        }
        fileData = {
          name: body.name || 'upload',
          content: Buffer.from(body.content, 'base64'),
          kind,
          path: body.path || undefined
        };
      }

      // The file name becomes part of the on-disk blob path, so it must be a bare
      // file name — reject path separators / '..' the same way `path` is guarded
      // above (else a crafted name could traverse outside the draft directory).
      if (
        fileData.name.includes('/') ||
        fileData.name.includes('\\') ||
        fileData.name === '.' ||
        fileData.name === '..'
      ) {
        return json({ error: { code: 'INVALID_NAME', message: 'File name must not contain path separators or ".."' } }, { status: 400 });
      }

      const services = getServices();
      const payload = await services.drafts.uploadFile(draftId, fileData);

      logger.info('File uploaded successfully', {
        requestId: context?.requestId, 
        draftId,
        uploadId: payload.uploadId,
        fileName: payload.name
      });
      return json(payload);
    } catch (error) {
      const draftId = draftUploadsMatch[1];
      logger.error('Failed to upload file', error instanceof Error ? error : new Error(String(error)), { 
        draftId 
      });
      return json(
        { error: { code: 'FILE_UPLOAD_FAILED', message: 'Failed to upload file' } },
        { status: 500 }
      );
    }
  }

  const draftUploadByIdMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/uploads\/([^/]+)$/);
  if (draftUploadByIdMatch && req.method === 'DELETE') {
    try {
      const draftId = draftUploadByIdMatch[1];
      const uploadId = draftUploadByIdMatch[2];
      const context = getRequestContext(req);
      logger.info('Deleting file from draft', { requestId: context?.requestId, draftId, uploadId });

      const services = getServices();
      await services.drafts.deleteFile(draftId, uploadId);
      
      logger.info('File deleted successfully', { 
        requestId: context?.requestId, 
        draftId,
        uploadId
      });
      return new Response(null, { status: 204 });
    } catch (error) {
      const draftId = draftUploadByIdMatch[1];
      const uploadId = draftUploadByIdMatch[2];
      const status = (error as ServiceError)?.code === 'NOT_FOUND' ? 404 : 500;
      logger.error('Failed to delete file', error instanceof Error ? error : new Error(String(error)), { 
        draftId, 
        uploadId, 
        status 
      });
      return json({ 
        error: { 
          code: status === 404 ? 'FILE_NOT_FOUND' : 'FILE_DELETE_FAILED', 
          message: status === 404 ? 'File not found' : 'Failed to delete file' 
        } 
      }, { status });
    }
  }

  // Draft validation
  const draftValidateMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/validate$/);
  if (draftValidateMatch && req.method === 'POST') {
    try {
      const draftId = draftValidateMatch[1];
      const context = getRequestContext(req);
      logger.info('Validating draft', { requestId: context?.requestId, draftId });

      const services = getServices();
      const payload = await services.drafts.validateDraft(draftId);
      
      logger.info('Draft validated successfully', { 
        requestId: context?.requestId, 
        draftId,
        isValid: payload.ok,
        errorCount: payload.errors.length,
        warningCount: payload.warnings.length
      });
      return json(payload);
    } catch (error) {
      const draftId = draftValidateMatch[1];
      const status = (error as ServiceError)?.code === 'NOT_FOUND' ? 404 : 500;
      logger.error('Failed to validate draft', error instanceof Error ? error : new Error(String(error)), { 
        draftId, 
        status 
      });
      return json({ 
        error: { 
          code: status === 404 ? 'DRAFT_NOT_FOUND' : 'DRAFT_VALIDATION_FAILED', 
          message: status === 404 ? 'Draft not found' : 'Failed to validate draft' 
        } 
      }, { status });
    }
  }

  // Draft preflight
  const draftPreflightMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/preflight$/);
  if (draftPreflightMatch && req.method === 'POST') {
    try {
      const draftId = draftPreflightMatch[1];
      const context = getRequestContext(req);
      logger.info('Running preflight check for draft', { requestId: context?.requestId, draftId });

      const services = getServices();
      const payload = await services.drafts.preflightCheck(draftId);
      
      logger.info('Preflight check completed', { 
        requestId: context?.requestId, 
        draftId,
        isReady: payload.ok,
        checkCount: payload.checks.length
      });
      return json(payload);
    } catch (error) {
      const draftId = draftPreflightMatch[1];
      const status = (error as ServiceError)?.code === 'NOT_FOUND' ? 404 : 500;
      logger.error('Failed to run preflight check', error instanceof Error ? error : new Error(String(error)), { 
        draftId, 
        status 
      });
      return json({ 
        error: { 
          code: status === 404 ? 'DRAFT_NOT_FOUND' : 'PREFLIGHT_CHECK_FAILED', 
          message: status === 404 ? 'Draft not found' : 'Failed to run preflight check' 
        } 
      }, { status });
    }
  }

  // Draft finalization
  const draftFinalizeMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/finalize$/);
  if (draftFinalizeMatch && req.method === 'POST') {
    try {
      const draftId = draftFinalizeMatch[1];
      const context = getRequestContext(req);
      logger.info('Finalizing draft', { requestId: context?.requestId, draftId });

      const services = getServices();
      const payload = await services.drafts.finalizeDraft(draftId);
      
      logger.info('Draft finalized successfully', { 
        requestId: context?.requestId, 
        draftId,
        checksum: payload.checksum
      });
      return json(payload);
    } catch (error) {
      const draftId = draftFinalizeMatch[1];
      const codeVal = (error as ServiceError)?.code;
      const status = codeVal === 'NOT_FOUND' ? 404 : codeVal === 'CONFLICT' ? 409 : 500;
      logger.error('Failed to finalize draft', error instanceof Error ? error : new Error(String(error)), { 
        draftId, 
        status 
      });
      return json({ 
        error: { 
          code: status === 404 ? 'DRAFT_NOT_FOUND' : 'DRAFT_FINALIZATION_FAILED', 
          message: status === 404 ? 'Draft not found' : 'Failed to finalize draft' 
        } 
      }, { status });
    }
  }


  // Deployments
  // All deployment routes are served by the single authoritative DeploymentService
  // (selected per-environment in the service factory). Errors are mapped centrally
  // via errorResponse() so unknown deployments fail uniformly with a typed 404.
  if (pathname === API.deployments.base && req.method === 'GET') {
    const page = Number(searchParams.get('page')) || 1;
    const limit = Number(searchParams.get('limit')) || 12;
    const q = searchParams.get('q') || undefined;
    const statusParam = searchParams.get('status') || 'all';

    try {
      const services = getServices();
      const payload: GetDeploymentsResponse = await services.deployments.listDeployments({
        page,
        limit,
        q,
        status: statusParam === 'all' ? 'all' : statusParam as 'running' | 'stopped' | 'installing' | 'updating' | 'error',
      });
      return json(payload);
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  if (pathname === API.deployments.base && req.method === 'POST') {
    // create from draft
    try {
      const body = await req.json().catch(() => ({}));
      const services = getServices();
      // Capture the installing user from the authenticated principal so the async
      // deploy job (which has no request context) can resolve `${HOLA_USER_EMAIL}`.
      // Only OIDC-authenticated dashboard users carry an email; admin-key/CLI
      // principals don't, and the token then resolves empty. Server-supplied — we
      // ignore any client-sent installedBy.
      const principal = getPrincipal(req);
      const installedBy = principal?.email
        ? { email: principal.email, name: principal.name }
        : undefined;
      const payload = await services.deployments.createFromDraft({ ...body, installedBy });
      return json(payload);
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  const deploymentMatch = pathname.match(/^\/api\/deployments\/([^/]+)$/);
  if (deploymentMatch && req.method === 'GET') {
    const id = deploymentMatch[1];
    try {
      const services = getServices();
      const payload = await services.deployments.getDeployment(id);
      return json(payload);
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  if (deploymentMatch && req.method === 'PATCH') {
    const id = deploymentMatch[1];
    try {
      const body = (await req.json().catch(() => ({}))) as PatchDeploymentRequest;
      const services = getServices();
      const payload: PatchDeploymentResponse = await services.deployments.updateDeployment(id, body);
      return json(payload);
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  if (deploymentMatch && req.method === 'DELETE') {
    const id = deploymentMatch[1];
    try {
      const services = getServices();
      await services.deployments.deleteDeployment(id);
      return json({ ok: true });
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  const deploymentActionsMatch = pathname.match(/^\/api\/deployments\/([^/]+)\/actions$/);
  if (deploymentActionsMatch && req.method === 'POST') {
    const deploymentId = deploymentActionsMatch[1];
    const body = (await req.json().catch(() => ({}))) as Partial<PostDeploymentActionRequest>;
    const action = body.action;

    if (!action || !['start', 'stop', 'restart', 'delete'].includes(action)) {
      return json({ error: { code: 'INVALID_ACTION', message: 'Invalid action' } }, { status: 400 });
    }

    try {
      const services = getServices();
      const payload: PostDeploymentActionResponse = await services.deployments.executeAction(deploymentId, { action });
      return json(payload);
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // Deployment rollback
  const deploymentRollbackMatch = pathname.match(/^\/api\/deployments\/([^/]+)\/rollback$/);
  if (deploymentRollbackMatch && req.method === 'POST') {
    const deploymentId = deploymentRollbackMatch[1];
    try {
      const body = (await req.json().catch(() => ({}))) as RollbackRequest;
      const services = getServices();
      const payload: RollbackResponse = await services.deployments.rollback(deploymentId, body);
      return json(payload);
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // Deployment promote (upgrade to a newer catalog version) — #284 Phase 2.
  // One endpoint orchestrates the whole upgrade: resolve the target version, build
  // a draft from the catalog bundle, carry the deployment's current env/secrets
  // forward onto the new release, finalize, then promote (which runs the upgrade
  // skip-guard + pre-upgrade snapshot before switching the active release).
  const deploymentPromoteMatch = pathname.match(/^\/api\/deployments\/([^/]+)\/promote$/);
  if (deploymentPromoteMatch && req.method === 'POST') {
    const deploymentId = deploymentPromoteMatch[1];
    try {
      const body = (await req.json().catch(() => ({}))) as PromoteDeploymentRequest;
      const context = getRequestContext(req);
      const services = getServices();
      const detail = await services.deployments.getDeployment(deploymentId);
      const appId = detail.app;
      const targetVersion = body.version ?? detail.latestVersion;
      if (!targetVersion) {
        return json(
          {
            error: {
              code: 'NO_TARGET_VERSION',
              message:
                'No version to promote to — the deployment is already at the latest known version (or the catalog is unavailable). Pass an explicit { "version": "x.y.z" }.',
            },
          },
          { status: 400 },
        );
      }
      // Build the target release from the catalog, then carry the operator's current
      // config forward onto the new version: env values/secrets (merged by key — a key
      // absent from the deployment keeps the new version's catalog default) and system
      // overrides. Ports are NOT carried — the new version's compose defines its own.
      //
      // Rebuild the draft from the SAME catalog source the app was installed from
      // (#340): createDraft defaults source to `hola`, so an app from a custom
      // source (e.g. a private catalog) would 404 with APP_NOT_FOUND on upgrade.
      const source = await services.deployments.getDeploymentSource(deploymentId);
      const draft = await services.drafts.createDraft({ appId, version: targetVersion, source });
      try {
        const carried = await services.deployments.getActiveConfig(deploymentId);
        const draftDetail = await services.drafts.getDraft(draft.draftId);
        const mergedAppEnv = (draftDetail.appEnv ?? []).map(e =>
          Object.prototype.hasOwnProperty.call(carried.appEnv, e.key) ? { ...e, value: carried.appEnv[e.key] } : e,
        );
        const patch: PatchDraftRequest = {};
        if (mergedAppEnv.length > 0) patch.appEnv = mergedAppEnv;
        if (Object.keys(carried.systemOverrides).length > 0) patch.systemOverrides = carried.systemOverrides;
        if (Object.keys(patch).length > 0) await services.drafts.updateDraft(draft.draftId, patch);
        try {
          await services.drafts.finalizeDraft(draft.draftId);
        } catch (finalizeErr) {
          throw asPromoteValidationError(finalizeErr);
        }
        logger.info('Promoting deployment to new release', {
          requestId: context?.requestId,
          deploymentId,
          appId,
          targetVersion,
          draftId: draft.draftId,
        });
        const payload: PromoteDeploymentResponse = await services.deployments.promote(deploymentId, {
          draftId: draft.draftId,
          snapshot: body.snapshot,
        });
        return json(payload);
      } catch (err) {
        // The draft for this attempt is orphaned if the upgrade can't proceed
        // (skip-guard rejection, snapshot failure, …) — delete it so it doesn't linger.
        await services.drafts.deleteDraft(draft.draftId).catch(() => {});
        throw err;
      }
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  const deploymentHistoryMatch = pathname.match(/^\/api\/deployments\/([^/]+)\/history$/);
  if (deploymentHistoryMatch && req.method === 'GET') {
    const deploymentId = deploymentHistoryMatch[1];
    const page = Number(searchParams.get('page')) || 1;
    const limit = Number(searchParams.get('limit')) || 10;

    try {
      const services = getServices();
      const payload = await services.deployments.getDeploymentHistory(deploymentId, { page, limit });
      return json(payload);
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // Active release's full config (typed appEnv rows + system overrides) for the
  // DeploymentDetail Configuration tab.
  const deploymentConfigMatch = pathname.match(/^\/api\/deployments\/([^/]+)\/config$/);
  if (deploymentConfigMatch && req.method === 'GET') {
    const deploymentId = deploymentConfigMatch[1];
    try {
      const services = getServices();
      const payload: GetDeploymentConfigResponse = await services.deployments.getConfig(deploymentId);
      return json(payload);
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // Logs snapshot (deployment): the app's real recent container output across
  // every compose service. Live logs stream from `/logs/stream` below. On any
  // docker error the service returns an empty snapshot — never fabricated data.
  const deploymentLogsMatch = pathname.match(/^\/api\/deployments\/([^/]+)\/logs$/);
  if (deploymentLogsMatch && req.method === 'GET') {
    const deploymentId = deploymentLogsMatch[1];
    const url = new URL(req.url);
    const tailParam = parseInt(url.searchParams.get('tail') ?? '', 10);
    const tail = Number.isFinite(tailParam) && tailParam > 0 ? tailParam : undefined;
    try {
      const services = getServices();
      const payload = await services.deployments.getDeploymentLogs(deploymentId, { tail });
      return json(payload);
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // Logs SSE Stream (deployment) - new endpoint for real-time logs
  const deploymentLogsStreamMatch = pathname.match(/^\/api\/deployments\/([^/]+)\/logs\/stream$/);
  if (deploymentLogsStreamMatch && req.method === 'GET') {
    const deploymentId = deploymentLogsStreamMatch[1];
    const services = getServices();
    const stream = createSSEStream({
      logger,
      onSubscribe(controller) {
        controller.heartbeat();
        // Two sources, merged: (1) Hola lifecycle/Compose events (deploy,
        // provision) from the logging bus, and (2) the app's real container
        // stdout via `docker compose logs -f`, so the tab shows what the app
        // is actually doing.
        const sub = services.logging.onLog({ kind: 'deployment', id: deploymentId }, entry => {
          controller.send({
            type: 'log',
            data: {
              timestamp: entry.timestamp,
              service: entry.service,
              level: entry.level,
              message: entry.message,
            },
          });
        });

        // The container stream starts async; guard against the client
        // disconnecting before the stop handle resolves (else it would leak the
        // `docker compose logs -f` child).
        let closed = false;
        let containerStop = () => {};
        services.deployments
          .streamDeploymentLogs(deploymentId, entry => {
            if (closed) return;
            controller.send({
              type: 'log',
              data: {
                timestamp: entry.timestamp,
                service: entry.service,
                level: entry.level,
                message: entry.message,
              },
            });
          })
          .then(handle => {
            if (closed) handle.stop();
            else containerStop = handle.stop;
          })
          .catch(error => {
            logger.warn('Failed to start container log stream', { deploymentId, error: String(error) });
          });

        return () => {
          closed = true;
          sub.unsubscribe();
          containerStop();
        };
      },
    });
    return new Response(stream, { headers: createSSEHeaders() });
  }

  // Jobs + logs SSE
  // Clear finished jobs (completed/failed/cancelled). Optional ?deploymentId= and
  // ?status= narrow the scope; running/queued jobs are never removed.
  if (pathname === API.jobs.base && req.method === 'DELETE') {
    const url = new URL(req.url);
    const deploymentId = url.searchParams.get('deploymentId') ?? undefined;
    const statusParam = url.searchParams.get('status');
    const status = statusParam && statusParam !== 'all' ? (statusParam as JobStatus) : undefined;
    try {
      const cleared = await getServices().jobs.clearJobs({ deploymentId, status });
      const payload: DeleteJobsResponse = { cleared };
      return json(payload);
    } catch (error) {
      logger.error('Failed to clear jobs', error as Error);
      return errorResponse(req, error);
    }
  }

  // List jobs
  if (pathname === API.jobs.base && req.method === 'GET') {
    const url = new URL(req.url);
    const deploymentId = url.searchParams.get('deploymentId');
    const statusParam = url.searchParams.get('status');
    const page = parseInt(url.searchParams.get('page') ?? '1', 10);
    const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
    
    let jobs: Job[];
    try {
      const services = getServices();
      const status = statusParam && statusParam !== 'all' ? statusParam as JobStatus : undefined;
      jobs = await services.jobs.listJobs({ deploymentId: deploymentId ?? undefined, status });
      // Join each job to its owning deployment's name/app so the UI can label a
      // job by what it acts on (not just "Starting"). One in-memory list + a map
      // lookup; fail-safe — a join error leaves jobs unenriched.
      try {
        const deps = await services.deployments.listDeployments({ page: 1, limit: 1000 });
        const byId = new Map(deps.items.map(d => [d.id, d]));
        jobs = jobs.map(j => {
          const d = j.deploymentId ? byId.get(j.deploymentId) : undefined;
          return d ? { ...j, deploymentName: d.name, app: d.app } : j;
        });
      } catch (joinErr) {
        logger.warn('Failed to enrich jobs with deployment names', { error: String(joinErr) });
      }
    } catch (error) {
      logger.error('Failed to list jobs', error as Error);
      jobs = [];
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
    try {
      const payload = await getServices().jobs.getJob(jobId);
      if (!payload) {
        return notFound();
      }
      return json(payload);
    } catch (error) {
      return errorResponse(req, error);
    }
  }

  // Snapshot of prior job logs from the logging service's in-memory ring buffer,
  // so a finished/failed job still shows why it ended (the live `/logs/stream`
  // below has nothing to replay once the job is over).
  const jobLogsMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/logs$/);
  if (jobLogsMatch && req.method === 'GET') {
    const jobId = jobLogsMatch[1];
    const items = getServices().logging
      .recentLogs({ kind: 'job', id: jobId })
      .map(entry => ({
        timestamp: entry.timestamp,
        service: entry.service,
        level: entry.level,
        message: entry.message,
      }));
    return json({ items });
  }

  // Job Logs SSE Stream - new endpoint for real-time job logs and updates
  const jobLogsStreamMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/logs\/stream$/);
  if (jobLogsStreamMatch && req.method === 'GET') {
    const jobId = jobLogsStreamMatch[1];
    try {
      const services = getServices();
      const stream = createSSEStream({
        logger,
        onSubscribe(controller) {
          controller.heartbeat();
          // Replay buffered history first so a tab opened mid/post-run sees the
          // prior lines (incl. the failure) before live lines start flowing.
          for (const entry of services.logging.recentLogs({ kind: 'job', id: jobId })) {
            controller.send({
              type: 'log',
              data: {
                timestamp: entry.timestamp,
                service: entry.service,
                level: entry.level,
                message: entry.message,
              },
            });
          }
          const sub = services.logging.onLog({ kind: 'job', id: jobId }, entry => {
            controller.send({
              type: 'log',
              data: {
                timestamp: entry.timestamp,
                service: entry.service,
                level: entry.level,
                message: entry.message,
              },
            });
          });

          const upd = services.jobs.onJobUpdate(jobId, update => {
            controller.send({
              type: 'job_update',
              data: {
                jobId,
                status: update.status,
                progress: update.progress,
                finishedAt: update.finishedAt,
              },
            });
          });

          return () => {
            sub.unsubscribe();
            upd.unsubscribe();
          };
        },
      });
      return new Response(stream, { headers: createSSEHeaders() });
    } catch (error) {
      // Surface the real failure rather than fabricating a fake job log stream.
      return errorResponse(req, error);
    }
  }

  // Backups. There is no platform backup engine yet (per-app backup is provided
  // by the `backrest` catalog app), so the list is genuinely empty rather than
  // seeded with sample backups. The mutation routes remain as no-op stubs.
  if (pathname === API.backups.base && req.method === 'GET') {
    const payload: GetBackupsResponse = { items: [], page: 1, limit: 10, total: 0 };
    return json(payload);
  }

  if (pathname === API.backups.base && req.method === 'POST') {
    await req.json().catch(() => ({})) as Partial<CreateBackupRequest>;
    const payload: CreateBackupResponse = { jobId: crypto.randomUUID(), backupId: crypto.randomUUID() };
    return json(payload);
  }

  const backupByIdMatch = pathname.match(/^\/api\/backups\/([^/]+)$/);
  if (backupByIdMatch && req.method === 'GET') {
    // No backup store: an id can never resolve to a real backup.
    return notFound();
  }

  const backupRestoreMatch = pathname.match(/^\/api\/backups\/([^/]+)\/restore$/);
  if (backupRestoreMatch && req.method === 'POST') {
    await req.json().catch(() => ({})) as Partial<RestoreBackupRequest>;
    const payload: RestoreBackupResponse = { jobId: crypto.randomUUID() };
    return json(payload);
  }

  if (backupByIdMatch && req.method === 'DELETE') {
    const payload: DeleteBackupResponse = { ok: true };
    return json(payload);
  }

  // Notifications. No notification store exists yet, so the feed is empty rather
  // than seeded with sample alerts.
  if (pathname === API.notifications.base && req.method === 'GET') {
    const payload: GetNotificationsResponse = {
      items: [], page: 1, limit: 10, total: 0, unreadCount: 0,
    };
    return json(payload);
  }

  const notificationByIdMatch = pathname.match(/^\/api\/notifications\/([^/]+)$/);
  if (notificationByIdMatch && req.method === 'PATCH') {
    await req.json().catch(() => ({})) as Partial<PatchNotificationRequest>;
    const payload: PatchNotificationResponse = { id: notificationByIdMatch[1], read: true };
    return json(payload);
  }

  if (pathname === API.notifications.actions && req.method === 'POST') {
    await req.json().catch(() => ({})) as Partial<PostNotificationsActionRequest>;
    const payload: PostNotificationsActionResponse = { ok: true };
    return json(payload);
  }

  // Settings - Phase 2: Using smart config service (database-backed when enabled)
  if (pathname === API.settings.base && req.method === 'GET') {
    try {
      const services = getServices();
      const systemSettings = await services.config.getSystemSettings();
      
      const payload: GetSettingsResponse = {
        systemEnv: systemSettings.systemEnv,
        docker: systemSettings.docker,
        tls: systemSettings.tls,
        notifications: systemSettings.notifications,
      };
      return json(payload);
    } catch (error) {
      logger.error('Failed to get system settings', error as Error);
      // Fallback to empty settings (no placeholder system variables).
      const payload: GetSettingsResponse = {
        systemEnv: [],
        docker: { host: '/var/run/docker.sock' },
        tls: { email: '' },
        notifications: { smtpHost: '', smtpUser: '', smtpPassword: '' },
      };
      return json(payload);
    }
  }

  if (pathname === API.settings.base && req.method === 'PATCH') {
    try {
      const body = (await req.json().catch(() => ({}))) as Partial<PatchSettingsRequest>;
      const services = getServices();
      
      // Update system settings
      const updatedSettings = await services.config.updateSystemSettings(body);
      
      const payload: PatchSettingsResponse = {
        systemEnv: updatedSettings.systemEnv,
        docker: updatedSettings.docker,
        tls: updatedSettings.tls,
        notifications: updatedSettings.notifications,
      };
      return json(payload);
    } catch (error) {
      logger.error('Failed to update system settings', error as Error);
      // Route through the shared mapper so a typed ValidationError keeps its
      // user-facing message + 400, but an unexpected error returns a generic 500
      // instead of leaking internal details (paths, driver errors).
      return errorResponse(req, error);
    }
  }

  if (pathname === API.settings.backup && req.method === 'GET') {
    try {
      const services = getServices();
      const backupSettings = await services.config.getBackupSettings();
      
      const payload: GetBackupSettingsResponse = {
        scheduleEnabled: backupSettings.scheduleEnabled,
        scheduleTime: backupSettings.scheduleTime,
        retentionDays: backupSettings.retentionDays,
      };
      return json(payload);
    } catch (error) {
      logger.error('Failed to get backup settings', error as Error);
      // Fallback to default settings
      const payload: GetBackupSettingsResponse = { 
        scheduleEnabled: true, 
        scheduleTime: '02:00', 
        retentionDays: 7 
      };
      return json(payload);
    }
  }

  if (pathname === API.settings.backup && req.method === 'PATCH') {
    try {
      const body = (await req.json().catch(() => ({}))) as Partial<PatchBackupSettingsRequest>;
      const services = getServices();
      
      // Update backup settings
      const updatedSettings = await services.config.updateBackupSettings(body);
      
      const payload: PatchBackupSettingsResponse = {
        scheduleEnabled: updatedSettings.scheduleEnabled,
        scheduleTime: updatedSettings.scheduleTime,
        retentionDays: updatedSettings.retentionDays,
      };
      return json(payload);
    } catch (error) {
      logger.error('Failed to update backup settings', error as Error);
      // Sanitize via the shared mapper (see system-settings handler above).
      return errorResponse(req, error);
    }
  }

  // System status
  if (pathname === API.system.status && req.method === 'GET') {
    try {
      const services = getServices();
      const payload: GetSystemStatusResponse = await services.systemMonitoring.getSystemStatus();
      return json(payload);
    } catch (error) {
      return errorResponse(req, error);
    }
  }

  // Update-availability check (cached GitHub release lookup; shared by web + CLI)
  if (pathname === API.system.updateCheck && req.method === 'GET') {
    try {
      const services = getServices();
      const payload: GetUpdateCheckResponse = await services.updateCheck.check();
      return json(payload);
    } catch (error) {
      return errorResponse(req, error);
    }
  }

  // System Status SSE Stream - Phase 4: Real-time system updates with monitoring service
  // Global event stream (#291): one authenticated SSE connection per dashboard
  // that multiplexes job_update + deployment_update events from the in-process
  // event bus, so list views (Deployments, JobTracker) stay live without polling.
  // Authenticated by authMiddleware like every other route. Logs keep their own
  // per-entity streams (they're high-volume and id-scoped); this carries state
  // transitions only.
  if (pathname === '/api/events' && req.method === 'GET') {
    const services = getServices();
    const stream = createSSEStream({
      logger,
      onSubscribe(controller) {
        controller.heartbeat();
        const sub = services.eventBus.subscribe((event) => controller.send(event));
        return () => { sub.unsubscribe(); };
      },
    });
    return new Response(stream, { headers: createSSEHeaders() });
  }

  if (pathname === '/api/system/status/stream' && req.method === 'GET') {
    const stream = createSSEStream({
      logger,
      heartbeatIntervalMs: 5000,
      onSubscribe(controller) {
        controller.heartbeat();
        try {
          const services = getServices();
          const monitoring = services.systemMonitoring.startMonitoring((systemStatus: GetSystemStatusResponse) => {
            controller.send({
              type: 'system_update',
              data: systemStatus,
            });
          }, 5000);

          return () => {
            monitoring.stop();
          };
        } catch (error) {
          logger.error('Failed to start real system monitoring, falling back to mock SSE', error as Error);
          let i = 0;
          const interval = setInterval(() => {
            i += 1;
            if (i % 2 === 0) {
              controller.send({
                type: 'system_update',
                data: {
                  docker: {
                    ok: true,
                    version: '24.0.5',
                  },
                  disk: {
                    freeBytes: Math.max(0, 50_000_000_000 - i * 1_000_000),
                    totalBytes: 100_000_000_000,
                  },
                  version: {
                    hola: '1.0.0',
                    compose: '2.20.0',
                  },
                  oras: {
                    ok: true,
                    version: '1.1.0',
                  },
                  authentik: {
                    ok: (i % 5) !== 0,
                  },
                },
              });
            }
          }, 5000);

          return () => {
            clearInterval(interval);
          };
        }
      },
    });
    return new Response(stream, { headers: createSSEHeaders() });
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
    // Simple changelog markdown response
    const markdown = `# API Changelog\n\n## Version 1.0.0\n\n- Initial release with core deployment functionality\n- Health monitoring and status endpoints\n- Job management and logging\n- Backup and restore operations\n- System configuration management\n`;
    return new Response(markdown, {
      headers: { 'content-type': 'text/markdown; charset=utf-8' }
    });
  }

  // Type definitions
  if (pathname === '/docs/types' && req.method === 'GET') {
    const html = `<!DOCTYPE html>\n<html>\n<head><title>API Types</title></head>\n<body>\n<h1>API Type Definitions</h1>\n<p>For complete type definitions, see the TypeScript definitions in the @hola/shared package.</p>\n</body>\n</html>`;
    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  }

  // Migration guide
  if (pathname === '/docs/migration' && req.method === 'GET') {
    const fromVersion = searchParams.get('from');
    const toVersion = searchParams.get('to');
    const html = `<!DOCTYPE html>\n<html>\n<head><title>Migration Guide</title></head>\n<body>\n<h1>API Migration Guide</h1>\n<p>Migrating from ${fromVersion || 'unknown'} to ${toVersion || 'latest'}</p>\n<p>This API is stable and backward compatible.</p>\n</body>\n</html>`;
    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  }

  // Documentation home page with navigation
  if (pathname === '/docs/home' && req.method === 'GET') {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hola API Documentation</title>
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      line-height: 1.6; 
      max-width: 800px; 
      margin: 0 auto; 
      padding: 2rem; 
      color: #333; 
    }
    h1 { color: #2563eb; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
    h2 { color: #1f2937; margin-top: 2rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem; margin: 1rem 0; }
    .card { 
      border: 1px solid #e5e7eb; 
      border-radius: 8px; 
      padding: 1rem; 
      text-decoration: none; 
      color: inherit; 
      transition: box-shadow 0.2s; 
    }
    .card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    .card h3 { margin: 0 0 0.5rem 0; color: #2563eb; }
    code { background: #f3f4f6; padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.9em; }
    pre { background: #f3f4f6; padding: 1rem; border-radius: 4px; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>🚀 Hola API Documentation</h1>
  <p>Welcome to the Hola deployment platform API. Explore the documentation below to get started.</p>

  <div class="grid">
    <a href="/docs" class="card">
      <h3>📋 Interactive API Explorer</h3>
      <p>Swagger UI with live API testing, request/response examples, and schema validation.</p>
    </a>
    
    <a href="/redoc" class="card">
      <h3>📖 API Reference</h3>
      <p>Clean, readable documentation with detailed endpoint descriptions and examples.</p>
    </a>
    
    <a href="/docs/examples" class="card">
      <h3>💻 Code Examples</h3>
      <p>Ready-to-use code samples in multiple programming languages and frameworks.</p>
    </a>
    
    <a href="/docs/types" class="card">
      <h3>🏗️ Type Definitions</h3>
      <p>Complete TypeScript type definitions for all API request and response models.</p>
    </a>
    
    <a href="/docs/migration" class="card">
      <h3>🔄 Migration Guide</h3>
      <p>Step-by-step instructions for upgrading between API versions and handling breaking changes.</p>
    </a>
    
    <a href="/docs/changelog" class="card">
      <h3>📝 Changelog</h3>
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

export async function handleRequest(req: Request): Promise<Response> {
  const pre = handlePreflight(req);
  if (pre) return withCors(pre);

  const url = new URL(req.url);

  const response = await requestMiddleware(req, async () => {
    return authMiddleware(req, async () => {
      return route(url, req);
    });
  });

  return withCors(response);
}

export async function createInProcessApp(options: InProcessAppOptions = {}): Promise<{ fetch: typeof handleRequest; close: () => Promise<void> }> {
  const { enableBackgroundTasks = false, resetServicesOnClose = true } = options;

  if (shouldAutoStart) {
    // In auto-start mode we don't control lifecycle here
    return {
      fetch: handleRequest,
      close: async () => {},
    };
  }
  if (enableBackgroundTasks) {
    await startBackgroundTasks();
  }

  return {
    fetch: handleRequest,
    close: async () => {
      stopBackgroundTasks();
      if (resetServicesOnClose) {
        resetServices();
      }
    },
  };
}

/**
 * Self-provision the dashboard's own OIDC client (best-effort, background).
 *
 * Only runs in production with auth on and HOLA_AUTH_MODE=authentik. Skips when
 * the operator supplied explicit HOLA_OIDC_* env (external IdP). Authentik may
 * still be migrating at first boot, so this retries with backoff and never blocks
 * serving — until it succeeds, /api/auth/config reports the admin-key fallback.
 */
async function initializePlatformAuth(): Promise<void> {
  if (!featureFlags.useAuth || authConfig.mode !== 'authentik') return;
  if (process.env.HOLA_OIDC_ISSUER && process.env.HOLA_OIDC_CLIENT_ID) {
    logger.info('Dashboard OIDC configured via env; skipping self-provision');
    return;
  }
  const host = process.env.HOLA_DOMAIN?.trim();
  if (!host) {
    logger.warn('HOLA_DOMAIN unset; cannot self-provision the dashboard OIDC client');
    return;
  }

  const { provisioner } = getServices();
  // Authentik's first boot (image pull + DB migrations + worker bootstrap) can take
  // several minutes, so keep retrying with capped backoff rather than giving up
  // after ~2 minutes. Never blocks serving — runs as a background task.
  const delaysMs = [0, 5_000, 15_000, 30_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000];
  for (let i = 0; i < delaysMs.length; i++) {
    if (delaysMs[i]) await new Promise((r) => setTimeout(r, delaysMs[i]));
    try {
      const result = await provisioner.provisionPlatformOidc({
        host,
        redirectPath: '/auth/callback',
        scopes: resolveOidcConfig().scopes,
      });
      setProvisionedOidc(result);
      logger.info('Dashboard OIDC client ready', { issuer: result.issuer, clientId: result.clientId });
      // Ensure the admin group exists + contains the superusers, so the dashboard
      // admin gate (HOLA_OIDC_ADMIN_GROUP, default hola-admins) and catalog apps
      // that map to it have members. Best-effort; never blocks readiness.
      const adminGroup = resolveOidcConfig().adminGroup;
      if (adminGroup) {
        await provisioner.ensureAdminGroup(adminGroup);
        // Optionally provision a named admin (HOLA_ADMIN_EMAIL) and surface its
        // one-time password-setup link so the operator signs in as themselves.
        const admin = await provisioner.ensureBootstrapAdmin(adminGroup);
        if (admin.recoveryLink) {
          logger.info(
            `=== Hola admin setup: open this one-time link to set your password ===\n${admin.recoveryLink}`,
          );
        }
      }
      return;
    } catch (error) {
      logger.warn('Dashboard OIDC provisioning attempt failed; will retry', {
        attempt: i + 1,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  logger.error('Gave up self-provisioning the dashboard OIDC client; using admin-key login until configured');
}

// Phase 0: Start background tasks
async function startBackgroundTasks() {
  logger.info('Starting background tasks');
  // No demo data generators: jobs, notifications, and system status are all
  // served from real services on demand.
}

function stopBackgroundTasks() {
  logger.info('Stopping background tasks');
  backgroundTimers.forEach(stop => stop());
  backgroundTimers.length = 0;
}

// Phase 0: Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully');
  stopBackgroundTasks();
  resetServices();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  stopBackgroundTasks();
  resetServices();
  process.exit(0);
});

// Phase 0 auto-start
if (shouldAutoStart) {
  await initializeDevelopmentEnvironment();
  await startBackgroundTasks();

  // Self-provision the dashboard OIDC client in the background (best-effort).
  void initializePlatformAuth();

  const server = Bun.serve({
    port: PORT,
    fetch: handleRequest,
    development: true,
    // Bun's default idleTimeout is 10s — it closes any connection that sends no
    // bytes for that long. Our SSE log streams keep themselves alive with a
    // heartbeat every 15s (createSSEStream), so with the default Bun would close
    // each stream at ~10s, BEFORE the first heartbeat lands: the client then sees
    // the body end ("Stream closed"), shows a connection error, reconnects, and
    // the indicator flaps Live↔Error on a ~10s loop during a deploy. Set the idle
    // timeout to Bun's max (255s); the 15s heartbeat resets it long before then, so
    // a live stream survives indefinitely while a genuinely stuck socket still times out.
    idleTimeout: 255,
  });

  console.log(`✅ Hola Server listening on port ${server.port}`);
  logger.info('Server started', { port: server.port, development: true });
}

export type InProcessAppOptions = {
  enableBackgroundTasks?: boolean;
  resetServicesOnClose?: boolean;
};
