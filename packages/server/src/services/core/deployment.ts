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
  AuthMode,
  GetLogsResponse,
  LogEntry,
  GetDeploymentConfigResponse,
  AppSecurityConfig
} from '@hola/shared';
import { checkUpgradePath, isNewerVersion } from '@hola/shared';
import { requestsPrivilegeEscalation } from './manifest-security';
import { validateParams } from '@hola/shared/param-validate';

import { getLogger } from '../../lib/logger';
import { NotFoundError, ConflictError, ValidationError, DraftValidationError, ServiceError } from '../../middleware/error-mapping';
import { dirHasContents, fileSize, tarGzipDir, restoreTarGzInto } from './snapshot-fs';
import type { HealthCheckable, ServiceHealth } from './types';
import type { StorageService } from './storage';
import type { JobService, JobContext } from './jobs';
import { JobCancelledError } from './jobs';
import type { DockerService } from './docker';
import type { DraftService, FinalizedArtifacts, FinalizedManifest } from './draft';
import { mergeAppEnv } from './draft';
import type { RegistryCredentialService } from './registry-credentials';
import type { PullCredentials } from './bundles';
import type { CatalogService } from './catalog';
import type { EventBus } from './event-bus';
import type { RoutingService } from './routing';
import type { LoggingService } from './logging';
import type { ProvisionerService, ProvisionResult } from './provisioner';
import { APP_DATA_TOKEN, APP_HOST_TOKEN, BASE_DOMAIN_TOKEN, USER_EMAIL_TOKEN } from '@hola/shared/compose-validate';
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
  /**
   * Take a pre-upgrade app-data snapshot before switching the release (#284
   * Phase 1). Always taken when the target version declares
   * `upgrade.preUpgradeBackup: "required"`; this opts in otherwise.
   */
  snapshot?: boolean;
}

/** Per-deployment pre-upgrade snapshot record (#284 Phase 1), stored under
 *  `deployments/<id>/snapshots/<snapshotId>/meta.json` alongside `data.tar.gz`. */
interface SnapshotMeta {
  snapshotId: string;
  deploymentId: string;
  /** The release that was active when the snapshot was taken — i.e. the release a
   *  data-aware rollback to it should restore this snapshot for. */
  fromReleaseId: string;
  fromVersion?: string;
  createdAt: string;
  sizeBytes: number;
}

/** Pre-upgrade snapshots kept per deployment (bounded retention; oldest pruned). */
const SNAPSHOT_RETENTION = 5;

export interface DeploymentService extends HealthCheckable {
  // Deployment lifecycle
  createFromDraft(request: CreateDeploymentFromDraftRequest): Promise<CreateDeploymentFromDraftResponse>;
  /** Stage a new release from a finalized draft onto an existing deployment and activate it. */
  promote(deploymentId: string, request: PromoteRequest): Promise<CreateDeploymentFromDraftResponse>;
  /** The active release's carry-forward config (app env incl. secrets + system overrides), for an upgrade. */
  getActiveConfig(deploymentId: string): Promise<{ appEnv: Record<string, string>; systemOverrides: Record<string, string> }>;
  /** The active release's full config (typed appEnv rows, spec intact, + system
   *  overrides), for the DeploymentDetail Configuration tab. */
  getConfig(deploymentId: string): Promise<GetDeploymentConfigResponse>;
  /** The catalog source this deployment was installed from (defaults to `hola`).
   *  Not surfaced on the public DeploymentDetail; the promote/upgrade flow needs
   *  it to rebuild the draft from the same source the app came from (#340). */
  getDeploymentSource(deploymentId: string): Promise<string>;

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

/**
 * Render a value for a Compose `.env` line (`KEY=VALUE`). Double-quote and escape
 * so spaces, `#`, and `$` are preserved literally rather than treated as a comment
 * or interpolation; collapse newlines (these are single-line values — passwords,
 * URLs, ids, client secrets). Compose strips the surrounding quotes when loading.
 */
function dotenvValue(v: string): string {
  const s = v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/\r?\n/g, ' ');
  return `"${s}"`;
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
  abstract getActiveConfig(deploymentId: string): Promise<{ appEnv: Record<string, string>; systemOverrides: Record<string, string> }>;
  abstract getConfig(deploymentId: string): Promise<GetDeploymentConfigResponse>;

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
  /**
   * Remove a deployment's host bind-mount data root (`<HOLA_APPS_BIND_ROOT>/<id>`
   * — the app's persistent Postgres/media data). Distinct from {@link removeStorage},
   * which only covers the internal `/data/deployments/<id>` tree. Base is a no-op
   * (mock/in-memory has no host data); the real service overrides it. Called on
   * delete so uninstall doesn't accumulate orphaned data dirs (#341).
   */
  protected async removeAppData(deploymentId: string): Promise<void> {
    void deploymentId;
  }
  /**
   * Tear down a deployment's running containers (`docker compose down`).
   * Base is a no-op; the real service overrides it. Called synchronously during
   * delete BEFORE {@link removeStorage} so the compose file still exists on disk.
   * A failure here is non-fatal — deletion must always proceed — and, crucially,
   * it must NOT re-persist the deployment, so it never leaves an `error` tombstone
   * for a record that is being removed.
   */
  protected async teardownContainers(deploymentId: string): Promise<void> {
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
   * Capture a pre-upgrade app-data snapshot before a promote switches releases
   * (#284 Phase 1). Default no-op — the in-memory/mock service has no app data on
   * disk; RealDeploymentService tars the data root. May throw (the caller decides
   * fail-closed vs. best-effort based on the target's `preUpgradeBackup`).
   */
  protected async capturePreUpgradeSnapshot(
    deploymentId: string,
    fromReleaseId: string,
    fromVersion: string | undefined,
  ): Promise<void> {
    void deploymentId;
    void fromReleaseId;
    void fromVersion;
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

  /** The catalog source a deployment was installed from, defaulting to `hola`
   *  (matching createDraft's own default). Rehydrates first so a cold server
   *  reads the persisted metadata rather than an empty in-memory map. */
  async getDeploymentSource(deploymentId: string): Promise<string> {
    await this.ensureLoaded();
    return this.requireDeployment(deploymentId).metadata?.source ?? 'hola';
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
          // Captured from the authenticated principal at create time (the deploy
          // job runs async without a request context). Feeds `${HOLA_USER_EMAIL}`.
          ...(request.installedBy ? { installedBy: request.installedBy } : {}),
          // The catalog source (default `hola`), carried through the finalized
          // manifest, so update detection checks the right source.
          ...(artifacts?.manifest.source ? { source: artifacts.manifest.source } : {}),
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
    const deployment = this.requireDeployment(deploymentId);
    const releaseId = crypto.randomUUID();

    this.logger.info('Promoting new release onto deployment', { deploymentId, releaseId, draftId: request.draftId });

    const artifacts = await this.loadFinalizedArtifacts(request.draftId);

    // Upgrade skip-guard (#284 Phase 0): reject an illegal version jump — below a
    // `minFromVersion` floor or past a required `waypoint` — BEFORE building or
    // staging the new release, so an unsafe promote fails up front with an
    // actionable next version rather than booting a half-migrated app. Same-version
    // re-promotes, downgrades, and apps with no upgrade metadata pass through.
    const fromVersion = deployment.version;
    const toVersion = artifacts?.manifest.version;
    const guard = checkUpgradePath(fromVersion, toVersion, artifacts?.manifest.upgrade);
    if (!guard.ok) {
      this.logger.warn('Blocked unsafe promote (upgrade skip-guard)', {
        deploymentId, fromVersion, toVersion, code: guard.code, suggestedVersion: guard.suggestedVersion,
      });
      throw new ValidationError(guard.message, { code: guard.code, fromVersion, toVersion, suggestedVersion: guard.suggestedVersion });
    }

    const { app, version, release } = await this.buildReleaseFromDraft(artifacts, request, deploymentId, releaseId);

    // Reject an unsatisfiable auth requirement before staging the new release, so
    // a promote that switches to a backend-only mode (e.g. forward-auth under
    // HOLA_AUTH_MODE=none) fails up front instead of in the deploy job.
    this.assertAuthProvisionable(artifacts?.manifest.auth, app);

    this.releases.set(releaseId, release);

    await this.ensureLayout(deploymentId);
    await this.stageReleaseArtifacts(artifacts, deploymentId, release);
    await this.persistRelease(release);

    // Pre-upgrade snapshot (#284 Phase 1): capture the app data BEFORE switching
    // the release, keyed by the outgoing release so a later data-aware rollback to
    // it restores this exact state. Always for `preUpgradeBackup: "required"`,
    // opt-in otherwise. Fail-closed only when required (don't silently upgrade a
    // stack the operator asked to be snapshotted); best-effort otherwise.
    const backupRequired = artifacts?.manifest.upgrade?.preUpgradeBackup === 'required';
    if ((backupRequired || request.snapshot === true) && deployment.currentReleaseId) {
      try {
        await this.capturePreUpgradeSnapshot(deploymentId, deployment.currentReleaseId, deployment.version);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (backupRequired) {
          throw new ValidationError(
            `Pre-upgrade snapshot failed and this upgrade requires one (preUpgradeBackup: required): ${msg}`,
          );
        }
        this.logger.warn('Pre-upgrade snapshot failed (continuing — not required)', { deploymentId, error: msg });
      }
    }

    // Atomically switch the active release to the new one.
    await this.promoteRelease(deploymentId, releaseId);

    // Sync the deployment's catalog-derived display fields to the promoted release.
    // promoteRelease only moves the release pointers (it's shared with rollback and
    // the Release type carries no version); without this the record (and the UI's
    // "update available") would still report the pre-upgrade version after a
    // successful promote.
    //
    // The icon rides along for the same reason: it's persisted at install
    // (createFromDraft) purely as a cache so the launcher needn't hit the catalog,
    // so an app whose package changes its logo would otherwise show the icon it had
    // on install day forever. We've just resolved the new manifest, so it's free.
    //
    // `name` is deliberately NOT refreshed — a caller-supplied name wins at install
    // and the record can't distinguish one from a manifest-derived default, so
    // rewriting it here would clobber an operator's rename.
    const promotedIcon = artifacts?.manifest.icon;
    if (version || promotedIcon) {
      const promoted = this.requireDeployment(deploymentId);
      let changed = false;
      if (version && promoted.version !== version) {
        promoted.version = version;
        changed = true;
      }
      if (promotedIcon && promoted.icon !== promotedIcon) {
        promoted.icon = promotedIcon;
        changed = true;
      }
      if (changed) {
        this.deployments.set(deploymentId, promoted);
        await this.persistDeployment(promoted);
      }
    }

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
    const page = filterAndPaginateDeployments(Array.from(this.deployments.values()), request);
    await this.enrichUpdateInfo(page.items);
    return page;
  }

  async getDeployment(deploymentId: string): Promise<GetDeploymentResponse> {
    await this.ensureLoaded();
    this.logger.info('Getting deployment', { deploymentId });
    const detail = toDetailResponse(this.requireDeployment(deploymentId));
    await this.enrichUpdateInfo([detail]);
    return detail;
  }

  /**
   * Annotate deployment responses with catalog update availability (#284):
   * `latestVersion` + `updateAvailable` from the catalog. Default no-op (the
   * in-memory/mock service has no catalog); RealDeploymentService overrides it.
   */
  protected async enrichUpdateInfo(
    items: Array<{ id?: string; app: string; version?: string; latestVersion?: string; updateAvailable?: boolean }>,
  ): Promise<void> {
    void items;
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
      // Tear down running containers synchronously, in-line, BEFORE we remove the
      // runtime directory below. Previously this enqueued a fire-and-forget `stop`
      // job and returned immediately; the job's `docker compose down` then raced
      // `removeStorage` and frequently ran after the compose file was already
      // deleted. That failure path re-persisted the (already removed) deployment
      // with status `error`, leaving a stuck tombstone after a "successful"
      // uninstall. Running the teardown here guarantees compose-down sees the file
      // and that no late job can resurrect the record.
      await this.teardownContainers(deploymentId);
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

    // Reclaim the host bind-mount data root (Postgres/media/etc). Best-effort and
    // non-fatal, mirroring removeStorage: a failure here must never block delete —
    // it leaves reclaimable data on disk, logged for manual cleanup (#341).
    try {
      await this.removeAppData(deploymentId);
    } catch (error) {
      this.logger.warn('Failed to delete deployment app data root', {
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
        // Data-aware rollback (#284 Phase 1): also restore the pre-upgrade app-data
        // snapshot taken when this target was last active, so the old image isn't
        // booted against a forward-migrated schema. Handled in runLifecycleJob.
        restoreData: request.restoreData === true,
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
    private provisioner: ProvisionerService,
    // Optional so existing constructions (and tests) need no change; when present,
    // deployment responses are annotated with catalog update availability (#284).
    private catalogService?: CatalogService,
    // Optional global event bus; when wired, status changes emit `deployment_update`
    // for the dashboard-wide `/api/events` stream (#291).
    private eventBus?: EventBus,
    // Optional; resolves a release's credentialRef → registry secret so a private
    // app's runtime image can be pulled at deploy time. Absent ⇒ anonymous pulls.
    private registryCredentials?: RegistryCredentialService,
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
    if (entries.length > 0) return { items: entries };

    // No container logs — the app's containers never started (a deploy that failed
    // BEFORE `compose up`, e.g. an error in provisionAuth/materializeCompose, or a
    // stopped/torn-down deployment). composeLogs returns an honest empty snapshot in
    // that case, which used to hide *why* the deploy failed. Fall back to the
    // deployment's lifecycle event log (the "Starting action…/Pulling…/action 'X'
    // failed: <error>" trail logged via logDeployment), so the failure reason is
    // visible at the endpoint users actually check (`hola logs <id>`).
    const events = this.loggingService
      .recentLogs({ kind: 'deployment', id: deploymentId }, options?.tail)
      .map((e) => ({ timestamp: e.timestamp, service: e.service, level: e.level, message: e.message }));
    return { items: events };
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
    //
    // NOT swallowed, for the same reason as the auth injection below: deploying
    // the compose as-is produces an app that starts, reports success, and is
    // unreachable — Traefik gets a routing rule pointing at a service that was
    // never joined to the network, so every request 502s with nothing but a warn
    // in the log. Failing the deploy surfaces the real problem while the operator
    // is still watching.
    let content: string;
    try {
      content = attachToHolaNetwork(raw, { alias: rule.serviceName, ingressService });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error('Could not attach app to the Traefik network', error as Error, {
        deploymentId: deployment.id,
        ingressService,
      });
      throw new ServiceError(
        `Could not attach ${deployment.id} to the Traefik network (ingress service '${ingressService}'): ${detail}. ` +
          `Deploying without it would start the app unreachable behind a 502.`,
      );
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
    // The installing user's email (captured at create time), so an app can seed
    // its own admin with the operator's identity (e.g. `ADMIN_EMAIL:
    // "${HOLA_USER_EMAIL}"`). Empty for admin-key/CLI installs — apps that need a
    // value regardless carry a compose fallback (`"${ADMIN_EMAIL:-…}"`).
    const userEmail = deployment.metadata.installedBy?.email ?? '';
    content = content
      .replaceAll(APP_HOST_TOKEN, rule.host)
      .replaceAll(BASE_DOMAIN_TOKEN, rule.domain)
      .replaceAll(USER_EMAIL_TOKEN, userEmail);

    // Apply install-wide operational defaults (restart, log rotation,
    // no-new-privileges hardening, optional TZ/limits) to every service. The app
    // wins for fill-if-absent fields; hardening is additive. See compose-defaults.
    // An app that declared (and the operator consented to) privilege escalation
    // gets no-new-privileges dropped on its ingress service so `sudo` works — the
    // grant is scoped to the ingress service, leaving any sidecars hardened.
    const security = await this.readActiveSecurity(deployment);
    const allowPrivilegeEscalationServices = requestsPrivilegeEscalation(security) ? [ingressService] : [];
    content = applyPlatformDefaults(content, composeDefaultsConfig, { allowPrivilegeEscalationServices });

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

    // Materialize interpolation variables into a sibling `.env` so Compose can
    // resolve `${VAR}` references the app's compose makes — both the app's own env
    // (user/default values from the manifest's `defaultEnv`, e.g. an internal DB
    // password) and the provisioned auth env (an app that DERIVES a value, e.g.
    // mealie's `OIDC_CONFIGURATION_URL: "${OIDC_ISSUER_URL}.well-known/..."`).
    // Without this those `${VAR}` resolve to blank. `docker compose` auto-loads
    // `.env` from the project directory (the runtime dir we run it in). Auth env
    // wins on a key clash; written 0600 since it can hold secrets.
    const appEnv = await this.readActiveAppEnv(deployment);
    // Expose the installing user's email as a Compose interpolation variable, so an
    // app can reference it WITH a fallback — `ADMIN_EMAIL: "${HOLA_USER_EMAIL:-…}"` —
    // and Compose supplies the default when the operator has no email (admin-key/CLI
    // installs). This is the recommended form: it needs no wizard field and never
    // dead-ends. (Bare `${HOLA_USER_EMAIL}`, which has no Compose-level fallback, is
    // additionally text-substituted in the compose/env above.) The `.env` is
    // interpolation-only — Compose won't inject it into a container that doesn't
    // reference it — so this doesn't leak the operator's email into every app.
    const interp: Record<string, string> = { HOLA_USER_EMAIL: userEmail, ...appEnv, ...injectedEnv };
    const interpKeys = Object.keys(interp);
    if (interpKeys.length > 0) {
      // Also resolve `${HOLA_USER_EMAIL}` inside env VALUES, so an app can set it as a
      // `defaultEnv` default and pair it with a compose fallback. Written verbatim to
      // `.env`, which Compose reads literally (no recursive interpolation of values),
      // so the token must be resolved here rather than left for Compose. Belt-and-
      // braces: also resolve `${HOLA_APP_HOST}`/`${HOLA_BASE_DOMAIN}` here — the draft
      // service already resolves these at seed time (draft.ts createDraft), but a
      // draft created before that existed, or a promote's carried-forward value, may
      // still carry the literal token; this is the last chance to resolve it before
      // it leaks into the running container's env.
      const dotenv = interpKeys
        .map(k => `${k}=${dotenvValue(
          interp[k]
            .replaceAll(USER_EMAIL_TOKEN, userEmail)
            .replaceAll(APP_HOST_TOKEN, rule.host)
            .replaceAll(BASE_DOMAIN_TOKEN, rule.domain)
        )}`)
        .join('\n') + '\n';
      await this.storageService.writeFile(`deployments/${deployment.id}/runtime/.env`, dotenv, 0o600);
    }
    return this.runtimeDir(deployment.id);
  }

  /**
   * Read a release's finalized manifest.
   *
   * Returns `undefined` when there is genuinely nothing to read — no active
   * release, or no manifest file. That's a legitimate state and callers treat it
   * as "field absent".
   *
   * THROWS when the file exists but cannot be read or parsed. That distinction is
   * the entire point of this helper. Every caller derives deploy-time behaviour
   * from this file, and the readers used to `catch { return undefined }` — making
   * a CORRUPT manifest indistinguishable from one that simply omits the field. A
   * truncated write therefore silently deployed the app with no auth wiring, no
   * env, or no config carried forward on upgrade, with nothing in the log but the
   * absence of a problem. Corruption must stop the operation, not quietly change
   * what it does.
   */
  private async readReleaseManifest(deploymentId: string, releaseId: string | undefined): Promise<FinalizedManifest | undefined> {
    if (!releaseId) return undefined;
    const manifestPath = `deployments/${deploymentId}/releases/${releaseId}/manifest.json`;
    if (!(await this.storageService.fileExists(manifestPath))) return undefined;
    try {
      return JSON.parse(await this.storageService.readFileAsString(manifestPath)) as FinalizedManifest;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error('Release manifest is unreadable or corrupt', error as Error, { deploymentId, releaseId, manifestPath });
      throw new ServiceError(
        `Release manifest for ${deploymentId} (release ${releaseId}) is unreadable or corrupt: ${detail}. ` +
          `Refusing to operate on this deployment with unknown auth/config — roll back to a good release or repair the file.`,
      );
    }
  }

  /** The active release's manifest, or undefined when there isn't one. Throws on corruption. */
  private async readActiveManifest(deployment: EnhancedDeploymentDetail): Promise<FinalizedManifest | undefined> {
    return this.readReleaseManifest(deployment.id, deployment.currentReleaseId);
  }

  /** Read the active release's declared auth config (if any). */
  private async readActiveAuth(deployment: EnhancedDeploymentDetail): Promise<FinalizedManifest['auth']> {
    return (await this.readActiveManifest(deployment))?.auth;
  }

  /** Cross-app capabilities the active release declares it consumes (ADR 0002). */
  private async readActiveConsumes(deployment: EnhancedDeploymentDetail): Promise<string[]> {
    return (await this.readActiveManifest(deployment))?.consumes ?? [];
  }

  /** Elevated container permissions the active release's manifest declares. */
  private async readActiveSecurity(deployment: EnhancedDeploymentDetail): Promise<AppSecurityConfig | undefined> {
    return (await this.readActiveManifest(deployment))?.security;
  }

  /** The active release's app env (manifest `defaultEnv` + any user overrides), as
   *  a flat map — the source for the runtime `.env` Compose interpolates from. */
  private async readActiveAppEnv(deployment: EnhancedDeploymentDetail): Promise<Record<string, string>> {
    const manifest = await this.readActiveManifest(deployment);
    const out: Record<string, string> = {};
    for (const e of manifest?.appEnv ?? []) out[e.key] = e.value ?? '';
    return out;
  }

  /** Absolute path to the active release's manifest, or undefined if there's no
   *  active release. Shared by `getConfig`/`updateDeployment` so both operate on
   *  the exact same file `materializeCompose` reads at deploy time. */
  private activeManifestPath(deployment: EnhancedDeploymentDetail): string | undefined {
    const releaseId = deployment.currentReleaseId;
    if (!releaseId) return undefined;
    return `deployments/${deployment.id}/releases/${releaseId}/manifest.json`;
  }

  /**
   * Resolve the registry credential (if any) recorded on the active release, so
   * the runtime image can be pulled from a private registry. Returns undefined
   * when the app has no credentialRef (the common anonymous case). A credentialRef
   * that no longer resolves (credential deleted after install) throws with a clear
   * message rather than surfacing a raw docker auth error later.
   */
  private async resolveRegistryAuth(deployment: EnhancedDeploymentDetail): Promise<PullCredentials[] | undefined> {
    const releaseId = deployment.currentReleaseId;
    if (!releaseId) return undefined;
    const credentialRef = (await this.readActiveManifest(deployment))?.credentialRef;
    if (!credentialRef) return undefined;
    const creds = await this.registryCredentials?.resolve(credentialRef);
    if (!creds) {
      throw new Error(`Registry credential not found: ${credentialRef}. Re-add it in Settings → Registry Credentials.`);
    }
    return [creds];
  }

  /** Public accessor for the active release's carry-forward config — its app env
   *  (incl. secret values) and system overrides — used by the upgrade flow to carry
   *  the operator's existing config forward onto the new release. (Ports are NOT
   *  carried: the new version's compose defines its own container ports.) */
  async getActiveConfig(deploymentId: string): Promise<{ appEnv: Record<string, string>; systemOverrides: Record<string, string> }> {
    const deployment = this.requireDeployment(deploymentId);
    const releaseId = deployment.currentReleaseId;
    const empty = { appEnv: {} as Record<string, string>, systemOverrides: {} as Record<string, string> };
    if (!releaseId) return empty;
    // Corruption throws rather than returning `empty`: this is the promote
    // carry-forward source, so an empty return silently ships the upgraded
    // release with none of the operator's env or secrets.
    const manifest = await this.readReleaseManifest(deployment.id, releaseId);
    if (!manifest) return empty;
    const appEnv: Record<string, string> = {};
    for (const e of manifest.appEnv ?? []) appEnv[e.key] = e.value ?? '';
    return { appEnv, systemOverrides: manifest.systemOverrides ?? {} };
  }

  /** Full config for the DeploymentDetail Configuration tab: the active release's
   *  typed `appEnv` rows (spec intact) + system overrides. Unlike `getActiveConfig`
   *  (value-only maps for the internal promote carry-forward merge), this is the
   *  public read-path the web UI renders via `ParamField`. */
  async getConfig(deploymentId: string): Promise<GetDeploymentConfigResponse> {
    // Rehydrate first, like every sibling per-deployment method — otherwise a
    // config read racing the initial detail fetch on a cold server sees the
    // empty in-memory map and 404s a deployment that exists on disk.
    await this.ensureLoaded();
    const deployment = this.requireDeployment(deploymentId);
    const manifestPath = this.activeManifestPath(deployment);
    if (!manifestPath) return { appEnv: [], systemOverrides: {} };
    const manifest = await this.readActiveManifest(deployment);
    if (!manifest) return { appEnv: [], systemOverrides: {} };
    return { appEnv: manifest.appEnv ?? [], systemOverrides: manifest.systemOverrides ?? {} };
  }

  /**
   * Real env/system-override PATCH (#325 Configuration tab): validates the
   * incoming `appEnv` against its own typed spec (re-imposed from the stored
   * manifest — a client only ever owns `value`, mirroring the draft PATCH
   * hardening in `draft.ts`), rewrites the active release's manifest, and — if
   * anything actually changed — triggers a real restart so
   * `materializeCompose` regenerates `runtime/.env` from the freshly-rewritten
   * manifest and `docker compose up` applies it. Previously a logged no-op.
   */
  override async updateDeployment(deploymentId: string, request: PatchDeploymentRequest): Promise<PatchDeploymentResponse> {
    await this.ensureLoaded();
    const deployment = this.requireDeployment(deploymentId);

    this.logger.info('Updating deployment configuration', { deploymentId });

    const hasEnvChange = request.env !== undefined || (request.removeEnvKeys?.length ?? 0) > 0;
    if (!hasEnvChange && !request.systemOverrides) {
      // Nothing to do — mirror the base class's cheap no-op path (still bumps
      // lastUpdated) rather than requiring an active release for a no-op call.
      deployment.lastUpdated = new Date().toISOString();
      this.deployments.set(deploymentId, deployment);
      await this.persistDeployment(deployment);
      return { ok: true };
    }

    const manifestPath = this.activeManifestPath(deployment);
    if (!manifestPath || !(await this.storageService.fileExists(manifestPath))) {
      throw new ConflictError('Deployment has no active release to configure');
    }
    const manifest = JSON.parse(await this.storageService.readFileAsString(manifestPath)) as FinalizedManifest;

    if (hasEnvChange) {
      // Merge-by-key (issue #332): `env` rows are upserted (spec re-imposed from
      // the stored manifest — a client only owns `value`, never the spec),
      // `removeEnvKeys` are dropped, and any stored var omitted from the request
      // is left untouched. Then validate the merged result against that spec, so
      // e.g. removing a required var is rejected rather than silently breaking
      // the app.
      const merged = mergeAppEnv(manifest.appEnv ?? [], request.env ?? [], request.removeEnvKeys ?? []);
      const issues = validateParams(merged);
      const errors = issues.filter((i) => i.severity === 'error');
      if (errors.length > 0) {
        const err = new DraftValidationError('Deployment configuration update failed validation', issues);
        err.code = 'DEPLOYMENT_VALIDATION_FAILED';
        throw err;
      }
      manifest.appEnv = merged;
    }

    if (request.systemOverrides) {
      manifest.systemOverrides = request.systemOverrides;
    }

    await this.storageService.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    deployment.lastUpdated = new Date().toISOString();
    this.deployments.set(deploymentId, deployment);
    await this.persistDeployment(deployment);

    // Trigger a real redeploy: `executeAction('restart')` enqueues the same
    // lifecycle job `runLifecycleJob` runs for an operator-initiated restart,
    // which calls `materializeCompose` — that reads the manifest fresh off disk
    // (see `readActiveAppEnv` above), so it picks up the rewrite just persisted
    // and runs a real `docker compose up` against it.
    const { jobId } = await this.executeAction(deploymentId, { action: 'restart' });
    return { ok: true, jobId };
  }

  /** The active release's declared ingress/web compose service, if any. */
  private async readActiveIngressService(deployment: EnhancedDeploymentDetail): Promise<string | undefined> {
    return (await this.readActiveManifest(deployment))?.ingressService;
  }

  /** Absolute host base that holds every app's data root. */
  private appsBindRoot(): string {
    return (process.env.HOLA_APPS_BIND_ROOT?.trim() || DEFAULT_APPS_BIND_ROOT).replace(/\/+$/, '');
  }

  /** Absolute host data root for a deployment (`<HOLA_APPS_BIND_ROOT>/<id>`). */
  private appRootFor(deploymentId: string): string {
    return `${this.appsBindRoot()}/${deploymentId}`;
  }

  // ---- Pre-upgrade snapshots (#284 Phase 1) --------------------------------

  private snapshotsDir(deploymentId: string): string {
    return `deployments/${deploymentId}/snapshots`;
  }

  /**
   * Snapshot a deployment's app data (file-level tar) keyed by the release that
   * is active right now (`fromReleaseId`) — the rollback target a later
   * data-aware rollback restores it for. No-ops when there's no app data yet (a
   * fresh app has nothing to snapshot). Prunes to the retention bound. The capture
   * is a live read (crash-consistent); transaction-consistent dumps are the
   * per-app hooks in #121. Overrides the base hook called from `promote`.
   */
  protected override async capturePreUpgradeSnapshot(
    deploymentId: string,
    fromReleaseId: string,
    fromVersion: string | undefined,
  ): Promise<void> {
    const appRoot = this.appRootFor(deploymentId);
    if (!(await dirHasContents(appRoot))) {
      this.logger.info('No app data to snapshot (fresh deployment)', { deploymentId });
      return;
    }

    // #121 backup hooks: a file-level tar of a live DB is only crash-consistent,
    // so an app can declare a `preHook` (quiesce / `pg_dump` into a path the tar
    // captures) and a `postHook` (clean up). The server runs them in the app's own
    // containers around the capture (ADR 0002 post-deploy command mechanism). Read
    // from the OUTGOING release's manifest — that's the app currently running.
    const backup = await this.readReleaseBackupConfig(deploymentId, fromReleaseId);
    const dir = this.runtimeDir(deploymentId);
    const projectName = this.projectName(deploymentId);

    // preHook failure propagates — `promote` decides fail-closed (when the target
    // declares `preUpgradeBackup: required`) vs. best-effort. A consistent dump is
    // worthless if we snapshot anyway.
    if (backup?.preHook) {
      this.logger.info('Running backup preHook before snapshot', { deploymentId, service: backup.preHook.service });
      const res = await this.dockerService.composeExec(dir, projectName, backup.preHook.service, backup.preHook.command);
      if (!res.success) throw new Error(`backup preHook failed: ${res.output}`);
    }

    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const snapshotId = `${stamp}-${fromReleaseId.slice(0, 8)}`;
      const relDir = `${this.snapshotsDir(deploymentId)}/${snapshotId}`;
      await this.storageService.ensureDir(relDir);

      const tarPath = this.storageService.resolveHolaPath('deployments', deploymentId, 'snapshots', snapshotId, 'data.tar.gz');
      await tarGzipDir(appRoot, tarPath);

      const meta: SnapshotMeta = {
        snapshotId,
        deploymentId,
        fromReleaseId,
        fromVersion,
        createdAt: new Date().toISOString(),
        sizeBytes: await fileSize(tarPath),
      };
      await this.storageService.writeFile(`${relDir}/meta.json`, JSON.stringify(meta, null, 2));
      this.logger.info('Captured pre-upgrade snapshot', { deploymentId, snapshotId, sizeBytes: meta.sizeBytes });
      await this.pruneSnapshots(deploymentId);
    } finally {
      // postHook always runs (clean up the dump), even if the capture threw.
      // Best-effort — a cleanup failure must not fail the upgrade.
      if (backup?.postHook) {
        try {
          const res = await this.dockerService.composeExec(dir, projectName, backup.postHook.service, backup.postHook.command);
          if (!res.success) this.logger.warn('backup postHook failed', { deploymentId, output: res.output });
        } catch (err) {
          this.logger.warn('backup postHook errored', { deploymentId, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
  }

  /** Read the per-app backup hooks (#121) from a release's finalized manifest. */
  private async readReleaseBackupConfig(deploymentId: string, releaseId: string): Promise<FinalizedManifest['backup']> {
    return (await this.readReleaseManifest(deploymentId, releaseId))?.backup;
  }

  /** Snapshot metadata for a deployment, newest first. */
  private async listSnapshots(deploymentId: string): Promise<SnapshotMeta[]> {
    let ids: string[];
    try {
      ids = await this.storageService.listDir(this.snapshotsDir(deploymentId));
    } catch {
      return [];
    }
    const metas: SnapshotMeta[] = [];
    for (const id of ids) {
      try {
        const raw = await this.storageService.readFileAsString(`${this.snapshotsDir(deploymentId)}/${id}/meta.json`);
        metas.push(JSON.parse(raw) as SnapshotMeta);
      } catch {
        // Skip an incomplete/half-written snapshot dir.
      }
    }
    return metas.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /** Drop the oldest snapshots beyond the retention bound. */
  private async pruneSnapshots(deploymentId: string): Promise<void> {
    const excess = (await this.listSnapshots(deploymentId)).slice(SNAPSHOT_RETENTION);
    for (const m of excess) {
      await this.storageService.deleteDir(`${this.snapshotsDir(deploymentId)}/${m.snapshotId}`, true);
    }
  }

  /**
   * Restore the most recent snapshot taken when `targetReleaseId` was active,
   * replacing the app-data dir. Returns false (with a warning) when none exists —
   * the caller then proceeds with a containers-only rollback. Callers MUST stop
   * the app's containers first (the data dir is wiped and replaced).
   */
  private async restoreAppDataSnapshot(
    deploymentId: string,
    targetReleaseId: string,
    log: (level: 'info' | 'warn' | 'error' | 'debug', message: string) => Promise<void>,
  ): Promise<boolean> {
    const snap = (await this.listSnapshots(deploymentId)).find((m) => m.fromReleaseId === targetReleaseId);
    if (!snap) {
      await log('warn', 'No pre-upgrade snapshot for this release — rolling back containers only (app data not restored).');
      return false;
    }
    const tarPath = this.storageService.resolveHolaPath('deployments', deploymentId, 'snapshots', snap.snapshotId, 'data.tar.gz');
    await log('info', `Restoring app data from pre-upgrade snapshot ${snap.snapshotId}…`);
    await restoreTarGzInto(tarPath, this.appRootFor(deploymentId));
    return true;
  }

  /**
   * Annotate deployment responses with catalog update availability (#284): for
   * each distinct app, look up the newest catalog version and compare it to the
   * installed `version`. Cheap (the catalog version list is served from the
   * in-memory cache, no bundle pull). Fail-safe — any catalog error leaves the
   * fields unset rather than failing the list/detail request.
   */
  protected override async enrichUpdateInfo(
    items: Array<{ id?: string; app: string; version?: string; latestVersion?: string; updateAvailable?: boolean }>,
  ): Promise<void> {
    if (!this.catalogService || items.length === 0) return;
    // The source an item was installed from (default `hola`), so update detection
    // queries the right catalog. Keyed per (source, app) since two sources could
    // publish the same appId. `(ref)` installs have no index to check → skipped.
    const sourceOf = (item: { id?: string; app: string }) =>
      (item.id ? this.deployments.get(item.id)?.metadata?.source : undefined) ?? 'hola';
    const latestByKey = new Map<string, string | undefined>();
    for (const item of items) {
      const source = sourceOf(item);
      const key = `${source}::${item.app}`;
      if (latestByKey.has(key)) continue;
      if (source === '(ref)') { latestByKey.set(key, undefined); continue; }
      try {
        const { items: versions } = await this.catalogService.getVersions(item.app, source);
        const newest = versions
          .map((v) => v.version)
          .reduce<string | undefined>((best, v) => (!best || isNewerVersion(v, best) ? v : best), undefined);
        latestByKey.set(key, newest);
      } catch {
        latestByKey.set(key, undefined); // app not in catalog / catalog down — skip
      }
    }
    for (const item of items) {
      const latest = latestByKey.get(`${sourceOf(item)}::${item.app}`);
      if (!latest) continue;
      item.latestVersion = latest;
      // Only flag an update when the installed version is a concrete, comparable
      // one. A deployment pinned to the literal "latest" has no known concrete
      // version to compare against — treating it as 0.0.0 would mark *every*
      // latest-install as out-of-date — so report "no update available" instead.
      const installed = item.version;
      item.updateAvailable = !!installed && installed !== 'latest' && isNewerVersion(latest, installed);
    }
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
        // Per-deployment guard: readActiveConsumes now throws on a corrupt
        // manifest, and this loop spans EVERY deployment — without this, one bad
        // manifest would stop the registry feed being written for all the others.
        // Skipping the unreadable one is the right blast radius here; the deploy
        // paths that actually act on a manifest still fail hard.
        let consumes: string[];
        try {
          consumes = await this.readActiveConsumes(d);
        } catch (error) {
          this.logger.warn('Skipping deployment in app-registry feed; its manifest is unreadable', {
            deploymentId: d.id,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
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
        const registryAuth = await this.resolveRegistryAuth(deployment);
        const res = await this.dockerService.composeUp(composeDir, projectName, registryAuth);
        output = res.output;
        if (!res.success) throw new Error(res.output);
        if (provisioned) await this.completeAuthWiring(deployment, provisioned, projectName, logBoth);
        nextStatus = 'running';
        nextLifecycle = 'active';
      } else {
        // deploy / start / rollback -> pull images, then compose up

        // Data-aware rollback (#284 Phase 1): before bringing the target release
        // up, stop the current containers and restore the app-data snapshot taken
        // when the target was last active. Stopping first is essential — we wipe
        // and replace the data dir, which must not happen under live containers.
        // No matching snapshot ⇒ a warning + a containers-only rollback (the data
        // is left as-is rather than failing the rollback outright).
        if (action === 'rollback' && ctx.payload.restoreData === true) {
          const targetReleaseId = (ctx.payload.targetReleaseId as string | undefined) ?? deployment.currentReleaseId ?? '';
          await logBoth('info', 'Data-aware rollback: stopping containers before restoring app data…');
          await this.dockerService.composeDown(this.runtimeDir(deploymentId), projectName);
          await this.restoreAppDataSnapshot(deploymentId, targetReleaseId, logBoth);
        }

        const provisioned = await this.provisionAuth(deployment);
        const composeDir = await this.materializeCompose(deployment, provisioned?.env ?? {});
        // Drop the provisioned OIDC creds file into the data root before `up` so a
        // bundle sidecar can render the app's SSO config for first boot (e.g. Immich).
        if (provisioned) await this.writeOidcCredentialsFile(deployment, provisioned, logBoth);

        // Pull first (generous timeout) so `up` isn't gated on download time —
        // large stacks like Postiz used to be SIGKILLed mid-pull by up's 2-min cap.
        // Resolve any private-registry credential once for both pull and up.
        const registryAuth = await this.resolveRegistryAuth(deployment);
        await logBoth('info', 'Pulling images (first install can take several minutes)…');
        const pull = await this.dockerService.composePull(composeDir, projectName, registryAuth);
        if (!pull.success) throw new Error(`Image pull failed: ${pull.output}`);
        await ctx.setProgress(60);

        // Cooperative cancellation: bail out before recreating containers (the
        // irreversible step) if the job was cancelled during the long pull.
        if (ctx.isCancelled()) throw new JobCancelledError();

        const res = await this.dockerService.composeUp(composeDir, projectName, registryAuth);
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
    // Deletion has no further `deployment_update` (the record is gone), so it
    // needs its own event or the Apps/Deployments lists never learn about it
    // short of a hard refresh.
    this.eventBus?.emit({ type: 'deployment_deleted', data: { deploymentId } });
  }

  /**
   * Run `docker compose down` for a deployment in-line during delete. Tolerates a
   * compose-down failure (e.g. nothing running, or no compose file): deletion must
   * proceed regardless. Unlike the lifecycle job, it never touches/persists the
   * deployment record, so it cannot leave an `error` tombstone for a record that is
   * being removed.
   */
  protected override async teardownContainers(deploymentId: string): Promise<void> {
    const res = await this.dockerService.composeDown(this.runtimeDir(deploymentId), this.projectName(deploymentId));
    if (!res.success) {
      this.logger.warn('compose down reported a failure during delete; continuing with teardown', {
        deploymentId,
        output: res.output,
      });
    }
  }

  protected override async onDeprovision(deployment: EnhancedDeploymentDetail): Promise<void> {
    const auth = deployment.metadata.auth;
    if (!auth) {
      // No provisioned ref recorded. Provisioning may have created Authentik
      // objects and then thrown before persisting the ref (#346 Defect 2), which
      // would otherwise strand them permanently — uninstall couldn't ever remove
      // them. Best-effort clean up by the deterministic names derived from the
      // app's DECLARED auth mode (read from the manifest, still available here).
      const declared = await this.readActiveAuth(deployment);
      if (!declared) return;
      const modes: AuthMode[] = [];
      if (declared.mode !== 'none') modes.push(declared.mode);
      if (declared.fallback === 'forward-auth' && declared.mode !== 'forward-auth') modes.push('forward-auth');
      if (modes.length === 0) return;
      const results = await Promise.allSettled(
        modes.map(mode => this.provisioner.deprovision({ deploymentId: deployment.id, appName: deployment.app, mode }))
      );
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) throw failed.reason;
      return;
    }
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
    // Every durable status change lands here, so this is the single chokepoint to
    // emit a `deployment_update` onto the global event bus (#291) — driving the
    // dashboard's live list/detail without polling.
    this.eventBus?.emit({
      type: 'deployment_update',
      data: { deploymentId: deployment.id, status: deployment.status, uptime: deployment.uptime, lastUpdated: deployment.lastUpdated },
    });
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

  /**
   * Remove the deployment's host bind-mount data root (`<HOLA_APPS_BIND_ROOT>/<id>`).
   * Guarded to only ever delete strictly *within* the apps bind root — never the
   * root itself nor any path escaping it — so a malformed id can't widen the blast
   * radius. No-ops when the dir doesn't exist (apps with no `${HOLA_APP_DATA}` mount
   * never create one), keeping the delete path quiet for those (#341).
   */
  protected override async removeAppData(deploymentId: string): Promise<void> {
    const base = this.appsBindRoot();
    const appRoot = this.appRootFor(deploymentId);
    if (appRoot === base || !appRoot.startsWith(`${base}/`)) {
      this.logger.warn('Refusing to remove app data outside the apps bind root', { deploymentId, appRoot, base });
      return;
    }
    if (!(await dirHasContents(appRoot))) return;
    await this.storageService.deleteDir(appRoot, true);
    this.logger.info('Removed deployment app data root', { deploymentId, appRoot });
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

  /** Mock has no persisted release manifests; the upgrade flow carries no config in tests. */
  async getActiveConfig(): Promise<{ appEnv: Record<string, string>; systemOverrides: Record<string, string> }> {
    return { appEnv: {}, systemOverrides: {} };
  }

  /** Mock has no persisted release manifests (see `getActiveConfig`); the
   *  Configuration tab's GET simply reports an empty config in tests/dev UI —
   *  but still 404s for an unknown id, consistent with every other per-
   *  deployment route (`getDeployment`, `updateDeployment`, etc.). */
  async getConfig(deploymentId: string): Promise<GetDeploymentConfigResponse> {
    this.requireDeployment(deploymentId);
    return { appEnv: [], systemOverrides: {} };
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
