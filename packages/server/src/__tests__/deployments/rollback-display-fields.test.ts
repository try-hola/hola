/**
 * #585: a rollback must leave the deployment record reporting the release it
 * rolled back TO — `version` (which drives "update available" and what
 * `hola deployments` says is running) and the cached `icon`, the same
 * catalog-derived display fields `promote` syncs.
 *
 * Both are synced at request time, right after the release pointer moves —
 * the point `promote` syncs them — so the record names the release the
 * `currentReleaseId` pointer names whether or not the job then succeeds. The
 * failed-job test pins that choice.
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
import { MockDockerService } from '../../services/core/docker';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

// The icon the catalog serves for the NEXT draft created — lets a test give
// each release a distinct icon.
let currentIcon = '🍵';

function makeCatalog(): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'Gitea', icon: currentIcon }),
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

/** A daemon on which `compose up` fails — the rolled-back release never starts. */
class FailingUpDocker extends MockDockerService {
  override async composeUp(): Promise<{ success: boolean; output: string }> {
    return { success: false, output: 'container hola-gitea-1 is unhealthy' };
  }
}

const COMPOSE = 'services:\n  gitea:\n    image: gitea/gitea:1.27.3\n';

async function waitForJob(jobs: RealJobService, id: string, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const job = await jobs.getJob(id);
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    if (Date.now() - start > timeoutMs) throw new Error(`Job ${id} did not finish (last: ${job?.status})`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('rollback syncs the record to the release rolled back to (#585)', () => {
  let dataRoot: string;
  let appsRoot: string;
  let prevAppsBindRoot: string | undefined;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-rb-display-data-'));
    appsRoot = await mkdtemp(join(tmpdir(), 'hola-rb-display-apps-'));
    prevAppsBindRoot = process.env.HOLA_APPS_BIND_ROOT;
    process.env.HOLA_APPS_BIND_ROOT = appsRoot;
    currentIcon = '🍵';
  });

  afterEach(async () => {
    if (prevAppsBindRoot === undefined) delete process.env.HOLA_APPS_BIND_ROOT;
    else process.env.HOLA_APPS_BIND_ROOT = prevAppsBindRoot;
    await rm(dataRoot, { recursive: true, force: true });
    await rm(appsRoot, { recursive: true, force: true });
  });

  function makeSystem(docker: MockDockerService = new MockDockerService()) {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage);
    const logging = new RealLoggingService(storage);
    const jobs = new RealJobService(database, logging);
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const drafts = new RealDraftService(storage, makeCatalog(), makeValidation());
    const deployments = new RealDeploymentService(storage, jobs, docker, drafts, routing, logging, new MockProvisionerService());
    return { jobs, drafts, deployments };
  }

  async function finalizedDraft(drafts: RealDraftService, version: string): Promise<string> {
    const { draftId } = await drafts.createDraft({ appId: 'gitea', version });
    await drafts.updateDraft(draftId, { composeOverride: COMPOSE });
    await drafts.finalizeDraft(draftId);
    return draftId;
  }

  test('after a successful rollback, version and icon report the target release', async () => {
    const { jobs, drafts, deployments } = makeSystem();
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '2.0.2'), name: 'gitea', options: { autoStart: false } });
    const release1 = dep.releaseId;

    currentIcon = '🐙';
    await deployments.promote(dep.deploymentId, { draftId: await finalizedDraft(drafts, '3.0.0-rc.1'), options: { autoStart: false } });
    const upgraded = await deployments.getDeployment(dep.deploymentId);
    expect(upgraded.version).toBe('3.0.0-rc.1');
    expect(upgraded.icon).toBe('🐙');

    const rb = await deployments.rollback(dep.deploymentId, { targetReleaseId: release1 });
    const job = await waitForJob(jobs, rb.jobId);
    expect(job.status).toBe('completed');

    const after = await deployments.getDeployment(dep.deploymentId);
    expect(after.version).toBe('2.0.2');
    expect(after.icon).toBe('🍵');
    // And from the list surface `hola deployments` reads.
    const listed = (await deployments.listDeployments({})).items.find((d) => d.id === dep.deploymentId);
    expect(listed?.version).toBe('2.0.2');
  });

  test('a rolled-back-to version is synced even when the rollback job then fails (matches promote)', async () => {
    const { jobs, drafts, deployments } = makeSystem(new FailingUpDocker());
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '2.0.2'), name: 'gitea', options: { autoStart: false } });
    const release1 = dep.releaseId;
    await deployments.promote(dep.deploymentId, { draftId: await finalizedDraft(drafts, '3.0.0-rc.1'), options: { autoStart: false } });

    const rb = await deployments.rollback(dep.deploymentId, { targetReleaseId: release1 });
    const job = await waitForJob(jobs, rb.jobId);
    expect(job.status).toBe('failed');

    // The active-release pointer moved at request time and stays on the target
    // (a retry/restart materializes it), so the version reported is that
    // release's — never the release the record no longer points at.
    const after = (await deployments.listDeployments({})).items.find((d) => d.id === dep.deploymentId);
    expect(after?.status).toBe('error');
    expect(after?.version).toBe('2.0.2');
    const history = await deployments.getDeployment(dep.deploymentId);
    expect(history.version).toBe('2.0.2');
  });

  test('promote still syncs version + icon through the shared helper', async () => {
    const { drafts, deployments } = makeSystem();
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '1.0.0'), name: 'gitea', options: { autoStart: false } });
    currentIcon = '🦊';
    await deployments.promote(dep.deploymentId, { draftId: await finalizedDraft(drafts, '1.1.0'), options: { autoStart: false } });
    const after = await deployments.getDeployment(dep.deploymentId);
    expect(after.version).toBe('1.1.0');
    expect(after.icon).toBe('🦊');
  });
});
