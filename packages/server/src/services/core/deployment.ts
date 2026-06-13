/**
 * Deployment Service - Phase 7
 *
 * Manages the full deployment lifecycle including creation from drafts,
 * release management, and deployment actions (start/stop/restart/delete/rollback).
 *
 * Both the real and mock implementations share a single in-memory store and the
 * same pure helpers so that every deployment API route observes consistent state:
 * a deployment created through `createFromDraft` is always visible to
 * `listDeployments`/`getDeployment`, and unknown deployments fail uniformly with
 * a typed `NotFoundError`. The real service additionally persists records to
 * storage; the mock keeps everything in memory for fast, deterministic tests.
 */

import type {
  CreateDeploymentFromDraftRequest,
  CreateDeploymentFromDraftResponse,
  EnhancedDeploymentDetail,
  GetDeploymentsRequest,
  GetDeploymentsResponse,
  GetDeploymentResponse,
  PatchDeploymentRequest,
  PatchDeploymentResponse,
  GetDeploymentHistoryResponse,
  PostDeploymentActionRequest,
  PostDeploymentActionResponse,
  RollbackRequest,
  RollbackResponse,
  Release,
  DeploymentLifecycleState,
  DeploymentAction,
  DeploymentDirectoryLayout,
  Job,
  DeploymentListItem
} from '@hola/shared';

import { getLogger } from '../../lib/logger';
import { NotFoundError, ConflictError } from '../../middleware/error-mapping';
import type { HealthCheckable, ServiceHealth } from './types';
import type { StorageService } from './storage';
import type { JobService } from './jobs';
import type { DockerService } from './docker';
import type { DraftService, FinalizedArtifacts } from './draft';

/** Promote a new release built from a finalized draft onto an existing deployment. */
export interface PromoteRequest {
  draftId: string;
  reason?: string;
  options?: { autoStart?: boolean };
}

export interface DeploymentService extends HealthCheckable {
  // Deployment lifecycle
  createFromDraft(request: CreateDeploymentFromDraftRequest): Promise<CreateDeploymentFromDraftResponse>;
  /** Stage a new release from a finalized draft onto an existing deployment and activate it. */
  promote(deploymentId: string, request: PromoteRequest): Promise<CreateDeploymentFromDraftResponse>;

  // Deployment management
  listDeployments(request: GetDeploymentsRequest): Promise<GetDeploymentsResponse>;
  getDeployment(deploymentId: string): Promise<GetDeploymentResponse>;
  updateDeployment(deploymentId: string, request: PatchDeploymentRequest): Promise<PatchDeploymentResponse>;
  deleteDeployment(deploymentId: string): Promise<void>;

  // Deployment actions
  executeAction(deploymentId: string, request: PostDeploymentActionRequest): Promise<PostDeploymentActionResponse>;
  rollback(deploymentId: string, request: RollbackRequest): Promise<RollbackResponse>;

  // History and releases
  getDeploymentHistory(deploymentId: string, options?: { page?: number; limit?: number }): Promise<GetDeploymentHistoryResponse>;
  getReleases(deploymentId: string): Promise<Release[]>;
  getRelease(deploymentId: string, releaseId: string): Promise<Release>;

  // Internal management
  getDirectoryLayout(deploymentId: string): Promise<DeploymentDirectoryLayout>;
  updateLifecycleState(deploymentId: string, state: DeploymentLifecycleState): Promise<void>;
}

// ---------------------------------------------------------------------------
// Shared pure helpers (no I/O) used by both the real and mock services.
// ---------------------------------------------------------------------------

/** Project a stored deployment record onto the list-item shape. */
function toListItem(d: EnhancedDeploymentDetail): DeploymentListItem {
  return {
    id: d.id,
    name: d.name,
    app: d.app,
    icon: d.icon,
    status: d.status,
    uptime: d.uptime,
    version: d.version,
    resources: d.resources,
    ports: d.ports,
    lastUpdated: d.lastUpdated,
    url: d.url,
  };
}

/** Project a stored deployment record onto the detail-response shape. */
function toDetailResponse(d: EnhancedDeploymentDetail): GetDeploymentResponse {
  return {
    id: d.id,
    name: d.name,
    app: d.app,
    icon: d.icon,
    status: d.status,
    uptime: d.uptime,
    version: d.version,
    url: d.url,
    resources: d.resources,
    ports: d.ports,
    lastUpdated: d.lastUpdated,
  };
}

/** Filter + paginate stored deployments into a list response. */
function filterAndPaginateDeployments(
  all: EnhancedDeploymentDetail[],
  request: GetDeploymentsRequest
): GetDeploymentsResponse {
  let filtered = all;

  if (request.status && request.status !== 'all') {
    filtered = filtered.filter(d => d.status === request.status);
  }

  if (request.q) {
    const query = request.q.toLowerCase();
    filtered = filtered.filter(d =>
      d.name.toLowerCase().includes(query) ||
      d.app.toLowerCase().includes(query)
    );
  }

  const page = request.page || 1;
  const limit = request.limit || 12;
  const startIndex = (page - 1) * limit;
  const items = filtered.slice(startIndex, startIndex + limit).map(toListItem);

  return { items, page, limit, total: filtered.length };
}

/** Paginate deployment jobs into a history response. */
function paginateHistory(
  jobs: Job[],
  options?: { page?: number; limit?: number }
): GetDeploymentHistoryResponse {
  const page = options?.page || 1;
  const limit = options?.limit || 10;
  const startIndex = (page - 1) * limit;
  const items = jobs.slice(startIndex, startIndex + limit).map(job => ({
    id: job.id,
    type: job.type,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  }));

  return { items, page, limit, total: jobs.length };
}

/** Apply a lifecycle action's effect to the in-memory deployment record. */
function applyActionStatus(deployment: EnhancedDeploymentDetail, action: DeploymentAction): void {
  switch (action) {
    case 'start':
    case 'restart':
      deployment.status = 'installing';
      deployment.lifecycleState = 'releasing';
      break;
    case 'stop':
    case 'delete':
      deployment.status = 'stopped';
      deployment.lifecycleState = 'stopped';
      break;
  }
  deployment.lastUpdated = new Date().toISOString();
}

/** Map a deployment action to the job type that performs it. */
function mapActionToJobType(action: DeploymentAction): Job['type'] {
  switch (action) {
    case 'start':
    case 'restart':
    case 'rollback':
      return 'start';
    case 'stop':
      return 'stop';
    case 'delete':
      return 'backup'; // Create backup before delete
    default:
      return 'start';
  }
}

// ---------------------------------------------------------------------------
// Shared in-memory base implementation.
// ---------------------------------------------------------------------------

/**
 * In-memory deployment service shared by the real and mock implementations.
 *
 * Subclasses provide persistence hooks (no-ops by default) and a health check.
 * All authoritative state lives in the `deployments` and `releases` maps so that
 * every route reads and writes the same source of truth.
 */
abstract class InMemoryDeploymentService implements DeploymentService {
  protected logger = getLogger().child({ service: 'DeploymentService' });
  protected deployments = new Map<string, EnhancedDeploymentDetail>();
  protected releases = new Map<string, Release>();
  /** One-time rehydration guard so persisted state loads at most once. */
  private loadPromise: Promise<void> | null = null;

  constructor(protected jobService: JobService) {}

  abstract healthCheck(): Promise<ServiceHealth>;

  // --- persistence hooks (no-ops here; overridden by the real service) ---
  protected async ensureLayout(deploymentId: string): Promise<void> {
    void deploymentId;
  }
  protected async persistDeployment(deployment: EnhancedDeploymentDetail): Promise<void> {
    void deployment;
  }
  protected async persistRelease(release: Release): Promise<void> {
    void release;
  }
  protected async removeStorage(deploymentId: string): Promise<void> {
    void deploymentId;
  }

  /** Rehydrate persisted deployments/releases from storage exactly once. */
  protected async ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadFromStorage();
    }
    return this.loadPromise;
  }

  /** Default: nothing to load (mock keeps its constructor seed). */
  protected async loadFromStorage(): Promise<void> {}

  /**
   * Build the release (and resolved app/version) for a deployment from a draft.
   * Default is a synthetic in-memory release; the real service overrides this to
   * build from the finalized artifacts produced by DraftService (#11).
   */
  protected async buildReleaseFromDraft(
    artifacts: FinalizedArtifacts | null,
    request: { draftId?: string },
    deploymentId: string,
    releaseId: string
  ): Promise<{ app: string; version?: string; release: Release }> {
    void artifacts;
    const now = new Date().toISOString();
    return {
      app: 'Unknown App',
      version: undefined,
      release: {
        id: releaseId,
        deploymentId,
        draftId: request.draftId ?? '',
        status: 'creating',
        createdAt: now,
        images: [],
        ports: [],
        filesChecksums: {},
      },
    };
  }

  /** Copy immutable release artifacts to durable storage. Default no-op (mock). */
  protected async stageReleaseArtifacts(
    artifacts: FinalizedArtifacts | null,
    deploymentId: string,
    release: Release
  ): Promise<void> {
    void artifacts;
    void deploymentId;
    void release;
  }

  /** Atomically record the active-release pointer. Default no-op (mock). */
  protected async writeCurrentPointer(deploymentId: string, releaseId: string): Promise<void> {
    void deploymentId;
    void releaseId;
  }

  /** Routing-activation seam for Traefik config (issue #16). Default no-op. */
  protected async onActiveReleaseChanged(deploymentId: string, releaseId: string): Promise<void> {
    void deploymentId;
    void releaseId;
  }

  /** Load the finalized artifacts for a draft. Default null (mock has no draft store). */
  protected async loadFinalizedArtifacts(draftId: string): Promise<FinalizedArtifacts | null> {
    void draftId;
    return null;
  }

  /** Look up a deployment or throw a typed 404. */
  protected requireDeployment(deploymentId: string): EnhancedDeploymentDetail {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new NotFoundError(`Deployment not found: ${deploymentId}`);
    }
    return deployment;
  }

  private countReleases(deploymentId: string): number {
    let n = 0;
    for (const r of this.releases.values()) {
      if (r.deploymentId === deploymentId) n++;
    }
    return n;
  }

  /**
   * Atomically make `releaseId` the active release of a deployment: demote the
   * previously-active release, activate the target, update the deployment's
   * release pointers, and write the durable `current` pointer last. A failure
   * before the pointer write leaves the previous active release intact.
   */
  protected async promoteRelease(deploymentId: string, releaseId: string): Promise<void> {
    const deployment = this.requireDeployment(deploymentId);
    const release = this.releases.get(releaseId);
    if (!release || release.deploymentId !== deploymentId) {
      throw new NotFoundError(`Release not found: ${releaseId}`);
    }

    const now = new Date().toISOString();
    const previousReleaseId = deployment.currentReleaseId;

    // Demote the previously-active release.
    if (previousReleaseId && previousReleaseId !== releaseId) {
      const prev = this.releases.get(previousReleaseId);
      if (prev) {
        prev.status = 'stopped';
        this.releases.set(prev.id, prev);
        await this.persistRelease(prev);
      }
    }

    // Activate the target release.
    release.status = 'active';
    release.deployedAt = now;
    this.releases.set(releaseId, release);
    await this.persistRelease(release);

    // Update deployment pointers.
    if (previousReleaseId !== releaseId) {
      deployment.previousReleaseId = previousReleaseId;
    }
    deployment.currentReleaseId = releaseId;
    deployment.rollbackAvailable = this.countReleases(deploymentId) > 1;
    deployment.lastUpdated = now;
    this.deployments.set(deploymentId, deployment);
    await this.persistDeployment(deployment);

    // Durable active-release switch (authoritative on rehydration), then routing.
    await this.writeCurrentPointer(deploymentId, releaseId);
    await this.onActiveReleaseChanged(deploymentId, releaseId);
  }

  async createFromDraft(request: CreateDeploymentFromDraftRequest): Promise<CreateDeploymentFromDraftResponse> {
    await this.ensureLoaded();
    const deploymentId = crypto.randomUUID();
    const releaseId = crypto.randomUUID();
    const now = new Date().toISOString();

    this.logger.info('Creating deployment from draft', {
      deploymentId,
      releaseId,
      draftId: request.draftId,
      name: request.name,
    });

    try {
      // Build the release from the finalized draft FIRST so an unfinalized draft
      // fails before any deployment directory or record is created (no partial state).
      const artifacts = await this.loadFinalizedArtifacts(request.draftId);
      const { app, version, release } = await this.buildReleaseFromDraft(artifacts, request, deploymentId, releaseId);

      await this.ensureLayout(deploymentId);

      const deployment: EnhancedDeploymentDetail = {
        id: deploymentId,
        name: request.name || `deployment-${deploymentId.slice(0, 8)}`,
        app,
        icon: '📦',
        status: 'installing',
        lifecycleState: 'releasing',
        draftId: request.draftId,
        rollbackAvailable: false,
        resources: { cpu: '0%', memory: '0MB' },
        ports: [],
        version,
        lastUpdated: now,
        metadata: {
          createdAt: now,
          owner: 'system',
          tags: [],
        },
      };
      this.deployments.set(deploymentId, deployment);
      this.releases.set(releaseId, release);

      await this.stageReleaseArtifacts(artifacts, deploymentId, release);
      await this.persistRelease(release);
      await this.persistDeployment(deployment);

      // Atomically activate the first release.
      await this.promoteRelease(deploymentId, releaseId);

      const jobId = await this.maybeStartJob(deploymentId, releaseId, request.options?.autoStart);

      return { deploymentId, releaseId, jobId };
    } catch (error) {
      this.logger.error('Failed to create deployment from draft', error as Error, {
        deploymentId,
        draftId: request.draftId,
      });
      throw error;
    }
  }

  async promote(deploymentId: string, request: PromoteRequest): Promise<CreateDeploymentFromDraftResponse> {
    await this.ensureLoaded();
    this.requireDeployment(deploymentId);
    const releaseId = crypto.randomUUID();

    this.logger.info('Promoting new release onto deployment', { deploymentId, releaseId, draftId: request.draftId });

    const artifacts = await this.loadFinalizedArtifacts(request.draftId);
    const { release } = await this.buildReleaseFromDraft(artifacts, request, deploymentId, releaseId);
    this.releases.set(releaseId, release);

    await this.ensureLayout(deploymentId);
    await this.stageReleaseArtifacts(artifacts, deploymentId, release);
    await this.persistRelease(release);

    // Atomically switch the active release to the new one.
    await this.promoteRelease(deploymentId, releaseId);

    const jobId = await this.maybeStartJob(deploymentId, releaseId, request.options?.autoStart);

    return { deploymentId, releaseId, jobId };
  }

  /** Create a start job for a (re)deployment unless autoStart was disabled. */
  private async maybeStartJob(deploymentId: string, releaseId: string, autoStart?: boolean): Promise<string | undefined> {
    if (autoStart === false) {
      return undefined;
    }
    const job = await this.jobService.createJob({
      type: 'start',
      deploymentId,
      payload: { releaseId, action: 'deploy' },
    });
    this.logger.info('Deployment job created', { deploymentId, releaseId, jobId: job.id });
    return job.id;
  }

  async listDeployments(request: GetDeploymentsRequest): Promise<GetDeploymentsResponse> {
    await this.ensureLoaded();
    this.logger.info('Listing deployments', { request });
    return filterAndPaginateDeployments(Array.from(this.deployments.values()), request);
  }

  async getDeployment(deploymentId: string): Promise<GetDeploymentResponse> {
    await this.ensureLoaded();
    this.logger.info('Getting deployment', { deploymentId });
    return toDetailResponse(this.requireDeployment(deploymentId));
  }

  async updateDeployment(deploymentId: string, request: PatchDeploymentRequest): Promise<PatchDeploymentResponse> {
    await this.ensureLoaded();
    const deployment = this.requireDeployment(deploymentId);

    this.logger.info('Updating deployment', { deploymentId, request });

    if (request.env) {
      // In a real implementation, this would trigger a new release
      this.logger.info('Environment variables updated', { deploymentId, envCount: request.env.length });
    }

    if (request.systemOverrides) {
      this.logger.info('System overrides updated', { deploymentId, overrides: request.systemOverrides });
    }

    deployment.lastUpdated = new Date().toISOString();
    this.deployments.set(deploymentId, deployment);
    await this.persistDeployment(deployment);

    return { ok: true };
  }

  async deleteDeployment(deploymentId: string): Promise<void> {
    await this.ensureLoaded();
    this.requireDeployment(deploymentId);

    this.logger.info('Deleting deployment', { deploymentId });

    try {
      // Stop any running containers first
      await this.executeAction(deploymentId, { action: 'stop' });
    } catch (error) {
      this.logger.warn('Failed to stop deployment before deletion', {
        deploymentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    this.deployments.delete(deploymentId);

    for (const [releaseId, release] of this.releases.entries()) {
      if (release.deploymentId === deploymentId) {
        this.releases.delete(releaseId);
      }
    }

    try {
      await this.removeStorage(deploymentId);
    } catch (error) {
      this.logger.warn('Failed to delete deployment storage', {
        deploymentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async executeAction(deploymentId: string, request: PostDeploymentActionRequest): Promise<PostDeploymentActionResponse> {
    await this.ensureLoaded();
    const deployment = this.requireDeployment(deploymentId);

    this.logger.info('Executing deployment action', { deploymentId, action: request.action });

    try {
      const job = await this.jobService.createJob({
        type: mapActionToJobType(request.action),
        deploymentId,
        payload: { action: request.action },
      });

      applyActionStatus(deployment, request.action);
      this.deployments.set(deploymentId, deployment);
      await this.persistDeployment(deployment);

      return { ok: true, jobId: job.id };
    } catch (error) {
      this.logger.error('Failed to execute deployment action', error as Error, { deploymentId, action: request.action });
      throw error;
    }
  }

  async rollback(deploymentId: string, request: RollbackRequest): Promise<RollbackResponse> {
    await this.ensureLoaded();
    const deployment = this.requireDeployment(deploymentId);

    this.logger.info('Rolling back deployment', { deploymentId, targetReleaseId: request.targetReleaseId });

    let targetReleaseId = request.targetReleaseId;
    if (!targetReleaseId) {
      // Default to the most recent release other than the one currently active.
      const candidates = Array.from(this.releases.values())
        .filter(r => r.deploymentId === deploymentId && r.id !== deployment.currentReleaseId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      if (candidates.length === 0) {
        throw new ConflictError('No previous release available for rollback');
      }

      targetReleaseId = candidates[0].id;
    }

    const targetRelease = this.releases.get(targetReleaseId);
    if (!targetRelease || targetRelease.deploymentId !== deploymentId) {
      throw new NotFoundError(`Target release not found: ${targetReleaseId}`);
    }

    const previousReleaseId = deployment.currentReleaseId || '';

    const job = await this.jobService.createJob({
      type: 'start',
      deploymentId,
      payload: {
        action: 'rollback',
        targetReleaseId,
        reason: request.reason,
      },
    });

    // Atomically activate the target release (switches the durable current pointer).
    await this.promoteRelease(deploymentId, targetReleaseId);

    deployment.status = 'installing';
    deployment.lifecycleState = 'releasing';
    deployment.lastUpdated = new Date().toISOString();
    this.deployments.set(deploymentId, deployment);
    await this.persistDeployment(deployment);

    return {
      jobId: job.id,
      targetReleaseId,
      previousReleaseId,
    };
  }

  async getDeploymentHistory(
    deploymentId: string,
    options?: { page?: number; limit?: number }
  ): Promise<GetDeploymentHistoryResponse> {
    await this.ensureLoaded();
    this.logger.info('Getting deployment history', { deploymentId, options });
    this.requireDeployment(deploymentId); // 404 for unknown deployments, consistent with other routes
    const jobs = await this.jobService.listJobs({ deploymentId });
    return paginateHistory(jobs, options);
  }

  async getReleases(deploymentId: string): Promise<Release[]> {
    await this.ensureLoaded();
    return Array.from(this.releases.values())
      .filter(r => r.deploymentId === deploymentId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getRelease(deploymentId: string, releaseId: string): Promise<Release> {
    await this.ensureLoaded();
    const release = this.releases.get(releaseId);
    if (!release || release.deploymentId !== deploymentId) {
      throw new NotFoundError(`Release not found: ${releaseId}`);
    }
    return release;
  }

  async getDirectoryLayout(deploymentId: string): Promise<DeploymentDirectoryLayout> {
    const deploymentPath = `deployments/${deploymentId}`;
    return {
      deploymentPath,
      draftsPath: `${deploymentPath}/drafts`,
      releasesPath: `${deploymentPath}/releases`,
      currentReleasePath: `${deploymentPath}/current`,
      logsPath: `${deploymentPath}/logs`,
      backupsPath: `${deploymentPath}/backups`,
    };
  }

  async updateLifecycleState(deploymentId: string, state: DeploymentLifecycleState): Promise<void> {
    const deployment = this.requireDeployment(deploymentId);
    deployment.lifecycleState = state;
    deployment.lastUpdated = new Date().toISOString();
    this.deployments.set(deploymentId, deployment);
    await this.persistDeployment(deployment);
  }
}

// ---------------------------------------------------------------------------
// Real service: in-memory store backed by storage persistence.
// ---------------------------------------------------------------------------

export class RealDeploymentService extends InMemoryDeploymentService {
  constructor(
    private storageService: StorageService,
    jobService: JobService,
    // Reserved for orchestration wiring (issue #15); not yet used directly here.
    private dockerService: DockerService,
    private draftService: DraftService
  ) {
    super(jobService);
    void this.dockerService;
  }

  async healthCheck(): Promise<ServiceHealth> {
    try {
      // Check if we can access storage and create deployment directory
      await this.storageService.ensureDir('deployments');
      return { healthy: true, lastCheck: new Date() };
    } catch (error) {
      return {
        healthy: false,
        lastCheck: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /** Rehydrate deployments, releases, and the active-release pointer from storage. */
  protected override async loadFromStorage(): Promise<void> {
    if (!(await this.storageService.fileExists('deployments'))) {
      return;
    }

    let ids: string[];
    try {
      ids = await this.storageService.listDir('deployments');
    } catch {
      return;
    }

    for (const deploymentId of ids) {
      const metaPath = `deployments/${deploymentId}/metadata.json`;
      if (!(await this.storageService.fileExists(metaPath))) {
        continue;
      }
      try {
        const deployment = JSON.parse(await this.storageService.readFileAsString(metaPath)) as EnhancedDeploymentDetail;

        // Load every release for this deployment.
        const releasesDir = `deployments/${deploymentId}/releases`;
        if (await this.storageService.fileExists(releasesDir)) {
          for (const releaseId of await this.storageService.listDir(releasesDir)) {
            const relPath = `${releasesDir}/${releaseId}/metadata.json`;
            if (await this.storageService.fileExists(relPath)) {
              const release = JSON.parse(await this.storageService.readFileAsString(relPath)) as Release;
              this.releases.set(release.id, release);
            }
          }
        }

        // The `current` pointer is authoritative for the active release.
        const pointerPath = `deployments/${deploymentId}/current`;
        if (await this.storageService.fileExists(pointerPath)) {
          deployment.currentReleaseId = (await this.storageService.readFileAsString(pointerPath)).trim();
        }

        this.deployments.set(deploymentId, deployment);
      } catch (error) {
        this.logger.warn('Failed to rehydrate deployment; skipping', {
          deploymentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.info('Rehydrated deployments from storage', { count: this.deployments.size });
  }

  protected override async loadFinalizedArtifacts(draftId: string): Promise<FinalizedArtifacts | null> {
    // Throws ConflictError if the draft was never finalized.
    return this.draftService.getFinalizedArtifacts(draftId);
  }

  protected override async buildReleaseFromDraft(
    artifacts: FinalizedArtifacts | null,
    request: { draftId?: string },
    deploymentId: string,
    releaseId: string
  ): Promise<{ app: string; version?: string; release: Release }> {
    const now = new Date().toISOString();
    const manifest = artifacts?.manifest;

    const filesChecksums: Record<string, string> = {};
    for (const f of manifest?.files ?? []) {
      filesChecksums[f.path || f.name] = f.sha256;
    }

    const release: Release = {
      id: releaseId,
      deploymentId,
      draftId: request.draftId ?? manifest?.draftId ?? '',
      status: 'creating',
      createdAt: now,
      images: [],
      ports: (manifest?.ports ?? []).map(p => ({ host: p.host, container: p.container, protocol: p.protocol })),
      filesChecksums,
      metadata: manifest ? { checksum: manifest.checksum } : undefined,
    };

    return {
      app: manifest?.appId ?? 'Unknown App',
      version: manifest?.version,
      release,
    };
  }

  protected override async ensureLayout(deploymentId: string): Promise<void> {
    const layout = await this.getDirectoryLayout(deploymentId);
    await this.storageService.ensureDir(layout.deploymentPath);
    await this.storageService.ensureDir(layout.draftsPath);
    await this.storageService.ensureDir(layout.releasesPath);
    await this.storageService.ensureDir(layout.logsPath);
  }

  /** Copy the finalized artifacts into the immutable release directory. */
  protected override async stageReleaseArtifacts(
    artifacts: FinalizedArtifacts | null,
    deploymentId: string,
    release: Release
  ): Promise<void> {
    if (!artifacts) {
      return;
    }
    const releaseDir = `deployments/${deploymentId}/releases/${release.id}`;
    if (artifacts.composeOverride) {
      await this.storageService.writeFile(`${releaseDir}/compose-override.yml`, artifacts.composeOverride);
    }
    for (const file of artifacts.files) {
      await this.storageService.writeFile(`${releaseDir}/files/${file.uploadId}-${file.name}`, file.content);
    }
    // Persist the source manifest alongside the release for traceability.
    await this.storageService.writeFile(
      `${releaseDir}/manifest.json`,
      JSON.stringify(artifacts.manifest, null, 2)
    );
  }

  /** Atomically switch the active-release pointer (storage writes are temp+rename). */
  protected override async writeCurrentPointer(deploymentId: string, releaseId: string): Promise<void> {
    await this.storageService.writeFile(`deployments/${deploymentId}/current`, releaseId);
  }

  protected override async persistDeployment(deployment: EnhancedDeploymentDetail): Promise<void> {
    await this.storageService.writeFile(
      `deployments/${deployment.id}/metadata.json`,
      JSON.stringify(deployment, null, 2)
    );
  }

  protected override async persistRelease(release: Release): Promise<void> {
    await this.storageService.writeFile(
      `deployments/${release.deploymentId}/releases/${release.id}/metadata.json`,
      JSON.stringify(release, null, 2)
    );
  }

  protected override async removeStorage(deploymentId: string): Promise<void> {
    await this.storageService.deleteDir(`deployments/${deploymentId}`, true);
  }
}

// ---------------------------------------------------------------------------
// Mock service: purely in-memory, seeded with sample data for tests/dev UI.
// ---------------------------------------------------------------------------

export class MockDeploymentService extends InMemoryDeploymentService {
  constructor(jobService: JobService) {
    super(jobService);
    this.logger = getLogger().child({ service: 'MockDeploymentService' });
    this.seed();
  }

  async healthCheck(): Promise<ServiceHealth> {
    return { healthy: true, lastCheck: new Date() };
  }

  /** Seed a couple of sample deployments so list views are non-empty out of the box. */
  private seed(): void {
    const now = new Date().toISOString();
    const earlier = new Date(Date.now() - 3600000).toISOString();

    const samples: Array<{ deployment: EnhancedDeploymentDetail; release: Release }> = [
      {
        deployment: {
          id: 'seed-nextcloud',
          name: 'Nextcloud',
          app: 'nextcloud',
          icon: '☁️',
          status: 'running',
          uptime: '2d 4h',
          version: '1.0.0',
          url: 'http://localhost:8080',
          lifecycleState: 'active',
          currentReleaseId: 'seed-nextcloud-release',
          rollbackAvailable: false,
          resources: { cpu: '15%', memory: '256MB' },
          ports: ['8080:80'],
          lastUpdated: now,
          metadata: { createdAt: now, owner: 'system', tags: [] },
        },
        release: {
          id: 'seed-nextcloud-release',
          deploymentId: 'seed-nextcloud',
          draftId: 'seed-nextcloud-draft',
          status: 'active',
          createdAt: now,
          deployedAt: now,
          images: [{ name: 'nextcloud', tag: 'latest' }],
          ports: [{ host: 8080, container: 80, protocol: 'tcp' }],
          filesChecksums: {},
        },
      },
      {
        deployment: {
          id: 'seed-homeassistant',
          name: 'Home Assistant',
          app: 'homeassistant',
          icon: '🏠',
          status: 'stopped',
          lifecycleState: 'stopped',
          currentReleaseId: 'seed-homeassistant-release',
          rollbackAvailable: false,
          resources: { cpu: '0%', memory: '0MB' },
          ports: ['8123:8123'],
          lastUpdated: earlier,
          metadata: { createdAt: earlier, owner: 'system', tags: [] },
        },
        release: {
          id: 'seed-homeassistant-release',
          deploymentId: 'seed-homeassistant',
          draftId: 'seed-homeassistant-draft',
          status: 'active',
          createdAt: earlier,
          deployedAt: earlier,
          images: [{ name: 'homeassistant', tag: 'latest' }],
          ports: [{ host: 8123, container: 8123, protocol: 'tcp' }],
          filesChecksums: {},
        },
      },
    ];

    for (const { deployment, release } of samples) {
      this.deployments.set(deployment.id, deployment);
      this.releases.set(release.id, release);
    }
  }
}
