/**
 * Catalog → deploy, end-to-end (#82, real daemon)
 *
 * Proves a draft whose composeOverride is *seeded from the catalog bundle* (not
 * pasted by the user via updateDraft) deploys and is routable. This exercises the
 * #82 change in RealDraftService.createDraft: getVersionDetail().composeOverride
 * flows into draft.composeOverride → finalize → release → Compose up → Traefik
 * route — without ORAS/GHCR (the catalog is stubbed to return the fixture compose,
 * exactly what RealCatalogService would surface from a real bundle).
 *
 * Gated on a reachable Docker daemon (run via `bun test:integration`); mirrors the
 * setup/cleanup discipline of docker-orchestration.it.ts.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';

import { RealDeploymentService } from '../../services/core/deployment';
import { RealDraftService } from '../../services/core/draft';
import { RealStorageService } from '../../services/core/storage';
import { RealRoutingService } from '../../services/core/routing';
import { RealDatabaseService } from '../../services/core/database';
import { RealLoggingService } from '../../services/core/logging';
import { RealJobService } from '../../services/core/jobs';
import { RealDockerService } from '../../services/core/docker';

const execAsync = promisify(exec);

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

const FIXTURE_COMPOSE_PATH = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  'fixtures',
  'integration',
  'docker-compose.yaml'
);

/**
 * Catalog stub standing in for RealCatalogService: getVersionDetail surfaces the
 * bundle compose as composeOverride plus the ingress port, exactly as the real
 * service does after reading compose.yaml/manifest.json from a pulled bundle.
 */
function makeCatalog(composeOverride: string): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'Fixture', icon: '🧪' }),
    getVersionDetail: async () => ({
      defaultEnv: [],
      defaults: { ports: [{ container: 8080, protocol: 'tcp' as const }], volumes: [] },
      composeOverride,
    }),
  } as unknown as CatalogArg;
}

function makeValidation(): ValidationArg {
  return {
    validateDraft: async () => ({ ok: true, errors: [], warnings: [] }),
    preflightCheck: async () => ({ ok: true, checks: [] }),
  } as unknown as ValidationArg;
}

async function sh(cmd: string): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 60_000 });
    return { stdout, stderr, ok: true };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '', ok: false };
  }
}

async function detectDocker(): Promise<boolean> {
  const res = await sh('docker version --format "{{.Server.Version}}"');
  return res.ok && res.stdout.trim().length > 0;
}

const dockerOk = await detectDocker();
if (!dockerOk) {
  console.warn('[#82] Docker unavailable — skipping catalog → deploy integration test');
}

async function waitForJob(jobs: RealJobService, id: string, timeoutMs = 120_000) {
  const start = Date.now();
  for (;;) {
    const job = await jobs.getJob(id);
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    if (Date.now() - start > timeoutMs) throw new Error(`Job ${id} did not finish (last status: ${job?.status})`);
    await new Promise(r => setTimeout(r, 200));
  }
}

async function containerId(project: string, service: string): Promise<string> {
  const res = await sh(
    `docker ps -aq --filter "label=com.docker.compose.project=${project}" --filter "label=com.docker.compose.service=${service}"`
  );
  return res.stdout.trim().split('\n').filter(Boolean)[0] ?? '';
}

describe.skipIf(!dockerOk)('Catalog → deploy (real daemon)', () => {
  let dataRoot: string;
  let createdHolaNetwork = false;
  let projects: string[];
  const allProjects: string[] = [];

  beforeAll(async () => {
    const inspectHola = await sh('docker network inspect hola');
    if (!inspectHola.ok) {
      const created = await sh('docker network create hola');
      createdHolaNetwork = created.ok;
    }
  });

  afterAll(async () => {
    if (createdHolaNetwork) await sh('docker network rm hola');
    for (const project of allProjects) {
      const containers = await sh(`docker ps -aq --filter "label=com.docker.compose.project=${project}"`);
      expect(containers.stdout.trim()).toBe('');
      const nets = await sh(`docker network ls -q --filter "name=${project}_default"`);
      expect(nets.stdout.trim()).toBe('');
    }
  });

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-cat-it-'));
    projects = [];
  });

  afterEach(async () => {
    for (const project of projects) {
      const ids = await sh(`docker ps -aq --filter "label=com.docker.compose.project=${project}"`);
      const list = ids.stdout.trim().split('\n').filter(Boolean);
      if (list.length) await sh(`docker rm -fv ${list.join(' ')}`);
      const nets = await sh(`docker network ls -q --filter "name=${project}_default"`);
      const netList = nets.stdout.trim().split('\n').filter(Boolean);
      if (netList.length) await sh(`docker network rm ${netList.join(' ')}`);
    }
    await rm(dataRoot, { recursive: true, force: true });
  });

  const docker = new RealDockerService();

  test(
    'deploys a catalog-seeded draft (compose from getVersionDetail) and routes it via Traefik',
    async () => {
      const compose = await readFile(FIXTURE_COMPOSE_PATH, 'utf8');

      const storage = new RealStorageService({ holaDir: dataRoot });
      const database = new RealDatabaseService(storage);
      const logging = new RealLoggingService(storage);
      const jobs = new RealJobService(database, logging);
      const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
      const drafts = new RealDraftService(storage, makeCatalog(compose), makeValidation());
      const deployments = new RealDeploymentService(storage, jobs, docker, drafts, routing, logging);

      // Catalog-seeded draft: NO updateDraft of composeOverride — it must arrive
      // from getVersionDetail via createDraft (the #82 change).
      const { draftId } = await drafts.createDraft({ appId: 'fixture', version: '1.0.0' });
      const seeded = await drafts.getDraft(draftId);
      expect(seeded.composeOverride).toBe(compose);
      await drafts.finalizeDraft(draftId);

      const created = await deployments.createFromDraft({ draftId, name: 'fixture' });
      const shortId = created.deploymentId.slice(0, 12);
      const project = `hola-${shortId}`;
      projects.push(project);
      allProjects.push(project);

      const job = await waitForJob(jobs, created.jobId!);
      expect(job.status).toBe('completed');
      expect((await deployments.getDeployment(created.deploymentId)).status).toBe('running');

      // No application host ports were published (Traefik-only ingress).
      const materialized = await storage.readFileAsString(`deployments/${created.deploymentId}/runtime/docker-compose.yml`);
      expect(materialized).not.toContain('ports:');

      // The app is on the hola network with its routing alias, and the emitted
      // Traefik dynamic config routes <app>.<domain> to it.
      const cid = await containerId(project, 'fixture');
      expect(cid).not.toBe('');
      const expectedAlias = `fixture-${shortId}`;
      const dynamic = await storage.readFileAsString('runtime/traefik/dynamic.yml');
      expect(dynamic).toContain(expectedAlias);
      expect(dynamic).toContain('fixture.local.hola');
    },
    180_000
  );
});
