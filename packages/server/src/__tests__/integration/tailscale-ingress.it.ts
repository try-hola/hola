/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Private Tailscale ingress (spec 010, T019): the network-isolation claim, proved
 * against a REAL Docker daemon, UNAUTHENTICATED.
 *
 * No tailnet is involved: the companion starts un-signed-in (`NeedsLogin`). What
 * this file establishes is everything that does not need Tailscale's control
 * plane: the companion starts and stays up under its hardening (`read_only`,
 * `cap_drop: ALL`, no-new-privileges) — V8 partially —, that from inside the
 * companion's own network namespace the backend is the only reachable thing, and
 * that disabling leaves no container, volume or network behind.
 *
 * Gated like the other `*.it.ts` files: skipped, visibly, when no daemon answers.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, readFile } from 'fs/promises';
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
import { RealDockerService } from '../../services/core/docker';

const execAsync = promisify(exec);
type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

async function sh(cmd: string): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 120_000 });
    return { stdout, stderr, ok: true };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '', ok: false };
  }
}

const dockerOk = await (async () => {
  const r = await sh('docker version --format "{{.Server.Version}}"');
  return r.ok && r.stdout.trim().length > 0;
})();
if (!dockerOk) console.warn('[spec 010] Docker unavailable: skipping the private-ingress integration test');

async function waitForJob(jobs: RealJobService, id: string, timeoutMs = 240_000) {
  const start = Date.now();
  for (;;) {
    const job = await jobs.getJob(id);
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    if (Date.now() - start > timeoutMs) throw new Error(`Job ${id} did not finish (last: ${job?.status})`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const COMPOSE = `services:
  web:
    image: busybox:1.36
    command: ["sh", "-c", "mkdir -p /www && echo HOLA_WEB_OK > /www/index.html && httpd -f -p 8080 -h /www"]
  db:
    image: busybox:1.36
    command: ["sh", "-c", "nc -lk -p 5432 -e true"]
`;

async function cid(project: string, service: string): Promise<string> {
  const r = await sh(`docker ps -aq --filter "label=com.docker.compose.project=${project}" --filter "label=com.docker.compose.service=${service}"`);
  return r.stdout.trim().split('\n').filter(Boolean)[0] ?? '';
}

describe.skipIf(!dockerOk)('private Tailscale ingress (real daemon, unauthenticated)', () => {
  let dataRoot: string;
  let appsRoot: string;
  let prevApps: string | undefined;
  let createdHola = false;
  let project = '';
  const OTHER = 'hola-ts-it-other';

  beforeAll(async () => {
    if (!(await sh('docker network inspect hola')).ok) createdHola = (await sh('docker network create hola')).ok;
  });
  afterAll(async () => {
    if (createdHola) await sh('docker network rm hola');
  });
  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-ts-it-'));
    appsRoot = await mkdtemp(join(tmpdir(), 'hola-ts-it-apps-'));
    prevApps = process.env.HOLA_APPS_BIND_ROOT;
    process.env.HOLA_APPS_BIND_ROOT = appsRoot;
  });
  afterEach(async () => {
    if (project) {
      const ids = await sh(`docker ps -aq --filter "label=com.docker.compose.project=${project}"`);
      const list = ids.stdout.trim().split('\n').filter(Boolean);
      if (list.length) await sh(`docker rm -fv ${list.join(' ')}`);
      for (const n of ['default', 'hola-ts-backend', 'hola-ts-egress']) await sh(`docker network rm ${project}_${n}`);
      await sh(`docker volume rm ${project}_hola-ts-state`);
    }
    await sh(`docker rm -f ${OTHER}`);
    if (prevApps === undefined) delete process.env.HOLA_APPS_BIND_ROOT;
    else process.env.HOLA_APPS_BIND_ROOT = prevApps;
    await rm(dataRoot, { recursive: true, force: true });
    await rm(appsRoot, { recursive: true, force: true });
  });

  function stack() {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage);
    const logging = new RealLoggingService(storage);
    const jobs = new RealJobService(database, logging);
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const catalog = {
      getApp: async (appId: string) => ({ id: appId, name: 'Fixture', icon: '🧪' }),
      getVersionDetail: async () => ({ defaultEnv: [], defaults: { ports: [{ container: 8080, protocol: 'tcp' as const }], volumes: [] } }),
    } as unknown as CatalogArg;
    const validation = {
      validateDraft: async () => ({ ok: true, errors: [], warnings: [] }),
      preflightCheck: async () => ({ ok: true, checks: [] }),
    } as unknown as ValidationArg;
    const drafts = new RealDraftService(storage, catalog, validation);
    const docker = new RealDockerService();
    const deployments = new RealDeploymentService(storage, jobs, docker, drafts, routing, logging, new MockProvisionerService());
    return { storage, jobs, drafts, deployments, routing };
  }

  test('companion is isolated to the backend, hardened, and removed cleanly on disable', async () => {
    const { jobs, drafts, deployments } = stack();

    // A container of "another project" on the shared hola network, to try to reach.
    await sh(`docker run -d --name ${OTHER} --network hola busybox:1.36 sleep 3600`);
    const otherIp = (await sh(`docker inspect -f '{{(index .NetworkSettings.Networks "hola").IPAddress}}' ${OTHER}`)).stdout.trim();
    expect(otherIp).toMatch(/^\d+\.\d+\.\d+\.\d+$/);

    const { draftId } = await drafts.createDraft({ appId: 'fixture', version: '1.0.0' });
    await drafts.updateDraft(draftId, { composeOverride: COMPOSE, ports: [{ container: 8080, protocol: 'tcp' }] });
    await drafts.finalizeDraft(draftId);
    const created = await deployments.createFromDraft({ draftId, name: 'fixture', options: { autoStart: false } });
    const id = created.deploymentId;
    project = `hola-${id}`;
    // The PUT route refuses a first enable without a credential, so write the setting onto the record directly.
    const rec = (deployments as any).deployments.get(id);
    rec.tailscaleIngress = {
      enabled: true, serviceName: 'svc:fixture', tag: 'tag:hola-ingress', backend: { service: 'web', port: 8080 },
      mode: 'https', listenPort: 443, forwardAuthAcknowledged: false, nodeName: 'hola-fixture', updatedAt: new Date().toISOString(),
    };
    const start = await deployments.executeAction(id, { action: 'start' });
    const job = await waitForJob(jobs, start.jobId!);
    expect(job.error ?? '').toBe('');
    expect(job.status).toBe('completed');

    const ts = await cid(project, 'hola-tailscale');
    const web = await cid(project, 'web');
    expect(ts).not.toBe('');
    expect(web).not.toBe('');
    const insp = async (fmt: string) => (await sh(`docker inspect -f '${fmt}' ${ts}`)).stdout.trim();

    // Stays up under the hardening (V8, partially: unauthenticated).
    await new Promise((r) => setTimeout(r, 4000));
    expect(await insp('{{.State.Running}}')).toBe('true');
    expect(await insp('{{.RestartCount}}')).toBe('0');

    // Hardening as applied by Docker.
    expect(await insp('{{.HostConfig.ReadonlyRootfs}}')).toBe('true');
    expect(await insp('{{.HostConfig.Privileged}}')).toBe('false');
    expect(await insp('{{json .HostConfig.CapDrop}}')).toBe('["ALL"]');
    expect(await insp('{{json .HostConfig.CapAdd}}')).toBe('null');
    expect(await insp('{{json .HostConfig.PortBindings}}')).toMatch(/^(null|\{\})$/);
    expect(await insp('{{.HostConfig.NetworkMode}}')).not.toBe('host');
    const mounts = JSON.parse(await insp('{{json .Mounts}}')) as Array<{ Type: string; Name?: string }>;
    expect(mounts.filter((m) => m.Type === 'bind')).toEqual([]);
    expect(mounts.map((m) => m.Name)).toEqual([`${project}_hola-ts-state`]);
    const nets = Object.keys(JSON.parse(await insp('{{json .NetworkSettings.Networks}}'))).sort();
    expect(nets).toEqual([`${project}_hola-ts-backend`, `${project}_hola-ts-egress`]);

    // The web container still sits on hola and default (and now the backend network).
    const webNets = Object.keys(JSON.parse((await sh(`docker inspect -f '{{json .NetworkSettings.Networks}}' ${web}`)).stdout)).sort();
    expect(webNets).toContain('hola');
    expect(webNets).toContain(`${project}_default`);
    expect(webNets).toContain(`${project}_hola-ts-backend`);

    // Unauthenticated status via the real driver.
    const status = await deployments.getTailscaleIngress(id, { refresh: true });
    expect(status.status.state).toBe('needs-sign-in');

    // Reach, from INSIDE the companion's own namespace.
    const nc = async (target: string, port: number) => (await sh(`docker exec ${ts} nc -z -w 3 ${target} ${port}`)).ok;
    expect(await nc('hola-ts-backend', 8080)).toBe(true);
    // db is on the project's default network only: unresolvable and unreachable from the companion.
    expect(await nc('db', 5432)).toBe(false);
    const dbIp = (await sh(`docker inspect -f '{{(index .NetworkSettings.Networks "${project}_default").IPAddress}}' ${await cid(project, 'db')}`)).stdout.trim();
    expect(dbIp).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(await nc(dbIp, 5432)).toBe(false);
    // another project's container on the hola network
    expect(await nc(otherIp, 80)).toBe(false);
    // (the backend's own service name also resolves on the backend network: it is the same container)
    expect(await nc('web', 8080)).toBe(true);

    // --- Disable: companion, volume and both networks gone; the app still answers. ---
    const dis = await deployments.disableTailscaleIngress(id);
    expect((await waitForJob(jobs, dis.jobId!)).status).toBe('completed');
    expect(await cid(project, 'hola-tailscale')).toBe('');
    expect((await sh(`docker volume inspect ${project}_hola-ts-state`)).ok).toBe(false);
    for (const n of ['hola-ts-backend', 'hola-ts-egress']) {
      expect((await sh(`docker network inspect ${project}_${n}`)).ok).toBe(false);
    }
    expect((await sh(`docker exec ${await cid(project, 'web')} wget -qO- http://localhost:8080/`)).stdout).toContain('HOLA_WEB_OK');
    expect((deployments as any).deployments.get(id).tailscaleIngress).toBeUndefined();
  }, 600_000);
  // #596: with exposure `tailscale-only` the ingress service is NOT joined to the
  // shared `hola` network and the routing file holds no router for the app; disabling
  // restores both in the same job.
  test('tailscale-only: ingress service is off the hola network and unrouted; disable restores both', async () => {
    const { jobs, drafts, deployments } = stack();
    const { draftId } = await drafts.createDraft({ appId: 'fixture', version: '1.0.0' });
    await drafts.updateDraft(draftId, { composeOverride: COMPOSE, ports: [{ container: 8080, protocol: 'tcp' }] });
    await drafts.finalizeDraft(draftId);
    const created = await deployments.createFromDraft({ draftId, name: 'fixture', options: { autoStart: false } });
    const id = created.deploymentId;
    project = `hola-${id}`;
    const rec = (deployments as any).deployments.get(id);
    rec.tailscaleIngress = {
      enabled: true, exposure: 'tailscale-only', serviceName: 'svc:fixture', tag: 'tag:hola-ingress', backend: { service: 'web', port: 8080 },
      mode: 'https', listenPort: 443, forwardAuthAcknowledged: false, nodeName: 'hola-fixture', updatedAt: new Date().toISOString(),
    };
    const job = await waitForJob(jobs, (await deployments.executeAction(id, { action: 'start' })).jobId!);
    expect(job.error ?? '').toBe('');
    expect(job.status).toBe('completed');

    const netsOf = async (service: string) =>
      Object.keys(JSON.parse((await sh(`docker inspect -f '{{json .NetworkSettings.Networks}}' ${await cid(project, service)}`)).stdout)).sort();
    const webNets = await netsOf('web');
    expect(webNets).not.toContain('hola');
    expect(webNets).toContain(`${project}_default`);
    expect(webNets).toContain(`${project}_hola-ts-backend`);
    const dynamicYml = join(dataRoot, 'runtime', 'traefik', 'dynamic.yml');
    const routed = async () => (existsSync(dynamicYml) ? (await readFile(dynamicYml, 'utf8')).includes(id) : false);
    expect(await routed()).toBe(false);

    const dis = await deployments.disableTailscaleIngress(id);
    expect((await waitForJob(jobs, dis.jobId!)).status).toBe('completed');
    expect(await netsOf('web')).toContain('hola');
    expect(await routed()).toBe(true);
  }, 600_000);
});
