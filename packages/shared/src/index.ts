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

  // Managed list of catalog sources (Homebrew-tap model). Instance-level,
  // admin-gated. The built-in public catalog is the seeded `hola` source.
  catalogSources: {
    base: '/api/catalog-sources',
    byId: (id: string) => `/api/catalog-sources/${id}`,
    // Probe a catalog.json before adding it: reports the registries its apps
    // actually publish from, so the operator grants consent from real data
    // rather than guessing a glob. Reserved id — `byId('preview')` can't collide
    // because preview is POST-only and matched first.
    preview: '/api/catalog-sources/preview',
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
    // Check whether a candidate subdomain is free (#246). GET with `?subdomain=` (a
    // raw label or a name to slugify); powers the install wizard's live availability
    // indicator. Returns GetSubdomainAvailabilityResponse.
    subdomainAvailable: '/api/deployments/subdomain-available',
    byId: (deploymentId: string) => `/api/deployments/${deploymentId}`,
    history: (deploymentId: string) => `/api/deployments/${deploymentId}/history`,
    logs: (deploymentId: string) => `/api/deployments/${deploymentId}/logs`,
    logsStream: (deploymentId: string) => `/api/deployments/${deploymentId}/logs/stream`,
    actions: (deploymentId: string) => `/api/deployments/${deploymentId}/actions`,
    rollback: (deploymentId: string) => `/api/deployments/${deploymentId}/rollback`,
    promote: (deploymentId: string) => `/api/deployments/${deploymentId}/promote`,
    // Active release's full config (typed appEnv rows + system overrides), for the
    // DeploymentDetail Configuration tab.
    config: (deploymentId: string) => `/api/deployments/${deploymentId}/config`,
    // On-demand richer update check for one deployment (#299): pulls the target
    // bundle to answer safe-bump vs. guided-upgrade. Returns
    // GetDeploymentUpdateCheckResponse. The list keeps the cheap #284 badge.
    updateCheck: (deploymentId: string) => `/api/deployments/${deploymentId}/update-check`,
    // Manifest-declared push targets for this deployment (#409), each resolved to
    // an absolute, containment-checked host path the CLI can rsync into. Returns
    // GetDeploymentPushTargetsResponse.
    pushTargets: (deploymentId: string) => `/api/deployments/${deploymentId}/push-targets`,
    // Run a push target's manifest-declared postHook after the bytes have landed
    // (#409). Returns PostDeploymentPushHookResponse.
    pushHook: (deploymentId: string) => `/api/deployments/${deploymentId}/push-hooks`,
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

/**
 * How a push overwrites the target directory (#409). `mirror` is rsync
 * `--delete` — the local tree becomes the server tree, so files only on the
 * server are removed. `additive` (the default) copies in without deleting.
 * Declared per target rather than as a CLI flag: mirror semantics are a property
 * of what the directory *is*, and a stray `--delete` against an additive target
 * would silently destroy data.
 */
export type AppPushMode = 'mirror' | 'additive';

/**
 * Whether the app is stopped for the duration of a push (#409). `stop` for apps
 * that hold open handles on the data being replaced (Calibre-Web and
 * `metadata.db`); `none` (the default) leaves it running.
 */
export type AppPushQuiesce = 'stop' | 'none';

/**
 * A directory an app declares as pushable in its bundle manifest's `push` block
 * (#409), so `hola app data push` can bulk-load data (an ebook library, a media
 * tree, a document archive) that's too big or too structured for the app's own
 * web upload.
 *
 * `path` is **relative to the app's data root** — never a container path and
 * never absolute. The server resolves it against `<HOLA_APPS_BIND_ROOT>/<id>/`
 * and verifies containment before handing it out, so a manifest can't declare
 * its way into another app's data (see `resolveContainedDir`).
 */
export type AppPushTarget = {
  /** Stable identifier the CLI takes as an argument. */
  id: string;
  /** Human-friendly name shown by `--list`. */
  label: string;
  /** Help text — what the operator should point at it. */
  description?: string;
  /** Directory relative to the app's data root. */
  path: string;
  /** Defaults to `additive`. */
  mode?: AppPushMode;
  /** Defaults to `none`. */
  quiesce?: AppPushQuiesce;
  /**
   * Run inside one of the app's own compose services after the bytes land — for
   * apps that want a reindex/reconnect instead of a `quiesce: stop` bounce. Same
   * exec-form shape as a backup hook.
   */
  postHook?: AppBackupHook;
};

/**
 * An optional Docker Compose profile an app declares in its bundle manifest
 * (#162). A profiled compose service (`profiles: [<key>]`) is NOT started unless
 * its profile is active, so this is how an app offers an *optional* heavy
 * dependency (e.g. Postiz's Elasticsearch visibility store) that the operator can
 * turn on at install time. `key` is the compose profile name (the activation
 * token); `label`/`description` drive the wizard checkbox; `default` pre-selects
 * it when the caller doesn't specify a set.
 */
export type AppProfileConfig = {
  key: string;
  label: string;
  description?: string;
  default?: boolean;
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
export type CatalogSourceTrust = 'verified' | 'custom';

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
  // Which catalog source this app comes from (defaults to `hola`, the built-in
  // public catalog) and its trust level, so the UI can badge custom sources.
  source: string;
  trust: CatalogSourceTrust;
  // Newest available version (resolved the same way "latest" resolves at
  // install time), so the browse listing can show it without a drill-down
  // request. Omitted if the source has no versions at all.
  version?: string;
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

// ------------------------------------------------------
// Catalog sources (managed list of catalog.json indexes)
// ------------------------------------------------------

/**
 * A registered catalog source. `type: 'index-url'` points at a catalog.json (the
 * SAME schema as the public catalog, hosted elsewhere). `auth` names a stored
 * registry credential used to pull the source's private packages. `trust` badges
 * the source in the UI; the built-in `hola` source is `verified`, user-added
 * sources are `custom`.
 */
export type CatalogSourceRecord = {
  id: string;
  name: string;
  type: 'index-url';
  url: string;
  auth?: { registry: string; credentialRef: string };
  /**
   * Registry glob patterns this source's bundles are permitted to pull from
   * (e.g. `ghcr.io/pofallon/*`). Adds to the server's baseline
   * `HOLA_REGISTRY_ALLOWLIST` for any pull sourced from this catalog — the
   * operator's explicit consent to trust a first-party registry without
   * registering a credential (which is only needed for *private* packages).
   * Default empty: behaviour matches the pre-existing baseline allowlist only.
   */
  allowRegistries?: string[];
  trust: CatalogSourceTrust;
  enabled: boolean;
};

export type AddCatalogSourceRequest = {
  id: string;
  name: string;
  url: string;
  auth?: { registry: string; credentialRef: string };
  /** Optional registry globs (e.g. `ghcr.io/pofallon/*`) — see CatalogSourceRecord. */
  allowRegistries?: string[];
  enabled?: boolean;
};

/**
 * Patch an existing custom catalog source. Every field is optional; only the
 * ones supplied change. `id`, `type` and `trust` are not patchable — the id is
 * the key, and the other two are derived.
 *
 * Chiefly exists so `allowRegistries` can be added to a source after the fact
 * (the usual fix for a `REF_NOT_ALLOWED` pull) without deleting and re-adding it.
 * Pass `allowRegistries: []` to clear it.
 */
export type UpdateCatalogSourceRequest = {
  name?: string;
  url?: string;
  auth?: { registry: string; credentialRef: string } | null;
  allowRegistries?: string[];
  enabled?: boolean;
};

/**
 * `details` on a `REF_NOT_ALLOWED` (403) error. The pull was blocked because the
 * bundle's registry isn't covered by the effective allowlist.
 *
 * Carried as structured data so a client can OFFER the fix — PATCH
 * `suggestedGlob` into the owning source's `allowRegistries` — instead of asking
 * the operator to re-read the prose message and retype it. Clients must read
 * these fields rather than regex the message, which is free to change.
 */
export type RefNotAllowedDetails = {
  /** The blocked OCI reference, e.g. `ghcr.io/acme/hola-cms:0.1.13`. */
  ref: string;
  /**
   * The narrowest glob that would permit `ref` — the registry host plus the
   * publishing namespace (e.g. `ghcr.io/acme/*`). Valid input for a source's
   * `allowRegistries` or the `HOLA_REGISTRY_ALLOWLIST` baseline.
   */
  suggestedGlob: string;
  /** The effective allowlist that rejected the ref (baseline + any consents). */
  allowed: string[];
};

/**
 * Narrowest allowlist glob covering an OCI ref: the host plus the publishing
 * namespace, so allowing one app doesn't silently allow an unrelated org on the
 * same registry. `ghcr.io/acme/hola-cms:0.1.13` → `ghcr.io/acme/*`; a
 * namespace-less ref (`registry.example.com/app:1`) → `registry.example.com/*`.
 *
 * Output is deliberately restricted to the `host/…/*` shape the server's glob
 * validator accepts, so a suggestion is always directly submittable.
 */
export function suggestRegistryGlob(ociRef: string): string {
  // Drop any digest/tag before splitting: a tag can't contain `/`, but a digest
  // (`@sha256:…`) must not be mistaken for a path segment.
  const withoutDigest = ociRef.split('@')[0];
  const segments = withoutDigest.split('/').filter(Boolean);
  const host = segments[0] ?? '';
  // host + namespace when the ref has one (host/ns/name), else just the host.
  const namespace = segments.length >= 3 ? segments[1] : undefined;
  return namespace ? `${host}/${namespace}/*` : `${host}/*`;
}

/**
 * Probe a catalog.json before adding it as a source. Read-only: nothing is
 * stored, so this is safe to call on every keystroke-settled URL.
 */
export type PreviewCatalogSourceRequest = {
  url: string;
};

/** One registry namespace a previewed catalog's apps publish bundles from. */
export type CatalogSourcePreviewRegistry = {
  /** The glob that would permit it — see `suggestRegistryGlob`. */
  glob: string;
  /** How many of the catalog's apps publish under it (for "12 apps" context). */
  appCount: number;
  /**
   * True when the server's baseline `HOLA_REGISTRY_ALLOWLIST` already covers it,
   * so no per-source consent is needed. The UI shows these as already-allowed
   * rather than asking for a grant that would be a no-op.
   */
  covered: boolean;
};

/**
 * What a catalog.json turned out to contain. Doubles as URL validation: a
 * catalog that can't be fetched or parsed fails the request outright rather than
 * being discovered later as a silently empty source.
 */
export type PreviewCatalogSourceResponse = {
  /** Apps listed in the catalog. */
  appCount: number;
  /** Distinct publishing registries, most-used first. */
  registries: CatalogSourcePreviewRegistry[];
  /**
   * Apps whose versions carry no OCI ref at all. They can't be installed from a
   * bundle, so no registry consent would help them — surfaced so a catalog that
   * previews as "0 registries" isn't mistaken for a broken probe.
   */
  appsWithoutRefs: number;
};

export type ListCatalogSourcesResponse = {
  items: CatalogSourceRecord[];
};

/**
 * Result of re-pulling every enabled catalog source. `sources` reports each
 * source's outcome individually so one bad source (unreachable URL, bad JSON)
 * doesn't silently mask the others succeeding.
 */
export type RefreshCatalogResponse = {
  success: boolean;
  timestamp: string;
  sources: Array<{ id: string; name: string; ok: boolean; error?: string }>;
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

/**
 * Data type a catalog manifest can declare for an env var, driving both
 * typed input rendering (install wizard) and validation (`param-validate.ts`).
 * Absent `type` behaves as `'string'` with no extra constraints. Adding a new
 * value here is additive: an older server/web build that doesn't recognize it
 * degrades to untyped (free-text) rather than failing — see ADR 0003.
 */
export type ParamType = 'string' | 'integer' | 'port' | 'boolean' | 'enum' | 'url' | 'email' | 'timezone';

/**
 * Recipe for the install wizard's "generate" wand and non-interactive CLI
 * installs to mint a secret value. Only meaningful when `AppEnvVar.isSecret`
 * is true (`validateParamSpec` flags it otherwise).
 */
export type ParamGenerate = {
  kind: 'hex' | 'base64' | 'fernet';
  /** Byte length fed to the generator (not output string length). Default 32. */
  length?: number;
};

/** One selectable choice for a `type: 'enum'` param. */
export type ParamEnumOption = {
  value: string;
  label?: string;
  description?: string;
};

export type AppEnvVar = {
  key: string;
  value: string;
  isSecret: boolean;
  description?: string;
  /** Human-facing label; falls back to `key` when absent. */
  label?: string;
  /** Data type for input rendering + validation. Default `'string'`. */
  type?: ParamType;
  /**
   * Whether an empty value is an error. Tri-state — this is back-compat
   * critical, do not collapse it to a boolean:
   * - `true`  → empty value is an error, even if `isSecret` is false.
   * - `false` → empty value is OK, **even for secrets**. This is the escape
   *             hatch for optional secrets (e.g. an app whose admin password
   *             is auto-generated by the upstream image when left blank) —
   *             fixes the historical bug where *any* empty secret was forced
   *             required regardless of manifest intent.
   * - `undefined` → legacy rule: `isSecret` implies required, everything else
   *             is optional. Preserves the behavior of every manifest written
   *             before this field existed, so this whole extension is additive.
   */
  required?: boolean;
  /** Hide behind a collapsed "Advanced" section in the install wizard. */
  advanced?: boolean;
  /**
   * True for a row discovered by scanning the bundle's compose.yaml
   * `environment:` blocks rather than declared in the manifest's `defaultEnv`
   * — internal/hardcoded config the packager never curated a label or type
   * for (DB passwords shared between two containers, fixed ports, etc). The
   * UI treats these like `advanced: true` (collapsed by default) since they
   * lack packager-provided labels; never set on a manifest-declared row.
   */
  autoDetected?: boolean;
  placeholder?: string;
  // --- string ---
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  // --- integer / port ---
  // (port implies a 1-65535 bound; if set, min/max may only narrow that
  // range, never widen it — see `validateParamValue`)
  min?: number;
  max?: number;
  // --- enum ---
  options?: ParamEnumOption[];
  // --- boolean ---
  // The literal string values stored in .env; default 'true'/'false'.
  trueValue?: string;
  falseValue?: string;
  // --- url ---
  httpsOnly?: boolean;
  // --- secret generation ---
  /** Generation recipe for the wand/CLI auto-fill. Only meaningful when `isSecret` is true. */
  generate?: ParamGenerate;
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
  // Whether the app may be installed more than once, declared in its bundle
  // manifest (#246). Absent/false ⇒ singleton (the default): the server rejects a
  // second install unless the operator opts in per-install. `true` (e.g. a browser
  // desktop) lets a user run N independent instances at distinct subdomains.
  multiInstance?: boolean;
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
  // Directories the app declares as pushable (#409), each a data-root-relative
  // path `hola app data push` can bulk-load into. Optional: most apps take their
  // data through their own UI and omit it.
  push?: AppPushTarget[];
  // Elevated container permissions the app requests (e.g. a browser desktop that
  // needs `sudo`). Each entry is surfaced for explicit operator consent in the
  // install wizard and relaxes the corresponding platform hardening at deploy
  // time. Optional: apps that don't declare it run fully hardened.
  security?: AppSecurityConfig;
  // Optional Compose profiles the app declares (#162), each gating an optional
  // service (e.g. an opt-in heavy dependency). The install wizard renders one
  // checkbox per profile; the enabled set is threaded into the compose lifecycle
  // as `COMPOSE_PROFILES`. Absent when the app has no optional services.
  profiles?: AppProfileConfig[];
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
  // For `forward-auth`: optional access restriction by group, and optional URL
  // path prefixes to EXEMPT from the forward-auth gate.
  //
  // `bypassPaths` lets a non-browser client (a CLI, a webhook) reach a specific
  // app API path that the app protects with its OWN credential, without being
  // bounced to the interactive Authentik login. Each prefix routes straight to
  // the app with NO forward-auth middleware, so the app MUST enforce its own auth
  // there (e.g. remo's `/api/v1/setup/` requires REMO_WEB_API_TOKEN). The prefix
  // is publicly reachable — declare it narrowly. Must start with `/` and never be
  // `/` (you cannot exempt the whole app). See the `connect` block, which surfaces
  // the code/key an operator uses against such a path.
  forwardAuth?: { allowedGroups?: string[]; bypassPaths?: string[] };
  // Optionally gate a `native-oidc`/no-auth app behind proxy login too.
  fallback?: 'forward-auth';
};

// Elevated container permissions an app may request in its bundle manifest.
// These relax the platform's default container hardening for a specific,
// declared reason, so the install wizard can surface each one for explicit
// operator consent before install. Kept as a discriminated list (not a single
// boolean) so each grant is named, individually explained, and individually
// acknowledged — and so it can grow (e.g. Linux capabilities) without redesign.
//
// - `allow-privilege-escalation`: drop the `no-new-privileges:true` hardening on
//   the app's ingress service so setuid escalation (i.e. `sudo`) works inside the
//   container. Needed by browser-desktop apps (e.g. webtop) whose whole purpose is
//   an interactive shell with admin access. This is the ONLY type today; the
//   underlying `no_new_privs` flag is a single kernel boolean and is not further
//   subdivisible (granular grants would be Linux capabilities — a future type).
export type ElevatedPermissionType = 'allow-privilege-escalation';

export type ElevatedPermission = {
  type: ElevatedPermissionType;
  // Human-readable justification shown next to the consent checkbox. Required —
  // an app must say WHY it needs the grant so the operator can make an informed
  // decision. Coercion drops any entry missing a non-empty reason.
  reason: string;
};

export type AppSecurityConfig = {
  // Elevated permissions the app requests. Every entry becomes a red, must-check
  // consent row in the install wizard; the server grants ONLY what's declared.
  elevated: ElevatedPermission[];
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
  // Whether the app may be installed more than once (#246), seeded from the bundle
  // manifest and carried through finalize (read-only; not user-editable). Drives
  // the server's singleton-by-default guard at create time.
  multiInstance?: boolean;
  // Elevated container permissions the app requests, seeded from the bundle
  // manifest and carried through finalize (read-only; not user-editable). The
  // install wizard surfaces each for consent; the deploy lifecycle relaxes the
  // matching hardening.
  security?: AppSecurityConfig;
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
  // Pushable directories seeded from the bundle manifest (#409) and carried
  // through finalize so `push-targets` can resolve them against the deployment's
  // data root (read-only; not user-editable).
  push?: AppPushTarget[];
  // Optional Compose profiles the app declares (#162), seeded from the bundle
  // manifest so the install wizard can render a checkbox per profile. The
  // selected keys are sent on create; the declared list itself is read-only.
  profiles?: AppProfileConfig[];
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
  // Elevated container permissions the app requests (seeded from the bundle
  // manifest), so the install wizard can surface each for explicit operator
  // consent. Absent when the app requests none (the fully-hardened default).
  security?: AppSecurityConfig;
  // Optional Compose profiles the app declares (#162), so the install wizard can
  // render one opt-in checkbox per profile. Absent when the app has none.
  profiles?: AppProfileConfig[];
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

/**
 * Richer, on-demand update check for a single deployment (#299). The cheap
 * `latestVersion`/`updateAvailable` signal that rides on every list/detail row
 * (#284) says only *that* a newer version exists; this says *what kind* of update
 * it is — a safe one-click bump vs. a guided multi-step upgrade — by pulling the
 * target bundle's manifest and reading its `upgrade` metadata + `checkUpgradePath`.
 * That bundle pull is why it's a separate endpoint the detail page calls, not a
 * field on the list. Everything beyond the cheap signal is absent (fail-safe) when
 * the catalog/bundle is unavailable or the app declares no upgrade metadata.
 */
export type GetDeploymentUpdateCheckResponse = {
  /** The deployment's current version (absent for a `latest`-pinned install). */
  installedVersion?: string;
  /** Newest catalog version for this app (the update target). */
  latestVersion?: string;
  updateAvailable: boolean;
  /** Target release migrates/breaks — surface a "review notes" acknowledgement. */
  breaking?: boolean;
  /** Whether the jump is a legal one-shot, or must pass a floor/waypoint first
   *  (carries the next safe version + message when not). Present only when an
   *  update is available and the target's upgrade metadata was resolved. */
  path?: UpgradePathResult;
  preUpgradeBackup?: 'required' | 'recommended' | 'none';
  upgradeNotesUrl?: string;
};

/**
 * The deployment's manifest-declared push targets (#409), resolved for the CLI.
 *
 * Every `destPath` is absolute on the Hola host and has been verified to sit
 * inside the deployment's data root — the CLI never joins host paths itself,
 * because only the server knows the real `HOLA_APPS_BIND_ROOT`. A target whose
 * declared path escapes containment is **omitted** from this list (and logged),
 * so a bad manifest degrades one target rather than the whole listing.
 *
 * `mode`/`quiesce` are echoed with their defaults already applied, and
 * `hasPostHook` says whether the CLI should call `push-hooks` afterwards — one
 * GET is everything a push needs.
 */
export type GetDeploymentPushTargetsResponse = {
  targets: Array<{
    id: string;
    label: string;
    description?: string;
    /** Absolute host path, containment-checked against the app's data root. */
    destPath: string;
    mode: AppPushMode;
    quiesce: AppPushQuiesce;
    hasPostHook: boolean;
  }>;
};

export type PostDeploymentPushHookRequest = {
  /** The `push[].id` whose postHook to run. */
  targetId: string;
};

/**
 * `ok: false` means the hook ran and failed (or timed out) — the bytes are
 * already on disk, so this is reported rather than rolled back. A target with no
 * declared postHook is a no-op `{ ok: true }`.
 */
export type PostDeploymentPushHookResponse = {
  ok: boolean;
  /** Combined stdout/stderr from the hook, when it produced any. */
  output?: string;
};

export type PatchDeploymentRequest = {
  /**
   * Env vars to add or update, keyed by `key` (issue #332). This PATCH has
   * **merge-by-key** semantics: a var listed here is upserted (its `value` is
   * set; the manifest-declared spec is preserved server-side), and any stored
   * var NOT listed is left untouched — a partial request never wipes the vars it
   * omits. To remove a var, list its key in `removeEnvKeys`.
   */
  env?: AppEnvVar[];
  /** Keys to delete from the deployment's env. Idempotent (unknown keys are ignored). */
  removeEnvKeys?: string[];
  systemOverrides?: Record<string, string>;
};
// `jobId` is present when the update triggered a real redeploy (a restart job
// that re-materializes Compose from the freshly-rewritten manifest); absent
// when the PATCH touched nothing that needs a redeploy.
export type PatchDeploymentResponse = { ok: true; jobId?: string };

// The active release's full config for the DeploymentDetail Configuration tab —
// unlike `getActiveConfig`'s value-only maps (used internally for promote's
// carry-forward merge), this carries the full typed `AppEnvVar` rows (spec
// intact: label/type/required/pattern/etc.) so the UI can render them via
// `ParamField` instead of plain text boxes.
export type GetDeploymentConfigResponse = {
  appEnv: AppEnvVar[];
  systemOverrides: Record<string, string>;
};

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
  /**
   * Why a failed job failed. Recorded on the job record all along but dropped on
   * the way out, so a failed deploy surfaced as a red status with no reason —
   * exactly the dead end that made a swallowed bundle-pull failure so hard to
   * diagnose. Only set for `failed` jobs.
   */
  error?: string;
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

export type SSEDeploymentDeletedEvent = {
  type: 'deployment_deleted';
  data: { deploymentId: string };
};

export type SSEEvent = SSELogEvent | SSEJobUpdateEvent | SSESystemUpdateEvent | SSEDeploymentUpdateEvent | SSEDeploymentDeletedEvent;

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
 * Stable, machine-readable codes emitted by typed app-parameter validation
 * (`param-validate.ts`). Part of the API contract; clients may branch on them.
 */
export type ParamIssueCode =
  | 'PARAM_REQUIRED_MISSING'
  | 'PARAM_INVALID_INTEGER'
  | 'PARAM_INTEGER_OUT_OF_RANGE'
  | 'PARAM_INVALID_PORT'
  | 'PARAM_INVALID_BOOLEAN'
  | 'PARAM_INVALID_ENUM_VALUE'
  | 'PARAM_INVALID_URL'
  | 'PARAM_URL_NOT_HTTPS'
  | 'PARAM_INVALID_EMAIL'
  | 'PARAM_INVALID_TIMEZONE'
  | 'PARAM_PATTERN_MISMATCH'
  | 'PARAM_TOO_SHORT'
  | 'PARAM_TOO_LONG'
  | 'PARAM_INVALID_SPEC';

/**
 * Codes emitted by the broader ValidationService (drafts, env, resources).
 * The trailing `(string & {})` keeps the type open for codes produced by
 * other validators while preserving autocompletion for the known set.
 */
export type ValidationIssueCode =
  | ComposeIssueCode
  | ParamIssueCode
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
  // The DNS label this deployment is routed under: the app is reachable at
  // `<subdomain>.<HOLA_BASE_DOMAIN>`. Derived from the user-supplied name at
  // create time (slug, defaulting to the app id) and then STABLE for the
  // install's life — routing reconciles from this stored value, never recomputing
  // from the name. Absent on deployments created before multi-instance (#246); the
  // routing layer falls back to the app id, so their host is unchanged.
  subdomain?: string;
  // Compose profiles active for this install (#162): the resolved subset of the
  // app's declared `profiles` keys that the operator enabled at create time.
  // Threaded into every compose lifecycle command as `COMPOSE_PROFILES` so the
  // profiled services `up` starts are the same ones `down` tears down. Absent
  // when no optional profile is enabled (the default).
  selectedProfiles?: string[];
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
    // The catalog source this app was installed from (defaults to `hola`). Used to
    // check the right source for available updates. `(ref)` for install-by-ref.
    source?: string;
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
  // Install a second instance of an app the catalog marks single-instance (#246).
  // By default the server rejects a duplicate install of an app whose manifest
  // does not set `multiInstance: true`; this per-install override bypasses that
  // singleton guard (it still requires a distinct subdomain). Client-supplied.
  allowMultiple?: boolean;
  // Optional Compose profiles to enable for this install (#162): a subset of the
  // app's manifest-declared profile keys. The server intersects it with the
  // declared set and persists the result as the deployment's active profiles. When
  // omitted, the server falls back to the profiles the manifest marks `default`.
  profiles?: string[];
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
  // URL path prefixes to EXEMPT from the forward-auth gate. The renderer emits a
  // higher-priority router per prefix that routes straight to the app service with
  // NO forward-auth middleware, so a non-browser client can reach an app API path
  // the app protects with its own credential. From `auth.forwardAuth.bypassPaths`.
  bypassPaths?: string[];
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

/**
 * Slugify a user-supplied instance name into a DNS label (#246): lowercase,
 * `[a-z0-9-]` only, collapsed/trimmed hyphens, capped at 63 chars (the DNS label
 * limit) with any trailing hyphen from truncation removed. Returns '' when nothing
 * usable remains (e.g. a name of only punctuation) — the caller then falls back to
 * the app id. Shared by the server (create-time derivation) and the web wizard
 * (live preview) so both agree on the resulting host.
 */
export function slugifySubdomain(input: string): string {
  return (input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
}

/** Whether a string is already a valid DNS label (the shape slugifySubdomain emits). */
export function isValidSubdomain(label: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label);
}

/** Response for the subdomain-availability check (#246). */
export type GetSubdomainAvailabilityResponse = {
  // The normalized DNS label the check resolved to (slug of the input).
  subdomain: string;
  // The full host the label would route to (`<subdomain>.<baseDomain>`).
  host: string;
  // False when the label is reserved (a core route), already taken by another
  // deployment, or not a valid DNS label. `reason` explains which.
  available: boolean;
  reason?: 'reserved' | 'taken' | 'invalid';
};

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