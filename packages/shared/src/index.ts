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

  // Registry credentials for private OCI pulls (GHCR PAT etc.). Instance-level,
  // admin-gated. Secrets are stored server-side and never returned to clients.
  registryCredentials: {
    base: '/api/registry-credentials',
    byId: (id: string) => `/api/registry-credentials/${id}`,
  },

  // Install a package directly by OCI reference (the escape hatch for one-offs,
  // and the shared primitive every catalog install builds on).
  installFromRef: '/api/install-from-ref',

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
    promote: (deploymentId: string) => `/api/deployments/${deploymentId}/promote`,
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

  // Global SSE event stream (#291): job_update + deployment_update transitions,
  // multiplexed so list views stay live from one connection.
  events: '/api/events',

  system: {
    status: '/api/system/status',
    health: '/api/system/health',
    updateCheck: '/api/system/update-check',
    healthz: '/healthz',
    readyz: '/readyz',
    metrics: '/metrics',
  },
} as const;

// ------------------------------------------------------
// Version comparison (shared by the server update-check and the CLI)
// ------------------------------------------------------

/**
 * Compare two semver-ish version strings (e.g. `0.6.23`, `0.6.23-rc.1`). Returns
 * a negative number if `a < b`, positive if `a > b`, and 0 if equal. Tolerant of
 * a leading `v`/`cli-v` and of differing segment counts; a release ranks above a
 * prerelease of the same numeric version (`1.2.0` > `1.2.0-rc.1`). Non-numeric
 * release segments fall back to a string compare so it never throws.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const cleaned = v.trim().replace(/^cli-v/, '').replace(/^v/, '');
    const [core, pre = ''] = cleaned.split('-', 2);
    const nums = core.split('.').map((n) => parseInt(n, 10) || 0);
    return { nums, pre };
  };
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (diff !== 0) return diff;
  }
  // Same numeric core: a release (no prerelease tag) outranks a prerelease.
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && !pb.pre) return -1;
  if (pa.pre === pb.pre) return 0;
  return pa.pre < pb.pre ? -1 : 1;
}

/** True when `candidate` is a strictly newer version than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

/**
 * Upgrade-safety metadata for a catalog app version (#284 Phase 0), declared in
 * the bundle manifest's `upgrade` block. Lets the server enforce a safe upgrade
 * path on `promote` and lets the dashboard warn before a breaking upgrade. Our
 * semver describes impact on the Hola user, so a breaking/migrating release
 * carries `breaking: true` plus any version-skip guard rails.
 */
export type AppUpgradeMeta = {
  /** This release migrates/breaks — the UI should force an explicit acknowledgement before promoting. */
  breaking?: boolean;
  /** Floor: a deployment must already be at/above this version to promote to this one (H2). */
  minFromVersion?: string;
  /** Versions a deployment MUST be promoted through one-at-a-time to reach this one (H2). */
  waypoints?: string[];
  /** Link to upgrade notes, shown in the promote dialog. */
  upgradeNotesUrl?: string;
  /** Whether a pre-upgrade backup is required/recommended before promoting (H7). */
  preUpgradeBackup?: 'required' | 'recommended' | 'none';
};

/**
 * A backup hook command run inside one of the app's own compose services (#121).
 * `command` is exec-form (argv), run via `docker compose exec <service> …`.
 */
export type AppBackupHook = {
  service: string;
  command: string[];
};

/**
 * Per-app pre/post-backup hooks (#121), declared in the bundle manifest's
 * `backup` block. A file-level snapshot of a running DB-backed app is only
 * crash-consistent; the `preHook` quiesces/dumps (e.g. `pg_dump` into a path the
 * snapshot captures) before the file capture, and the `postHook` cleans up after.
 * The Hola server runs them around the snapshot (it owns the deploy lifecycle and
 * the post-deploy command mechanism — ADR 0002). Shared by the pre-upgrade
 * snapshot (#284) and, later, scheduled Backrest backups.
 */
export type AppBackupConfig = {
  preHook?: AppBackupHook;
  postHook?: AppBackupHook;
};

/** Result of {@link checkUpgradePath}: ok, or a rejection with an actionable next step. */
export type UpgradePathResult =
  | { ok: true }
  | {
      ok: false;
      code: 'min-from-version' | 'waypoint-required';
      message: string;
      /** The version the caller should promote to first, before retrying the target. */
      suggestedVersion: string;
    };

/**
 * Validate a catalog-app upgrade against the target version's upgrade metadata
 * (#284 Phase 0). Rejects an illegal jump — below the `minFromVersion` floor, or
 * skipping past a required `waypoint` — with an actionable next version.
 *
 * Only enforced for an actual forward upgrade (`toVersion` newer than
 * `fromVersion`) with both versions and metadata known. Same-version re-promotes,
 * downgrades/rollbacks, and unknown versions pass through — those paths are the
 * caller's concern, not a skip-guard's.
 */
export function checkUpgradePath(
  fromVersion: string | undefined,
  toVersion: string | undefined,
  meta?: AppUpgradeMeta,
): UpgradePathResult {
  if (!meta || !fromVersion || !toVersion) return { ok: true };
  if (!isNewerVersion(toVersion, fromVersion)) return { ok: true };

  // Floor (H2): the deployment must already be at/above minFromVersion.
  if (meta.minFromVersion && isNewerVersion(meta.minFromVersion, fromVersion)) {
    return {
      ok: false,
      code: 'min-from-version',
      message:
        `This version requires upgrading from at least ${meta.minFromVersion}, but the deployment ` +
        `is on ${fromVersion}. Upgrade to ${meta.minFromVersion} first, then continue.`,
      suggestedVersion: meta.minFromVersion,
    };
  }

  // Waypoints (H2): can't skip past one. The next required stop is the lowest
  // waypoint strictly between the current and target versions.
  const next = (meta.waypoints ?? [])
    .filter((w) => isNewerVersion(w, fromVersion) && isNewerVersion(toVersion, w))
    .sort(compareVersions)[0];
  if (next) {
    return {
      ok: false,
      code: 'waypoint-required',
      message:
        `Upgrading ${fromVersion} → ${toVersion} must pass through ${next} first. ` +
        `Promote to ${next}, let it settle, then continue.`,
      suggestedVersion: next,
    };
  }

  return { ok: true };
}

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
// `me` returns the current principal. `config` is an UNAUTHENTICATED endpoint the
// web dashboard reads at boot to learn how to log in (OIDC vs admin-key). `login`/
// `logout` back the admin-key session fallback (sets/clears an HttpOnly cookie);
// the OIDC path exchanges codes in the browser and sends a Bearer JWT instead.
export const AUTH_API = {
  me: '/api/auth/me',
  config: '/api/auth/config',
  login: '/api/auth/login',
  logout: '/api/auth/logout',
} as const;

export type GetAuthMeResponse = Principal;

/**
 * GET /api/auth/config — tells the dashboard how to authenticate. Served without
 * auth so the SPA can fetch it before it has a credential.
 *  - `mode: 'none'`   — auth disabled (HOLA_USE_AUTH=false); the SPA loads directly.
 *  - `mode: 'oidc'`   — run the Authorization Code + PKCE flow against `oidc`.
 *  - `mode: 'apikey'` — auth on but no OIDC; the SPA shows an admin-key login.
 */
export type AuthConfigResponse = {
  authRequired: boolean;
  mode: 'none' | 'oidc' | 'apikey';
  oidc?: {
    issuer: string;
    clientId: string;
    redirectUri: string;
    audience: string;
    scopes: string[];
  };
};

// POST /api/auth/login — admin-key session fallback.
export type AuthLoginRequest = { key: string };
export type AuthLoginResponse = { ok: true; principal: Principal };

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
  // Restrict the listing to a single catalog source id (Slice 2). Omitted =>
  // merge across all enabled sources. The built-in public catalog is `hola`.
  source?: string;
};

// ------------------------------------------------------
// Registry credentials (private OCI pulls)
// ------------------------------------------------------

/**
 * A stored registry credential, as returned to clients. The password/token is
 * NEVER serialized — only the metadata needed to pick a credential is exposed.
 * `registry` is the host (optionally host/path) the credential authorizes, e.g.
 * `ghcr.io` or `ghcr.io/acme`.
 */
export type RegistryCredentialRecord = {
  id: string;
  registry: string;
  username: string;
};

export type AddRegistryCredentialRequest = {
  registry: string;
  username: string;
  /** The secret token (e.g. a GHCR PAT with read:packages). Write-only. */
  password: string;
  /** Optional stable id; the server generates one when omitted. */
  id?: string;
};

export type ListRegistryCredentialsResponse = {
  items: RegistryCredentialRecord[];
};

/**
 * Install a package straight from an OCI reference (e.g.
 * `ghcr.io/acme/hola-cms:0.1.0`), bypassing the catalog index. `credentialRef`
 * names a stored RegistryCredentialRecord used for both the `oras pull` and the
 * runtime image pull when the ref points at a private registry.
 */
export type InstallFromRefRequest = {
  ociRef: string;
  credentialRef?: string;
  name?: string;
  version?: string;
};

export type InstallFromRefResponse = {
  draftId: string;
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
  // The concrete catalog version this detail resolves to. When the caller asks
  // for "latest" (the CLI/web default), the server resolves it to the newest
  // pinned release (e.g. "1.4.1") and reports it here so a draft/deployment can
  // persist a real version rather than an unknown one — which is what drives the
  // installed-version display and per-app update detection.
  version: string;
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
  // Cross-app capabilities the app consumes, declared in its bundle manifest
  // (e.g. `app-registry`). The server writes the corresponding feed into the
  // app's data root on app-set change; rendering is a bundle bolt-on (ADR 0002).
  consumes?: string[];
  // The compose service Traefik should route to and that receives injected auth
  // env, for multi-service apps whose web/ingress service isn't named after the
  // app id (the default heuristic). Sourced from the bundle manifest's
  // `ingress.service`.
  ingressService?: string;
  // Upgrade-safety metadata declared in the bundle manifest's `upgrade` block
  // (#284 Phase 0). Drives the server-side skip-guard on `promote` and the
  // dashboard's pre-upgrade warning. Optional: apps that don't declare it have
  // no upgrade restrictions.
  upgrade?: AppUpgradeMeta;
  // Per-app pre/post-backup hooks (#121) for transaction-consistent snapshots
  // (e.g. pg_dump before a file-level capture). Optional: most apps (and SQLite)
  // are fine with crash-consistent file snapshots and omit it.
  backup?: AppBackupConfig;
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
    //
    // `authUrl`/`tokenUrl`/`userinfoUrl` are for apps that DON'T do OIDC
    // discovery from the issuer and need the IdP's explicit endpoints (e.g.
    // Postiz's POSTIZ_OAUTH_AUTH_URL/TOKEN_URL/USERINFO_URL). Hola fills them
    // from the provider's well-known Authentik endpoints.
    env?: {
      issuer: string;
      clientId: string;
      clientSecret: string;
      redirectUri?: string;
      authUrl?: string;
      tokenUrl?: string;
      userinfoUrl?: string;
    };
    // Literal env to set ONLY when this app's OIDC is actually provisioned —
    // e.g. an enable flag and the SSO button label (POSTIZ_GENERIC_OAUTH=true,
    // NEXT_PUBLIC_POSTIZ_OAUTH_DISPLAY_NAME=Authentik). Kept out of the app's
    // always-on defaultEnv so a non-SSO install doesn't show a dead SSO button.
    staticEnv?: Record<string, string>;
    setup?: OidcSetupCommand;
    // Extra redirect URIs to register on the OIDC client, beyond the one derived
    // from `redirectPath`. Each entry may contain the `${HOLA_APP_HOST}` token
    // (expanded to the app's public host) OR a non-http scheme. For apps whose
    // OIDC client needs several callbacks across web + mobile — e.g. Immich uses
    // `/auth/login`, `/user-settings`, and the mobile `app.immich:///oauth-callback`.
    extraRedirectUris?: string[];
    // For apps that ingest OIDC ONLY from a config FILE written before first boot
    // (e.g. Immich: the admin UI is locked when a config file is present, there
    // are no OIDC env vars, and `${ENV}` is not expanded inside the file). When set,
    // the server writes the provisioned OIDC values as a GENERIC JSON creds file —
    // `{ issuer, clientId, clientSecret, redirectUri }` — to `path` (relative to the
    // app's `${HOLA_APP_DATA}` root) before the stack starts. Rendering those creds
    // into the app's own config format is the BUNDLE's job: a sidecar/init container
    // (see Homepage's registry renderer + ADR 0002) reads this file and writes the
    // app config, so the server stays out of per-app config formats.
    credentialsFile?: { path: string };
    // Admin-by-group for apps that derive their role from a SCALAR OIDC claim
    // (e.g. Immich's `immich_role` = "admin"/"user"), rather than reading the raw
    // `groups` list like Gitea. The provisioner creates an Authentik scope mapping
    // that emits `claim` = `adminValue` for members of `adminGroup` (default the
    // platform admin group), else `memberValue`, and rides it on the `scope` the
    // client already requests (default `profile`). Lets the first SSO login land a
    // member of the admin group as an app admin with no manual promotion.
    roleClaim?: {
      claim: string;
      adminGroup?: string;
      adminValue?: string;
      memberValue?: string;
      scope?: string;
    };
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
  // Catalog source id this draft's app came from (defaults to `hola`). Carried
  // through finalize so the deployment record knows which source to check for
  // updates and, with `credentialRef`, how to authenticate the runtime image pull.
  source?: string;
  // Stored registry credential id used to pull this app's bundle + runtime image
  // from a private registry. Seeded from the install request; carried through
  // finalize (read-only; not user-editable). Never contains the secret itself.
  credentialRef?: string;
  // App icon (emoji or image URL) and product display name seeded from the
  // catalog and carried through finalize, so the deployment can persist both
  // without a live catalog lookup at render time.
  icon?: string;
  displayName?: string;
  systemOverrides: Record<string, string>;
  appEnv: AppEnvVar[];
  ports: Array<{ host?: number; container: number; protocol: 'tcp' | 'udp' }>;
  composeOverride?: string;
  // App auth capability seeded from the catalog bundle manifest (read-only; not
  // user-editable). Carried through finalize so the deploy lifecycle can provision.
  auth?: AppAuthConfig;
  // Cross-app capabilities consumed (e.g. `app-registry`), seeded from the bundle
  // manifest and carried through finalize (ADR 0002).
  consumes?: string[];
  // The compose service to route to / inject auth env into, for multi-service
  // apps whose ingress service isn't named after the app id. Seeded from the
  // bundle manifest and carried through finalize (read-only; not user-editable).
  ingressService?: string;
  // Upgrade-safety metadata seeded from the bundle manifest (#284 Phase 0) and
  // carried through finalize so `promote` can enforce the skip-guard against the
  // target version (read-only; not user-editable).
  upgrade?: AppUpgradeMeta;
  // Per-app pre/post-backup hooks (#121) seeded from the bundle manifest and
  // carried through finalize so the snapshot path can quiesce/dump around the
  // file capture (read-only; not user-editable).
  backup?: AppBackupConfig;
  files: Array<{ uploadId: string; name: string; size: number; kind: 'composeOverride' | 'additionalFile' | 'env' | 'secret' }>;
};

export type CreateDraftRequest = {
  // Catalog install path: the app id (bare, e.g. `uptime-kuma`). Optional only
  // because the install-by-ref path supplies `ociRef` instead.
  appId?: string;
  version?: string;
  // Catalog source id the app comes from (Slice 2). Defaults to `hola` (the
  // built-in public catalog) so existing bare-appId callers are unaffected.
  source?: string;
  // Install-by-ref path (Slice 1): a full OCI package reference. When present,
  // the draft is seeded directly from the pulled bundle rather than the index.
  ociRef?: string;
  // Stored registry credential id used to pull `ociRef` / the source's packages.
  credentialRef?: string;
};
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
  // Newest catalog version for this app, and whether it's newer than the
  // installed `version` (per-app update notifications, #284). Derived server-side
  // from the catalog; absent when the catalog is unavailable.
  latestVersion?: string;
  updateAvailable?: boolean;
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
  // Newest catalog version + whether an update is available (per-app update
  // notifications, #284). Derived server-side; absent when the catalog is
  // unavailable.
  latestVersion?: string;
  updateAvailable?: boolean;
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
  // The owning deployment's display name + app id, joined server-side when jobs
  // are listed so the UI can label a job by what it's acting on (not just its
  // type). Absent for jobs with no/deleted deployment.
  deploymentName?: string;
  app?: string;
};

export type GetJobsRequest = PageRequest & {
  deploymentId?: string;
  status?: JobStatus;
};

export type GetJobsResponse = PageResponse<Job>;

export type GetJobResponse = Job;

// Bulk-clear finished jobs (DELETE /api/jobs). Only terminal jobs (completed,
// failed, cancelled) are ever removed — running/queued jobs are never touched.
// `deploymentId` scopes the clear to one deployment's jobs; `status` narrows it
// to a specific terminal status (default: all terminal jobs).
export type DeleteJobsRequest = {
  deploymentId?: string;
  status?: JobStatus;
};

export type DeleteJobsResponse = { cleared: number };

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

/**
 * Result of the update-available check shared by the web dashboard and the CLI.
 * The server computes this from its own pinned version vs. the newest published
 * `cli-v*` release, caching the outbound GitHub call so many clients share one
 * lookup. `latest`/`releaseUrl` are null when the check could not be performed
 * (offline, rate-limited) — in that case `updateAvailable` is false (fail-safe).
 */
export type UpdateCheckResult = {
  /** The version this server is running (its pinned image tag). */
  current: string;
  /** The newest published release version, or null if the check failed. */
  latest: string | null;
  /** True only when `latest` is a strictly newer version than `current`. */
  updateAvailable: boolean;
  /** Link to the latest release's notes, or null if unknown. */
  releaseUrl: string | null;
};

export type GetUpdateCheckResponse = UpdateCheckResult;

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
  | 'IMAGE_MUTABLE_TAG'
  | 'INVALID_ENV_FORM'
  | 'DUPLICATE_ENV_KEY'
  | 'UNDEFINED_VOLUME'
  | 'UNDEFINED_NETWORK'
  | 'UNDEFINED_SECRET'
  | 'HOST_PORT_NOT_ALLOWED'
  | 'HOST_NETWORK_MODE_NOT_ALLOWED'
  | 'NAMED_VOLUME_NOT_ALLOWED'
  | 'VOLUME_NOT_UNDER_APP_DATA'
  | 'UNKNOWN_PLATFORM_TOKEN';

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
    // The dashboard user who created this deployment, captured from the
    // authenticated principal at create time (the async deploy job has no request
    // context). `email` seeds the `${HOLA_USER_EMAIL}` compose token. Only present
    // for OIDC-authenticated dashboard users; absent for admin-key / CLI installs.
    installedBy?: { email?: string; name?: string };
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
  // The installing user, filled in by the server from the authenticated principal
  // (not sent by clients). Persisted on the deployment so `${HOLA_USER_EMAIL}` can
  // resolve in the async deploy job, which runs without a request context.
  installedBy?: { email?: string; name?: string };
};

export type CreateDeploymentFromDraftResponse = {
  deploymentId: string;
  releaseId: string;
  jobId?: string; // If deployment started immediately
};

/**
 * Promote (upgrade) an existing deployment to a newer catalog version (#284
 * Phase 2). The server resolves the target, builds a draft from the catalog
 * bundle, carries the deployment's current env/secrets forward, finalizes it,
 * and runs the upgrade skip-guard + pre-upgrade snapshot before switching the
 * active release. Response is the standard create-from-draft result.
 */
export type PromoteDeploymentRequest = {
  /** Target catalog version. Defaults to the deployment's latest available version. */
  version?: string;
  /**
   * Force a pre-upgrade app-data snapshot even when the target doesn't declare
   * `upgrade.preUpgradeBackup: "required"` (which always snapshots).
   */
  snapshot?: boolean;
};

export type PromoteDeploymentResponse = CreateDeploymentFromDraftResponse;

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
  /**
   * Data-aware rollback (#284 Phase 1): also restore the pre-upgrade app-data
   * snapshot taken when the target release was last active, reverting data + image
   * together (TrueNAS-style). Off by default (compose/image-only rollback). No
   * snapshot for the target ⇒ a warning + a containers-only rollback.
   */
  restoreData?: boolean;
};

export type RollbackResponse = {
  jobId: string;
  targetReleaseId: string;
  previousReleaseId: string;
};