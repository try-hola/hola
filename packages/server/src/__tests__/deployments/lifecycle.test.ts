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
import { parse } from 'yaml';
import { mkdtemp, rm } from 'fs/promises';
import { existsSync } from 'fs';
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

  test('attaches the manifest-declared ingress service, not the first service', async () => {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage);
    const logging = new RealLoggingService(storage);
    const jobs = new RealJobService(database, logging);
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    // Catalog declares 'web' as the ingress service for a multi-service app whose
    // web service is neither named after the app id ('myapp') nor listed first.
    const catalog = {
      getApp: async (appId: string) => ({ id: appId, name: 'App', icon: '📦' }),
      getVersionDetail: async () => ({
        defaultEnv: [],
        defaults: { ports: [], volumes: [] },
        ingressService: 'web',
      }),
    } as unknown as CatalogArg;
    const drafts = new RealDraftService(storage, catalog, makeValidation());
    const deployments = new RealDeploymentService(storage, jobs, new MockDockerService(), drafts, routing, logging, new MockProvisionerService());

    const multiCompose = 'services:\n  db:\n    image: postgres:16\n  web:\n    image: nginx:1.27\n';
    const { draftId } = await drafts.createDraft({ appId: 'myapp', version: '1.0.0' });
    await drafts.updateDraft(draftId, { composeOverride: multiCompose });
    await drafts.finalizeDraft(draftId);
    const created = await deployments.createFromDraft({ draftId, name: 'myapp' });
    const job = await waitForJob(jobs, created.jobId!);
    expect(job.status).toBe('completed');

    const materialized = await storage.readFileAsString(`deployments/${created.deploymentId}/runtime/docker-compose.yml`);
    const doc = parse(materialized) as { services: Record<string, { networks?: Record<string, unknown> }> };
    // The hola network alias landed on 'web' (the declared ingress), not 'db' (first).
    expect(doc.services.web.networks?.hola).toBeDefined();
    expect(doc.services.db.networks?.hola).toBeUndefined();
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

  test('delete runs compose-down before removing the runtime dir, leaving no error tombstone', async () => {
    // Regression for the uninstall teardown-order race: delete used to enqueue a
    // fire-and-forget `stop` job and then immediately delete the runtime dir. The
    // late job's `compose down` then ran against a missing compose file, failed,
    // and re-persisted the (already removed) deployment with status `error`.
    const downCalls: Array<{ projectPath: string; composeFileExisted: boolean }> = [];
    const docker = new MockDockerService();
    // Mirror real `docker compose down`: it FAILS when the compose file is gone
    // ("no configuration file provided"). The small delay makes the race
    // deterministic — under the buggy fire-and-forget ordering, `removeStorage`
    // always lands before this resolves, so the file is gone and down fails,
    // reproducing the persisted `error` tombstone. Under the fix, down is awaited
    // in-line before storage removal, so the file is always present here.
    docker.composeDown = async (projectPath: string) => {
      await new Promise(r => setTimeout(r, 50));
      const composeFileExisted = existsSync(join(projectPath, 'docker-compose.yml'));
      downCalls.push({ projectPath, composeFileExisted });
      return composeFileExisted
        ? { success: true, output: '[mock] stopped and removed' }
        : { success: false, output: 'no configuration file provided: not found' };
    };

    const { jobs, drafts, deployments } = makeSystem(docker);
    const created = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts), name: 'gitea' });
    await waitForJob(jobs, created.jobId!);

    const runtimeCompose = join(dataRoot, 'deployments', created.deploymentId, 'runtime', 'docker-compose.yml');
    expect(existsSync(runtimeCompose)).toBe(true);

    await deployments.deleteDeployment(created.deploymentId);

    // compose down ran exactly once, and the compose file still existed when it did
    // (i.e. teardown happened BEFORE storage removal, not racing after it).
    expect(downCalls.length).toBe(1);
    expect(downCalls[0].composeFileExisted).toBe(true);

    // Storage is gone now and the deployment is fully removed (404).
    expect(existsSync(runtimeCompose)).toBe(false);
    await expect(deployments.getDeployment(created.deploymentId)).rejects.toThrow();

    // Let any (incorrectly) enqueued late teardown job run to completion, then assert
    // nothing resurrected the record: no in-memory listing, no persisted error
    // tombstone, and no failed teardown job lingering for this deployment.
    await new Promise(r => setTimeout(r, 200));

    const listed = await deployments.listDeployments({});
    expect(listed.items.some(d => d.id === created.deploymentId)).toBe(false);
    expect(listed.items.some(d => d.status === 'error')).toBe(false);

    // A fresh service rehydrating from the same data root must not see a tombstone.
    const rehydrated = makeSystem(new MockDockerService()).deployments;
    const reListed = await rehydrated.listDeployments({});
    expect(reListed.items.some(d => d.id === created.deploymentId)).toBe(false);
    expect(reListed.items.some(d => d.status === 'error')).toBe(false);

    const failedJobs = (await jobs.listJobs({ deploymentId: created.deploymentId, status: 'failed' }));
    expect(failedJobs.length).toBe(0);
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
