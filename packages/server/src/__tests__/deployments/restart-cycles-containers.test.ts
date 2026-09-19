/**
 * `restart` actually cycles the app's containers (#457).
 *
 * The restart action runs `docker compose up -d` — deliberately, so the freshly
 * materialized compose is re-read — but `up -d` recreates ONLY the services
 * whose config changed. For a deployment whose compose is unchanged that is a
 * no-op, and restart used to report success having cycled nothing. These pin the
 * follow-up pass: services `up -d` left alone are restarted explicitly, ones it
 * recreated are not restarted twice, and a container that was not running is
 * left where it is.
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
import { MockDockerService, type ComposeProject, type ComposeService, type DockerService } from '../../services/core/docker';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

const COMPOSE = 'services:\n  app:\n    image: nginx:1.27\n  init:\n    image: busybox:1.36\n';

function makeCatalog(): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'App', icon: '📦' }),
    getVersionDetail: async () => ({ defaultEnv: [], defaults: { ports: [], volumes: [] } }),
  } as unknown as CatalogArg;
}
function makeValidation(): ValidationArg {
  return {
    validateDraft: async () => ({ ok: true, errors: [], warnings: [] }),
    preflightCheck: async () => ({ ok: true, checks: [] }),
  } as unknown as ValidationArg;
}

async function waitForJob(jobs: RealJobService, id: string, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const job = await jobs.getJob(id);
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    if (Date.now() - start > timeoutMs) throw new Error(`Job ${id} did not finish (last: ${job?.status})`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/**
 * Docker stub whose `ps` answers from a script of snapshots: one per call, so a
 * test can say "these were the containers before `up -d`, these after". Records
 * every `composeRestart` service name.
 */
function makeDocker(snapshots: ComposeService[][]): DockerService & { restarts: string[] } {
  const base = new MockDockerService();
  let call = 0;
  const restarts: string[] = [];
  const stub = Object.create(base) as DockerService & { restarts: string[] };
  stub.restarts = restarts;
  stub.composePs = async (_p: string, projectName: string): Promise<ComposeProject> => {
    const services = snapshots[Math.min(call, snapshots.length - 1)] ?? [];
    call += 1;
    return { name: projectName, services, configFiles: [] };
  };
  stub.composeRestart = async (_p: string, _n: string, serviceName?: string) => {
    if (serviceName) restarts.push(serviceName);
    return { success: true, output: '[stub] restarted' };
  };
  return stub;
}

const svc = (name: string, id: string, state: ComposeService['state'] = 'running'): ComposeService => ({
  name,
  id,
  state,
  status: state,
  image: 'img:1',
  ports: [],
});

describe('restart cycles the containers up -d left alone (#457)', () => {
  let dataRoot: string;
  beforeEach(async () => { dataRoot = await mkdtemp(join(tmpdir(), 'hola-restart-')); });
  afterEach(async () => { await rm(dataRoot, { recursive: true, force: true }); });

  function makeSystem(docker: DockerService) {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage);
    const logging = new RealLoggingService(storage);
    const jobs = new RealJobService(database, logging);
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const drafts = new RealDraftService(storage, makeCatalog(), makeValidation());
    const deployments = new RealDeploymentService(storage, jobs, docker, drafts, routing, logging, new MockProvisionerService());
    return { jobs, drafts, deployments };
  }

  async function deploy(drafts: RealDraftService, deployments: RealDeploymentService, jobs: RealJobService) {
    const { draftId } = await drafts.createDraft({ appId: 'app', version: '1.0.0' });
    await drafts.updateDraft(draftId, { composeOverride: COMPOSE });
    await drafts.finalizeDraft(draftId);
    const created = await deployments.createFromDraft({ draftId, name: 'app' });
    await waitForJob(jobs, created.jobId!);
    return created.deploymentId;
  }

  test('an unchanged running service is restarted explicitly', async () => {
    // Same container id before and after `up -d` — compose left it alone, which
    // is exactly the case that used to silently do nothing.
    const docker = makeDocker([[svc('app', 'c1')], [svc('app', 'c1')]]);
    const { jobs, drafts, deployments } = makeSystem(docker);
    const id = await deploy(drafts, deployments, jobs);
    docker.restarts.length = 0;

    const res = await deployments.executeAction(id, { action: 'restart' });
    const job = await waitForJob(jobs, res.jobId!);
    expect(job.status).toBe('completed');
    expect(docker.restarts).toEqual(['app']);
  });

  test('a service up -d recreated is NOT restarted a second time', async () => {
    // New container id => it already cycled.
    const docker = makeDocker([[svc('app', 'c1')], [svc('app', 'c2')]]);
    const { jobs, drafts, deployments } = makeSystem(docker);
    const id = await deploy(drafts, deployments, jobs);
    docker.restarts.length = 0;

    await waitForJob(jobs, (await deployments.executeAction(id, { action: 'restart' })).jobId!);
    expect(docker.restarts).toEqual([]);
  });

  test('an exited one-shot init container is left exited, not re-run', async () => {
    const docker = makeDocker([
      [svc('app', 'c1'), svc('init', 'i1', 'exited')],
      [svc('app', 'c1'), svc('init', 'i1', 'exited')],
    ]);
    const { jobs, drafts, deployments } = makeSystem(docker);
    const id = await deploy(drafts, deployments, jobs);
    docker.restarts.length = 0;

    await waitForJob(jobs, (await deployments.executeAction(id, { action: 'restart' })).jobId!);
    expect(docker.restarts).toEqual(['app']);
  });

  test('a restart failure does not fail the job — up -d already succeeded', async () => {
    const docker = makeDocker([[svc('app', 'c1')], [svc('app', 'c1')]]);
    docker.composeRestart = async () => ({ success: false, output: 'daemon said no' });
    const { jobs, drafts, deployments } = makeSystem(docker);
    const id = await deploy(drafts, deployments, jobs);

    const job = await waitForJob(jobs, (await deployments.executeAction(id, { action: 'restart' })).jobId!);
    expect(job.status).toBe('completed');
    const detail = await deployments.getDeployment(id);
    expect(detail.status).toBe('running');
  });

  test('an unreadable compose state restarts nothing rather than guessing', async () => {
    const docker = makeDocker([[svc('app', 'c1')]]);
    docker.composePs = async () => { throw new Error('daemon unreachable'); };
    const { jobs, drafts, deployments } = makeSystem(docker);
    const id = await deploy(drafts, deployments, jobs);
    docker.restarts.length = 0;

    const job = await waitForJob(jobs, (await deployments.executeAction(id, { action: 'restart' })).jobId!);
    expect(job.status).toBe('completed');
    expect(docker.restarts).toEqual([]);
  });
});
