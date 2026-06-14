/**
 * API contract tests — real services backed by temporary storage (#17).
 *
 * Drives the Draft → Validation → Deployment → Job → Routing boundaries through
 * the REAL service implementations on an isolated temp data dir, with a mock
 * Docker engine (no daemon) and a stub catalog (no network). Proves:
 *  - Compose semantic failures surface through the standard draft validation.
 *  - Host/path routing conflicts are detected; non-conflicting routes are not.
 *  - A deployment is consistent across detail/list/history from one state source.
 *  - State is durable: recreating the services over the same data dir (a
 *    simulated restart) rehydrates the deployment and its routing.
 *
 * Hermetic: temp dir, mock Docker, stub catalog — no external network, no
 * hard-coded home directory, no background process management.
 */

import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';

import { RealDeploymentService } from '../../services/core/deployment';
import { MockProvisionerService } from '../../services/core/provisioner';
import { RealDraftService } from '../../services/core/draft';
import { RealStorageService } from '../../services/core/storage';
import { RealRoutingService } from '../../services/core/routing';
import { RealDatabaseService } from '../../services/core/database';
import { RealLoggingService } from '../../services/core/logging';
import { RealJobService } from '../../services/core/jobs';
import { RealValidationService } from '../../services/core/validation';
import { MockDockerService } from '../../services/core/docker';
import { MockSystemMonitoringService } from '../../services/core/system-monitoring';
import { ValidationError } from '../../middleware/error-mapping';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];

/** Stub catalog so draft creation needs no network (mirrors the #19 fixture). */
function makeCatalog(): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'Fixture', icon: '🧪' }),
    getVersionDetail: async () => ({
      defaultEnv: [],
      defaults: { ports: [{ container: 8080, protocol: 'tcp' as const }], volumes: [] },
    }),
  } as unknown as CatalogArg;
}

const FIXTURE_COMPOSE_PATH = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  'fixtures',
  'integration',
  'docker-compose.yaml',
);

function makeSystem(dataRoot: string) {
  const storage = new RealStorageService({ holaDir: dataRoot });
  const database = new RealDatabaseService(storage);
  const logging = new RealLoggingService(storage);
  const jobs = new RealJobService(database, logging);
  const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
  const docker = new MockDockerService();
  const systemMonitoring = new MockSystemMonitoringService();
  const validation = new RealValidationService(docker, systemMonitoring, storage, routing);
  const drafts = new RealDraftService(storage, makeCatalog(), validation);
  const deployments = new RealDeploymentService(storage, jobs, docker, drafts, routing, logging, new MockProvisionerService());
  return { storage, database, jobs, routing, docker, validation, drafts, deployments };
}

async function waitForJob(jobs: RealJobService, id: string, timeoutMs = 30_000) {
  const start = Date.now();
  for (;;) {
    const job = await jobs.getJob(id);
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    if (Date.now() - start > timeoutMs) throw new Error(`Job ${id} did not finish (last: ${job?.status})`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function finalizedFixtureDraft(drafts: RealDraftService): Promise<string> {
  const compose = await readFile(FIXTURE_COMPOSE_PATH, 'utf8');
  const { draftId } = await drafts.createDraft({ appId: 'fixture', version: '1.0.0' });
  await drafts.updateDraft(draftId, {
    composeOverride: compose,
    ports: [{ container: 8080, protocol: 'tcp' }],
  });
  await drafts.finalizeDraft(draftId);
  return draftId;
}

describe('Contract (real services): draft validation', () => {
  let dataRoot: string;
  afterEach(async () => {
    if (dataRoot) await rm(dataRoot, { recursive: true, force: true });
  });

  test('a host-port compose override fails validation with a structured issue', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-ct-'));
    const { drafts } = makeSystem(dataRoot);
    const { draftId } = await drafts.createDraft({ appId: 'fixture', version: '1.0.0' });
    await drafts.updateDraft(draftId, {
      composeOverride: 'services:\n  web:\n    image: nginx:1.27\n    ports:\n      - "8080:80"\n',
    });

    const report = await drafts.validateDraft(draftId);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.code === 'HOST_PORT_NOT_ALLOWED')).toBe(true);
  });

  test('a malformed compose override is rejected at ingestion with a 400', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-ct-'));
    const { drafts } = makeSystem(dataRoot);
    const { draftId } = await drafts.createDraft({ appId: 'fixture', version: '1.0.0' });

    let thrown: unknown;
    try {
      await drafts.updateDraft(draftId, { composeOverride: 'services: [unclosed' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ValidationError);
    expect((thrown as ValidationError).status).toBe(400);
  });
});

describe('Contract (real services): routing conflicts', () => {
  let dataRoot: string;
  afterEach(async () => {
    if (dataRoot) await rm(dataRoot, { recursive: true, force: true });
  });

  test('an overlapping host conflicts while a distinct host does not', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-ct-'));
    const { routing } = makeSystem(dataRoot);

    const ruleA = routing.generateRule({ deploymentId: 'dep-a', appName: 'grafana' });
    await routing.activateRoute(ruleA);

    // Same app name → same host, owned by a different deployment → conflict.
    const ruleB = routing.generateRule({ deploymentId: 'dep-b', appName: 'grafana' });
    expect((await routing.validateRule(ruleB)).length).toBeGreaterThan(0);

    // Distinct app name → distinct host → no conflict.
    const ruleC = routing.generateRule({ deploymentId: 'dep-c', appName: 'prometheus' });
    expect(await routing.validateRule(ruleC)).toEqual([]);

    // Re-validating the owner's own rule is not a self-conflict.
    expect(await routing.validateRule(ruleA)).toEqual([]);
  });
});

describe('Contract (real services): deployment consistency + durability', () => {
  let dataRoot: string;
  afterEach(async () => {
    if (dataRoot) await rm(dataRoot, { recursive: true, force: true });
  });

  test('a created deployment is consistent across detail/list/history and survives a restart', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-ct-'));
    const sys = makeSystem(dataRoot);

    const draftId = await finalizedFixtureDraft(sys.drafts);
    const created = await sys.deployments.createFromDraft({ draftId, name: 'grafana' });
    expect(created.jobId).toBeDefined();
    expect((await waitForJob(sys.jobs, created.jobId!)).status).toBe('completed');

    // Detail reflects the running state (mock Docker reports success).
    const detail = await sys.deployments.getDeployment(created.deploymentId);
    expect(detail.id).toBe(created.deploymentId);
    expect(detail.status).toBe('running');

    // Same record is visible in the list (one consistent state source).
    const list = await sys.deployments.listDeployments({ page: 1, limit: 100 });
    expect(list.items.some((d) => d.id === created.deploymentId)).toBe(true);

    // The create job is recorded in history.
    const history = await sys.deployments.getDeploymentHistory(created.deploymentId, { page: 1, limit: 100 });
    expect(history.items.some((j) => j.id === created.jobId)).toBe(true);

    // --- Simulated restart: rebuild the services over the same data dir ------
    const restarted = makeSystem(dataRoot);
    const afterRestart = await restarted.deployments.getDeployment(created.deploymentId);
    expect(afterRestart.id).toBe(created.deploymentId);
    expect(afterRestart.status).toBe('running');

    // Routing state is durable too.
    const map = await restarted.routing.getRoutingMap();
    const rules = Object.values(map);
    expect(rules.some((r) => r.deploymentId === created.deploymentId)).toBe(true);
  });
});
