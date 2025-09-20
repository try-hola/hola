/**
 * Deployment Service - Phase 7
 * 
 * Manages the full deployment lifecycle including creation from drafts,
 * release management, and deployment actions (start/stop/restart/delete/rollback).
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
import type { HealthCheckable, ServiceHealth } from './types';
import type { StorageService } from './storage';
import type { JobService } from './jobs';
import type { DockerService } from './docker';

export interface DeploymentService extends HealthCheckable {
  // Deployment lifecycle
  createFromDraft(request: CreateDeploymentFromDraftRequest): Promise<CreateDeploymentFromDraftResponse>;
  
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

export class RealDeploymentService implements DeploymentService {
  private logger = getLogger().child({ service: 'DeploymentService' });
  private deployments = new Map<string, EnhancedDeploymentDetail>();
  private releases = new Map<string, Release>();

  constructor(
    private storageService: StorageService,
    private jobService: JobService,
    private dockerService: DockerService
  ) {}

  async healthCheck(): Promise<ServiceHealth> {
    try {
      // Check if we can access storage and create deployment directory
      await this.storageService.ensureDir('deployments');
      
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

  async createFromDraft(request: CreateDeploymentFromDraftRequest): Promise<CreateDeploymentFromDraftResponse> {
    const deploymentId = crypto.randomUUID();
    const releaseId = crypto.randomUUID();
    
    this.logger.info('Creating deployment from draft', { 
      deploymentId, 
      releaseId, 
      draftId: request.draftId,
      name: request.name
    });

    try {
      // Create deployment directory structure
      const layout = await this.getDirectoryLayout(deploymentId);
      await this.storageService.ensureDir(layout.deploymentPath);
      await this.storageService.ensureDir(layout.draftsPath);
      await this.storageService.ensureDir(layout.releasesPath);
      await this.storageService.ensureDir(layout.logsPath);

      // Create initial deployment record
      const deployment: EnhancedDeploymentDetail = {
        id: deploymentId,
        name: request.name || `deployment-${deploymentId.slice(0, 8)}`,
        app: 'Unknown App', // Will be updated from draft
        icon: '📦',
        status: 'installing',
        lifecycleState: 'releasing',
        currentReleaseId: releaseId,
        draftId: request.draftId,
        rollbackAvailable: false,
        resources: { cpu: '0%', memory: '0MB' },
        ports: [],
        lastUpdated: new Date().toISOString(),
        metadata: {
          createdAt: new Date().toISOString(),
          owner: 'system',
          tags: [],
        },
      };

      // Store deployment
      this.deployments.set(deploymentId, deployment);

      // Create initial release
      const release: Release = {
        id: releaseId,
        deploymentId,
        draftId: request.draftId,
        status: 'creating',
        createdAt: new Date().toISOString(),
        images: [],
        ports: [],
        filesChecksums: {},
      };

      this.releases.set(releaseId, release);

      // Persist to storage
      await this.storageService.writeFile(
        `deployments/${deploymentId}/metadata.json`,
        JSON.stringify(deployment, null, 2)
      );

      await this.storageService.writeFile(
        `deployments/${deploymentId}/releases/${releaseId}/metadata.json`,
        JSON.stringify(release, null, 2)
      );

      let jobId: string | undefined;

      // Optionally start deployment immediately
      if (request.options?.autoStart !== false) {
        const job = await this.jobService.createJob({
          type: 'start',
          deploymentId,
          payload: { releaseId, action: 'deploy' },
        });
        jobId = job.id;
        
        this.logger.info('Deployment job created', { deploymentId, releaseId, jobId });
      }

      return {
        deploymentId,
        releaseId,
        jobId,
      };
    } catch (error) {
      this.logger.error('Failed to create deployment from draft', error as Error, {
        deploymentId,
        draftId: request.draftId,
      });
      throw error;
    }
  }

  async listDeployments(request: GetDeploymentsRequest): Promise<GetDeploymentsResponse> {
    this.logger.info('Listing deployments', { request });

    const deployments = Array.from(this.deployments.values());
    
    // Apply filters
    let filtered = deployments;
    
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

    // Apply pagination
    const page = request.page || 1;
    const limit = request.limit || 12;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    
    const paginatedDeployments = filtered.slice(startIndex, endIndex);

    // Convert to list items
    const items: DeploymentListItem[] = paginatedDeployments.map(d => ({
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
    }));

    return {
      items,
      page,
      limit,
      total: filtered.length,
    };
  }

  async getDeployment(deploymentId: string): Promise<GetDeploymentResponse> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    this.logger.info('Getting deployment', { deploymentId });

    return {
      id: deployment.id,
      name: deployment.name,
      app: deployment.app,
      icon: deployment.icon,
      status: deployment.status,
      uptime: deployment.uptime,
      version: deployment.version,
      url: deployment.url,
      resources: deployment.resources,
      ports: deployment.ports,
      lastUpdated: deployment.lastUpdated,
    };
  }

  async updateDeployment(deploymentId: string, request: PatchDeploymentRequest): Promise<PatchDeploymentResponse> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    this.logger.info('Updating deployment', { deploymentId, request });

    // Update deployment fields
    if (request.env) {
      // In a real implementation, this would trigger a new release
      this.logger.info('Environment variables updated', { deploymentId, envCount: request.env.length });
    }

    if (request.systemOverrides) {
      this.logger.info('System overrides updated', { deploymentId, overrides: request.systemOverrides });
    }

    deployment.lastUpdated = new Date().toISOString();
    this.deployments.set(deploymentId, deployment);

    // Persist changes
    await this.storageService.writeFile(
      `deployments/${deploymentId}/metadata.json`,
      JSON.stringify(deployment, null, 2)
    );

    return { ok: true };
  }

  async deleteDeployment(deploymentId: string): Promise<void> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    this.logger.info('Deleting deployment', { deploymentId });

    try {
      // Stop any running containers first
      await this.executeAction(deploymentId, { action: 'stop' });
    } catch (error) {
      this.logger.warn('Failed to stop deployment before deletion', { deploymentId, error: error instanceof Error ? error.message : String(error) });
    }

    // Remove from memory
    this.deployments.delete(deploymentId);

    // Remove releases
    for (const [releaseId, release] of this.releases.entries()) {
      if (release.deploymentId === deploymentId) {
        this.releases.delete(releaseId);
      }
    }

    // Remove from storage
    try {
      await this.storageService.deleteDir(`deployments/${deploymentId}`, true);
    } catch (error) {
      this.logger.warn('Failed to delete deployment storage', { deploymentId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async executeAction(deploymentId: string, request: PostDeploymentActionRequest): Promise<PostDeploymentActionResponse> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    this.logger.info('Executing deployment action', { deploymentId, action: request.action });

    try {
      // Create job for the action
      const job = await this.jobService.createJob({
        type: this.mapActionToJobType(request.action),
        deploymentId,
        payload: { action: request.action },
      });

      // Update deployment status based on action
      switch (request.action) {
        case 'start':
          deployment.status = 'installing';
          deployment.lifecycleState = 'releasing';
          break;
        case 'stop':
          deployment.status = 'stopped';
          deployment.lifecycleState = 'stopped';
          break;
        case 'restart':
          deployment.status = 'installing';
          deployment.lifecycleState = 'releasing';
          break;
        case 'delete':
          deployment.status = 'stopped';
          deployment.lifecycleState = 'stopped';
          break;
      }

      deployment.lastUpdated = new Date().toISOString();
      this.deployments.set(deploymentId, deployment);

      return {
        ok: true,
        jobId: job.id,
      };
    } catch (error) {
      this.logger.error('Failed to execute deployment action', error as Error, { deploymentId, action: request.action });
      throw error;
    }
  }

  async rollback(deploymentId: string, request: RollbackRequest): Promise<RollbackResponse> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    this.logger.info('Rolling back deployment', { deploymentId, targetReleaseId: request.targetReleaseId });

    // Find target release
    let targetReleaseId = request.targetReleaseId;
    if (!targetReleaseId) {
      // Find previous successful release
      const releases = Array.from(this.releases.values())
        .filter(r => r.deploymentId === deploymentId && r.status === 'active')
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      if (releases.length < 2) {
        throw new Error('No previous release available for rollback');
      }
      
      targetReleaseId = releases[1].id; // Second most recent
    }

    const targetRelease = this.releases.get(targetReleaseId);
    if (!targetRelease) {
      throw new Error(`Target release not found: ${targetReleaseId}`);
    }

    // Create rollback job
    const job = await this.jobService.createJob({
      type: 'start',
      deploymentId,
      payload: { 
        action: 'rollback', 
        targetReleaseId,
        reason: request.reason,
      },
    });

    deployment.status = 'installing';
    deployment.lifecycleState = 'releasing';
    deployment.lastUpdated = new Date().toISOString();
    this.deployments.set(deploymentId, deployment);

    return {
      jobId: job.id,
      targetReleaseId,
      previousReleaseId: deployment.currentReleaseId || '',
    };
  }

  async getDeploymentHistory(
    deploymentId: string, 
    options?: { page?: number; limit?: number }
  ): Promise<GetDeploymentHistoryResponse> {
    this.logger.info('Getting deployment history', { deploymentId, options });

    // Get jobs for this deployment
    const jobs = await this.jobService.listJobs({ deploymentId });
    
    // Apply pagination
    const page = options?.page || 1;
    const limit = options?.limit || 10;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    
    const paginatedJobs = jobs.slice(startIndex, endIndex);

    // Convert to history items
    const items = paginatedJobs.map(job => ({
      id: job.id,
      type: job.type,
      status: job.status,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    }));

    return {
      items,
      page,
      limit,
      total: jobs.length,
    };
  }

  async getReleases(deploymentId: string): Promise<Release[]> {
    return Array.from(this.releases.values())
      .filter(r => r.deploymentId === deploymentId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getRelease(deploymentId: string, releaseId: string): Promise<Release> {
    const release = this.releases.get(releaseId);
    if (!release || release.deploymentId !== deploymentId) {
      throw new Error(`Release not found: ${releaseId}`);
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
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    deployment.lifecycleState = state;
    deployment.lastUpdated = new Date().toISOString();
    this.deployments.set(deploymentId, deployment);

    // Persist changes
    await this.storageService.writeFile(
      `deployments/${deploymentId}/metadata.json`,
      JSON.stringify(deployment, null, 2)
    );
  }

  private mapActionToJobType(action: DeploymentAction): Job['type'] {
    switch (action) {
      case 'start':
      case 'restart':
        return 'start';
      case 'stop':
        return 'stop';
      case 'delete':
        return 'backup'; // Create backup before delete
      case 'rollback':
        return 'start';
      default:
        return 'start';
    }
  }
}

export class MockDeploymentService implements DeploymentService {
  private logger = getLogger().child({ service: 'MockDeploymentService' });

  async healthCheck(): Promise<ServiceHealth> {
    return {
      healthy: true,
      lastCheck: new Date(),
    };
  }

  async createFromDraft(request: CreateDeploymentFromDraftRequest): Promise<CreateDeploymentFromDraftResponse> {
    const deploymentId = crypto.randomUUID();
    const releaseId = crypto.randomUUID();
    
    this.logger.info('Mock: Creating deployment from draft', { 
      deploymentId, 
      releaseId, 
      draftId: request.draftId
    });

    return {
      deploymentId,
      releaseId,
      jobId: crypto.randomUUID(),
    };
  }

  async listDeployments(request: GetDeploymentsRequest): Promise<GetDeploymentsResponse> {
    this.logger.info('Mock: Listing deployments', { request });

    const items: DeploymentListItem[] = [
      {
        id: 'deploy-1',
        name: 'Mock App 1',
        app: 'nextcloud',
        icon: '☁️',
        status: 'running',
        uptime: '2d 4h',
        version: '1.0.0',
        resources: { cpu: '15%', memory: '256MB' },
        ports: ['8080:80'],
        lastUpdated: new Date().toISOString(),
        url: 'http://localhost:8080',
      },
      {
        id: 'deploy-2',
        name: 'Mock App 2',
        app: 'homeassistant',
        icon: '🏠',
        status: 'stopped',
        resources: { cpu: '0%', memory: '0MB' },
        ports: ['8123:8123'],
        lastUpdated: new Date(Date.now() - 3600000).toISOString(),
      },
    ];

    return {
      items,
      page: 1,
      limit: 12,
      total: items.length,
    };
  }

  async getDeployment(deploymentId: string): Promise<GetDeploymentResponse> {
    this.logger.info('Mock: Getting deployment', { deploymentId });

    return {
      id: deploymentId,
      name: 'Mock Deployment',
      app: 'nextcloud',
      icon: '☁️',
      status: 'running',
      uptime: '2d 4h',
      version: '1.0.0',
      url: 'http://localhost:8080',
      resources: { cpu: '15%', memory: '256MB', disk: '2.1GB' },
      ports: ['8080:80'],
      lastUpdated: new Date().toISOString(),
    };
  }

  async updateDeployment(deploymentId: string, request: PatchDeploymentRequest): Promise<PatchDeploymentResponse> {
    this.logger.info('Mock: Updating deployment', { deploymentId, request });
    return { ok: true };
  }

  async deleteDeployment(deploymentId: string): Promise<void> {
    this.logger.info('Mock: Deleting deployment', { deploymentId });
  }

  async executeAction(deploymentId: string, request: PostDeploymentActionRequest): Promise<PostDeploymentActionResponse> {
    this.logger.info('Mock: Executing deployment action', { deploymentId, action: request.action });
    
    return {
      ok: true,
      jobId: crypto.randomUUID(),
    };
  }

  async rollback(deploymentId: string, request: RollbackRequest): Promise<RollbackResponse> {
    this.logger.info('Mock: Rolling back deployment', { deploymentId, request });
    
    return {
      jobId: crypto.randomUUID(),
      targetReleaseId: 'mock-release-1',
      previousReleaseId: 'mock-release-2',
    };
  }

  async getDeploymentHistory(
    deploymentId: string, 
    options?: { page?: number; limit?: number }
  ): Promise<GetDeploymentHistoryResponse> {
    this.logger.info('Mock: Getting deployment history', { deploymentId, options });

    return {
      items: [
        {
          id: 'job-1',
          type: 'start',
          status: 'completed',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      ],
      page: 1,
      limit: 10,
      total: 1,
    };
  }

  async getReleases(deploymentId: string): Promise<Release[]> {
    this.logger.info('Mock: Getting releases', { deploymentId });
    
    return [
      {
        id: 'release-1',
        deploymentId,
        draftId: 'draft-1',
        status: 'active',
        createdAt: new Date().toISOString(),
        deployedAt: new Date().toISOString(),
        images: [{ name: 'nginx', tag: 'latest' }],
        ports: [{ host: 8080, container: 80, protocol: 'tcp' }],
        filesChecksums: {},
      },
    ];
  }

  async getRelease(deploymentId: string, releaseId: string): Promise<Release> {
    this.logger.info('Mock: Getting release', { deploymentId, releaseId });
    
    return {
      id: releaseId,
      deploymentId,
      draftId: 'draft-1',
      status: 'active',
      createdAt: new Date().toISOString(),
      deployedAt: new Date().toISOString(),
      images: [{ name: 'nginx', tag: 'latest' }],
      ports: [{ host: 8080, container: 80, protocol: 'tcp' }],
      filesChecksums: {},
    };
  }

  async getDirectoryLayout(deploymentId: string): Promise<DeploymentDirectoryLayout> {
    return {
      deploymentPath: `deployments/${deploymentId}`,
      draftsPath: `deployments/${deploymentId}/drafts`,
      releasesPath: `deployments/${deploymentId}/releases`,
      currentReleasePath: `deployments/${deploymentId}/current`,
      logsPath: `deployments/${deploymentId}/logs`,
      backupsPath: `deployments/${deploymentId}/backups`,
    };
  }

  async updateLifecycleState(deploymentId: string, state: DeploymentLifecycleState): Promise<void> {
    this.logger.info('Mock: Updating lifecycle state', { deploymentId, state });
  }
}
