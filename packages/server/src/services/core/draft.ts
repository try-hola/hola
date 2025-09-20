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
  DraftDefaults
} from '@hola/shared';

import { getLogger } from '../../lib/logger';
import type { HealthCheckable, ServiceHealth } from './types';
import type { StorageService } from './storage';
import type { CatalogService } from './catalog';

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
  
  // Internal helpers
  getDraftDefaults(appId: string, version?: string): Promise<{ env: AppEnvVar[]; defaults: DraftDefaults }>;
}

export class RealDraftService implements DraftService {
  private logger = getLogger().child({ service: 'DraftService' });
  private drafts = new Map<string, Draft>();
  private draftFiles = new Map<string, Map<string, DraftFile & { content?: Buffer }>>();

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

  async createDraft(request: CreateDraftRequest): Promise<CreateDraftResponse> {
    const draftId = crypto.randomUUID();
    this.logger.info('Creating draft', { draftId, appId: request.appId, version: request.version });

    try {
      // Get app info from catalog
      const app = await this.catalogService.getApp(request.appId);
      
      // Get default environment and configuration
      const defaults = await this.getDraftDefaults(request.appId, request.version);
      
      // Create initial draft
      const draft: Draft = {
        draftId,
        appId: request.appId,
        version: request.version,
        systemOverrides: {},
        appEnv: defaults.env,
        ports: defaults.defaults.ports,
        composeOverride: '',
        files: [],
      };

      // Store draft
      this.drafts.set(draftId, draft);
      this.draftFiles.set(draftId, new Map());

      // Ensure storage directory exists
      await this.storageService.ensureDir(`drafts/${draftId}`);

      const response: CreateDraftResponse = {
        draftId,
        app: {
          id: app.id,
          name: app.name,
          icon: app.icon,
        },
        systemEnv: [
          { key: 'DOMAIN', value: 'localhost', isSecret: false, description: 'Base domain' },
          { key: 'SMTP_PASSWORD', value: '', isSecret: true, description: 'SMTP password' },
        ],
        appEnv: defaults.env,
        defaults: defaults.defaults,
      };

      this.logger.info('Draft created successfully', { draftId, appId: request.appId });
      return response;
    } catch (error) {
      this.logger.error('Failed to create draft', error as Error, { draftId, request });
      throw error;
    }
  }

  async getDraft(draftId: string): Promise<GetDraftResponse> {
    const draft = this.drafts.get(draftId);
    if (!draft) {
      throw new Error(`Draft not found: ${draftId}`);
    }

    const files = Array.from(this.draftFiles.get(draftId)?.values() || []).map(file => ({
      uploadId: file.uploadId,
      name: file.name,
      size: file.size,
      kind: file.kind,
    }));

    return {
      ...draft,
      files,
    };
  }

  async updateDraft(draftId: string, patch: PatchDraftRequest): Promise<PatchDraftResponse> {
    const draft = this.drafts.get(draftId);
    if (!draft) {
      throw new Error(`Draft not found: ${draftId}`);
    }

    this.logger.info('Updating draft', { draftId, patch });

    // Apply patch
    const updatedDraft: Draft = {
      ...draft,
      ...patch,
    };

    this.drafts.set(draftId, updatedDraft);

    // Persist to storage
    await this.storageService.writeFile(
      `drafts/${draftId}/draft.json`,
      JSON.stringify(updatedDraft, null, 2)
    );

    const files = Array.from(this.draftFiles.get(draftId)?.values() || []).map(file => ({
      uploadId: file.uploadId,
      name: file.name,
      size: file.size,
      kind: file.kind,
    }));

    return {
      ok: true,
      draft: {
        ...updatedDraft,
        files,
      },
    };
  }

  async deleteDraft(draftId: string): Promise<void> {
    const draft = this.drafts.get(draftId);
    if (!draft) {
      throw new Error(`Draft not found: ${draftId}`);
    }

    this.logger.info('Deleting draft', { draftId });

    // Remove from memory
    this.drafts.delete(draftId);
    this.draftFiles.delete(draftId);

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
    const draft = this.drafts.get(draftId);
    if (!draft) {
      throw new Error(`Draft not found: ${draftId}`);
    }

    const uploadId = crypto.randomUUID();
    this.logger.info('Uploading file to draft', { draftId, uploadId, fileName: file.name, kind: file.kind, size: file.content.length });

    // Create file record
    const draftFile: DraftFile & { content: Buffer } = {
      uploadId,
      name: file.name,
      size: file.content.length,
      kind: file.kind,
      path: file.path,
      content: file.content,
    };

    // Store in memory
    let files = this.draftFiles.get(draftId);
    if (!files) {
      files = new Map();
      this.draftFiles.set(draftId, files);
    }
    files.set(uploadId, draftFile);

    // Store to disk
    const filePath = `drafts/${draftId}/files/${uploadId}-${file.name}`;
    await this.storageService.writeFile(filePath, file.content);

    return {
      uploadId,
      name: file.name,
      size: file.content.length,
      kind: file.kind,
    };
  }

  async deleteFile(draftId: string, uploadId: string): Promise<DeleteDraftFileResponse> {
    const draft = this.drafts.get(draftId);
    if (!draft) {
      throw new Error(`Draft not found: ${draftId}`);
    }

    const files = this.draftFiles.get(draftId);
    const file = files?.get(uploadId);
    if (!file) {
      throw new Error(`File not found: ${uploadId}`);
    }

    this.logger.info('Deleting file from draft', { draftId, uploadId, fileName: file.name });

    // Remove from memory
    files?.delete(uploadId);

    // Remove from storage
    try {
      const filePath = `drafts/${draftId}/files/${uploadId}-${file.name}`;
      await this.storageService.deleteFile(filePath);
    } catch (error) {
      this.logger.warn('Failed to delete file from storage', { draftId, uploadId, error: error instanceof Error ? error.message : String(error) });
    }

    return { ok: true };
  }

  async validateDraft(draftId: string): Promise<ValidateDraftResponse> {
    const draft = this.drafts.get(draftId);
    if (!draft) {
      throw new Error(`Draft not found: ${draftId}`);
    }

    this.logger.info('Validating draft', { draftId });

    try {
      // Use validation service for comprehensive checks
      const report = await this.validationService.validateDraft(draft, this.draftFiles.get(draftId));

      return {
        ok: report.ok,
        errors: report.errors,
        warnings: report.warnings,
      };
    } catch (error) {
      this.logger.error('Draft validation failed', error as Error, { draftId });
      return {
        ok: false,
        errors: [{ message: error instanceof Error ? error.message : 'Validation failed' }],
        warnings: [],
      };
    }
  }

  async preflightCheck(draftId: string): Promise<EnhancedPreflightResponse> {
    const draft = this.drafts.get(draftId);
    if (!draft) {
      throw new Error(`Draft not found: ${draftId}`);
    }

    this.logger.info('Running preflight check', { draftId });

    try {
      // Use validation service for preflight checks
      return await this.validationService.preflightCheck(draft, this.draftFiles.get(draftId));
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
    const draft = this.drafts.get(draftId);
    if (!draft) {
      throw new Error(`Draft not found: ${draftId}`);
    }

    this.logger.info('Finalizing draft', { draftId });

    try {
      // First validate the draft
      const validation = await this.validateDraft(draftId);
      if (!validation.ok) {
        throw new Error(`Draft validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
      }

      // Generate deployment spec
      const files = this.draftFiles.get(draftId);
      const spec = {
        draftId,
        appId: draft.appId,
        version: draft.version,
        systemOverrides: draft.systemOverrides,
        appEnv: draft.appEnv,
        ports: draft.ports,
        composeOverride: draft.composeOverride,
        files: Array.from(files?.values() || []).map(f => ({
          uploadId: f.uploadId,
          name: f.name,
          kind: f.kind,
          path: f.path,
        })),
        finalizedAt: new Date().toISOString(),
      };

      // Generate checksum
      const checksum = await this.generateChecksum(spec);

      // Store finalized spec
      await this.storageService.writeFile(
        `drafts/${draftId}/finalized.json`,
        JSON.stringify(spec, null, 2)
      );

      this.logger.info('Draft finalized successfully', { draftId, checksum });

      return {
        spec,
        checksum,
      };
    } catch (error) {
      this.logger.error('Failed to finalize draft', error as Error, { draftId });
      throw error;
    }
  }

  async getDraftDefaults(appId: string, version?: string): Promise<{ env: AppEnvVar[]; defaults: DraftDefaults }> {
    try {
      const versionDetail = await this.catalogService.getVersionDetail(appId, version || 'latest');
      return {
        env: versionDetail.defaultEnv,
        defaults: versionDetail.defaults,
      };
    } catch (error) {
      this.logger.warn('Failed to get app defaults, using fallback', { appId, version, error: error instanceof Error ? error.message : String(error) });
      
      // Fallback defaults
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

  private async generateChecksum(spec: unknown): Promise<string> {
    const content = JSON.stringify(spec);
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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
      app: { id: request.appId, name: 'Mock App', icon: '📦' },
      systemEnv: [
        { key: 'DOMAIN', value: 'localhost', isSecret: false, description: 'Base domain' },
        { key: 'SMTP_PASSWORD', value: '', isSecret: true, description: 'SMTP password' },
      ],
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
        { field: 'ports', message: 'Port 8080 may conflict with other services' },
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
