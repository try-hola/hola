/**
 * Deployment Configuration slice (declarative-drifting-tiger PR 5).
 *
 * Verifies the two halves of the previously-stubbed Configuration tab backend:
 * - `GET /config` (`RealDeploymentService.getConfig`) returns the active
 *   release's full `AppEnvVar` rows — spec intact (type/min/max/etc.), not the
 *   value-only map `getActiveConfig` uses internally for promote's carry-forward.
 * - `updateDeployment` (used by `PATCH /api/deployments/:id`) is now a real,
 *   validating write: an invalid typed value is rejected with a structured 422
 *   (`DraftValidationError`-shaped, listing the offending issue), and a valid
 *   update rewrites the active release's manifest (value changed, spec
 *   preserved) and triggers a real restart job so the change actually deploys.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { RealDeploymentService } from '../../services/core/deployment';
import { RealDraftService } from '../../services/core/draft';
import { RealStorageService } from '../../services/core/storage';
import { RealRoutingService } from '../../services/core/routing';
import { RealDatabaseService } from '../../services/core/database';
import { RealLoggingService } from '../../services/core/logging';
import { RealJobService } from '../../services/core/jobs';
import { MockDockerService } from '../../services/core/docker';
import { MockProvisionerService } from '../../services/core/provisioner';
import type { ApiError } from '../../middleware/error-mapping';
import { setupTestServer, teardownTestServer } from '../utils/bun-server';
import { makeRequest } from '../utils/phase7-helpers';
import type {
  CreateDraftRequest,
  CreateDraftResponse,
  CreateDeploymentFromDraftRequest,
  CreateDeploymentFromDraftResponse,
  GetDeploymentConfigResponse,
} from '@hola/shared';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

function makeCatalog(): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'App', icon: '📦' }),
    getVersionDetail: async () => ({
      version: '1.0.0',
      defaultEnv: [
        {
          key: 'MAX_CONNECTIONS',
          value: '10',
          isSecret: false,
          type: 'integer',
          min: 1,
          max: 100,
          label: 'Max connections',
        },
        { key: 'ADMIN_USER', value: 'admin', isSecret: false },
      ],
      defaults: { ports: [], volumes: [] },
    }),
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
    if (Date.now() - start > timeoutMs) throw new Error(`Job ${id} did not finish (last status: ${job?.status})`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('Deployment configuration (getConfig + real updateDeployment)', () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-deploy-config-'));
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  function makeSystem() {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage);
    const logging = new RealLoggingService(storage);
    const jobs = new RealJobService(database, logging);
    const routing = new RealRoutingService(storage, { baseDomain: 'example.com' });
    const drafts = new RealDraftService(storage, makeCatalog(), makeValidation());
    const docker = new MockDockerService();
    const deployments = new RealDeploymentService(storage, jobs, docker, drafts, routing, logging, new MockProvisionerService());
    return { storage, jobs, drafts, deployments };
  }

  async function createRunningDeployment(drafts: RealDraftService, deployments: RealDeploymentService, jobs: RealJobService) {
    const { draftId } = await drafts.createDraft({ appId: 'myapp', version: '1.0.0' });
    await drafts.updateDraft(draftId, { composeOverride: 'services:\n  myapp:\n    image: myapp:1.0.0\n' });
    await drafts.finalizeDraft(draftId);
    const created = await deployments.createFromDraft({ draftId, name: 'myapp' });
    const job = await waitForJob(jobs, created.jobId!);
    expect(job.status).toBe('completed');
    return created.deploymentId;
  }

  test('getConfig returns full typed appEnv rows (spec intact), not just values', async () => {
    const { drafts, deployments, jobs } = makeSystem();
    const deploymentId = await createRunningDeployment(drafts, deployments, jobs);

    const config = await deployments.getConfig(deploymentId);
    expect(config.systemOverrides).toEqual({});
    const maxConn = config.appEnv.find((e) => e.key === 'MAX_CONNECTIONS');
    expect(maxConn).toBeDefined();
    expect(maxConn!.value).toBe('10');
    // Spec fields carried through, not reduced to a bare value map.
    expect(maxConn!.type).toBe('integer');
    expect(maxConn!.min).toBe(1);
    expect(maxConn!.max).toBe(100);
    expect(maxConn!.label).toBe('Max connections');

    const adminUser = config.appEnv.find((e) => e.key === 'ADMIN_USER');
    expect(adminUser?.value).toBe('admin');
  });

  test('getConfig on an unknown deployment throws a 404, consistent with other deployment routes', async () => {
    const { deployments } = makeSystem();
    let caught: ApiError | undefined;
    try {
      await deployments.getConfig('does-not-exist');
    } catch (err) {
      caught = err as ApiError;
    }
    expect(caught).toBeDefined();
    expect(caught!.code).toBe('NOT_FOUND');
  });

  test('updateDeployment rejects an out-of-range typed value with a structured 422', async () => {
    const { drafts, deployments, jobs, storage } = makeSystem();
    const deploymentId = await createRunningDeployment(drafts, deployments, jobs);

    let caught: ApiError | undefined;
    try {
      await deployments.updateDeployment(deploymentId, {
        env: [{ key: 'MAX_CONNECTIONS', value: '9999', isSecret: false }],
      });
    } catch (err) {
      caught = err as ApiError;
    }

    expect(caught).toBeDefined();
    expect(caught!.status).toBe(422);
    const issues = (caught!.details as { issues?: Array<{ code: string; path?: string }> } | undefined)?.issues;
    expect(issues).toBeDefined();
    expect(issues!.some((i) => i.code === 'PARAM_INTEGER_OUT_OF_RANGE' && i.path === 'env.MAX_CONNECTIONS')).toBe(true);

    // Rejected update must not have touched the persisted manifest.
    const config = await deployments.getConfig(deploymentId);
    expect(config.appEnv.find((e) => e.key === 'MAX_CONNECTIONS')?.value).toBe('10');
    void storage;
  });

  test('updateDeployment persists a valid value (spec preserved) and triggers a real redeploy', async () => {
    const { drafts, deployments, jobs, storage } = makeSystem();
    const deploymentId = await createRunningDeployment(drafts, deployments, jobs);

    const result = await deployments.updateDeployment(deploymentId, {
      env: [
        { key: 'MAX_CONNECTIONS', value: '50', isSecret: false },
        { key: 'ADMIN_USER', value: 'root', isSecret: false },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.jobId).toBeDefined();

    const job = await waitForJob(jobs, result.jobId!);
    expect(job.status).toBe('completed');

    // Value updated, spec preserved (not stripped/forged by the client's bare row).
    const config = await deployments.getConfig(deploymentId);
    const maxConn = config.appEnv.find((e) => e.key === 'MAX_CONNECTIONS');
    expect(maxConn!.value).toBe('50');
    expect(maxConn!.type).toBe('integer');
    expect(maxConn!.min).toBe(1);
    expect(maxConn!.max).toBe(100);
    expect(config.appEnv.find((e) => e.key === 'ADMIN_USER')?.value).toBe('root');

    // The restart job re-materialized Compose from the freshly-rewritten
    // manifest — the runtime .env reflects the new value (real redeploy, not
    // just a durable write that waits for some future natural restart).
    const dotenv = await storage.readFileAsString(`deployments/${deploymentId}/runtime/.env`);
    expect(dotenv).toContain('MAX_CONNECTIONS="50"');
    expect(dotenv).toContain('ADMIN_USER="root"');
  });

  test('a partial env update leaves omitted vars untouched (merge-by-key, issue #332)', async () => {
    const { drafts, deployments, jobs } = makeSystem();
    const deploymentId = await createRunningDeployment(drafts, deployments, jobs);

    // Send ONLY ADMIN_USER. Under the old full-replace this silently wiped
    // MAX_CONNECTIONS; merge-by-key must leave it (and its spec) intact.
    const result = await deployments.updateDeployment(deploymentId, {
      env: [{ key: 'ADMIN_USER', value: 'root', isSecret: false }],
    });
    expect(result.ok).toBe(true);
    await waitForJob(jobs, result.jobId!);

    const config = await deployments.getConfig(deploymentId);
    expect(config.appEnv.find((e) => e.key === 'ADMIN_USER')?.value).toBe('root');
    const maxConn = config.appEnv.find((e) => e.key === 'MAX_CONNECTIONS');
    expect(maxConn?.value).toBe('10'); // NOT dropped
    expect(maxConn?.type).toBe('integer'); // spec still intact
  });

  test('adding a new custom var merges it without dropping existing vars', async () => {
    const { drafts, deployments, jobs } = makeSystem();
    const deploymentId = await createRunningDeployment(drafts, deployments, jobs);

    const result = await deployments.updateDeployment(deploymentId, {
      env: [{ key: 'EXTRA_FLAG', value: 'on', isSecret: false }],
    });
    await waitForJob(jobs, result.jobId!);

    const config = await deployments.getConfig(deploymentId);
    expect(config.appEnv.find((e) => e.key === 'EXTRA_FLAG')?.value).toBe('on');
    expect(config.appEnv.find((e) => e.key === 'MAX_CONNECTIONS')?.value).toBe('10');
    expect(config.appEnv.find((e) => e.key === 'ADMIN_USER')?.value).toBe('admin');
  });

  test('removeEnvKeys deletes the named vars (idempotent) and leaves the rest', async () => {
    const { drafts, deployments, jobs } = makeSystem();
    const deploymentId = await createRunningDeployment(drafts, deployments, jobs);

    // Seed a custom var, then remove it plus a key that never existed.
    await waitForJob(
      jobs,
      (await deployments.updateDeployment(deploymentId, { env: [{ key: 'EXTRA_FLAG', value: 'on', isSecret: false }] })).jobId!,
    );

    const result = await deployments.updateDeployment(deploymentId, {
      removeEnvKeys: ['EXTRA_FLAG', 'NEVER_EXISTED'],
    });
    expect(result.ok).toBe(true);
    await waitForJob(jobs, result.jobId!);

    const config = await deployments.getConfig(deploymentId);
    expect(config.appEnv.some((e) => e.key === 'EXTRA_FLAG')).toBe(false);
    expect(config.appEnv.find((e) => e.key === 'MAX_CONNECTIONS')?.value).toBe('10');
    expect(config.appEnv.find((e) => e.key === 'ADMIN_USER')?.value).toBe('admin');
  });

  test('a combined set + unset applies in a single update', async () => {
    const { drafts, deployments, jobs } = makeSystem();
    const deploymentId = await createRunningDeployment(drafts, deployments, jobs);
    await waitForJob(
      jobs,
      (await deployments.updateDeployment(deploymentId, { env: [{ key: 'OLD', value: '1', isSecret: false }] })).jobId!,
    );

    const result = await deployments.updateDeployment(deploymentId, {
      env: [{ key: 'ADMIN_USER', value: 'root', isSecret: false }],
      removeEnvKeys: ['OLD'],
    });
    await waitForJob(jobs, result.jobId!);

    const config = await deployments.getConfig(deploymentId);
    expect(config.appEnv.find((e) => e.key === 'ADMIN_USER')?.value).toBe('root');
    expect(config.appEnv.some((e) => e.key === 'OLD')).toBe(false);
    expect(config.appEnv.find((e) => e.key === 'MAX_CONNECTIONS')?.value).toBe('10');
  });

  test('updateDeployment with systemOverrides persists them and is reflected in getConfig', async () => {
    const { drafts, deployments, jobs } = makeSystem();
    const deploymentId = await createRunningDeployment(drafts, deployments, jobs);

    const result = await deployments.updateDeployment(deploymentId, {
      systemOverrides: { CUSTOM_DOMAIN: 'app.example.com' },
    });
    expect(result.ok).toBe(true);
    // Synchronize on the triggered restart job so it can't race the next
    // test's `afterEach` (dataRoot cleanup) — see the env-update test above.
    expect(result.jobId).toBeDefined();
    await waitForJob(jobs, result.jobId!);

    const config = await deployments.getConfig(deploymentId);
    expect(config.systemOverrides).toEqual({ CUSTOM_DOMAIN: 'app.example.com' });
  });

  test('a no-op update (no env, no systemOverrides) does not trigger a redeploy', async () => {
    const { drafts, deployments, jobs } = makeSystem();
    const deploymentId = await createRunningDeployment(drafts, deployments, jobs);

    const result = await deployments.updateDeployment(deploymentId, {});
    expect(result.ok).toBe(true);
    expect(result.jobId).toBeUndefined();
  });
});

describe('GET /api/deployments/:id/config (route wiring, Mock services)', () => {
  let baseURL: string;

  beforeEach(async () => {
    baseURL = 'http://localhost:3002';
    await setupTestServer(3002, { NODE_ENV: 'test' });
  });

  afterEach(async () => {
    await teardownTestServer();
  });

  test('returns 200 with the config shape for a known deployment', async () => {
    const createRequest: CreateDraftRequest = { appId: 'nextcloud', version: '1.0.0' };
    const draft = await makeRequest<CreateDraftResponse>({
      method: 'POST',
      url: `${baseURL}/api/drafts`,
      body: createRequest,
    });
    const deploymentRequest: CreateDeploymentFromDraftRequest = { draftId: draft.data!.draftId, name: 'config-route-test' };
    const created = await makeRequest<CreateDeploymentFromDraftResponse>({
      method: 'POST',
      url: `${baseURL}/api/deployments`,
      body: deploymentRequest,
    });
    expect(created.success).toBe(true);

    const config = await makeRequest<GetDeploymentConfigResponse>({
      method: 'GET',
      url: `${baseURL}/api/deployments/${created.data!.deploymentId}/config`,
    });
    expect(config.success).toBe(true);
    expect(Array.isArray(config.data!.appEnv)).toBe(true);
    expect(typeof config.data!.systemOverrides).toBe('object');
  });

  test('returns 404 for an unknown deployment, consistent with sibling routes', async () => {
    const res = await makeRequest({
      method: 'GET',
      url: `${baseURL}/api/deployments/does-not-exist-00000000/config`,
    });
    expect(res.success).toBe(false);
    expect(res.error!.code).toBe('NOT_FOUND');
  });
});
