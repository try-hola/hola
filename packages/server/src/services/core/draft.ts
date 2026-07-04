/**
 * Draft Service - Phase 7
 * 
 * Manages draft creation, editing, validation, and finalization.
 * Drafts are mutable until finalized into immutable releases.
 */

import type { 
  Draft, 
  DraftFile, 
  CreateDraftRequest, 
  CreateDraftResponse, 
  GetDraftResponse, 
  PatchDraftRequest, 
  PatchDraftResponse,
  UploadDraftFileResponse,
  DeleteDraftFileResponse,
  ValidateDraftResponse,
  EnhancedPreflightResponse,
  FinalizeDraftResponse,
  AppEnvVar,
  DraftDefaults,
  AppAuthConfig,
  AppUpgradeMeta,
  AppBackupConfig
} from '@hola/shared';

import { createHash } from 'crypto';

import { getLogger } from '../../lib/logger';
import { NotFoundError, ConflictError, ValidationError, DraftValidationError } from '../../middleware/error-mapping';
import { validateComposeDocument, APP_HOST_TOKEN, BASE_DOMAIN_TOKEN } from '@hola/shared/compose-validate';
import type { HealthCheckable, ServiceHealth } from './types';
import type { StorageService } from './storage';
import type { CatalogService } from './catalog';
import type { RegistryCredentialService } from './registry-credentials';
import type { RoutingService } from './routing';

/**
 * Shape of `drafts/<id>/finalized/manifest.json` produced by `finalizeDraft`.
 * This is the deterministic, deployment-ready specification consumed by
 * `DeploymentService` when building a release.
 */
export interface FinalizedManifestFile {
  uploadId: string;
  name: string;
  kind: DraftFile['kind'];
  path?: string;
  sha256: string;
}

export interface FinalizedManifest {
  draftId: string;
  appId: string;
  version?: string;
  // App icon (emoji or image URL) and product display name carried from the
  // catalog so the deployment record can persist both without re-reading the
  // catalog at create time.
  icon?: string;
  displayName?: string;
  // Catalog source the app came from (defaults to `hola`) and the registry
  // credential id used to pull it — carried so the deploy lifecycle can pull the
  // runtime image from a private registry and check the right source for updates.
  source?: string;
  credentialRef?: string;
  systemOverrides: Record<string, string>;
  appEnv: AppEnvVar[];
  ports: Array<{ host?: number; container: number; protocol: 'tcp' | 'udp' }>;
  composeOverride: string;
  // App auth capability carried from the catalog manifest so the deploy
  // lifecycle can provision SSO without re-reading the bundle.
  auth?: AppAuthConfig;
  // Cross-app capabilities consumed (e.g. `app-registry`); carried so the
  // deploy lifecycle can publish the right feeds without re-reading the bundle.
  consumes?: string[];
  // The compose service to route to / inject auth env into; carried so
  // materializeCompose targets the right service for multi-service apps.
  ingressService?: string;
  // Upgrade-safety metadata (#284 Phase 0) carried from the bundle manifest so
  // `promote` can enforce the skip-guard against this (target) version.
  upgrade?: AppUpgradeMeta;
  // Per-app pre/post-backup hooks (#121) carried from the bundle manifest so the
  // snapshot path can run them around the file capture.
  backup?: AppBackupConfig;
  files: FinalizedManifestFile[];
  checksum: string;
  finalizedAt: string;
}

/** Finalized manifest plus the staged file/compose contents it references. */
export interface FinalizedArtifacts {
  manifest: FinalizedManifest;
  composeOverride?: string;
  files: Array<{ uploadId: string; name: string; kind: DraftFile['kind']; path?: string; content: Buffer }>;
}

/**
 * Deterministic JSON serialization with recursively sorted object keys, so a
 * given draft specification always produces the same string (and thus the same
 * checksum) regardless of property insertion order.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

// Temporary interface - will be replaced when ValidationService is properly integrated
interface ValidationService {
  validateDraft(draft: Draft, files?: Map<string, DraftFile & { content?: Buffer }>): Promise<ValidateDraftResponse>;
  preflightCheck(draft: Draft, files?: Map<string, DraftFile & { content?: Buffer }>): Promise<EnhancedPreflightResponse>;
}

export interface DraftService extends HealthCheckable {
  // CRUD operations
  createDraft(request: CreateDraftRequest): Promise<CreateDraftResponse>;
  getDraft(draftId: string): Promise<GetDraftResponse>;
  updateDraft(draftId: string, patch: PatchDraftRequest): Promise<PatchDraftResponse>;
  deleteDraft(draftId: string): Promise<void>;
  
  // File operations
  uploadFile(draftId: string, file: { name: string; content: Buffer; kind: DraftFile['kind']; path?: string }): Promise<UploadDraftFileResponse>;
  deleteFile(draftId: string, uploadId: string): Promise<DeleteDraftFileResponse>;
  
  // Validation operations
  validateDraft(draftId: string): Promise<ValidateDraftResponse>;
  preflightCheck(draftId: string): Promise<EnhancedPreflightResponse>;
  
  // Finalization
  finalizeDraft(draftId: string): Promise<FinalizeDraftResponse>;
  /** Read the staged finalized artifacts for a finalized draft (for deployment creation). */
  getFinalizedArtifacts(draftId: string): Promise<FinalizedArtifacts>;

  // Internal helpers
  getDraftDefaults(appId: string, version?: string): Promise<{ env: AppEnvVar[]; defaults: DraftDefaults }>;
}

/**
 * Lifecycle status of a persisted draft.
 * `draft` = still mutable; `finalized` = artifacts staged for deployment.
 */
type DraftLifecycleStatus = 'draft' | 'finalized';

/**
 * On-disk draft record. Wraps the public `Draft` (the wire contract) with
 * persistence metadata that is not part of the API shape. Stored at
 * `drafts/<draftId>/draft.json`. File blob content lives separately under
 * `drafts/<draftId>/files/` and is cached in memory on demand.
 */
interface DraftRecord {
  draft: Draft;
  status: DraftLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  finalizedAt?: string;
  checksum?: string;
  /** Per-upload content checksums, keyed by uploadId (used for stable finalize). */
  fileChecksums: Record<string, string>;
  /** Per-upload target deployment paths, keyed by uploadId (not part of the wire Draft). */
  filePaths: Record<string, string>;
}

/**
 * Reject a Compose override that cannot be parsed as YAML at ingestion time so
 * malformed input fails fast with a 400. Semantic issues (undefined volumes,
 * host ports, etc.) are NOT rejected here — they surface through the `/validate`
 * endpoint so the wizard can display them inline while the user iterates.
 */
function assertComposeParses(content: string, source: string): void {
  if (!content || !content.trim()) return;
  const parseErrors = validateComposeDocument(content).filter((i) => i.code === 'INVALID_YAML');
  if (parseErrors.length > 0) {
    throw new ValidationError(`Invalid compose YAML in ${source}`, { issues: parseErrors });
  }
}

/**
 * Re-impose every typed-spec field (everything but `value`) from the stored
 * draft's env rows onto an incoming PATCH's `appEnv`, so a client (web/CLI) can
 * only ever change a seeded row's `value` — never forge/strip its `type`,
 * `required`, `pattern`, etc. A row whose key has no match in the stored draft
 * (a custom/user-added var, e.g. the wizard's "Add variable" or an unknown CLI
 * `--set` key) passes through unmodified — it has no spec to protect.
 *
 * Exported: `RealDeploymentService.updateDeployment` (deployment.ts) reuses the
 * exact same re-imposition semantics for a live deployment's config PATCH — a
 * client only ever owns `value` there either, never the manifest-declared spec.
 */
export function hardenAppEnv(storedEnv: AppEnvVar[], incomingEnv: AppEnvVar[]): AppEnvVar[] {
  const byKey = new Map(storedEnv.map((e) => [e.key, e]));
  return incomingEnv.map((incoming) => {
    const stored = byKey.get(incoming.key);
    return stored ? { ...stored, value: incoming.value } : incoming;
  });
}

export class RealDraftService implements DraftService {
  private logger = getLogger().child({ service: 'DraftService' });
  private drafts = new Map<string, DraftRecord>();
  /** Lazily-populated blob content cache: draftId -> uploadId -> content. */
  private fileContents = new Map<string, Map<string, Buffer>>();
  /** One-time rehydration guard so we load persisted state at most once. */
  private loadPromise: Promise<void> | null = null;

  constructor(
    private storageService: StorageService,
    private catalogService: CatalogService,
    private validationService: ValidationService,
    // Resolves a credentialRef → registry secret for the install-by-ref path.
    // Optional so existing wiring/tests that don't need private pulls still work.
    private registryCredentials?: RegistryCredentialService,
    // Resolves the install's base domain for platform-token prefill (seed-time
    // `${HOLA_APP_HOST}`/`${HOLA_BASE_DOMAIN}` resolution). Optional so existing
    // wiring/tests that don't need prefill still work — when absent, seeded env
    // values keep the literal token (deploy-time resolution in
    // `deployment.ts`'s materializeCompose is the belt-and-braces fallback).
    private routingService?: RoutingService
  ) {}

  /**
   * Replace `${HOLA_APP_HOST}`/`${HOLA_BASE_DOMAIN}` in seeded env values with
   * this install's concrete values, so the wizard shows a real prefilled URL/
   * domain (e.g. `https://vaultwarden.example.com`) instead of a raw token.
   * The app's public host follows the same `<appId>.<baseDomain>` pattern used
   * by `RoutingService.generateRule` (routing.ts's `buildRule`) — there's no
   * deployment/deploymentId yet at draft-creation time, so this computes the
   * host directly rather than calling `generateRule`.
   */
  private resolvePlatformTokens(appId: string, env: AppEnvVar[]): AppEnvVar[] {
    if (!this.routingService) return env;
    const baseDomain = this.routingService.baseDomain();
    const appHost = `${appId}.${baseDomain}`;
    return env.map((e) => {
      if (!e.value.includes(APP_HOST_TOKEN) && !e.value.includes(BASE_DOMAIN_TOKEN)) return e;
      return {
        ...e,
        value: e.value.replaceAll(APP_HOST_TOKEN, appHost).replaceAll(BASE_DOMAIN_TOKEN, baseDomain),
      };
    });
  }

  async healthCheck(): Promise<ServiceHealth> {
    try {
      // Check if we can access storage
      await this.storageService.ensureDir('drafts');

      return {
        healthy: true,
        lastCheck: new Date(),
      };
    } catch (error) {
      return {
        healthy: false,
        lastCheck: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ---- persistence helpers -------------------------------------------------

  /** Rehydrate persisted drafts from storage exactly once. */
  private async ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadFromStorage();
    }
    return this.loadPromise;
  }

  private async loadFromStorage(): Promise<void> {
    if (!(await this.storageService.fileExists('drafts'))) {
      return;
    }

    let ids: string[];
    try {
      ids = await this.storageService.listDir('drafts');
    } catch {
      return; // No drafts directory yet
    }

    for (const draftId of ids) {
      const recordPath = `drafts/${draftId}/draft.json`;
      if (!(await this.storageService.fileExists(recordPath))) {
        continue;
      }
      try {
        const raw = await this.storageService.readFileAsString(recordPath);
        const record = JSON.parse(raw) as DraftRecord;
        // Backfill optional sidecar maps for forward compatibility with older records.
        if (!record.fileChecksums) {
          record.fileChecksums = {};
        }
        if (!record.filePaths) {
          record.filePaths = {};
        }
        this.drafts.set(draftId, record);
      } catch (error) {
        this.logger.warn('Failed to rehydrate draft; skipping', {
          draftId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.info('Rehydrated drafts from storage', { count: this.drafts.size });
  }

  private async persistRecord(record: DraftRecord): Promise<void> {
    await this.storageService.writeFile(
      `drafts/${record.draft.draftId}/draft.json`,
      JSON.stringify(record, null, 2)
    );
  }

  private requireRecord(draftId: string): DraftRecord {
    const record = this.drafts.get(draftId);
    if (!record) {
      throw new Error(`Draft not found: ${draftId}`);
    }
    return record;
  }

  private blobPath(draftId: string, uploadId: string, name: string): string {
    return `drafts/${draftId}/files/${uploadId}-${name}`;
  }

  /**
   * Build the `Map<uploadId, DraftFile & { content }>` expected by the
   * validation service, loading blob content from disk into the cache as needed.
   */
  private async buildFilesMap(draftId: string): Promise<Map<string, DraftFile & { content?: Buffer }>> {
    const record = this.requireRecord(draftId);
    let cache = this.fileContents.get(draftId);
    if (!cache) {
      cache = new Map();
      this.fileContents.set(draftId, cache);
    }

    const result = new Map<string, DraftFile & { content?: Buffer }>();
    for (const file of record.draft.files) {
      let content = cache.get(file.uploadId);
      if (!content) {
        const path = this.blobPath(draftId, file.uploadId, file.name);
        if (await this.storageService.fileExists(path)) {
          content = await this.storageService.readFile(path);
          cache.set(file.uploadId, content);
        }
      }
      result.set(file.uploadId, { ...file, content });
    }
    return result;
  }

  private static sha256(content: string | Buffer): string {
    const data = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    return createHash('sha256').update(data).digest('hex');
  }

  // ---- CRUD ----------------------------------------------------------------

  async createDraft(request: CreateDraftRequest): Promise<CreateDraftResponse> {
    await this.ensureLoaded();
    const draftId = crypto.randomUUID();

    // Install-by-ref path (Slice 1): seed the draft straight from a pulled OCI
    // package instead of a catalog index entry. Shares the same pull→validate
    // primitive so the strict compose rules still apply.
    if (request.ociRef) {
      return this.createDraftFromRef(draftId, request);
    }

    if (!request.appId) throw new ValidationError('appId or ociRef is required');
    const source = request.source ?? 'hola';
    this.logger.info('Creating draft', { draftId, appId: request.appId, version: request.version, source });

    try {
      // Get app info from catalog (from the requested source, default `hola`)
      const app = await this.catalogService.getApp(request.appId, source);

      // Get default environment and configuration
      const defaults = await this.getDraftDefaults(request.appId, request.version, source);

      // Resolve `${HOLA_APP_HOST}`/`${HOLA_BASE_DOMAIN}` in the seeded env values
      // to this install's concrete host/domain, so the wizard shows a real
      // prefilled value rather than a raw platform token.
      const appEnv = this.resolvePlatformTokens(request.appId, defaults.env);

      // Seed the draft's compose from the catalog bundle so it can be deployed
      // without the user pasting compose. Guard it through the same parse check
      // as user-supplied compose so a bad bundle fails fast.
      const composeOverride = defaults.composeOverride ?? '';
      assertComposeParses(composeOverride, 'catalog bundle');

      // Create initial draft
      const draft: Draft = {
        draftId,
        appId: request.appId,
        // Persist the concrete resolved version (catalog turned "latest"/unset into
        // a pinned release) so the finalized manifest and the deployment record
        // carry a real version — that's what the deployments list shows and what
        // update detection compares against. Fall back to the raw request only if
        // the catalog couldn't resolve one.
        version: defaults.resolvedVersion ?? request.version,
        // Catalog source the app came from (defaults to the built-in `hola`).
        source,
        credentialRef: request.credentialRef,
        icon: app.icon,
        displayName: app.name,
        systemOverrides: {},
        appEnv,
        ports: defaults.defaults.ports,
        composeOverride,
        auth: defaults.auth,
        consumes: defaults.consumes,
        ingressService: defaults.ingressService,
        upgrade: defaults.upgrade,
        backup: defaults.backup,
        files: [],
      };

      const now = new Date().toISOString();
      const record: DraftRecord = {
        draft,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
        fileChecksums: {},
        filePaths: {},
      };

      // Store draft (in memory + durable)
      this.drafts.set(draftId, record);
      this.fileContents.set(draftId, new Map());
      await this.storageService.ensureDir(`drafts/${draftId}`);
      await this.persistRecord(record);

      const response: CreateDraftResponse = {
        draftId,
        app: {
          id: app.id,
          name: app.name,
          icon: app.icon,
        },
        // Platform-wide system variables an operator may override per-install.
        // None are defined by default (apps resolve install-specific values from
        // their bundle compose + tokens), so this is empty rather than seeded with
        // placeholder vars that don't affect the deploy.
        systemEnv: [],
        appEnv,
        defaults: defaults.defaults,
      };

      this.logger.info('Draft created successfully', { draftId, appId: request.appId });
      return response;
    } catch (error) {
      this.logger.error('Failed to create draft', error as Error, { draftId, appId: request.appId });
      throw error;
    }
  }

  /**
   * Build a draft directly from an OCI package reference (install-by-ref). The
   * bundle is pulled + validated by the same catalog primitive; a private ref is
   * authenticated with the stored credential named by `request.credentialRef`.
   * The resolved appId (a slug from the ref), source sentinel `(ref)`, and
   * credentialRef are persisted so the deploy lifecycle can pull the runtime
   * image with the same credential.
   */
  private async createDraftFromRef(draftId: string, request: CreateDraftRequest): Promise<CreateDraftResponse> {
    const ociRef = request.ociRef!;
    this.logger.info('Creating draft from OCI ref', { draftId, ociRef, credentialRef: request.credentialRef });
    try {
      let credentials;
      if (request.credentialRef) {
        credentials = await this.registryCredentials?.resolve(request.credentialRef);
        if (!credentials) throw new ValidationError(`Unknown registry credential: ${request.credentialRef}`);
      }

      const detail = await this.catalogService.getVersionDetailByRef(ociRef, credentials);
      const appId = detail.appId;

      const composeOverride = detail.composeOverride ?? '';
      assertComposeParses(composeOverride, 'oci bundle');

      // Resolve `${HOLA_APP_HOST}`/`${HOLA_BASE_DOMAIN}` in the seeded env values
      // to this install's concrete host/domain (see createDraft).
      const appEnv = this.resolvePlatformTokens(appId, detail.defaultEnv);

      const draft: Draft = {
        draftId,
        appId,
        version: detail.version,
        source: '(ref)',
        credentialRef: request.credentialRef,
        icon: '📦',
        displayName: appId,
        systemOverrides: {},
        appEnv,
        ports: detail.defaults.ports,
        composeOverride,
        auth: detail.auth,
        consumes: detail.consumes,
        ingressService: detail.ingressService,
        upgrade: detail.upgrade,
        backup: detail.backup,
        files: [],
      };

      const now = new Date().toISOString();
      const record: DraftRecord = {
        draft,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
        fileChecksums: {},
        filePaths: {},
      };

      this.drafts.set(draftId, record);
      this.fileContents.set(draftId, new Map());
      await this.storageService.ensureDir(`drafts/${draftId}`);
      await this.persistRecord(record);

      this.logger.info('Draft created from ref successfully', { draftId, appId, version: detail.version });
      return {
        draftId,
        app: { id: appId, name: draft.displayName ?? appId, icon: draft.icon ?? '📦' },
        systemEnv: [],
        appEnv,
        defaults: detail.defaults,
      };
    } catch (error) {
      this.logger.error('Failed to create draft from ref', error as Error, { draftId, ociRef });
      throw error;
    }
  }

  async getDraft(draftId: string): Promise<GetDraftResponse> {
    await this.ensureLoaded();
    const record = this.requireRecord(draftId);
    return { ...record.draft };
  }

  async updateDraft(draftId: string, patch: PatchDraftRequest): Promise<PatchDraftResponse> {
    await this.ensureLoaded();
    const record = this.requireRecord(draftId);

    // Avoid logging secret env values; log which fields changed instead.
    this.logger.info('Updating draft', { draftId, fields: Object.keys(patch) });

    // Fail fast on unparseable compose overrides set via PATCH (#13).
    if (typeof patch.composeOverride === 'string') {
      assertComposeParses(patch.composeOverride, 'composeOverride');
    }

    // A client only ever owns `value` per env row — the typed spec (type/label/
    // required/pattern/etc) is seeded from the catalog at draft-creation time and
    // must not be forgeable/droppable via PATCH. Re-impose every spec field from
    // the currently-stored row before merging the patch. Only touch `appEnv` when
    // the patch actually carries one — spreading an explicit `appEnv: undefined`
    // key into the merge below would wipe the stored env entirely.
    const hardenedPatch: PatchDraftRequest = patch.appEnv
      ? { ...patch, appEnv: hardenAppEnv(record.draft.appEnv, patch.appEnv) }
      : patch;

    // Apply patch (preserve file metadata managed by upload/delete).
    record.draft = { ...record.draft, ...hardenedPatch };
    record.updatedAt = new Date().toISOString();
    this.drafts.set(draftId, record);
    await this.persistRecord(record);

    return {
      ok: true,
      draft: { ...record.draft },
    };
  }

  async deleteDraft(draftId: string): Promise<void> {
    await this.ensureLoaded();
    this.requireRecord(draftId);

    this.logger.info('Deleting draft', { draftId });

    // Remove from memory
    this.drafts.delete(draftId);
    this.fileContents.delete(draftId);

    // Remove from storage
    try {
      await this.storageService.deleteDir(`drafts/${draftId}`, true);
    } catch (error) {
      this.logger.warn('Failed to delete draft storage', { draftId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async uploadFile(
    draftId: string,
    file: { name: string; content: Buffer; kind: DraftFile['kind']; path?: string }
  ): Promise<UploadDraftFileResponse> {
    await this.ensureLoaded();
    const record = this.requireRecord(draftId);

    // Fail fast on unparseable compose overrides (#13).
    if (file.kind === 'composeOverride') {
      assertComposeParses(file.content.toString('utf-8'), file.name);
    }

    const uploadId = crypto.randomUUID();
    this.logger.info('Uploading file to draft', { draftId, uploadId, fileName: file.name, kind: file.kind, size: file.content.length });

    // Persist blob first so durable state never references a missing file.
    await this.storageService.writeFile(this.blobPath(draftId, uploadId, file.name), file.content);

    // Update file metadata on the record and cache the content.
    record.draft.files = [
      ...record.draft.files,
      { uploadId, name: file.name, size: file.content.length, kind: file.kind },
    ];
    record.fileChecksums[uploadId] = RealDraftService.sha256(file.content);
    if (file.path) {
      record.filePaths[uploadId] = file.path;
    }
    record.updatedAt = new Date().toISOString();

    let cache = this.fileContents.get(draftId);
    if (!cache) {
      cache = new Map();
      this.fileContents.set(draftId, cache);
    }
    cache.set(uploadId, file.content);

    await this.persistRecord(record);

    return {
      uploadId,
      name: file.name,
      size: file.content.length,
      kind: file.kind,
    };
  }

  async deleteFile(draftId: string, uploadId: string): Promise<DeleteDraftFileResponse> {
    await this.ensureLoaded();
    const record = this.requireRecord(draftId);

    const file = record.draft.files.find(f => f.uploadId === uploadId);
    if (!file) {
      throw new Error(`File not found: ${uploadId}`);
    }

    this.logger.info('Deleting file from draft', { draftId, uploadId, fileName: file.name });

    // Remove metadata + cached content
    record.draft.files = record.draft.files.filter(f => f.uploadId !== uploadId);
    delete record.fileChecksums[uploadId];
    delete record.filePaths[uploadId];
    record.updatedAt = new Date().toISOString();
    this.fileContents.get(draftId)?.delete(uploadId);
    await this.persistRecord(record);

    // Remove the blob from storage
    try {
      await this.storageService.deleteFile(this.blobPath(draftId, uploadId, file.name));
    } catch (error) {
      this.logger.warn('Failed to delete file from storage', { draftId, uploadId, error: error instanceof Error ? error.message : String(error) });
    }

    return { ok: true };
  }

  async validateDraft(draftId: string): Promise<ValidateDraftResponse> {
    await this.ensureLoaded();
    const record = this.requireRecord(draftId);

    this.logger.info('Validating draft', { draftId });

    try {
      // Use validation service for comprehensive checks
      const report = await this.validationService.validateDraft(record.draft, await this.buildFilesMap(draftId));

      return {
        ok: report.ok,
        errors: report.errors,
        warnings: report.warnings,
      };
    } catch (error) {
      this.logger.error('Draft validation failed', error as Error, { draftId });
      return {
        ok: false,
        errors: [{ code: 'VALIDATION_FAILED', severity: 'error', message: error instanceof Error ? error.message : 'Validation failed' }],
        warnings: [],
      };
    }
  }

  async preflightCheck(draftId: string): Promise<EnhancedPreflightResponse> {
    await this.ensureLoaded();
    const record = this.requireRecord(draftId);

    this.logger.info('Running preflight check', { draftId });

    try {
      // Use validation service for preflight checks
      return await this.validationService.preflightCheck(record.draft, await this.buildFilesMap(draftId));
    } catch (error) {
      this.logger.error('Preflight check failed', error as Error, { draftId });
      return {
        ok: false,
        checks: [{
          name: 'preflight',
          type: 'docker',
          status: 'fail',
          detail: error instanceof Error ? error.message : 'Preflight check failed',
        }],
      };
    }
  }

  async finalizeDraft(draftId: string): Promise<FinalizeDraftResponse> {
    await this.ensureLoaded();
    const record = this.requireRecord(draftId);

    this.logger.info('Finalizing draft', { draftId });

    try {
      // First validate the draft
      const validation = await this.validateDraft(draftId);
      if (!validation.ok) {
        // Structured 422 (code + per-issue details) rather than a message-only
        // Error, so a client (wizard/CLI/promote) can render/name the offending
        // key(s) instead of a generic 500. `mapErrorToResponse` picks this up
        // automatically via its `'status' in error && 'code' in error` branch.
        throw new DraftValidationError(
          `Draft validation failed: ${validation.errors.map(e => e.message).join(', ')}`,
          validation.errors,
        );
      }

      const draft = record.draft;
      const filesMap = await this.buildFilesMap(draftId);

      // Deterministic spec: sorted files, no timestamps. This is the checksum input,
      // so repeated finalization of unchanged input yields an identical checksum.
      const specFiles = draft.files
        .map(f => ({
          uploadId: f.uploadId,
          name: f.name,
          kind: f.kind,
          path: record.filePaths[f.uploadId],
          sha256: record.fileChecksums[f.uploadId],
        }))
        .sort((a, b) => a.uploadId.localeCompare(b.uploadId));

      const canonicalSpec = {
        draftId,
        appId: draft.appId,
        version: draft.version,
        systemOverrides: draft.systemOverrides,
        appEnv: draft.appEnv,
        ports: draft.ports,
        composeOverride: draft.composeOverride ?? '',
        auth: draft.auth,
        consumes: draft.consumes,
        ingressService: draft.ingressService,
        upgrade: draft.upgrade,
        backup: draft.backup,
        files: specFiles,
      };

      const checksum = RealDraftService.sha256(stableStringify(canonicalSpec));
      const finalizedAt = new Date().toISOString();

      // Stage deterministic artifacts consumable by DeploymentService (#14).
      const finalizedDir = `drafts/${draftId}/finalized`;
      await this.storageService.ensureDir(finalizedDir);

      if (canonicalSpec.composeOverride) {
        await this.storageService.writeFile(
          `${finalizedDir}/compose-override.yml`,
          canonicalSpec.composeOverride
        );
      }

      for (const file of draft.files) {
        const content = filesMap.get(file.uploadId)?.content;
        if (content) {
          await this.storageService.writeFile(
            `${finalizedDir}/files/${file.uploadId}-${file.name}`,
            content
          );
        }
      }

      // `icon`/`displayName` are presentation, not part of the deployable spec,
      // so they're added outside canonicalSpec — keeping the checksum a pure
      // function of the spec.
      // `source`/`credentialRef` are install-time routing metadata (which catalog
      // source + which registry credential), not deployable content, so they live
      // outside canonicalSpec and don't perturb the checksum — like icon/displayName.
      const manifest = { ...canonicalSpec, icon: draft.icon, displayName: draft.displayName, source: draft.source, credentialRef: draft.credentialRef, checksum, finalizedAt };
      await this.storageService.writeFile(
        `${finalizedDir}/manifest.json`,
        JSON.stringify(manifest, null, 2)
      );

      // Record finalized status durably.
      record.status = 'finalized';
      record.finalizedAt = finalizedAt;
      record.checksum = checksum;
      record.updatedAt = finalizedAt;
      await this.persistRecord(record);

      this.logger.info('Draft finalized successfully', { draftId, checksum });

      return {
        spec: manifest,
        checksum,
      };
    } catch (error) {
      this.logger.error('Failed to finalize draft', error as Error, { draftId });
      throw error;
    }
  }

  async getFinalizedArtifacts(draftId: string): Promise<FinalizedArtifacts> {
    await this.ensureLoaded();
    const manifestPath = `drafts/${draftId}/finalized/manifest.json`;
    if (!(await this.storageService.fileExists(manifestPath))) {
      throw new ConflictError(`Draft is not finalized: ${draftId}`);
    }

    const manifest = JSON.parse(await this.storageService.readFileAsString(manifestPath)) as FinalizedManifest;

    const files: FinalizedArtifacts['files'] = [];
    for (const f of manifest.files) {
      const blobPath = `drafts/${draftId}/finalized/files/${f.uploadId}-${f.name}`;
      const content = (await this.storageService.fileExists(blobPath))
        ? await this.storageService.readFile(blobPath)
        : Buffer.alloc(0);
      files.push({ uploadId: f.uploadId, name: f.name, kind: f.kind, path: f.path, content });
    }

    return {
      manifest,
      composeOverride: manifest.composeOverride || undefined,
      files,
    };
  }

  async getDraftDefaults(appId: string, version?: string, source?: string): Promise<{ env: AppEnvVar[]; defaults: DraftDefaults; composeOverride: string; auth?: AppAuthConfig; consumes?: string[]; ingressService?: string; upgrade?: AppUpgradeMeta; backup?: AppBackupConfig; resolvedVersion?: string }> {
    try {
      const versionDetail = await this.catalogService.getVersionDetail(appId, version || 'latest', source);
      return {
        env: versionDetail.defaultEnv,
        defaults: versionDetail.defaults,
        composeOverride: versionDetail.composeOverride ?? '',
        auth: versionDetail.auth,
        consumes: versionDetail.consumes,
        ingressService: versionDetail.ingressService,
        upgrade: versionDetail.upgrade,
        backup: versionDetail.backup,
        // The concrete version the catalog resolved (e.g. "latest" → "1.4.1"), so
        // the draft persists a real version for display + update detection.
        resolvedVersion: versionDetail.version,
      };
    } catch (error) {
      this.logger.warn('Failed to get app defaults, using fallback', { appId, version, error: error instanceof Error ? error.message : String(error) });

      // Fallback defaults (no bundle compose available — the user supplies one)
      return {
        env: [
          { key: 'APP_PORT', value: '8080', isSecret: false, description: 'Application port' },
        ],
        defaults: {
          ports: [{ host: 8080, container: 80, protocol: 'tcp' }],
          volumes: [{ hostPath: './data', containerPath: '/data', readOnly: false }],
        },
        composeOverride: '',
      };
    }
  }
}

export class MockDraftService implements DraftService {
  private logger = getLogger().child({ service: 'MockDraftService' });
  private drafts = new Map<string, Draft>();
  private draftFiles = new Map<string, Map<string, DraftFile & { content?: Buffer }>>();

  async healthCheck(): Promise<ServiceHealth> {
    return {
      healthy: true,
      lastCheck: new Date(),
    };
  }

  async createDraft(request: CreateDraftRequest): Promise<CreateDraftResponse> {
    const draftId = crypto.randomUUID();
    this.logger.info('Mock: Creating draft', { draftId, request });
    // appId is optional on the wire (the install-by-ref path supplies ociRef); the
    // mock derives a placeholder id so its Draft/response stay well-formed.
    const appId = request.appId ?? 'mock-app';
    const draft: Draft = {
      draftId,
      appId,
      version: request.version,
      source: request.source ?? (request.ociRef ? '(ref)' : 'hola'),
      credentialRef: request.credentialRef,
      icon: '📦',
      displayName: 'Mock App',
      systemOverrides: {},
      appEnv: [ { key: 'APP_PORT', value: '8080', isSecret: false, description: 'Application port' } ],
      ports: [{ host: 8080, container: 80, protocol: 'tcp' }],
      composeOverride: '',
      files: [],
    };
    this.drafts.set(draftId, draft);
    this.draftFiles.set(draftId, new Map());

    return {
      draftId,
      app: { id: appId, name: draft.displayName ?? 'Mock App', icon: draft.icon ?? '📦' },
      systemEnv: [],
      appEnv: draft.appEnv,
      defaults: { ports: draft.ports, volumes: [{ hostPath: './data', containerPath: '/data', readOnly: false }] },
    };
  }

  async getDraft(draftId: string): Promise<GetDraftResponse> {
    this.logger.info('Mock: Getting draft', { draftId });
    const draft = this.drafts.get(draftId);
    if (!draft) {
      throw new Error(`Draft not found: ${draftId}`);
    }
    const files = Array.from(this.draftFiles.get(draftId)?.values() || []).map(f => ({
      uploadId: f.uploadId,
      name: f.name,
      size: f.size,
      kind: f.kind,
    }));
    return { ...draft, files };
  }

  async updateDraft(draftId: string, patch: PatchDraftRequest): Promise<PatchDraftResponse> {
    this.logger.info('Mock: Updating draft', { draftId, patch });
    const existing = this.drafts.get(draftId);
    if (!existing) throw new Error(`Draft not found: ${draftId}`);
    const updated: Draft = { ...existing, ...patch } as Draft;
    this.drafts.set(draftId, updated);
    const files = Array.from(this.draftFiles.get(draftId)?.values() || []).map(f => ({
      uploadId: f.uploadId,
      name: f.name,
      size: f.size,
      kind: f.kind,
    }));
    return { ok: true, draft: { ...updated, files } };
  }

  async deleteDraft(draftId: string): Promise<void> {
    this.logger.info('Mock: Deleting draft', { draftId });
    this.drafts.delete(draftId);
    this.draftFiles.delete(draftId);
  }

  async uploadFile(
    draftId: string, 
    file: { name: string; content: Buffer; kind: DraftFile['kind']; path?: string }
  ): Promise<UploadDraftFileResponse> {
    this.logger.info('Mock: Uploading file', { draftId, fileName: file.name, kind: file.kind });
    const draft = this.drafts.get(draftId);
    if (!draft) throw new Error(`Draft not found: ${draftId}`);
    let files = this.draftFiles.get(draftId);
    if (!files) { files = new Map(); this.draftFiles.set(draftId, files); }
    const uploadId = crypto.randomUUID();
    files.set(uploadId, { uploadId, name: file.name, size: file.content.length, kind: file.kind, path: file.path });
    return { uploadId, name: file.name, size: file.content.length, kind: file.kind };
  }

  async deleteFile(draftId: string, uploadId: string): Promise<DeleteDraftFileResponse> {
    this.logger.info('Mock: Deleting file', { draftId, uploadId });
    return { ok: true };
  }

  async validateDraft(draftId: string): Promise<ValidateDraftResponse> {
    this.logger.info('Mock: Validating draft', { draftId });

    return {
      ok: true,
      errors: [],
      warnings: [
        { code: 'IMAGE_MISSING_TAG', severity: 'warning', field: 'ports', message: 'Port 8080 may conflict with other services' },
      ],
    };
  }

  async preflightCheck(draftId: string): Promise<EnhancedPreflightResponse> {
    this.logger.info('Mock: Running preflight check', { draftId });

    return {
      ok: true,
      checks: [
        { name: 'env', type: 'env', status: 'pass' },
        { name: 'docker', type: 'docker', status: 'pass' },
        { name: 'disk', type: 'disk', status: 'warn', detail: 'Low disk space' },
        { name: 'ports', type: 'ports', status: 'pass' },
      ],
    };
  }

  async finalizeDraft(draftId: string): Promise<FinalizeDraftResponse> {
    this.logger.info('Mock: Finalizing draft', { draftId });
    const draft = this.drafts.get(draftId);
    if (!draft) throw new Error(`Draft not found: ${draftId}`);
    return { spec: { draftId: draft.draftId, appId: draft.appId, finalizedAt: new Date().toISOString() }, checksum: crypto.randomUUID() };
  }

  async getFinalizedArtifacts(draftId: string): Promise<FinalizedArtifacts> {
    this.logger.info('Mock: Getting finalized artifacts', { draftId });
    const draft = this.drafts.get(draftId);
    if (!draft) throw new NotFoundError(`Draft not found: ${draftId}`);
    const manifest: FinalizedManifest = {
      draftId,
      appId: draft.appId,
      version: draft.version,
      icon: draft.icon,
      displayName: draft.displayName,
      systemOverrides: draft.systemOverrides,
      appEnv: draft.appEnv,
      ports: draft.ports,
      composeOverride: draft.composeOverride ?? '',
      ingressService: draft.ingressService,
      upgrade: draft.upgrade,
      backup: draft.backup,
      files: [],
      checksum: 'mock-checksum',
      finalizedAt: new Date().toISOString(),
    };
    return { manifest, composeOverride: manifest.composeOverride || undefined, files: [] };
  }

  async getDraftDefaults(appId: string, version?: string): Promise<{ env: AppEnvVar[]; defaults: DraftDefaults }> {
    this.logger.info('Mock: Getting draft defaults', { appId, version });

    return {
      env: [
        { key: 'APP_PORT', value: '8080', isSecret: false, description: 'Application port' },
      ],
      defaults: {
        ports: [{ host: 8080, container: 80, protocol: 'tcp' }],
        volumes: [{ hostPath: './data', containerPath: '/data', readOnly: false }],
      },
    };
  }
}
