/**
 * The resolved-configuration containment gate is wired into every path that
 * brings an app up (F02a).
 *
 * `materializeCompose` is the single call site deliberately: it runs on deploy,
 * start, rollback AND restart, so no lifecycle branch can reach `compose up`
 * without passing through the gate. These pin that placement — a refusal fails
 * the job BEFORE `compose pull`, so nothing was pulled and no container exists
 * — plus the fail-closed behaviour when Compose cannot resolve the document at
 * all.
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

const COMPOSE = 'services:\n  app:\n    image: nginx:1.27\n    volumes:\n      - ${HOLA_APP_DATA}/data:/data\n';

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
 * Docker stub that answers `config` with whatever a test hands it, and records
 * the order of the lifecycle calls so "refused before the pull" is an assertion
 * rather than a hope.
 */
function makeDocker(config: { success: boolean; output: string; config?: unknown }) {
  const base = new MockDockerService();
  const calls: string[] = [];
  const stub = Object.create(base) as DockerService & { calls: string[] };
  stub.calls = calls;
  stub.composeConfig = async () => {
    calls.push('config');
    return config;
  };
  stub.composePull = async (_p: string, projectName: string) => {
    calls.push('pull');
    return { success: true, output: `[stub] ${projectName} pulled` };
  };
  stub.composeUp = async (_p: string, projectName: string) => {
    calls.push('up');
    return { success: true, output: `[stub] ${projectName} up` };
  };
  return stub;
}

describe('resolved-configuration containment gate (F02a)', () => {
  let dataRoot: string;
  let appsRoot: string;
  let prevAppsBindRoot: string | undefined;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-f02-'));
    // The compose under test mounts `${HOLA_APP_DATA}`, which materialisation
    // resolves against this root and creates — point it somewhere writable.
    appsRoot = await mkdtemp(join(tmpdir(), 'hola-f02-apps-'));
    prevAppsBindRoot = process.env.HOLA_APPS_BIND_ROOT;
    process.env.HOLA_APPS_BIND_ROOT = appsRoot;
  });
  afterEach(async () => {
    if (prevAppsBindRoot === undefined) delete process.env.HOLA_APPS_BIND_ROOT;
    else process.env.HOLA_APPS_BIND_ROOT = prevAppsBindRoot;
    await rm(dataRoot, { recursive: true, force: true });
    await rm(appsRoot, { recursive: true, force: true });
  });

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
    const job = await waitForJob(jobs, created.jobId!);
    return { job, deploymentId: created.deploymentId };
  }

  test('a resolved bind source outside the app data root fails the deploy before the pull', async () => {
    // Exactly what the reviewer's `${HOLA_APP_DATA}/${ESCAPE}:/data` resolves to
    // once Compose has interpolated the app's own env.
    const docker = makeDocker({
      success: true,
      output: 'resolved',
      config: {
        services: {
          app: { volumes: [{ type: 'bind', source: '/data/apps/other/../../../var/run', target: '/data' }] },
        },
      },
    });
    const { jobs, drafts, deployments } = makeSystem(docker);
    const { job } = await deploy(drafts, deployments, jobs);

    expect(job.status).toBe('failed');
    expect(job.error ?? '').toContain('outside its own data root');
    // The gate runs inside `materializeCompose`, which is upstream of both:
    // nothing was pulled and nothing was created.
    expect(docker.calls).toEqual(['config']);
  });

  test('a document Compose cannot resolve fails closed', async () => {
    const docker = makeDocker({ success: false, output: 'variable is not set and has no default' });
    const { jobs, drafts, deployments } = makeSystem(docker);
    const { job } = await deploy(drafts, deployments, jobs);

    expect(job.status).toBe('failed');
    expect(job.error ?? '').toContain('Could not resolve the Compose configuration');
    expect(docker.calls).toEqual(['config']);
  });

  test('a contained resolved configuration deploys, gate first then pull then up', async () => {
    const docker = makeDocker({ success: true, output: 'resolved', config: { services: {} } });
    // Answer with the mount this app's compose actually declares, resolved the
    // way materialisation resolves it: `<apps root>/<deployment id>/data`. The
    // project name is `hola-<deployment id>`, which is how the stub learns the
    // id it is being asked about — so this is the real path, not a placeholder.
    docker.composeConfig = async (_path: string, projectName: string) => {
      docker.calls.push('config');
      const appRoot = `${appsRoot}/${projectName.replace(/^hola-/, '')}`;
      return {
        success: true,
        output: 'resolved',
        config: { services: { app: { volumes: [{ type: 'bind', source: `${appRoot}/data`, target: '/data' }] } } },
      };
    };
    const { jobs, drafts, deployments } = makeSystem(docker);
    const { job } = await deploy(drafts, deployments, jobs);

    expect(job.status).toBe('completed');
    expect(docker.calls).toEqual(['config', 'pull', 'up']);
  });

  test('the gate also guards `restart`, which re-materialises and brings up', async () => {
    const docker = makeDocker({ success: true, output: 'resolved', config: { services: {} } });
    const { jobs, drafts, deployments } = makeSystem(docker);
    const { job, deploymentId } = await deploy(drafts, deployments, jobs);
    expect(job.status).toBe('completed');

    // A restart materialises afresh — so a compose that has since become
    // uncontained (an env change, a platform bug) is caught there too.
    docker.calls.length = 0;
    docker.composeConfig = async () => {
      docker.calls.push('config');
      return {
        success: true,
        output: 'resolved',
        config: { services: { app: { volumes: [{ type: 'bind', source: '/etc', target: '/host-etc' }] } } },
      };
    };
    const res = await deployments.executeAction(deploymentId, { action: 'restart' });
    const restartJob = await waitForJob(jobs, res.jobId!);

    expect(restartJob.status).toBe('failed');
    expect(restartJob.error ?? '').toContain('outside its own data root');
    expect(docker.calls).toEqual(['config']);
  });
});
