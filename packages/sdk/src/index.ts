import { 
  API, 
  // Phase 7 Draft types
  CreateDraftRequest, CreateDraftResponse, GetDraftResponse, 
  PatchDraftRequest, PatchDraftResponse,
  UploadDraftFileResponse, DeleteDraftFileResponse,
  ValidateDraftResponse, EnhancedPreflightResponse, FinalizeDraftResponse,
  // Phase 7 Deployment types
  CreateDeploymentFromDraftRequest, CreateDeploymentFromDraftResponse,
  GetDeploymentsRequest, GetDeploymentsResponse, GetDeploymentResponse,
  PatchDeploymentRequest, PatchDeploymentResponse,
  PostDeploymentActionRequest, PostDeploymentActionResponse,
  RollbackRequest, RollbackResponse, GetDeploymentHistoryResponse,
  PromoteDeploymentRequest, PromoteDeploymentResponse,
  GetDeploymentConfigResponse,
  GetDeploymentUpdateCheckResponse,
  GetDeploymentPushTargetsResponse,
  PostDeploymentPushHookRequest,
  PostDeploymentPushHookResponse,
  GetSubdomainAvailabilityResponse,
  // Catalog types
  GetCatalogAppsRequest, GetCatalogAppsResponse, GetCatalogAppResponse,
  GetCatalogAppVersionsResponse, GetCatalogAppVersionDetailResponse,
  // Registry credentials + install-by-ref (multi-catalog Slice 1)
  RegistryCredentialRecord, AddRegistryCredentialRequest, ListRegistryCredentialsResponse,
  InstallFromRefRequest, InstallFromRefResponse,
  // Catalog sources (multi-catalog Slice 2)
  CatalogSourceRecord, AddCatalogSourceRequest, UpdateCatalogSourceRequest, ListCatalogSourcesResponse,
  PreviewCatalogSourceRequest, PreviewCatalogSourceResponse,
  RefreshCatalogResponse,
  // Job types
  DeleteJobsRequest, DeleteJobsResponse,
  // System types
  GetUpdateCheckResponse
} from '@hola/shared';

export type SdkInitOptions = {
  baseUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
};

export class HolaSdk {
  private baseUrl: string;
  private token?: string;
  private fetchImpl: typeof fetch;

  constructor(opts: SdkInitOptions = {}) {
    this.baseUrl = opts.baseUrl ?? inferBaseUrl();
    this.token = opts.token ?? inferToken();
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as typeof fetch);
    if (!this.fetchImpl) {
      throw new Error('fetch is not available. Provide fetchImpl or use a runtime with fetch.');
    }
  }

  private url(path: string) {
    return `${this.baseUrl}${path}`;
  }

  private headers(extra?: HeadersInit): HeadersInit {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (extra) Object.assign(h, extra as Record<string, string>);
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  async get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(this.url(path), { method: 'GET', headers: this.headers() });
    return parseJson<T>(res);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(this.url(path), {
      method: 'POST',
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return parseJson<T>(res);
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(this.url(path), {
      method: 'PATCH',
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return parseJson<T>(res);
  }

  async delete<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(this.url(path), { method: 'DELETE', headers: this.headers() });
    return parseJson<T>(res);
  }

  // --- Convenience methods using shared API constants ---

  health() { return this.get(API.health); }
  me() { return this.get(API.me); }
  summary() { return this.get(API.summary); }

  catalog = {
    apps: (qs?: GetCatalogAppsRequest) => this.get<GetCatalogAppsResponse>(`${API.catalog.apps}${buildQuery(qs as Record<string, string | number | boolean | undefined>)}`),
    // `source` selects which catalog source the app comes from (default `hola`).
    app: (appId: string, source?: string) => this.get<GetCatalogAppResponse>(`${API.catalog.appById(appId)}${buildQuery({ source })}`),
    versions: (appId: string, source?: string) => this.get<GetCatalogAppVersionsResponse>(`${API.catalog.versions(appId)}${buildQuery({ source })}`),
    versionDetail: (appId: string, version: string, source?: string) => this.get<GetCatalogAppVersionDetailResponse>(`${API.catalog.versionDetail(appId, version)}${buildQuery({ source })}`),
    // Force an immediate re-fetch of the remote catalog (bypasses the refresh-interval
    // TTL) so newly-published app versions surface as available updates right away.
    refresh: (force = true) => this.post<RefreshCatalogResponse>(`${API.catalog.refresh}${buildQuery({ force })}`),
  };

  // Managed catalog sources (Homebrew-tap model). Instance-level, admin-gated.
  catalogSources = {
    list: () => this.get<ListCatalogSourcesResponse>(API.catalogSources.base),
    add: (data: AddCatalogSourceRequest) => this.post<CatalogSourceRecord>(API.catalogSources.base, data),
    // Patch a source in place — chiefly to add `allowRegistries` after a
    // REF_NOT_ALLOWED pull, without deleting and re-adding the source.
    update: (id: string, data: UpdateCatalogSourceRequest) =>
      this.patch<CatalogSourceRecord>(API.catalogSources.byId(id), data),
    remove: (id: string) => this.delete<{ success: boolean }>(API.catalogSources.byId(id)),
    // Probe a catalog.json before adding it: what apps it lists and which
    // registries they publish from. Stores nothing.
    preview: (url: string) =>
      this.post<PreviewCatalogSourceResponse>(API.catalogSources.preview, { url } satisfies PreviewCatalogSourceRequest),
  };

  // Registry credentials for private OCI pulls. The token is write-only: `add`
  // sends it, `list` never returns it. Instance-level, admin-gated server-side.
  registryCredentials = {
    list: () => this.get<ListRegistryCredentialsResponse>(API.registryCredentials.base),
    add: (data: AddRegistryCredentialRequest) => this.post<RegistryCredentialRecord>(API.registryCredentials.base, data),
    remove: (id: string) => this.delete<{ success: boolean }>(API.registryCredentials.byId(id)),
  };

  // Install a package straight from an OCI reference (the escape hatch for
  // one-offs). Returns the created draft id; finalize + deploy it like any draft.
  installFromRef = (data: InstallFromRefRequest) =>
    this.post<InstallFromRefResponse>(API.installFromRef, data);

  drafts = {
    create: (data: CreateDraftRequest) => this.post<CreateDraftResponse>(API.drafts.create, data),
    byId: (draftId: string) => this.get<GetDraftResponse>(API.drafts.byId(draftId)),
    update: (draftId: string, data: PatchDraftRequest) => this.patch<PatchDraftResponse>(API.drafts.byId(draftId), data),
    remove: (draftId: string) => this.delete<void>(API.drafts.byId(draftId)),
    uploadFile: (draftId: string, filePath: string, content: string) =>
      this.post<UploadDraftFileResponse>(API.drafts.uploads(draftId), { filePath, content }),
    removeFile: (draftId: string, uploadId: string) => 
      this.delete<DeleteDraftFileResponse>(API.drafts.uploadById(draftId, uploadId)),
    validate: (draftId: string) => this.post<ValidateDraftResponse>(API.drafts.validate(draftId)),
    preflight: (draftId: string) => this.post<EnhancedPreflightResponse>(API.drafts.preflight(draftId)),
    finalize: (draftId: string) => this.post<FinalizeDraftResponse>(API.drafts.finalize(draftId)),
  };

  deployments = {
    create: (data: CreateDeploymentFromDraftRequest) => this.post<CreateDeploymentFromDraftResponse>(API.deployments.base, data),
    // Live check for the install wizard: is `<subdomain>.<base>` free (#246)?
    subdomainAvailable: (subdomain: string) =>
      this.get<GetSubdomainAvailabilityResponse>(`${API.deployments.subdomainAvailable}${buildQuery({ subdomain })}`),
    list: (qs?: GetDeploymentsRequest) => this.get<GetDeploymentsResponse>(`${API.deployments.base}${buildQuery(qs)}`),
    byId: (deploymentId: string) => this.get<GetDeploymentResponse>(API.deployments.byId(deploymentId)),
    update: (deploymentId: string, data: PatchDeploymentRequest) => this.patch<PatchDeploymentResponse>(API.deployments.byId(deploymentId), data),
    delete: (deploymentId: string) => this.delete<void>(API.deployments.byId(deploymentId)),
    history: (deploymentId: string, qs?: Record<string, string | number | boolean | undefined>) => this.get<GetDeploymentHistoryResponse>(`${API.deployments.history(deploymentId)}${buildQuery(qs)}`),
    action: (deploymentId: string, action: PostDeploymentActionRequest) => this.post<PostDeploymentActionResponse>(API.deployments.actions(deploymentId), action),
    rollback: (deploymentId: string, rollback: RollbackRequest) => this.post<RollbackResponse>(API.deployments.rollback(deploymentId), rollback),
    promote: (deploymentId: string, promote: PromoteDeploymentRequest = {}) => this.post<PromoteDeploymentResponse>(API.deployments.promote(deploymentId), promote),
    logs: (deploymentId: string, qs?: Record<string, string | number | boolean | undefined>) => this.get(`${API.deployments.logs(deploymentId)}${buildQuery(qs)}`),
    config: (deploymentId: string) => this.get<GetDeploymentConfigResponse>(API.deployments.config(deploymentId)),
    // On-demand richer update check for one deployment (#299): safe-bump vs.
    // guided-upgrade, with the target's breaking/backup/notes + a path verdict.
    updateCheck: (deploymentId: string) => this.get<GetDeploymentUpdateCheckResponse>(API.deployments.updateCheck(deploymentId)),
    // Manifest-declared push targets (#409), each resolved to an absolute host
    // path already proven to sit inside the app's data root — the client rsyncs
    // to `destPath` verbatim rather than joining paths itself.
    pushTargets: (deploymentId: string) => this.get<GetDeploymentPushTargetsResponse>(API.deployments.pushTargets(deploymentId)),
    // Run a push target's manifest-declared postHook after the push (#409).
    pushHook: (deploymentId: string, data: PostDeploymentPushHookRequest) =>
      this.post<PostDeploymentPushHookResponse>(API.deployments.pushHook(deploymentId), data),
  };

  jobs = {
    byId: (jobId: string) => this.get(API.jobs.byId(jobId)),
    logs: (jobId: string, qs?: Record<string, string | number | boolean | undefined>) => this.get(`${API.jobs.logs(jobId)}${buildQuery(qs)}`),
    // Clear finished (completed/failed/cancelled) jobs, optionally scoped by
    // deployment and/or a single terminal status. Never removes running/queued jobs.
    clear: (qs?: DeleteJobsRequest) => this.delete<DeleteJobsResponse>(`${API.jobs.base}${buildQuery(qs as Record<string, string | number | boolean | undefined>)}`),
  };

  // --- Core deployment functionality ---

  system = {
    status: () => this.get(API.system.status),
    health: () => this.get(API.system.health),
    updateCheck: () => this.get<GetUpdateCheckResponse>(API.system.updateCheck),
  };
}

// --- helpers ---

function inferBaseUrl() {
  // Prefer CLI/server env var first
  if (typeof process !== 'undefined' && process.env?.HOLA_API_URL) return process.env.HOLA_API_URL;
  // Vite-style for future web integration
  try {
    const viteUrl = (import.meta as { env?: { VITE_API_BASE_URL?: string } })?.env?.VITE_API_BASE_URL;
    if (typeof viteUrl === 'string' && viteUrl) return viteUrl;
  } catch {
    // ignore error
  }
  return 'http://localhost:3001';
}

function inferToken() {
  if (typeof process !== 'undefined' && process.env?.HOLA_TOKEN) return process.env.HOLA_TOKEN;
  return undefined;
}

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await safeText(res);
    throw new Error(`HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ''}`);
  }
  // May be empty body (204)
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

async function safeText(res: Response) {
  try { return await res.text(); } catch { return ''; }
}

function buildQuery(qs?: Record<string, string | number | boolean | undefined>): string {
  if (!qs) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(qs)) {
    if (v !== undefined && v !== null) sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export { buildQuery };
