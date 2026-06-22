/**
 * Deployment Lifecycle Tests (issue #15)
 *
 * Exercises real Compose orchestration wiring end-to-end in-process: a deployment
 * action creates a job, the job runs the lifecycle executor (Compose up/down via
 * the Docker service), the deployment converges to a truthful terminal status,
 * and a Compose failure marks both the job and the deployment failed. Uses the
 * success-simulating MockDockerService so it runs without a real Docker daemon.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { RealDeploymentService } from '../../services/core/deployment';
import { MockProvisionerService } from '../../services/core/provisioner';
import { RealDraftService } from '../../services/core/draft';
import { RealStorageService } from '../../services/core/storage';
import { RealRoutingService } from '../../services/core/routing';
import { RealDatabaseService } from '../../services/core/database';
import { RealLoggingService } from '../../services/core/logging';
import { RealJobService } from '../../services/core/jobs';
import { MockDockerService, type DockerService } from '../../services/core/docker';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

function makeCatalog(): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'Gitea', icon: '🍵' }),
    getVersionDetail: async () => ({
      defaultEnv: [],
      defaults: { ports: [{ host: 3000, container: 3000, protocol: 'tcp' as const }], volumes: [] },
    }),
  } as unknown as CatalogArg;
}

function makeValidation(): ValidationArg {
  return {
    validateDraft: async () => ({ ok: true, errors: [], warnings: [] }),
    preflightCheck: async () => ({ ok: true, checks: [] }),
  } as unknown as ValidationArg;
}

const COMPOSE = 'services:\n  gitea:\n    image: gitea/gitea:latest\n';

async function waitForJob(jobs: RealJobService, id: string, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const job = await jobs.getJob(id);
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    if (Date.now() - start > timeoutMs) throw new Error(`Job ${id} did not finish (last status: ${job?.status})`);
    await new Promise(r => setTimeout(r, 10));
  }
}

describe('Deployment lifecycle (real orchestration wiring)', () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-lifecycle-'));
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  function makeSystem(docker: DockerService = new MockDockerService()) {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage);
    const logging = new RealLoggingService(storage);
    const jobs = new RealJobService(database, logging);
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const drafts = new RealDraftService(storage, makeCatalog(), makeValidation());
    const deployments = new RealDeploymentService(storage, jobs, docker, drafts, routing, logging, new MockProvisionerService());
    return { storage, jobs, logging, drafts, deployments };
  }

  async function finalizedDraft(drafts: RealDraftService): Promise<string> {
    const { draftId } = await drafts.createDraft({ appId: 'gitea', version: '1.0.0' });
    await drafts.updateDraft(draftId, { composeOverride: COMPOSE });
    await drafts.finalizeDraft(draftId);
    return draftId;
  }

  test('create -> start job runs Compose up and converges to running', async () => {
    const { jobs, drafts, deployments } = makeSystem();
    const created = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts), name: 'gitea' });
    expect(created.jobId).toBeDefined();

    const job = await waitForJob(jobs, created.jobId!);
    expect(job.status).toBe('completed');

    const detail = await deployments.getDeployment(created.deploymentId);
    expect(detail.status).toBe('running');

    // The compose file was materialized and attached to the Traefik network.
    const materialized = await makeSystem().storage.readFileAsString(`deployments/${created.deploymentId}/runtime/docker-compose.yml`);
    expect(materialized).toContain('hola');
    expect(materialized).toContain('aliases');
    expect(materialized).toContain('external: true');
  });

  test('stop action runs Compose down and converges to stopped', async () => {
    const { jobs, drafts, deployments } = makeSystem();
    const created = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts), name: 'gitea' });
    await waitForJob(jobs, created.jobId!);

    const action = await deployments.executeAction(created.deploymentId, { action: 'stop' });
    const job = await waitForJob(jobs, action.jobId!);
    expect(job.status).toBe('completed');

    expect((await deployments.getDeployment(created.deploymentId)).status).toBe('stopped');
  });

  test('a Compose up failure marks the job and the deployment failed', async () => {
    // Override on a real instance so the other methods (incl. composePull) keep
    // working — only `up` fails, exercising the post-pull failure path.
    const failingDocker = new MockDockerService();
    failingDocker.composeUp = async () => ({ success: false, output: 'mock: compose up failed' });

    const { jobs, drafts, deployments } = makeSystem(failingDocker);
    const created = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts), name: 'gitea' });

    const job = await waitForJob(jobs, created.jobId!);
    expect(job.status).toBe('failed');

    expect((await deployments.getDeployment(created.deploymentId)).status).toBe('error');
  });

  test('an image-pull failure fails the deploy before Compose up runs', async () => {
    const pullFailingDocker = new MockDockerService();
    let upCalled = false;
    pullFailingDocker.composePull = async () => ({ success: false, output: 'denied: requested access to the resource is denied' });
    pullFailingDocker.composeUp = async () => { upCalled = true; return { success: true, output: '' }; };

    const { jobs, drafts, deployments, logging } = makeSystem(pullFailingDocker);
    const created = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts), name: 'gitea' });

    const lines: string[] = [];
    const sub = logging.onLog({ kind: 'deployment', id: created.deploymentId }, (log) => lines.push(log.message));
    const job = await waitForJob(jobs, created.jobId!);
    sub.unsubscribe();

    expect(job.status).toBe('failed');
    expect(upCalled).toBe(false);
    expect((await deployments.getDeployment(created.deploymentId)).status).toBe('error');
    expect(lines.some(m => m.includes('Image pull failed') && m.includes('denied'))).toBe(true);
  });

  test('lifecycle logs are streamed to the deployment log target', async () => {
    const sys = makeSystem();
    const lines: string[] = [];

    const created = await sys.deployments.createFromDraft({ draftId: await finalizedDraft(sys.drafts), name: 'gitea', options: { autoStart: false } });
    const sub = sys.logging.onLog({ kind: 'deployment', id: created.deploymentId }, (log) => lines.push(log.message));

    const action = await sys.deployments.executeAction(created.deploymentId, { action: 'start' });
    await waitForJob(sys.jobs, action.jobId!);
    sub.unsubscribe();

    expect(lines.some(m => m.includes('Starting deployment action'))).toBe(true);
    expect(lines.some(m => m.includes("completed"))).toBe(true);
  });
});
