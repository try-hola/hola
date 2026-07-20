/**
 * A corrupt release manifest must stop the operation, not silently change it.
 *
 * The readActive* family was uniformly `fileExists`-guarded and then
 * `catch { return undefined }`, which made a CORRUPT manifest indistinguishable
 * from one that simply omits the field. The consequences were not cosmetic:
 *
 *   - readActiveAuth    -> app deploys with NO auth wiring (silent SSO bypass)
 *   - getActiveConfig   -> promote carries NO env/secrets forward (config loss)
 *   - readActiveAppEnv  -> runtime/.env written empty (opaque crash-loop)
 *
 * All of them now go through readReleaseManifest, which returns undefined only
 * when there is genuinely nothing to read and throws when the file exists but
 * cannot be parsed.
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
import type { DockerService } from '../../services/core/docker';

async function waitForJob(jobs: RealJobService, id: string, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const job = await jobs.getJob(id);
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    if (Date.now() - start > timeoutMs) throw new Error(`Job ${id} did not finish (last status: ${job?.status})`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];
type JobArg = ConstructorParameters<typeof RealDeploymentService>[1];

const makeCatalog = () => ({
  getApp: async (appId: string) => ({ id: appId, name: 'Gitea', icon: '🍵' }),
  getVersionDetail: async () => ({
    defaultEnv: [{ key: 'DB_PASSWORD', value: 's3cret', isSecret: true, description: 'db' }],
    defaults: { ports: [{ container: 3000, protocol: 'tcp' as const }], volumes: [] },
    auth: { mode: 'forward-auth' as const },
  }),
}) as unknown as CatalogArg;

const makeValidation = () => ({
  validateDraft: async () => ({ ok: true, errors: [], warnings: [] }),
  preflightCheck: async () => ({ ok: true, checks: [] }),
}) as unknown as ValidationArg;

const makeJobs = () => {
  const jobs: Array<Record<string, unknown>> = [];
  return {
    createJob: async (p: { type: string; deploymentId?: string }) => {
      const job = { id: crypto.randomUUID(), type: p.type, status: 'queued', startedAt: new Date().toISOString(), deploymentId: p.deploymentId };
      jobs.push(job);
      return job;
    },
    listJobs: async () => jobs,
    cancelJob: async () => {},
    getJob: async () => null,
    onJobUpdate: () => ({ unsubscribe() {} }),
    setExecutor: () => {},
    healthCheck: async () => ({ healthy: true, lastCheck: new Date() }),
  } as unknown as JobArg;
};

const noDocker = {} as unknown as DockerService;
type LoggingArg = ConstructorParameters<typeof RealDeploymentService>[5];
const noLogging = {
  log: async () => {}, onLog: () => ({ unsubscribe() {} }), logJob: async () => {},
  logDeployment: async () => {}, healthCheck: async () => ({ healthy: true, lastCheck: new Date() }),
} as unknown as LoggingArg;

describe('corrupt release manifest', () => {
  let dataRoot: string;
  let storage: RealStorageService;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-corrupt-manifest-'));
    storage = new RealStorageService({ holaDir: dataRoot });
  });
  afterEach(async () => { await rm(dataRoot, { recursive: true, force: true }); });

  function makeSystem() {
    const drafts = new RealDraftService(storage, makeCatalog(), makeValidation());
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const deployments = new RealDeploymentService(storage, makeJobs(), noDocker, drafts, routing, noLogging, new MockProvisionerService());
    return { drafts, deployments };
  }

  async function install() {
    const { drafts, deployments } = makeSystem();
    const { draftId } = await drafts.createDraft({ appId: 'gitea', version: '1.0.0' });
    await drafts.updateDraft(draftId, { composeOverride: 'services:\n  gitea:\n    image: gitea:1.0.0\n' });
    await drafts.finalizeDraft(draftId);
    const dep = await deployments.createFromDraft({ draftId, name: 'gitea', options: { autoStart: false } });
    return { deployments, drafts, ...dep };
  }

  const corrupt = (deploymentId: string, releaseId: string) =>
    storage.writeFile(`deployments/${deploymentId}/releases/${releaseId}/manifest.json`, '{ "auth": tr');

  test('getConfig throws instead of reporting an empty config', async () => {
    const { deployments, deploymentId, releaseId } = await install();
    // Sanity: intact manifest reads fine and carries the app's env.
    expect((await deployments.getConfig(deploymentId)).appEnv.map(e => e.key)).toContain('DB_PASSWORD');

    await corrupt(deploymentId, releaseId);

    await expect(deployments.getConfig(deploymentId)).rejects.toThrow(/unreadable or corrupt/);
  });

  test('getActiveConfig throws rather than dropping the operator config on upgrade', async () => {
    const { deployments, deploymentId, releaseId } = await install();
    expect((await deployments.getActiveConfig(deploymentId)).appEnv.DB_PASSWORD).toBe('s3cret');

    await corrupt(deploymentId, releaseId);

    // Silently returning {} here would promote a new release with none of the
    // operator's env or secrets carried forward.
    await expect(deployments.getActiveConfig(deploymentId)).rejects.toThrow(/unreadable or corrupt/);
  });

  test('the error names the deployment and release so it can be repaired', async () => {
    const { deployments, deploymentId, releaseId } = await install();
    await corrupt(deploymentId, releaseId);

    const err = await deployments.getConfig(deploymentId).catch(e => e);
    expect(err.message).toContain(deploymentId);
    expect(err.message).toContain(releaseId);
    expect(err.status).toBe(500);
  });

  test('a genuinely absent manifest is still treated as "no config", not an error', async () => {
    // The legitimate case the catch existed for must keep working: nothing to
    // read is different from something unreadable.
    const { deployments, deploymentId, releaseId } = await install();
    await storage.deleteFile(`deployments/${deploymentId}/releases/${releaseId}/manifest.json`);

    await expect(deployments.getConfig(deploymentId)).resolves.toEqual({ appEnv: [], systemOverrides: {} });
    await expect(deployments.getActiveConfig(deploymentId)).resolves.toEqual({ appEnv: {}, systemOverrides: {} });
  });

  test('SECURITY: a corrupt manifest fails the deploy instead of shipping the app with no auth', async () => {
    // The headline case. The app declares auth.mode = forward-auth. With the old
    // `catch { return undefined }`, a corrupt manifest read as "no auth block",
    // so the deploy succeeded and the app came up publicly reachable with the SSO
    // gate silently absent. The job must fail instead.
    const storage2 = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage2);
    const logging = new RealLoggingService(storage2);
    const jobs = new RealJobService(database, logging);
    const routing = new RealRoutingService(storage2, { baseDomain: 'example.com' });
    const drafts = new RealDraftService(storage2, makeCatalog(), makeValidation());
    const deployments = new RealDeploymentService(
      storage2, jobs, new MockDockerService(), drafts, routing, logging, new MockProvisionerService(),
    );

    const { draftId } = await drafts.createDraft({ appId: 'gitea', version: '1.0.0' });
    await drafts.updateDraft(draftId, { composeOverride: 'services:\n  gitea:\n    image: gitea:1.0.0\n' });
    await drafts.finalizeDraft(draftId);
    const created = await deployments.createFromDraft({ draftId, name: 'gitea', options: { autoStart: false } });

    await corrupt(created.deploymentId, created.releaseId);

    // Restart drives the same lifecycle job a deploy does.
    const action = await deployments.executeAction(created.deploymentId, { action: 'restart' });
    const job = await waitForJob(jobs, action.jobId!);

    expect(job.status).toBe('failed');
    expect(String(job.error ?? '')).toMatch(/unreadable or corrupt/);
  });

  test('a corrupt manifest never blocks deletion', async () => {
    // Deletion must stay possible — otherwise a corrupt manifest would strand the
    // deployment with no way to remove it. The delete path wraps every step.
    const { deployments, deploymentId, releaseId } = await install();
    await corrupt(deploymentId, releaseId);

    await expect(deployments.deleteDeployment(deploymentId)).resolves.toBeUndefined();
    await expect(deployments.getDeployment(deploymentId)).rejects.toThrow();
  });
});
