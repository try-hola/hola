/**
 * Docker/Compose orchestration integration test (issue #19).
 *
 * Drives a minimal fixture bundle through the supported deployment service APIs
 * against a REAL Docker daemon and asserts on real Compose state: containers up,
 * isolated `hola` network membership with the routing alias, NO published host
 * ports, logs originating from the real container, plus restart / stop / rollback.
 *
 * Gating: this file is named `*.it.ts` so the default `bun test` run (which only
 * collects `*.test.ts`) never picks it up — it runs only via `bun run
 * test:integration`. Even then, the suite skips explicitly when Docker is
 * unavailable, so the hermetic baseline stays green on hosts without a daemon.
 *
 * In production the shared `hola` network is created by the main Compose stack
 * (packages/compose/docker-compose.yml → networks.default.name: hola). The
 * deployed app's compose declares it `external: true` (see compose-network.ts),
 * so this test must create that network itself before Compose up and remove it
 * afterwards (only if it created it).
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

function makeCatalog(): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'Fixture', icon: '🧪' }),
    getVersionDetail: async () => ({
      defaultEnv: [],
      defaults: { ports: [{ container: 8080, protocol: 'tcp' as const }], volumes: [] },
    }),
  } as unknown as CatalogArg;
}

function makeValidation(): ValidationArg {
  return {
    validateDraft: async () => ({ ok: true, errors: [], warnings: [] }),
    preflightCheck: async () => ({ ok: true, checks: [] }),
  } as unknown as ValidationArg;
}

const FIXTURE_COMPOSE_PATH = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  'fixtures',
  'integration',
  'docker-compose.yaml'
);

/** Run a shell command, capturing output and never throwing (best-effort). */
async function sh(cmd: string): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 60_000 });
    return { stdout, stderr, ok: true };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '', ok: false };
  }
}

/** True when a Docker engine (server) is reachable — mirrors RealDockerService.getDockerInfo. */
async function detectDocker(): Promise<boolean> {
  const res = await sh('docker version --format "{{.Server.Version}}"');
  return res.ok && res.stdout.trim().length > 0;
}

const dockerOk = await detectDocker();
if (!dockerOk) {
  // Explicit, visible skip so an absent daemon never looks like a silent pass.
  console.warn('[#19] Docker unavailable — skipping Docker/Compose orchestration integration test');
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

/** Resolve the single container id for a project's service via Compose labels. */
async function containerId(project: string, service: string): Promise<string> {
  const res = await sh(
    `docker ps -aq --filter "label=com.docker.compose.project=${project}" --filter "label=com.docker.compose.service=${service}"`
  );
  return res.stdout.trim().split('\n').filter(Boolean)[0] ?? '';
}

async function inspect(cid: string, format: string): Promise<string> {
  const res = await sh(`docker inspect -f '${format}' ${cid}`);
  return res.stdout.trim();
}

async function waitForHealthy(cid: string, timeoutMs = 60_000): Promise<string> {
  const start = Date.now();
  for (;;) {
    const status = await inspect(cid, '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}');
    if (status === 'healthy') return status;
    if (Date.now() - start > timeoutMs) return status;
    await new Promise(r => setTimeout(r, 500));
  }
}

describe.skipIf(!dockerOk)('Docker/Compose orchestration (real daemon)', () => {
  let dataRoot: string;
  let createdHolaNetwork = false;
  /** Compose project names created during the current test, swept in afterEach. */
  let projects: string[];
  /** Every project created across the suite — the afterAll leak guard. */
  const allProjects: string[] = [];

  beforeAll(async () => {
    // The deployed app's compose marks `hola` external; create it if absent.
    const inspectHola = await sh('docker network inspect hola');
    if (!inspectHola.ok) {
      const created = await sh('docker network create hola');
      createdHolaNetwork = created.ok;
    }
  });

  afterAll(async () => {
    if (createdHolaNetwork) {
      await sh('docker network rm hola');
    }
    // Final leak guard: every project created by the suite must leave behind no
    // containers and no project network (exact-match label/name filters).
    for (const project of allProjects) {
      const containers = await sh(`docker ps -aq --filter "label=com.docker.compose.project=${project}"`);
      expect(containers.stdout.trim()).toBe('');
      const nets = await sh(`docker network ls -q --filter "name=${project}_default"`);
      expect(nets.stdout.trim()).toBe('');
    }
  });

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-it-'));
    projects = [];
  });

  afterEach(async () => {
    // Reliable, compose-file-independent cleanup: remove every container of each
    // project (with anonymous volumes) and the project's default network.
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

  function makeSystem() {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage);
    const logging = new RealLoggingService(storage);
    const jobs = new RealJobService(database, logging);
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const drafts = new RealDraftService(storage, makeCatalog(), makeValidation());
    const deployments = new RealDeploymentService(storage, jobs, docker, drafts, routing, logging);
    return { storage, jobs, logging, drafts, deployments };
  }

  const docker = new RealDockerService();

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

  test(
    'deploy fixture: up, healthy, no host ports, isolated hola network, real logs, restart, stop, rollback',
    async () => {
      const { storage, jobs, drafts, deployments } = makeSystem();

      // --- Create + start (Compose up) -------------------------------------
      const created = await deployments.createFromDraft({
        draftId: await finalizedFixtureDraft(drafts),
        name: 'fixture',
      });
      const shortId = created.deploymentId.slice(0, 12);
      const project = `hola-${shortId}`;
      projects.push(project);
      allProjects.push(project);

      const job = await waitForJob(jobs, created.jobId!);
      expect(job.status).toBe('completed');
      expect((await deployments.getDeployment(created.deploymentId)).status).toBe('running');

      // --- Compose ps reflects actual running state ------------------------
      const runtimeDir = storage.resolveHolaPath('deployments', created.deploymentId, 'runtime');
      const ps = await docker.composePs(runtimeDir, project);
      const svc = ps.services.find(s => s.name === 'fixture');
      expect(svc?.state).toBe('running');

      // --- Real container health transitions to healthy --------------------
      const cid = await containerId(project, 'fixture');
      expect(cid).not.toBe('');
      expect(await waitForHealthy(cid)).toBe('healthy');

      // --- No application host ports are published -------------------------
      const materialized = await storage.readFileAsString(`deployments/${created.deploymentId}/runtime/docker-compose.yml`);
      expect(materialized).not.toContain('ports:');
      const portsJson = await inspect(cid, '{{json .NetworkSettings.Ports}}');
      const ports = JSON.parse(portsJson || '{}') as Record<string, unknown[] | null>;
      const published = Object.values(ports).filter(v => Array.isArray(v) && v.length > 0);
      expect(published).toHaveLength(0);

      // --- Isolated network membership with the routing alias --------------
      const expectedAlias = `fixture-${shortId}`;
      const netsJson = await inspect(cid, '{{json .NetworkSettings.Networks}}');
      const nets = JSON.parse(netsJson) as Record<string, { Aliases?: string[] }>;
      expect(Object.keys(nets)).toContain('hola');
      expect(nets.hola.Aliases ?? []).toContain(expectedAlias);

      // Cross-check the emitted Traefik artifacts agree with the live alias.
      const routingMap = await storage.readFileAsString('runtime/traefik/routing-map.json');
      expect(routingMap).toContain(expectedAlias);
      expect(routingMap).toContain('fixture.local.hola');
      const dynamic = await storage.readFileAsString('runtime/traefik/dynamic.yml');
      expect(dynamic).toContain(expectedAlias);
      expect(dynamic).toContain('fixture.local.hola');

      // --- Logs originate from the real fixture container ------------------
      const logs = await docker.getContainerLogs(cid);
      expect(logs.entries.some(e => e.message.includes('HOLA_FIXTURE_READY'))).toBe(true);

      // --- Restart keeps it running ----------------------------------------
      const restart = await deployments.executeAction(created.deploymentId, { action: 'restart' });
      expect((await waitForJob(jobs, restart.jobId!)).status).toBe('completed');
      const psAfterRestart = await docker.composePs(runtimeDir, project);
      expect(psAfterRestart.services.find(s => s.name === 'fixture')?.state).toBe('running');

      // --- Stop tears the containers down ----------------------------------
      const stop = await deployments.executeAction(created.deploymentId, { action: 'stop' });
      expect((await waitForJob(jobs, stop.jobId!)).status).toBe('completed');
      expect((await deployments.getDeployment(created.deploymentId)).status).toBe('stopped');
      const psAfterStop = await docker.composePs(runtimeDir, project);
      expect(psAfterStop.services.filter(s => s.state === 'running')).toHaveLength(0);

      // --- Promote a second release, then roll back to the first -----------
      const firstReleaseId = (await deployments.getReleases(created.deploymentId))[0].id;
      // Stage release 2 without starting it, so its job can't race the rollback's
      // compose-up on the shared project.
      await deployments.promote(created.deploymentId, {
        draftId: await finalizedFixtureDraft(drafts),
        options: { autoStart: false },
      });
      const releasesAfterPromote = await deployments.getReleases(created.deploymentId);
      expect(releasesAfterPromote.length).toBe(2);
      const currentAfterPromote = (await storage.readFileAsString(`deployments/${created.deploymentId}/current`)).trim();
      expect(currentAfterPromote).not.toBe(firstReleaseId);

      const rollback = await deployments.rollback(created.deploymentId, {});
      expect(rollback.targetReleaseId).toBe(firstReleaseId);
      expect((await waitForJob(jobs, rollback.jobId)).status).toBe('completed');
      const currentAfterRollback = (await storage.readFileAsString(`deployments/${created.deploymentId}/current`)).trim();
      expect(currentAfterRollback).toBe(firstReleaseId);
      // Compose re-converges to running on the rolled-back release.
      const psAfterRollback = await docker.composePs(runtimeDir, project);
      expect(psAfterRollback.services.find(s => s.name === 'fixture')?.state).toBe('running');
    },
    180_000
  );
});
