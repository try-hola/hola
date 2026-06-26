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
  DeploymentListItem,
  ProvisionedAuthRef,
  GetLogsResponse,
  LogEntry
} from '@hola/shared';

import { getLogger } from '../../lib/logger';
import { NotFoundError, ConflictError } from '../../middleware/error-mapping';
import type { HealthCheckable, ServiceHealth } from './types';
import type { StorageService } from './storage';
import type { JobService, JobContext } from './jobs';
import { JobCancelledError } from './jobs';
import type { DockerService } from './docker';
import type { DraftService, FinalizedArtifacts, FinalizedManifest } from './draft';
import type { RoutingService } from './routing';
import type { LoggingService } from './logging';
import type { ProvisionerService, ProvisionResult } from './provisioner';
import { APP_DATA_TOKEN, APP_HOST_TOKEN, BASE_DOMAIN_TOKEN } from '@hola/shared/compose-validate';
import { attachToHolaNetwork, injectEnvironment } from './compose-network';
import { applyPlatformDefaults } from './compose-defaults';
import { composeDefaultsConfig } from '../../config/compose-defaults';
import { APP_REGISTRY_CAPABILITY, REGISTRY_FILENAME, buildRegistry, type RegistryApp } from './app-registry';
import { APPS_DATA_CAPABILITY, injectReadonlyMount } from './compose-mounts';

/** Default host base for per-app data roots when HOLA_APPS_BIND_ROOT is unset. */
const DEFAULT_APPS_BIND_ROOT = '/srv/hola/apps';

/**
 * Build a human-readable, collision-safe deployment id: the app slug plus a
 * short random suffix (e.g. `gitea-3f9a2c7b`). Stable for the install's life
 * (reused across promote/rollback), so it keys the project name, routing, and
 * the per-app data root. The random suffix keeps two installs of the same app
 * distinct.
 */
function makeDeploymentId(appId: string): string {
  const slug = appId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  return `${slug}-${suffix}`;
}

type ProvisionCredentials = NonNullable<ProvisionResult['credentials']>;

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

  // Container logs (the app's real stdout, distinct from lifecycle/job logs)
  /** Recent container logs for the deployment's compose project (snapshot). */
  getDeploymentLogs(deploymentId: string, options?: { tail?: number }): Promise<GetLogsResponse>;
  /** Live container log stream; returns a stop handle. No-op when unsupported. */
  streamDeploymentLogs(deploymentId: string, callback: (entry: LogEntry) => void): Promise<{ stop: () => void }>;

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

  /** Validate routing (host) availability before creating a deployment. Default no-op. */
  protected async onBeforeCreate(deploymentId: string, app: string): Promise<void> {
    void deploymentId;
    void app;
  }

  /**
   * Preflight the app's declared auth requirement against the active auth backend
   * before any deployment state is created (RealDeploymentService overrides this
   * to consult the provisioner). Default no-op — the in-memory/mock service has no
   * real backend to gate against.
   */
  protected assertAuthProvisionable(auth: FinalizedManifest['auth'], appName: string): void {
    void auth;
    void appName;
  }

  /** Public URL the app is reachable at; the real service derives it from routing. */
  protected appUrl(deploymentId: string, app: string): string | undefined {
    void deploymentId;
    void app;
    return undefined;
  }

  /** Routing cleanup when a deployment is removed (issue #16). Default no-op. */
  protected async onDeploymentRemoved(deploymentId: string): Promise<void> {
    void deploymentId;
  }

  /**
   * Tear down provisioned auth artifacts when a deployment is deleted. Default
   * no-op (mock). Called with the live deployment record (so its metadata.auth
   * ref is available) before storage is removed.
   */
  protected async onDeprovision(deployment: EnhancedDeploymentDetail): Promise<void> {
    void deployment;
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
    const releaseId = crypto.randomUUID();
    const now = new Date().toISOString();
    let deploymentId = '';

    try {
      // Build the release from the finalized draft FIRST so an unfinalized draft
      // fails before any deployment directory or record is created (no partial state).
      const artifacts = await this.loadFinalizedArtifacts(request.draftId);
      // Mint a human-readable id from the app slug now that we know it.
      deploymentId = makeDeploymentId(artifacts?.manifest.appId ?? 'app');
      this.logger.info('Creating deployment from draft', {
        deploymentId,
        releaseId,
        draftId: request.draftId,
        name: request.name,
      });
      const { app, version, release } = await this.buildReleaseFromDraft(artifacts, request, deploymentId, releaseId);

      // Reject an app whose declared auth needs a backend the active provisioner
      // can't satisfy (e.g. forward-auth under HOLA_AUTH_MODE=none) BEFORE creating
      // any deployment state — the same check the deploy job's provisionAuth would
      // hit, but up front so the user gets the clear error instead of a tombstone.
      this.assertAuthProvisionable(artifacts?.manifest.auth, app);

      // Reject a routing (host) conflict before creating any deployment state.
      await this.onBeforeCreate(deploymentId, app);

      await this.ensureLayout(deploymentId);

      // Public URL the app is reachable at (Traefik routes <app>.<base-domain>);
      // the Real service derives it from routing, the mock leaves it unset.
      const url = this.appUrl(deploymentId, app);

      const deployment: EnhancedDeploymentDetail = {
        id: deploymentId,
        // Default to the catalog product name (e.g. "Uptime Kuma"), falling back
        // to the app slug — so the UI shows a readable app name without a live
        // catalog lookup, never an opaque "deployment-<id>". A caller-supplied
        // name wins.
        name: request.name || artifacts?.manifest.displayName || app,
        app,
        // Persist the catalog icon (emoji or image URL) carried through the
        // finalized manifest, so the launcher and registry feed have a stable
        // icon without a live catalog lookup. Falls back to a generic glyph.
        icon: artifacts?.manifest.icon || '📦',
        status: 'installing',
        lifecycleState: 'releasing',
        draftId: request.draftId,
        rollbackAvailable: false,
        resources: { cpu: '0%', memory: '0MB' },
        ports: [],
        version,
        url,
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
    const { app, release } = await this.buildReleaseFromDraft(artifacts, request, deploymentId, releaseId);

    // Reject an unsatisfiable auth requirement before staging the new release, so
    // a promote that switches to a backend-only mode (e.g. forward-auth under
    // HOLA_AUTH_MODE=none) fails up front instead of in the deploy job.
    this.assertAuthProvisionable(artifacts?.manifest.auth, app);

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
    // Capture the live record up front so its provisioned-auth ref is available
    // for teardown before in-memory/storage state is removed.
    const deployment = this.requireDeployment(deploymentId);

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

    // Tear down auth artifacts (OIDC client, etc.). Must never block deletion:
    // a failure leaves an orphan that is logged for manual cleanup.
    try {
      await this.onDeprovision(deployment);
    } catch (error) {
      this.logger.warn('Failed to deprovision auth artifacts; continuing with delete', {
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

    await this.onDeploymentRemoved(deploymentId);
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

  /**
   * Container-log snapshot. The base store has no Docker engine, so it returns
   * an honest empty snapshot; RealDeploymentService overrides this to read the
   * app's actual compose-project logs.
   */
  async getDeploymentLogs(deploymentId: string, options?: { tail?: number }): Promise<GetLogsResponse> {
    void deploymentId;
    void options;
    return { items: [] };
  }

  /** No-op container stream for the base store; RealDeploymentService overrides. */
  async streamDeploymentLogs(
    deploymentId: string,
    callback: (entry: LogEntry) => void
  ): Promise<{ stop: () => void }> {
    void deploymentId;
    void callback;
    return { stop: () => {} };
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
    private dockerService: DockerService,
    private draftService: DraftService,
    private routingService: RoutingService,
    private loggingService: LoggingService,
    private provisioner: ProvisionerService
  ) {
    super(jobService);
    // Perform real Compose lifecycle work when a deployment job runs.
    this.jobService.setExecutor(ctx => this.runLifecycleJob(ctx));
  }

  /** Post-deploy auth-setup retry tuning (overridable in tests to avoid real waits). */
  authSetupMaxAttempts = 18;
  authSetupIntervalMs = 5000;

  /** Public URL the app is reachable at (Traefik routes `<app>.<base-domain>`). */
  protected override appUrl(deploymentId: string, app: string): string {
    return `https://${this.routingService.generateRule({ deploymentId, appName: app }).host}`;
  }

  /** Deterministic Compose project name (aligns with the routing network name). */
  private projectName(deploymentId: string): string {
    return `hola-${deploymentId}`;
  }

  /** Absolute working directory that holds the materialized docker-compose.yml. */
  private runtimeDir(deploymentId: string): string {
    return this.storageService.resolveHolaPath('deployments', deploymentId, 'runtime');
  }

  /**
   * Real container logs for a deployment: read the compose project's recent
   * stdout across every service. Returns an empty snapshot for an unknown
   * deployment (never throws/fabricates); docker errors are absorbed by the
   * docker service.
   */
  override async getDeploymentLogs(
    deploymentId: string,
    options?: { tail?: number }
  ): Promise<GetLogsResponse> {
    await this.ensureLoaded();
    if (!this.deployments.has(deploymentId)) return { items: [] };
    const { entries } = await this.dockerService.composeLogs(
      this.runtimeDir(deploymentId),
      this.projectName(deploymentId),
      options
    );
    return { items: entries };
  }

  /** Live stream of the deployment's compose-project container stdout. */
  override async streamDeploymentLogs(
    deploymentId: string,
    callback: (entry: LogEntry) => void
  ): Promise<{ stop: () => void }> {
    await this.ensureLoaded();
    if (!this.deployments.has(deploymentId)) return { stop: () => {} };
    return this.dockerService.streamComposeLogs(
      this.runtimeDir(deploymentId),
      this.projectName(deploymentId),
      callback
    );
  }

  /** Write the active release's compose file into the deployment runtime dir. */
  private async materializeCompose(
    deployment: EnhancedDeploymentDetail,
    injectedEnv: Record<string, string> = {}
  ): Promise<string> {
    const releaseId = deployment.currentReleaseId;
    if (!releaseId) {
      throw new Error('No active release to deploy');
    }
    const src = `deployments/${deployment.id}/releases/${releaseId}/compose-override.yml`;
    if (!(await this.storageService.fileExists(src))) {
      throw new Error('Active release has no compose file');
    }
    const raw = await this.storageService.readFileAsString(src);

    // The routing rule gives us the install-specific values apps reference as
    // tokens (public host, base domain) plus the network alias. generateRule is
    // pure, so compute it once up front and reuse it below.
    const rule = this.routingService.generateRule({ deploymentId: deployment.id, appName: deployment.app });

    // The compose service Traefik routes to and that receives injected auth env.
    // Prefer the manifest-declared ingress service (multi-service apps whose web
    // service isn't named after the app id), falling back to the app id; the
    // compose-network helpers fall back further to the first service if neither
    // names an existing one.
    const ingressService = (await this.readActiveIngressService(deployment)) ?? deployment.app;

    // Attach the ingress service to the Traefik network so the emitted routing
    // config can reach it (the alias must match the routing service name).
    let content = raw;
    try {
      content = attachToHolaNetwork(raw, { alias: rule.serviceName, ingressService });
    } catch (error) {
      this.logger.warn('Could not attach app to Traefik network; deploying compose as-is', {
        deploymentId: deployment.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Inject provisioned auth env into the ingress service. NOT swallowed: a
    // failure here must fail the deploy rather than silently ship an app whose
    // auth was never wired (a security-relevant bypass).
    const hasSecret = Object.keys(injectedEnv).length > 0;
    if (hasSecret) {
      content = injectEnvironment(content, injectedEnv, { ingressService });
    }

    // Resolve the per-app data root: apps declare persistent storage under the
    // `${HOLA_APP_DATA}` token (enforced by the compose validator), which we
    // point at one stable per-install host directory so all of an app's data
    // lives in a single backup-friendly folder (`<base>/<deploymentId>/...`).
    // The base must be identity-mounted into the server (same path on host and
    // in-container) so the path the server creates matches what the daemon binds
    // into app containers — see packages/compose.
    if (content.includes(APP_DATA_TOKEN)) {
      const appRoot = this.appRootFor(deployment.id);
      await this.storageService.ensureDir(appRoot);
      content = content.replaceAll(APP_DATA_TOKEN, appRoot);
    }

    // Resolve install-specific tokens apps reference in their env, so the catalog
    // carries no hardcoded per-install values: the app's public host
    // (`<app>.<base-domain>`) and the install base domain. Each app still names
    // its own env key (e.g. `DOMAIN: https://${HOLA_APP_HOST}`); only the value
    // is a token. (${HOLA_APP_DATA} above is the storage equivalent.)
    content = content
      .replaceAll(APP_HOST_TOKEN, rule.host)
      .replaceAll(BASE_DOMAIN_TOKEN, rule.domain);

    // Apply install-wide operational defaults (restart, log rotation,
    // no-new-privileges hardening, optional TZ/limits) to every service. The app
    // wins for fill-if-absent fields; hardening is additive. See compose-defaults.
    content = applyPlatformDefaults(content, composeDefaultsConfig);

    // Grant a trusted app (e.g. a backup tool) read-only access to ALL apps'
    // data when its manifest declares `consumes: apps-data`. Identity-mapped so
    // absolute host paths resolve unchanged. Read-only; gated by the capability.
    const consumes = await this.readActiveConsumes(deployment);
    if (consumes.includes(APPS_DATA_CAPABILITY)) {
      content = injectReadonlyMount(content, { hostPath: this.appsBindRoot() });
    }

    // The runtime compose may hold a client secret in cleartext; restrict it.
    await this.storageService.writeFile(
      `deployments/${deployment.id}/runtime/docker-compose.yml`,
      content,
      hasSecret ? 0o600 : undefined
    );
    return this.runtimeDir(deployment.id);
  }

  /** Read the active release's declared auth config (if any). */
  private async readActiveAuth(deployment: EnhancedDeploymentDetail): Promise<FinalizedManifest['auth']> {
    const releaseId = deployment.currentReleaseId;
    if (!releaseId) return undefined;
    const manifestPath = `deployments/${deployment.id}/releases/${releaseId}/manifest.json`;
    if (!(await this.storageService.fileExists(manifestPath))) return undefined;
    try {
      const manifest = JSON.parse(await this.storageService.readFileAsString(manifestPath)) as FinalizedManifest;
      return manifest.auth;
    } catch {
      return undefined;
    }
  }

  /** Cross-app capabilities the active release declares it consumes (ADR 0002). */
  private async readActiveConsumes(deployment: EnhancedDeploymentDetail): Promise<string[]> {
    const releaseId = deployment.currentReleaseId;
    if (!releaseId) return [];
    const manifestPath = `deployments/${deployment.id}/releases/${releaseId}/manifest.json`;
    if (!(await this.storageService.fileExists(manifestPath))) return [];
    try {
      const manifest = JSON.parse(await this.storageService.readFileAsString(manifestPath)) as FinalizedManifest;
      return manifest.consumes ?? [];
    } catch {
      return [];
    }
  }

  /** The active release's declared ingress/web compose service, if any. */
  private async readActiveIngressService(deployment: EnhancedDeploymentDetail): Promise<string | undefined> {
    const releaseId = deployment.currentReleaseId;
    if (!releaseId) return undefined;
    const manifestPath = `deployments/${deployment.id}/releases/${releaseId}/manifest.json`;
    if (!(await this.storageService.fileExists(manifestPath))) return undefined;
    try {
      const manifest = JSON.parse(await this.storageService.readFileAsString(manifestPath)) as FinalizedManifest;
      return manifest.ingressService;
    } catch {
      return undefined;
    }
  }

  /** Absolute host base that holds every app's data root. */
  private appsBindRoot(): string {
    return (process.env.HOLA_APPS_BIND_ROOT?.trim() || DEFAULT_APPS_BIND_ROOT).replace(/\/+$/, '');
  }

  /** Absolute host data root for a deployment (`<HOLA_APPS_BIND_ROOT>/<id>`). */
  private appRootFor(deploymentId: string): string {
    return `${this.appsBindRoot()}/${deploymentId}`;
  }

  /**
   * Publish the app registry feed (ADR 0002): build the canonical list of
   * installed apps and write `registry.json` into the data root of every
   * deployment that declares `consumes: app-registry`. Rendering into each app's
   * own config format is a bundle bolt-on, not the server's concern. Never
   * throws — a feed failure must not fail a deploy.
   */
  private async reconcileAppRegistry(): Promise<void> {
    try {
      const apps: RegistryApp[] = Array.from(this.deployments.values()).map((d) => ({
        id: d.id,
        app: d.app,
        name: d.name,
        url: d.url,
        icon: d.icon,
        status: d.status,
      }));
      const content = buildRegistry(apps);

      for (const d of this.deployments.values()) {
        const consumes = await this.readActiveConsumes(d);
        if (!consumes.includes(APP_REGISTRY_CAPABILITY)) continue;
        try {
          const root = this.appRootFor(d.id);
          await this.storageService.ensureDir(root);
          await this.storageService.writeFile(`${root}/${REGISTRY_FILENAME}`, content);
        } catch (error) {
          this.logger.warn('Failed to write app registry feed', {
            deploymentId: d.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      this.logger.warn('App registry reconcile failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Preflight an app's declared auth requirement against the active auth backend,
   * BEFORE any deployment record/job is created. Mirrors the modes `provisionAuth`
   * will actually provision — the declared mode plus a forward-auth fallback when
   * `auth.fallback` requests one — and delegates the can-we-provision decision to
   * the provisioner, so an app needing a backend that isn't configured (e.g.
   * forward-auth under `HOLA_AUTH_MODE=none`) is rejected up front with the
   * backend's own clear, actionable error instead of tombstoning a deployment in
   * `error` state. No-op when the app declares no auth block.
   */
  protected override assertAuthProvisionable(auth: FinalizedManifest['auth'], appName: string): void {
    if (!auth) return;
    this.provisioner.assertCanProvisionAuthMode(auth.mode, appName);
    const wantsFallback = auth.fallback === 'forward-auth' && auth.mode !== 'forward-auth';
    if (wantsFallback) {
      this.provisioner.assertCanProvisionAuthMode('forward-auth', appName);
    }
  }

  /**
   * Provision auth artifacts (if the active release's manifest declares an
   * `auth` block) before the app starts. Returns the env to inject plus the raw
   * provisioned credentials + the auth config (for any post-deploy setup command),
   * or null when there's nothing to do. Idempotent: reuses any ref already persisted
   * on the deployment (keyed on deploymentId), so restart/rollback/start-after-stop
   * never create duplicate clients. Throws on provisioning failure so the lifecycle
   * job fails before any container starts.
   */
  private async provisionAuth(
    deployment: EnhancedDeploymentDetail
  ): Promise<{ env: Record<string, string>; credentials?: ProvisionCredentials; auth: NonNullable<FinalizedManifest['auth']> } | null> {
    const auth = await this.readActiveAuth(deployment);
    // Nothing to do for `none` unless it's explicitly gated by a forward-auth fallback.
    const wantsFallback = auth?.fallback === 'forward-auth' && auth.mode !== 'forward-auth';
    if (!auth || (auth.mode === 'none' && !wantsFallback)) return null;

    const rule = this.routingRuleFor(deployment);
    const result = await this.provisioner.provision({
      deploymentId: deployment.id,
      appName: deployment.app,
      mode: auth.mode,
      host: rule.host,
      existingRef: deployment.metadata.auth?.ref,
      oidc: auth.oidc,
      ldap: auth.ldap,
      forwardAuth: auth.forwardAuth,
    });

    // Defense-in-depth: also gate the app behind forward-auth when requested,
    // even though it has its own (OIDC) login. Provisions a second proxy provider.
    let middleware = result.middleware;
    let fallbackRef: ProvisionedAuthRef | undefined;
    if (wantsFallback) {
      const fa = await this.provisioner.provision({
        deploymentId: deployment.id,
        appName: deployment.app,
        mode: 'forward-auth',
        host: rule.host,
        existingRef: deployment.metadata.auth?.fallbackRef,
        forwardAuth: auth.forwardAuth,
      });
      middleware = fa.middleware;
      fallbackRef = fa.ref;
    }

    // Persist the provisioned refs so re-deploy reuses them and delete can tear them down.
    deployment.metadata.auth = { mode: auth.mode, ref: result.ref, middleware, fallbackRef };
    this.deployments.set(deployment.id, deployment);
    await this.persistDeployment(deployment);

    return { env: result.env, credentials: result.credentials, auth };
  }

  /**
   * Run an app's post-deploy OIDC setup command (e.g. `gitea admin auth add-oauth`)
   * inside its container, for apps that can't be configured by env alone. Idempotent
   * via the manifest's check/checkMatch guard, and retried with backoff because the
   * app may still be running first-boot migrations. Throws if it never succeeds, so a
   * deploy that can't complete its auth wiring is surfaced rather than silently broken.
   */
  private async runPostDeploySetup(
    deployment: EnhancedDeploymentDetail,
    provisioned: { credentials?: ProvisionCredentials; auth: NonNullable<FinalizedManifest['auth']> },
    projectName: string,
    logBoth: (level: 'info' | 'warn' | 'error' | 'debug', message: string) => Promise<void>
  ): Promise<void> {
    const setup = provisioned.auth.oidc?.setup;
    const creds = provisioned.credentials;
    if (!setup || !creds) return;

    const service = setup.service ?? deployment.app;
    const dir = this.runtimeDir(deployment.id);
    const subs: Record<string, string> = {
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      issuer: creds.issuer,
      redirectUri: creds.redirectUri,
      host: this.routingRuleFor(deployment).host,
    };
    const apply = (args: string[]) =>
      args.map(a => a.replace(/\{\{(\w+)\}\}/g, (_, k) => subs[k] ?? `{{${k}}}`));

    for (let attempt = 1; attempt <= this.authSetupMaxAttempts; attempt++) {
      if (attempt > 1) await new Promise(r => setTimeout(r, this.authSetupIntervalMs));

      if (setup.check) {
        const chk = await this.dockerService.composeExec(dir, projectName, service, apply(setup.check), { user: setup.user });
        if (!chk.success) {
          await logBoth('info', `Auth setup: app not ready yet (attempt ${attempt}/${this.authSetupMaxAttempts})`);
          continue; // app likely still starting; retry
        }
        if (setup.checkMatch && chk.output.includes(setup.checkMatch)) {
          await logBoth('info', 'Auth setup: already configured, skipping');
          return;
        }
      }

      const cmd = await this.dockerService.composeExec(dir, projectName, service, apply(setup.command), { user: setup.user });
      if (cmd.success) {
        await logBoth('info', 'Auth setup: OIDC source configured');
        return;
      }
      await logBoth('warn', `Auth setup command failed (attempt ${attempt}/${this.authSetupMaxAttempts})`);
    }
    throw new Error('post-deploy auth setup did not succeed after retries');
  }

  /** Finish auth wiring after the container is up: run any setup command, then for
   *  forward-auth re-emit the route with its gate (the route was first activated at
   *  promote time, before provisioning produced the middleware). */
  private async completeAuthWiring(
    deployment: EnhancedDeploymentDetail,
    provisioned: { credentials?: ProvisionCredentials; auth: NonNullable<FinalizedManifest['auth']> },
    projectName: string,
    logBoth: (level: 'info' | 'warn' | 'error' | 'debug', message: string) => Promise<void>
  ): Promise<void> {
    await this.runPostDeploySetup(deployment, provisioned, projectName, logBoth);
    // Re-emit the route with the gate whenever a forward-auth middleware was
    // provisioned — either `forward-auth` mode or a `fallback: forward-auth` on a
    // native-oidc/none app. routingRuleFor reads the persisted middleware.
    if (deployment.metadata.auth?.middleware) {
      await this.routingService.activateRoute(this.routingRuleFor(deployment));
      await logBoth('info', 'Auth: forward-auth gate applied to route');
    }
  }

  /**
   * Write the provisioned OIDC credentials as a GENERIC JSON file into an app's
   * data root BEFORE the stack starts (manifest `auth.oidc.credentialsFile`), for
   * apps that ingest OIDC only from a file read at boot (e.g. Immich — UI locked,
   * no OIDC env vars). The file holds `{ issuer, clientId, clientSecret,
   * redirectUri }`; a sidecar/init container in the app BUNDLE renders it into the
   * app's own config format (see Homepage's registry renderer + ADR 0002), so the
   * server never deals with per-app config formats. The path is relative to
   * `${HOLA_APP_DATA}` (the same per-install root compose mounts). No-op without a
   * credentialsFile directive or credentials. Written 0600 (holds the secret).
   */
  private async writeOidcCredentialsFile(
    deployment: EnhancedDeploymentDetail,
    provisioned: { credentials?: ProvisionCredentials; auth: NonNullable<FinalizedManifest['auth']> },
    logBoth: (level: 'info' | 'warn' | 'error' | 'debug', message: string) => Promise<void>
  ): Promise<void> {
    const cf = provisioned.auth.oidc?.credentialsFile;
    const creds = provisioned.credentials;
    if (!cf || !creds) return;

    const content = JSON.stringify(
      { issuer: creds.issuer, clientId: creds.clientId, clientSecret: creds.clientSecret, redirectUri: creds.redirectUri },
      null,
      2
    );

    // Resolve under the app's data root; reject path traversal out of it.
    const rel = cf.path.replace(/^\/+/, '');
    if (rel.split('/').includes('..')) {
      throw new Error(`Invalid auth.oidc.credentialsFile path '${cf.path}' (must stay within the app data root)`);
    }
    const root = this.appRootFor(deployment.id);
    const target = `${root}/${rel}`;
    const slash = target.lastIndexOf('/');
    if (slash > root.length) await this.storageService.ensureDir(target.slice(0, slash));
    else await this.storageService.ensureDir(root);
    await this.storageService.writeFile(target, content, 0o600);
    await logBoth('info', `Auth: wrote OIDC credentials file ${rel} for the bundle to render`);
  }

  private jobTypeToAction(type: Job['type']): string {
    switch (type) {
      case 'stop': return 'stop';
      case 'backup': return 'delete';
      default: return 'start';
    }
  }

  /**
   * Job executor: run the requested Compose lifecycle operation for a deployment,
   * stream logs to the job and the deployment, and converge the deployment to a
   * truthful terminal status. Returns false for non-deployment jobs (simulated
   * fallback). Throws on Compose failure so the job is marked failed.
   */
  private async runLifecycleJob(ctx: JobContext): Promise<boolean> {
    const deploymentId = ctx.job.deploymentId;
    if (!deploymentId) return false;
    await this.ensureLoaded();
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) return false;

    const action = (ctx.payload.action as string | undefined) ?? this.jobTypeToAction(ctx.job.type);
    const projectName = this.projectName(deploymentId);
    const logBoth = async (level: 'info' | 'warn' | 'error' | 'debug', message: string) => {
      await ctx.log(level, message);
      await this.loggingService.logDeployment(deploymentId, level, message);
    };

    await logBoth('info', `Starting deployment action: ${action}`);
    await ctx.setProgress(10);

    try {
      let output: string;
      let nextStatus: EnhancedDeploymentDetail['status'];
      let nextLifecycle: EnhancedDeploymentDetail['lifecycleState'];

      if (action === 'stop' || action === 'delete') {
        const res = await this.dockerService.composeDown(this.runtimeDir(deploymentId), projectName);
        output = res.output;
        if (!res.success && action !== 'delete') throw new Error(res.output);
        nextStatus = 'stopped';
        nextLifecycle = 'stopped';
      } else if (action === 'restart') {
        const provisioned = await this.provisionAuth(deployment);
        const composeDir = await this.materializeCompose(deployment, provisioned?.env ?? {});
        if (provisioned) await this.writeOidcCredentialsFile(deployment, provisioned, logBoth);
        // Use `up -d` (recreate) rather than `docker compose restart`: restart
        // restarts the existing containers in place and would NOT re-read the
        // freshly materialized compose, so changed env/labels (e.g. updated OIDC
        // wiring) would silently never reach the app. `up -d` recreates only the
        // services whose config changed, using the already-present images.
        const res = await this.dockerService.composeUp(composeDir, projectName);
        output = res.output;
        if (!res.success) throw new Error(res.output);
        if (provisioned) await this.completeAuthWiring(deployment, provisioned, projectName, logBoth);
        nextStatus = 'running';
        nextLifecycle = 'active';
      } else {
        // deploy / start / rollback -> pull images, then compose up
        const provisioned = await this.provisionAuth(deployment);
        const composeDir = await this.materializeCompose(deployment, provisioned?.env ?? {});
        // Drop the provisioned OIDC creds file into the data root before `up` so a
        // bundle sidecar can render the app's SSO config for first boot (e.g. Immich).
        if (provisioned) await this.writeOidcCredentialsFile(deployment, provisioned, logBoth);

        // Pull first (generous timeout) so `up` isn't gated on download time —
        // large stacks like Postiz used to be SIGKILLed mid-pull by up's 2-min cap.
        await logBoth('info', 'Pulling images (first install can take several minutes)…');
        const pull = await this.dockerService.composePull(composeDir, projectName);
        if (!pull.success) throw new Error(`Image pull failed: ${pull.output}`);
        await ctx.setProgress(60);

        // Cooperative cancellation: bail out before recreating containers (the
        // irreversible step) if the job was cancelled during the long pull.
        if (ctx.isCancelled()) throw new JobCancelledError();

        const res = await this.dockerService.composeUp(composeDir, projectName);
        output = res.output;
        if (!res.success) throw new Error(res.output);
        if (provisioned) await this.completeAuthWiring(deployment, provisioned, projectName, logBoth);
        nextStatus = 'running';
        nextLifecycle = 'active';
      }

      if (output) await logBoth('info', output);
      await ctx.setProgress(90);

      deployment.status = nextStatus;
      deployment.lifecycleState = nextLifecycle;
      deployment.lastUpdated = new Date().toISOString();
      this.deployments.set(deploymentId, deployment);
      await this.persistDeployment(deployment);

      // App-set / status changed → refresh the registry feed for consumers.
      await this.reconcileAppRegistry();

      await logBoth('info', `Deployment action '${action}' completed`);
      return true;
    } catch (error) {
      deployment.status = 'error';
      deployment.lastUpdated = new Date().toISOString();
      this.deployments.set(deploymentId, deployment);
      await this.persistDeployment(deployment);
      await logBoth('error', `Deployment action '${action}' failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /** Derive the Traefik routing rule for a deployment's active release. Carries the
   *  forward-auth middleware (if provisioned) so the gate survives restart/reconcile. */
  private routingRuleFor(deployment: EnhancedDeploymentDetail): ReturnType<RoutingService['generateRule']> {
    const release = deployment.currentReleaseId ? this.releases.get(deployment.currentReleaseId) : undefined;
    const port = release?.ports?.[0]?.container;
    const rule = this.routingService.generateRule({ deploymentId: deployment.id, appName: deployment.app, port });
    const middleware = deployment.metadata.auth?.middleware;
    return middleware ? { ...rule, forwardAuth: middleware } : rule;
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

    // Rebuild Traefik routing from the persisted active deployments.
    const rules = Array.from(this.deployments.values())
      .filter(d => d.currentReleaseId)
      .map(d => this.routingRuleFor(d));
    await this.routingService.reconcile(rules);

    this.logger.info('Rehydrated deployments from storage', { count: this.deployments.size });
  }

  protected override async onBeforeCreate(deploymentId: string, app: string): Promise<void> {
    const rule = this.routingService.generateRule({ deploymentId, appName: app });
    const conflicts = await this.routingService.validateRule(rule);
    if (conflicts.length > 0) {
      throw new ConflictError(conflicts.map(c => c.message).join('; '));
    }
  }

  protected override async onActiveReleaseChanged(deploymentId: string): Promise<void> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) return;
    const rule = this.routingRuleFor(deployment);
    // Avoid a brief unauthenticated window: if the app must be gated by forward-auth
    // but the gate hasn't been provisioned yet (first deploy — no middleware on the
    // rule), defer route activation to completeAuthWiring after the deploy job
    // provisions it. Re-deploys/restarts already carry the persisted middleware, so
    // they activate immediately with the gate.
    if (!rule.forwardAuth) {
      const auth = await this.readActiveAuth(deployment);
      if (auth?.mode === 'forward-auth' || auth?.fallback === 'forward-auth') {
        this.logger.info('Deferring route activation until forward-auth is provisioned', { deploymentId });
        return;
      }
    }
    await this.routingService.activateRoute(rule);
  }

  protected override async onDeploymentRemoved(deploymentId: string): Promise<void> {
    await this.routingService.deactivateRoute(deploymentId);
    // The removed app drops out of the registry feed for remaining consumers.
    await this.reconcileAppRegistry();
  }

  protected override async onDeprovision(deployment: EnhancedDeploymentDetail): Promise<void> {
    const auth = deployment.metadata.auth;
    if (!auth) return;
    // Tear down both refs independently: a failure deprovisioning the primary
    // must not leave the `fallback: forward-auth` provider (and its outpost
    // binding) orphaned in the auth backend. Surface the first error after both
    // attempts so the caller still sees the failure.
    const results = await Promise.allSettled([
      this.provisioner.deprovision({ deploymentId: deployment.id, ref: auth.ref }),
      auth.fallbackRef
        ? this.provisioner.deprovision({ deploymentId: deployment.id, ref: auth.fallbackRef })
        : Promise.resolve(),
    ]);
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) throw failed.reason;
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
