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
  AppAuthConfig
} from '@hola/shared';

import { createHash } from 'crypto';

import { getLogger } from '../../lib/logger';
import { NotFoundError, ConflictError, ValidationError } from '../../middleware/error-mapping';
import { validateComposeDocument } from '@hola/shared/compose-validate';
import type { HealthCheckable, ServiceHealth } from './types';
import type { StorageService } from './storage';
import type { CatalogService } from './catalog';

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
    private validationService: ValidationService
  ) {}

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
    this.logger.info('Creating draft', { draftId, appId: request.appId, version: request.version });

    try {
      // Get app info from catalog
      const app = await this.catalogService.getApp(request.appId);

      // Get default environment and configuration
      const defaults = await this.getDraftDefaults(request.appId, request.version);

      // Seed the draft's compose from the catalog bundle so it can be deployed
      // without the user pasting compose. Guard it through the same parse check
      // as user-supplied compose so a bad bundle fails fast.
      const composeOverride = defaults.composeOverride ?? '';
      assertComposeParses(composeOverride, 'catalog bundle');

      // Create initial draft
      const draft: Draft = {
        draftId,
        appId: request.appId,
        version: request.version,
        icon: app.icon,
        displayName: app.name,
        systemOverrides: {},
        appEnv: defaults.env,
        ports: defaults.defaults.ports,
        composeOverride,
        auth: defaults.auth,
        consumes: defaults.consumes,
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
        appEnv: defaults.env,
        defaults: defaults.defaults,
      };

      this.logger.info('Draft created successfully', { draftId, appId: request.appId });
      return response;
    } catch (error) {
      this.logger.error('Failed to create draft', error as Error, { draftId, appId: request.appId });
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

    // Apply patch (preserve file metadata managed by upload/delete).
    record.draft = { ...record.draft, ...patch };
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
        throw new Error(`Draft validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
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
      const manifest = { ...canonicalSpec, icon: draft.icon, displayName: draft.displayName, checksum, finalizedAt };
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

  async getDraftDefaults(appId: string, version?: string): Promise<{ env: AppEnvVar[]; defaults: DraftDefaults; composeOverride: string; auth?: AppAuthConfig; consumes?: string[] }> {
    try {
      const versionDetail = await this.catalogService.getVersionDetail(appId, version || 'latest');
      return {
        env: versionDetail.defaultEnv,
        defaults: versionDetail.defaults,
        composeOverride: versionDetail.composeOverride ?? '',
        auth: versionDetail.auth,
        consumes: versionDetail.consumes,
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
    const draft: Draft = {
      draftId,
      appId: request.appId,
      version: request.version,
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
      app: { id: request.appId, name: draft.displayName ?? 'Mock App', icon: draft.icon ?? '📦' },
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
