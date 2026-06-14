// Shared types and utilities for web and server

// ------------------------------------------------------
// API route constants to prevent drift between client/server
// ------------------------------------------------------
export const API = {
  base: '/api',
  health: '/api/health',
  hello: '/api/hello',
  echo: '/api/echo',

  me: '/api/me',
  summary: '/api/summary',

  catalog: {
    apps: '/api/catalog/apps', // list, query via ?query=&category=&page=&limit=
    refresh: '/api/catalog/refresh',
    appById: (appId: string) => `/api/catalog/apps/${appId}`,
    versions: (appId: string) => `/api/catalog/apps/${appId}/versions`,
    versionDetail: (appId: string, version: string) =>
      `/api/catalog/apps/${appId}/versions/${encodeURIComponent(version)}`
  },

  drafts: {
    create: '/api/drafts',
    byId: (draftId: string) => `/api/drafts/${draftId}`,
    uploads: (draftId: string) => `/api/drafts/${draftId}/uploads`,
    uploadById: (draftId: string, uploadId: string) => `/api/drafts/${draftId}/uploads/${uploadId}`,
    validate: (draftId: string) => `/api/drafts/${draftId}/validate`,
    preflight: (draftId: string) => `/api/drafts/${draftId}/preflight`,
    finalize: (draftId: string) => `/api/drafts/${draftId}/finalize`
  },

  deployments: {
    base: '/api/deployments', // list and POST create-from-draft at /api/deployments
    byId: (deploymentId: string) => `/api/deployments/${deploymentId}`,
    history: (deploymentId: string) => `/api/deployments/${deploymentId}/history`,
    logs: (deploymentId: string) => `/api/deployments/${deploymentId}/logs`,
    logsStream: (deploymentId: string) => `/api/deployments/${deploymentId}/logs/stream`,
    actions: (deploymentId: string) => `/api/deployments/${deploymentId}/actions`,
    rollback: (deploymentId: string) => `/api/deployments/${deploymentId}/rollback`,
  },

  jobs: {
    base: '/api/jobs', // list jobs with ?deploymentId=&status=&page=&limit=
    byId: (jobId: string) => `/api/jobs/${jobId}`,
    logs: (jobId: string) => `/api/jobs/${jobId}/logs`,
    logsStream: (jobId: string) => `/api/jobs/${jobId}/logs/stream`,
  },

  backups: {
    base: '/api/backups',
    byId: (backupId: string) => `/api/backups/${backupId}`,
    restore: (backupId: string) => `/api/backups/${backupId}/restore`,
  },

  notifications: {
    base: '/api/notifications',
    byId: (id: string) => `/api/notifications/${id}`,
    actions: '/api/notifications/actions',
  },

  settings: {
    base: '/api/settings',
    backup: '/api/settings/backup',
  },

  system: {
    status: '/api/system/status',
    health: '/api/system/health',
    healthz: '/healthz',
    readyz: '/readyz',
    metrics: '/metrics',
  },
} as const;

// ------------------------------------------------------
// Common helpers
// ------------------------------------------------------
export type PageRequest = {
  page?: number;
  limit?: number;
  q?: string;
};

export type PageResponse<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
};

export type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

// ------------------------------------------------------
// Health / Hello (existing)
// ------------------------------------------------------
export type HealthResponse = {
  ok: boolean;
  ts: string; // ISO timestamp
};

export type HelloResponse = {
  message: string;
};

// ------------------------------------------------------
// Identity and Authentication (Phase 3)
// ------------------------------------------------------
export type PrincipalType = 'user' | 'service' | 'system';

export type Principal = {
  id: string;
  type: PrincipalType;
  name: string;
  email?: string;
  roles: string[];
  capabilities: string[];
  metadata?: Record<string, unknown>;
};

export type AuthContext = {
  isAuthenticated: boolean;
  principal?: Principal;
  error?: string;
};

// Standard application capabilities
export const CAPABILITIES = {
  // Read operations
  READ_SYSTEM: 'read:system',
  READ_DEPLOYMENTS: 'read:deployments',
  READ_LOGS: 'read:logs',
  READ_BACKUPS: 'read:backups',
  READ_CATALOG: 'read:catalog',
  
  // Write operations  
  WRITE_DEPLOYMENTS: 'write:deployments',
  WRITE_SETTINGS: 'write:settings',
  WRITE_BACKUPS: 'write:backups',
  
  // Management operations
  MANAGE_SYSTEM: 'manage:system',
  MANAGE_USERS: 'manage:users',
  
  // Special capabilities
  ADMIN: 'admin',
  ALL: '*',
} as const;

export type Capability = typeof CAPABILITIES[keyof typeof CAPABILITIES];

// Auth API endpoints.
// pt.1 (control-plane API keys) implements `me`. Session/SSO endpoints
// (login/logout/refresh) arrive with application SSO in MVP pt.2 (ADR 0001).
export const AUTH_API = {
  me: '/api/auth/me',
} as const;

export type GetAuthMeResponse = Principal;

// GET /api/me
export type GetMeResponse = Principal;

// ------------------------------------------------------
// Dashboard Summary
// ------------------------------------------------------
export type JobType = 'install' | 'update' | 'backup' | 'restore' | 'start' | 'stop' | 'restart';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export type SummaryJob = {
  id: string;
  deploymentId: string;
  type: JobType;
  app: string;
  status: JobStatus;
  progress?: number;
  timestamp: string; // human or ISO, UI can render either
};

export type SystemStatus = {
  docker: { ok: boolean; version?: string };
  disk: { freeBytes: number; totalBytes: number };
  version: { hola: string; compose: string };
  oras?: { ok: boolean; version?: string };
  authentik?: { ok: boolean };
};

export type GetSummaryResponse = {
  deploymentsCount: number;
  activeJobsCount: number;
  alertsCount: number;
  recentJobs: SummaryJob[];
  system: SystemStatus;
};

// ------------------------------------------------------
// Catalog
// ------------------------------------------------------
export type CatalogApp = {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  rating: number;
  downloads: string | number;
  tags: string[];
  featured: boolean;
};

export type GetCatalogAppsRequest = PageRequest & {
  query?: string;
  category?: string;
};

export type GetCatalogAppsResponse = PageResponse<CatalogApp>;

export type GetCatalogAppResponse = CatalogApp & {
  versions: string[];
};

export type CatalogAppVersion = {
  version: string;
  createdAt: string;
};

export type GetCatalogAppVersionsResponse = {
  items: CatalogAppVersion[];
  total: number;
};

export type AppEnvVar = {
  key: string;
  value: string;
  isSecret: boolean;
  description?: string;
};

export type DraftDefaults = {
  ports: Array<{ host?: number; container: number; protocol: 'tcp' | 'udp' }>;
  volumes: Array<{ hostPath?: string; containerPath: string; readOnly?: boolean }>;
};

export type GetCatalogAppVersionDetailResponse = {
  defaultEnv: AppEnvVar[];
  defaults: DraftDefaults;
  // The bundle's compose.yaml, used to seed a catalog-created draft's
  // composeOverride so it can be deployed without the user pasting compose.
  // Optional: clients that only need env/port defaults can ignore it.
  composeOverride?: string;
  // How the app integrates with auth/SSO, declared in its bundle manifest.
  // Drives provisioning at deploy time (see AppAuthConfig). Optional: apps
  // that don't declare it behave as `none` (no auth wiring).
  auth?: AppAuthConfig;
};

// ------------------------------------------------------
// Auth / SSO
// ------------------------------------------------------
// How a catalog app integrates with the operator's auth platform. The platform
// (Authentik today; Authelia+LLDAP tracked in try-hola/hola#88) is chosen by the
// operator; this declares only the app's *capability* so Hola can resolve
// capability × platform at deploy time.
export type AuthMode = 'none' | 'native-oidc' | 'native-ldap' | 'forward-auth';

// A command run inside an app's container after deploy to finish OIDC wiring for
// apps that can't be configured by env alone (e.g. Gitea stores its OAuth2 login
// source in the DB and needs `gitea admin auth add-oauth`). Placeholders
// {{clientId}} {{clientSecret}} {{issuer}} {{redirectUri}} {{host}} are substituted
// with the provisioned values. `check`/`checkMatch` make it idempotent: if `check`
// exits 0 and its stdout contains `checkMatch`, `command` is skipped.
export type OidcSetupCommand = {
  /** Compose service to exec in (defaults to the ingress service). */
  service?: string;
  /** Exec as this user (e.g. `git` for Gitea). */
  user?: string;
  /** Idempotency probe argv; if it succeeds and its output contains checkMatch, skip command. */
  check?: string[];
  checkMatch?: string;
  /** The argv that configures the OIDC source (placeholders substituted). */
  command: string[];
};

export type AppAuthConfig = {
  mode: AuthMode;
  // For `native-oidc`: how Hola wires the provisioned OIDC client into the app.
  // `env` maps the issuer/client id/secret/redirect into the app's expected env-var
  // NAMES (for env-configurable apps like Grafana). `setup` runs an in-container
  // command for apps configured via CLI/DB (like Gitea). At least one is expected;
  // an app may use both. `redirectPath` + `scopes` are always required.
  oidc?: {
    redirectPath: string;
    scopes: string[];
    // `redirectUri` is optional: many apps derive their own redirect URI from
    // their base URL and have no env var for the literal callback URL (e.g.
    // Actual Budget uses ACTUAL_OPENID_SERVER_HOSTNAME). issuer/clientId/
    // clientSecret are always required when an env map is present.
    env?: { issuer: string; clientId: string; clientSecret: string; redirectUri?: string };
    setup?: OidcSetupCommand;
  };
  // For `native-ldap`: the env-var NAMES this app expects its LDAP bind settings in.
  ldap?: {
    env: { host: string; port: string; bindDn: string; bindPassword: string; baseDn: string };
  };
  // For `forward-auth`: optional access restriction by group.
  forwardAuth?: { allowedGroups?: string[] };
  // Optionally gate a `native-oidc`/no-auth app behind proxy login too.
  fallback?: 'forward-auth';
};

// Opaque handle to the auth artifacts provisioned for a deployment, persisted on
// its metadata so they can be reused (idempotent re-deploy) and torn down on delete.
// Keyed on deploymentId (stable across releases), never releaseId.
export type ProvisionedAuthRef = {
  mode: AuthMode;
  clientId?: string;
  providerPk?: number;
  applicationSlug?: string;
  outpostPk?: number;
  bindAccountPk?: number;
};

// ------------------------------------------------------
// Drafts (Install Wizard)
// ------------------------------------------------------
export type Draft = {
  draftId: string;
  appId: string;
  version?: string;
  systemOverrides: Record<string, string>;
  appEnv: AppEnvVar[];
  ports: Array<{ host?: number; container: number; protocol: 'tcp' | 'udp' }>;
  composeOverride?: string;
  // App auth capability seeded from the catalog bundle manifest (read-only; not
  // user-editable). Carried through finalize so the deploy lifecycle can provision.
  auth?: AppAuthConfig;
  files: Array<{ uploadId: string; name: string; size: number; kind: 'composeOverride' | 'additionalFile' | 'env' | 'secret' }>;
};

export type CreateDraftRequest = { appId: string; version?: string };
export type CreateDraftResponse = {
  draftId: string;
  app: { id: string; name: string; icon: string };
  systemEnv: AppEnvVar[];
  appEnv: AppEnvVar[];
  defaults: DraftDefaults;
};

export type GetDraftResponse = Draft;

export type PatchDraftRequest = Partial<Pick<Draft, 'systemOverrides' | 'appEnv' | 'ports' | 'composeOverride'>>;
export type PatchDraftResponse = { ok: true; draft: Draft };

export type UploadDraftFileResponse = { uploadId: string; name: string; size: number; kind: 'composeOverride' | 'additionalFile' | 'env' | 'secret' };
export type DeleteDraftFileResponse = { ok: true };

export type ValidateDraftResponse = {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

export type PreflightCheck = { name: string; status: 'pass' | 'warn' | 'fail'; detail?: string };
export type PreflightResponse = { ok: boolean; checks: PreflightCheck[] };

export type FinalizeDraftResponse = { spec: unknown; checksum: string };

// ------------------------------------------------------
// Deployments
// ------------------------------------------------------
export type DeploymentStatus = 'running' | 'stopped' | 'installing' | 'updating' | 'error';

export type DeploymentListItem = {
  id: string;
  name: string;
  app: string;
  icon: string;
  status: DeploymentStatus;
  uptime?: string;
  version?: string;
  resources?: { cpu: string; memory: string };
  ports: string[];
  lastUpdated: string;
  url?: string;
};

export type GetDeploymentsRequest = PageRequest & {
  status?: DeploymentStatus | 'all';
};
export type GetDeploymentsResponse = PageResponse<DeploymentListItem>;

export type DeploymentDetail = {
  id: string;
  name: string;
  app: string;
  icon: string;
  status: DeploymentStatus;
  uptime?: string;
  version?: string;
  url?: string;
  resources: { cpu: string; memory: string; disk?: string };
  ports: string[];
  lastUpdated: string;
};

export type GetDeploymentResponse = DeploymentDetail;

export type PatchDeploymentRequest = {
  env?: AppEnvVar[];
  systemOverrides?: Record<string, string>;
};
export type PatchDeploymentResponse = { ok: true };

export type DeploymentHistoryItem = {
  id: string;
  type: JobType;
  status: JobStatus;
  startedAt: string;
  finishedAt?: string;
};
export type GetDeploymentHistoryResponse = PageResponse<DeploymentHistoryItem>;

export type PostDeploymentActionRequest = { action: 'start' | 'stop' | 'restart' | 'delete' };
export type PostDeploymentActionResponse = { ok?: boolean; jobId?: string };

// ------------------------------------------------------
// Jobs
// ------------------------------------------------------
export type Job = {
  id: string;
  type: JobType;
  status: JobStatus;
  startedAt: string;
  finishedAt?: string;
  progress?: number;
  deploymentId?: string;
};

export type GetJobsRequest = PageRequest & {
  deploymentId?: string;
  status?: JobStatus;
};

export type GetJobsResponse = PageResponse<Job>;

export type GetJobResponse = Job;

// ------------------------------------------------------
// Logs (SSE or polling fallback)
// ------------------------------------------------------
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export type LogEntry = {
  timestamp: string; // ISO
  service: string;
  level: LogLevel;
  message: string;
};

// Polling fallback
export type GetLogsResponse = {
  items: LogEntry[];
  nextSince?: string;
};

// SSE Events for real-time logs
export type SSELogEvent = {
  type: 'log';
  data: LogEntry;
};

export type SSEJobUpdateEvent = {
  type: 'job_update';
  data: {
    jobId: string;
    status: JobStatus;
    progress?: number;
    finishedAt?: string;
  };
};

export type SSESystemUpdateEvent = {
  type: 'system_update';
  data: Partial<SystemStatus>;
};

export type SSEDeploymentUpdateEvent = {
  type: 'deployment_update';
  data: {
    deploymentId: string;
    status: DeploymentStatus;
    uptime?: string;
    lastUpdated: string;
  };
};

export type SSEEvent = SSELogEvent | SSEJobUpdateEvent | SSESystemUpdateEvent | SSEDeploymentUpdateEvent;

// Connection status for SSE
export type SSEConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

// ------------------------------------------------------
// Backups
// ------------------------------------------------------
export type BackupStatus = 'completed' | 'failed' | 'running';
export type BackupType = 'automatic' | 'manual';

export type BackupItem = {
  id: string;
  app: string;
  appId?: string;
  icon?: string;
  timestamp: string;
  sizeBytes: number;
  status: BackupStatus;
  type: BackupType;
};

export type GetBackupsRequest = PageRequest & { appId?: string; status?: BackupStatus };
export type GetBackupsResponse = PageResponse<BackupItem>;

export type CreateBackupRequest = { appId?: string };
export type CreateBackupResponse = { jobId: string; backupId?: string };

export type GetBackupResponse = BackupItem & {
  files?: Array<{ path: string; sizeBytes: number }>;
};

export type RestoreBackupRequest = { targetDeploymentId?: string };
export type RestoreBackupResponse = { jobId: string };

export type DeleteBackupResponse = { ok: true };

// ------------------------------------------------------
// Notifications
// ------------------------------------------------------
export type NotificationType = 'error' | 'success' | 'warning' | 'info' | 'update';
export type NotificationPriority = 'low' | 'medium' | 'high';

export type NotificationItem = {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  priority: NotificationPriority;
};

export type GetNotificationsRequest = PageRequest & {
  filter?: 'all' | 'unread' | `type:${NotificationType}`;
};
export type GetNotificationsResponse = PageResponse<NotificationItem> & { unreadCount: number };

export type PatchNotificationRequest = { read?: boolean; dismiss?: true };
export type PatchNotificationResponse = { id: string; read: boolean };

export type PostNotificationsActionRequest = { action: 'markAllRead' | 'dismissAll' };
export type PostNotificationsActionResponse = { ok: true };

// ------------------------------------------------------
// Settings
// ------------------------------------------------------
export type SystemEnvVar = AppEnvVar;

export type GetSettingsResponse = {
  systemEnv: SystemEnvVar[];
  docker?: { host?: string };
  tls?: { email?: string };
  notifications?: { smtpHost?: string; smtpUser?: string; smtpPassword?: string }; // password redacted in GET
};

export type PatchSettingsRequest = Partial<GetSettingsResponse>;
export type PatchSettingsResponse = GetSettingsResponse;

// Backup schedule
export type GetBackupSettingsResponse = {
  scheduleEnabled: boolean;
  scheduleTime: string; // "HH:mm"
  retentionDays: number;
};

export type PatchBackupSettingsRequest = Partial<GetBackupSettingsResponse>;
export type PatchBackupSettingsResponse = GetBackupSettingsResponse;

// ------------------------------------------------------
// System status
// ------------------------------------------------------
export type GetSystemStatusResponse = SystemStatus;

export type SystemHealthResponse = {
  healthStatus: Record<string, {
    healthy: boolean;
    lastCheck: string;
  }>;
  activatedServices: string[];
};

export type SystemConfigResponse = {
  phase: string;
  featureFlags: Record<string, boolean>;
  config: Record<string, unknown>;
  services: Record<string, boolean>;
};

export type HealthzResponse = {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime: number;
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
  };
};

// readyz returns a simple success response (200 OK with minimal/no body)
export type ReadyzResponse = Record<string, never>; // Empty object or simple success

export type MetricsResponse = {
  http_requests: Record<string, number>;
  service_activations: Record<string, number>;
  http_request_duration: Record<string, {
    count: number;
    sum: number;
    avg: number;
  }>;
  memory_usage: Record<string, number>;
};

// ------------------------------------------------------
// Documentation utilities
// ------------------------------------------------------
export * from './docs';

// ------------------------------------------------------
// Phase 7 core types - simplified for production use
// ------------------------------------------------------

// Validation report for internal use
export type ValidationSeverity = 'error' | 'warning';

/**
 * Stable, machine-readable codes emitted by Compose schema/semantic validation.
 * These are part of the API contract; clients may branch on them.
 */
export type ComposeIssueCode =
  | 'INVALID_YAML'
  | 'NO_SERVICES'
  | 'UNSUPPORTED_KEY'
  | 'INVALID_SERVICE'
  | 'INVALID_SERVICE_NAME'
  | 'IMAGE_AND_BUILD_CONFLICT'
  | 'MISSING_IMAGE_OR_BUILD'
  | 'INVALID_IMAGE_REF'
  | 'IMAGE_MISSING_TAG'
  | 'INVALID_ENV_FORM'
  | 'DUPLICATE_ENV_KEY'
  | 'UNDEFINED_VOLUME'
  | 'UNDEFINED_NETWORK'
  | 'UNDEFINED_SECRET'
  | 'HOST_PORT_NOT_ALLOWED';

/**
 * Codes emitted by the broader ValidationService (drafts, env, resources).
 * The trailing `(string & {})` keeps the type open for codes produced by
 * other validators while preserving autocompletion for the known set.
 */
export type ValidationIssueCode =
  | ComposeIssueCode
  | 'MISSING_APP_ID'
  | 'INVALID_PORT_RANGE'
  | 'INVALID_ENV_KEY'
  | 'MISSING_SECRET_VALUE'
  | 'LOW_MEMORY'
  | 'LOW_CPU'
  | 'VALIDATION_FAILED'
  | (string & {});

export type ValidationIssue = {
  /** Stable machine-readable code (e.g. 'HOST_PORT_NOT_ALLOWED'). */
  code: ValidationIssueCode;
  /** Whether this issue blocks (`error`) or is advisory (`warning`). */
  severity: ValidationSeverity;
  /** Human-readable description of the problem. */
  message: string;
  /** Precise dotted/bracketed path to the offending node, e.g. `services.web.ports[0]`. */
  path?: string;
  /** @deprecated Human-facing field label; prefer `path`. Retained for back-compat. */
  field?: string;
};
export type ValidationReport = {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  // Optional richer details when available
  ports?: Array<{ host?: number; container: number; protocol?: 'tcp' | 'udp' }>; 
  images?: Array<{ name: string; tag?: string; digest?: string; pullable?: boolean }>;
};



// ------------------------------------------------------
// Phase 7 Core Types - Deployment Lifecycle
// ------------------------------------------------------

// Release types
export type ReleaseStatus = 'creating' | 'ready' | 'failed' | 'deploying' | 'active' | 'stopped';

export type Release = {
  id: string;
  deploymentId: string;
  draftId: string;
  status: ReleaseStatus;
  createdAt: string;
  deployedAt?: string;
  failedAt?: string;
  images: Array<{ name: string; tag: string; digest?: string }>;
  ports: Array<{ host?: number; container: number; protocol: 'tcp' | 'udp'; purpose?: string }>;
  filesChecksums: Record<string, string>; // path -> sha256
  healthCheck?: {
    type: 'http' | 'tcp' | 'none';
    endpoint?: string;
    port?: number;
    timeoutMs?: number;
  };
  metadata?: Record<string, unknown>;
};

// Draft updates - extending the existing Draft type  
export type DraftFile = {
  uploadId: string;
  name: string;
  size: number;
  kind: 'composeOverride' | 'additionalFile' | 'env' | 'secret';
  path?: string; // target path in deployment
};

// Enhanced validation responses
export type PreflightCheckType = 'env' | 'docker' | 'disk' | 'ports' | 'images' | 'network' | 'permissions' | 'routing';
export type PreflightCheckStatus = 'pass' | 'warn' | 'fail';

export type EnhancedPreflightCheck = {
  name: string;
  type: PreflightCheckType;
  status: PreflightCheckStatus;
  detail?: string;
  code?: string;
  remediation?: string;
};

export type EnhancedPreflightResponse = {
  ok: boolean;
  checks: EnhancedPreflightCheck[];
  reservationToken?: string; // For port reservations
};

// Deployment lifecycle
export type DeploymentAction = 'start' | 'stop' | 'restart' | 'delete' | 'rollback';

export type DeploymentLifecycleState = 
  | 'draft' 
  | 'validated' 
  | 'finalized' 
  | 'releasing' 
  | 'active' 
  | 'stopped' 
  | 'failed' 
  | 'rolled_back';

// Enhanced deployment details
export type EnhancedDeploymentDetail = DeploymentDetail & {
  lifecycleState: DeploymentLifecycleState;
  currentReleaseId?: string;
  previousReleaseId?: string;
  draftId?: string;
  rollbackAvailable: boolean;
  metadata: {
    createdAt: string;
    owner?: string;
    tags?: string[];
    notes?: string;
    // Auth artifacts provisioned for this deployment (if any), so they can be
    // reused on re-deploy and torn down on delete. Keyed on deploymentId.
    // `middleware` is set for forward-auth apps so the route can be re-emitted
    // with the gate on restart without re-provisioning.
    // `ref` is the primary mode's artifact; `fallbackRef` is the extra forward-auth
    // provider when `auth.fallback: forward-auth` gates a native-oidc/none app too.
    auth?: { mode: AuthMode; ref: ProvisionedAuthRef; middleware?: ForwardAuthMiddleware; fallbackRef?: ProvisionedAuthRef };
  };
};

// Deployment creation request 
export type CreateDeploymentFromDraftRequest = {
  draftId: string;
  name?: string;
  options?: {
    autoStart?: boolean;
    healthCheckTimeoutMs?: number;
    rollbackOnFailure?: boolean;
  };
};

export type CreateDeploymentFromDraftResponse = {
  deploymentId: string;
  releaseId: string;
  jobId?: string; // If deployment started immediately
};

// Network and resource types
export type NetworkMode = 'bridge' | 'host' | 'traefik' | 'none';

export type DeploymentNetworkConfig = {
  mode: NetworkMode;
  networkName?: string; // For traefik mode
  traefikDomain?: string;
  traefikEntrypoints?: string[];
};

export type ResourceLimits = {
  cpuShares?: number;
  memoryBytes?: number;
  diskBytes?: number;
  pidsLimit?: number;
};

// Traefik routing configuration
// Forward-auth middleware attached to a route so Traefik gates the app behind the
// auth platform's outpost. `outpostUrl` is the platform's internal base URL
// (e.g. http://authentik-server:9000); the renderer derives the forwardAuth
// address, the auth-response headers, and the outpost path-prefix router from it.
export type ForwardAuthMiddleware = {
  name: string;
  outpostUrl: string;
};

export type TraefikRoutingRule = {
  deploymentId: string;
  appName: string;
  host: string; // e.g., "nextcloud.local.hola"
  domain: string; // e.g., "local.hola"
  serviceName: string;
  networkName: string;
  port?: number; // internal container/service port Traefik forwards to
  createdAt: string;
  // Present when the app is protected by forward-auth (auth mode `forward-auth`).
  forwardAuth?: ForwardAuthMiddleware;
};

export type RoutingConflict = {
  conflictingDeploymentId: string;
  conflictingAppName: string;
  conflictingHost: string;
  message: string;
};

export type TraefikRoutingMap = Record<string, TraefikRoutingRule>; // "host" -> routing rule

// Directory structure metadata
export type DeploymentDirectoryLayout = {
  deploymentPath: string;
  draftsPath: string;
  releasesPath: string;
  currentReleasePath?: string;
  logsPath: string;
  backupsPath?: string;
};

// Rollback operations
export type RollbackRequest = {
  targetReleaseId?: string; // If not specified, rolls back to previous
  reason?: string;
};

export type RollbackResponse = {
  jobId: string;
  targetReleaseId: string;
  previousReleaseId: string;
};