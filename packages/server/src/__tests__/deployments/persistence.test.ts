/**
 * Deployment Persistence Tests (real service)
 *
 * Verifies that RealDeploymentService is durable and that promotion/rollback are
 * atomic: releases are built from finalized draft artifacts (#11), deployments,
 * releases, and the active-release pointer survive a simulated restart (a fresh
 * service over the same data root), rollback atomically switches the active
 * release, a failed promotion leaves the previous release active, and unknown /
 * unfinalized inputs fail with typed errors. Uses a temporary data root so the
 * suite passes without a writable home directory.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile, access, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { RealDeploymentService } from '../../services/core/deployment';
import { MockProvisionerService } from '../../services/core/provisioner';
import { RealDraftService } from '../../services/core/draft';
import { RealStorageService } from '../../services/core/storage';
import { RealRoutingService } from '../../services/core/routing';
import { NotFoundError, ConflictError, BundleUnavailableError } from '../../middleware/error-mapping';
import type { DockerService } from '../../services/core/docker';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];
type JobArg = ConstructorParameters<typeof RealDeploymentService>[1];

/**
 * `unavailable`: the catalog has no bundle for this app, so `getVersionDetail`
 * throws `VERSION_NOT_FOUND` and the draft falls back to placeholder defaults —
 * the path where no `channels` fact can be established (#431, fail-closed).
 */
function makeCatalog(opts?: { multiInstance?: boolean; unavailable?: boolean }): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'Test App', icon: '📦' }),
    getVersionDetail: async (_appId: string, _version: string, _source?: string, channel?: string) => {
      if (opts?.unavailable) throw new BundleUnavailableError('VERSION_NOT_FOUND', 'VERSION_NOT_FOUND');
      return {
        defaultEnv: [{ key: 'APP_PORT', value: '3000', isSecret: false, description: 'port' }],
        defaults: {
          ports: [{ host: 3000, container: 3000, protocol: 'tcp' as const }],
          volumes: [{ hostPath: './data', containerPath: '/data', readOnly: false }],
        },
        // #246: a catalog app that declares it supports multiple instances.
        ...(opts?.multiInstance ? { multiInstance: true } : {}),
        // #428: echo the requested channel back as the resolved version's channel
        // (this stub isn't exercising catalog eligibility — that's
        // catalog-channels.test.ts / channels.test.ts) so a draft/deployment
        // created through it follows the channel it asked for.
        channel: channel ?? 'stable',
        // #431: the channels this app is actually PUBLISHED on. `rc` is published
        // (so it differentiates a second copy); anything else the caller invents
        // (e.g. `banana`) resolves via the stable floor but is not published.
        channels: ['stable', 'rc'],
      };
    },
  } as unknown as CatalogArg;
}

function makeValidation(): ValidationArg {
  return {
    validateDraft: async () => ({ ok: true, errors: [], warnings: [] }),
    preflightCheck: async () => ({ ok: true, checks: [] }),
  } as unknown as ValidationArg;
}

/** Minimal in-memory job service (avoids MockJobService's progress timers). */
function makeJobs(): JobArg {
  const jobs: Array<{ id: string; type: string; status: string; startedAt: string; deploymentId?: string }> = [];
  return {
    createJob: async (p: { type: string; deploymentId?: string }) => {
      const job = { id: crypto.randomUUID(), type: p.type, status: 'queued', startedAt: new Date().toISOString(), deploymentId: p.deploymentId };
      jobs.push(job);
      return job;
    },
    listJobs: async (f?: { deploymentId?: string }) => jobs.filter(j => !f?.deploymentId || j.deploymentId === f.deploymentId),
    cancelJob: async () => {},
    getJob: async () => null,
    onJobUpdate: () => ({ unsubscribe() {} }),
    setExecutor: () => {},
    healthCheck: async () => ({ healthy: true, lastCheck: new Date() }),
  } as unknown as JobArg;
}

const noDocker = {} as unknown as DockerService;
type LoggingArg = ConstructorParameters<typeof RealDeploymentService>[5];
const noLogging = {
  log: async () => {},
  onLog: () => ({ unsubscribe() {} }),
  logJob: async () => {},
  logDeployment: async () => {},
  healthCheck: async () => ({ healthy: true, lastCheck: new Date() }),
} as unknown as LoggingArg;

describe('Deployment persistence (real service)', () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-deploy-'));
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  /** A fresh service set over the same data root simulates a restart. */
  function makeSystem(opts?: { multiInstance?: boolean; unavailable?: boolean }) {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const drafts = new RealDraftService(storage, makeCatalog(opts), makeValidation());
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const deployments = new RealDeploymentService(storage, makeJobs(), noDocker, drafts, routing, noLogging, new MockProvisionerService());
    return { storage, drafts, routing, deployments };
  }

  async function finalizedDraft(drafts: RealDraftService, compose?: string, channel?: string): Promise<string> {
    const { draftId } = await drafts.createDraft({ appId: 'gitea', version: '1.0.0', channel });
    if (compose) {
      await drafts.updateDraft(draftId, { composeOverride: compose });
    }
    await drafts.finalizeDraft(draftId);
    return draftId;
  }

  test('getDeploymentSource returns the source the app was installed from, defaulting to hola (#340)', async () => {
    const { drafts, deployments } = makeSystem();

    // Installed from the built-in catalog (no explicit source) → defaults to `hola`.
    const draftDefault = (await drafts.createDraft({ appId: 'gitea', version: '1.0.0' })).draftId;
    await drafts.finalizeDraft(draftDefault);
    const depDefault = await deployments.createFromDraft({ draftId: draftDefault, name: 'gitea', options: { autoStart: false } });
    expect(await deployments.getDeploymentSource(depDefault.deploymentId)).toBe('hola');

    // Installed from a custom catalog source → that source is what promote must
    // rebuild the draft from, or the upgrade 404s with APP_NOT_FOUND. (Distinct
    // appId so it doesn't collide with the gitea host above.)
    const draftCustom = (await drafts.createDraft({ appId: 'nextcloud', version: '1.0.0', source: 'get2know' })).draftId;
    await drafts.finalizeDraft(draftCustom);
    const depCustom = await deployments.createFromDraft({ draftId: draftCustom, name: 'nextcloud-custom', options: { autoStart: false } });
    expect(await deployments.getDeploymentSource(depCustom.deploymentId)).toBe('get2know');

    // Survives a restart (fresh service over the same data root rehydrates metadata).
    const restarted = makeSystem();
    expect(await restarted.deployments.getDeploymentSource(depCustom.deploymentId)).toBe('get2know');
  });

  test('deleteDeployment reclaims the host bind-mount data root (#341)', async () => {
    const bindRoot = await mkdtemp(join(tmpdir(), 'hola-appsbind-'));
    const prevBindRoot = process.env.HOLA_APPS_BIND_ROOT;
    process.env.HOLA_APPS_BIND_ROOT = bindRoot;
    try {
      const { drafts, deployments } = makeSystem();
      const draftId = await finalizedDraft(drafts, 'services:\n  gitea:\n    image: gitea/gitea\n');
      const created = await deployments.createFromDraft({ draftId, name: 'gitea', options: { autoStart: false } });

      // Simulate the app's persistent data written into its bind root by a real
      // `docker compose up` (Postgres db/, uploaded media/, etc.).
      const exists = async (p: string) => access(p).then(() => true, () => false);
      const appRoot = join(bindRoot, created.deploymentId);
      await mkdir(join(appRoot, 'db'), { recursive: true });
      await writeFile(join(appRoot, 'db', 'data'), 'rows');
      expect(await exists(appRoot)).toBe(true);

      await deployments.deleteDeployment(created.deploymentId);

      // The data root is gone — uninstall no longer leaves orphaned data on disk.
      expect(await exists(appRoot)).toBe(false);
      // The bind root itself is untouched (guard only deletes strictly within it).
      expect(await exists(bindRoot)).toBe(true);
    } finally {
      if (prevBindRoot === undefined) delete process.env.HOLA_APPS_BIND_ROOT;
      else process.env.HOLA_APPS_BIND_ROOT = prevBindRoot;
      await rm(bindRoot, { recursive: true, force: true });
    }
  });

  test('promotes a finalized draft into a deployment with a persisted active release', async () => {
    const { storage, drafts, deployments } = makeSystem();
    const draftId = await finalizedDraft(drafts, 'services:\n  gitea:\n    image: gitea/gitea\n');

    const created = await deployments.createFromDraft({ draftId, name: 'gitea', options: { autoStart: false } });
    expect(created.releaseId).toBeDefined();

    // Built from the manifest (app/version), not fabricated.
    const detail = await deployments.getDeployment(created.deploymentId);
    expect(detail.app).toBe('gitea');
    expect(detail.version).toBe('1.0.0');

    // Durable: immutable release dir, staged compose, and the current pointer.
    expect(await storage.fileExists(`deployments/${created.deploymentId}/releases/${created.releaseId}/metadata.json`)).toBe(true);
    expect(await storage.fileExists(`deployments/${created.deploymentId}/releases/${created.releaseId}/compose-override.yml`)).toBe(true);
    expect(await storage.readFileAsString(`deployments/${created.deploymentId}/current`)).toBe(created.releaseId);

    const releases = await deployments.getReleases(created.deploymentId);
    expect(releases).toHaveLength(1);
    expect(releases[0].status).toBe('active');
  });

  test('deployment, releases, and active pointer survive a restart', async () => {
    const a = makeSystem();
    const draftId = await finalizedDraft(a.drafts);
    const created = await a.deployments.createFromDraft({ draftId, name: 'gitea', options: { autoStart: false } });

    // Restart.
    const b = makeSystem();
    const list = await b.deployments.listDeployments({ page: 1, limit: 100 });
    expect(list.items.some(d => d.id === created.deploymentId)).toBe(true);

    const detail = await b.deployments.getDeployment(created.deploymentId);
    expect(detail.id).toBe(created.deploymentId);

    const releases = await b.deployments.getReleases(created.deploymentId);
    expect(releases.find(r => r.id === created.releaseId)?.status).toBe('active');
  });

  test('re-deploy then rollback atomically switches the active release and survives restart', async () => {
    const a = makeSystem();
    const draftA = await finalizedDraft(a.drafts, 'services:\n  gitea:\n    image: gitea:a\n');
    const dep = await a.deployments.createFromDraft({ draftId: draftA, name: 'gitea', options: { autoStart: false } });
    const release1 = dep.releaseId;

    // Promote a second release onto the same deployment.
    const draftB = await finalizedDraft(a.drafts, 'services:\n  gitea:\n    image: gitea:b\n');
    const promoted = await a.deployments.promote(dep.deploymentId, { draftId: draftB, options: { autoStart: false } });
    const release2 = promoted.releaseId;

    expect(await a.storage.readFileAsString(`deployments/${dep.deploymentId}/current`)).toBe(release2);
    let releases = await a.deployments.getReleases(dep.deploymentId);
    expect(releases.find(r => r.id === release2)?.status).toBe('active');
    expect(releases.find(r => r.id === release1)?.status).toBe('stopped');

    // Roll back to the first release.
    const rollback = await a.deployments.rollback(dep.deploymentId, { targetReleaseId: release1 });
    expect(rollback.targetReleaseId).toBe(release1);
    expect(rollback.previousReleaseId).toBe(release2);
    expect(await a.storage.readFileAsString(`deployments/${dep.deploymentId}/current`)).toBe(release1);

    releases = await a.deployments.getReleases(dep.deploymentId);
    expect(releases.find(r => r.id === release1)?.status).toBe('active');
    expect(releases.find(r => r.id === release2)?.status).toBe('stopped');

    // Restart: the rolled-back pointer is rehydrated.
    const b = makeSystem();
    const after = await b.deployments.getReleases(dep.deploymentId);
    expect(after.find(r => r.id === release1)?.status).toBe('active');
    expect(await b.storage.readFileAsString(`deployments/${dep.deploymentId}/current`)).toBe(release1);
  });

  test('default rollback (no target) returns to the previous release', async () => {
    const { drafts, deployments } = makeSystem();
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts), options: { autoStart: false } });
    const release1 = dep.releaseId;
    const promoted = await deployments.promote(dep.deploymentId, { draftId: await finalizedDraft(drafts), options: { autoStart: false } });

    const rollback = await deployments.rollback(dep.deploymentId, {});
    expect(rollback.targetReleaseId).toBe(release1);
    expect(rollback.previousReleaseId).toBe(promoted.releaseId);
  });

  test('a deployment created without a name defaults to the catalog product name', async () => {
    const { drafts, deployments } = makeSystem();
    const created = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts), options: { autoStart: false } });
    const detail = await deployments.getDeployment(created.deploymentId);
    // The catalog product name is persisted at install (carried via the finalized
    // manifest), so the UI shows a readable name without a live catalog join —
    // never an opaque "deployment-<id>" placeholder. Falls back to the app slug.
    expect(detail.name).toBe('Test App');
  });

  test('a failed promotion leaves the previous release active', async () => {
    const { storage, drafts, deployments } = makeSystem();
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts), options: { autoStart: false } });
    const release1 = dep.releaseId;

    // Promote from a draft that was never finalized -> should throw before any switch.
    const { draftId: unfinalized } = await drafts.createDraft({ appId: 'gitea' });
    await expect(deployments.promote(dep.deploymentId, { draftId: unfinalized })).rejects.toBeInstanceOf(ConflictError);

    // The active release and pointer are unchanged.
    expect(await storage.readFileAsString(`deployments/${dep.deploymentId}/current`)).toBe(release1);
    const releases = await deployments.getReleases(dep.deploymentId);
    expect(releases).toHaveLength(1);
    expect(releases[0].status).toBe('active');
  });

  test('routing is emitted on create, rebuilt on restart, and removed on delete', async () => {
    const a = makeSystem();
    const dep = await a.deployments.createFromDraft({ draftId: await finalizedDraft(a.drafts), name: 'gitea', options: { autoStart: false } });

    // A Traefik route + dynamic config are emitted for the active deployment.
    const map = await a.routing.getRoutingMap();
    expect(map['gitea.local.hola']?.deploymentId).toBe(dep.deploymentId);
    expect(await a.storage.fileExists('runtime/traefik/dynamic.yml')).toBe(true);

    // Restart reconstructs routing from persisted deployments.
    const b = makeSystem();
    await b.deployments.listDeployments({ page: 1, limit: 100 }); // triggers rehydrate + reconcile
    expect((await b.routing.getRoutingMap())['gitea.local.hola']?.deploymentId).toBe(dep.deploymentId);

    // Deleting the deployment removes its route.
    await b.deployments.deleteDeployment(dep.deploymentId);
    expect((await b.routing.getRoutingMap())['gitea.local.hola']).toBeUndefined();
  });

  test('deleting a deployment emits a deployment_deleted event (#331)', async () => {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const drafts = new RealDraftService(storage, makeCatalog(), makeValidation());
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const events: Array<{ type: string; data: unknown }> = [];
    const eventBus = { emit: (e: { type: string; data: unknown }) => events.push(e), subscribe: () => ({ unsubscribe() {} }) };
    const deployments = new RealDeploymentService(storage, makeJobs(), noDocker, drafts, routing, noLogging, new MockProvisionerService(), undefined, eventBus);

    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts), name: 'gitea', options: { autoStart: false } });
    await deployments.deleteDeployment(dep.deploymentId);

    const deleted = events.find(e => e.type === 'deployment_deleted');
    expect(deleted?.data).toEqual({ deploymentId: dep.deploymentId });
  });

  test('a second install of a single-instance app is rejected by the singleton guard (#246)', async () => {
    const { drafts, deployments } = makeSystem();
    await deployments.createFromDraft({ draftId: await finalizedDraft(drafts), name: 'gitea', options: { autoStart: false } });

    // A distinct name would route to a distinct host, so this is NOT a host
    // conflict — it's the single-instance-by-default guard that rejects it.
    await expect(
      deployments.createFromDraft({ draftId: await finalizedDraft(drafts), name: 'gitea-2', options: { autoStart: false } })
    ).rejects.toThrow(/single-instance/);

    // The rejected second deployment left no state behind.
    const list = await deployments.listDeployments({ page: 1, limit: 100 });
    expect(list.items).toHaveLength(1);
  });

  test('the operator override installs a second instance at a distinct subdomain (#246)', async () => {
    const { drafts, deployments, routing } = makeSystem();
    const first = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts), name: 'gitea', options: { autoStart: false } });
    // First/default install (name == app id) keeps the historical `<app>.<base>`.
    expect((await deployments.getDeployment(first.deploymentId)).url).toBe('https://gitea.local.hola');

    const second = await deployments.createFromDraft({
      draftId: await finalizedDraft(drafts),
      name: 'Gitea Two',
      allowMultiple: true,
      options: { autoStart: false },
    });
    // The name is slugified into a distinct DNS label → a distinct host.
    expect((await deployments.getDeployment(second.deploymentId)).url).toBe('https://gitea-two.local.hola');

    // Both instances coexist as independent deployments and independent routes.
    const list = await deployments.listDeployments({ page: 1, limit: 100 });
    expect(list.items).toHaveLength(2);
    const map = await routing.getRoutingMap();
    expect(map['gitea.local.hola']?.deploymentId).toBe(first.deploymentId);
    expect(map['gitea-two.local.hola']?.deploymentId).toBe(second.deploymentId);
  });

  test('a multiInstance catalog app allows a second install without the override (#246)', async () => {
    const { drafts, deployments } = makeSystem({ multiInstance: true });
    await deployments.createFromDraft({ draftId: await finalizedDraft(drafts), name: 'gitea', options: { autoStart: false } });
    // No allowMultiple needed: the manifest opts into multiples.
    const second = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts), name: 'gitea-b', options: { autoStart: false } });
    expect((await deployments.getDeployment(second.deploymentId)).url).toBe('https://gitea-b.local.hola');
    expect((await deployments.listDeployments({ page: 1, limit: 100 })).items).toHaveLength(2);
  });

  test('a second instance reusing an existing subdomain is rejected as a host conflict (#246)', async () => {
    const { drafts, deployments } = makeSystem();
    await deployments.createFromDraft({ draftId: await finalizedDraft(drafts), name: 'gitea', options: { autoStart: false } });

    // Override past the singleton guard, but reuse the same name → same subdomain →
    // genuine host conflict.
    await expect(
      deployments.createFromDraft({ draftId: await finalizedDraft(drafts), name: 'gitea', allowMultiple: true, options: { autoStart: false } })
    ).rejects.toThrow(/already in use/);

    expect((await deployments.listDeployments({ page: 1, limit: 100 })).items).toHaveLength(1);
  });

  test('a persisted subdomain survives a restart and keeps the route stable (#246)', async () => {
    const s1 = makeSystem({ multiInstance: true });
    const dep = await s1.deployments.createFromDraft({
      draftId: await finalizedDraft(s1.drafts),
      name: 'Second Desk',
      options: { autoStart: false },
    });
    // The derived subdomain is persisted on the deployment record itself.
    const stored = JSON.parse(await readFile(join(dataRoot, 'deployments', dep.deploymentId, 'metadata.json'), 'utf8'));
    expect(stored.subdomain).toBe('second-desk');

    // A fresh service set over the same data root rebuilds routing from the stored
    // deployment (loadFromStorage → reconcile via the stored subdomain), so the
    // host survives the restart.
    const s2 = makeSystem({ multiInstance: true });
    await s2.deployments.getDeployment(dep.deploymentId); // triggers ensureLoaded → reconcile
    const map = await s2.routing.getRoutingMap();
    expect(map['second-desk.local.hola']?.deploymentId).toBe(dep.deploymentId);
  });

  // --- Release channels (#428): the single-instance guard is per app AND channel ---

  test('a channel copy of a single-instance app is permitted without the override (#428)', async () => {
    const { drafts, deployments } = makeSystem();
    const first = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts), name: 'gitea', options: { autoStart: false } });
    // First copy records no reason.
    expect((await deployments.getDeployment(first.deploymentId)).instanceReason).toBeUndefined();

    // A distinct name AND a channel no existing copy follows → no override needed.
    const second = await deployments.createFromDraft({
      draftId: await finalizedDraft(drafts, undefined, 'rc'),
      name: 'gitea-rc',
      options: { autoStart: false },
    });
    const detail = await deployments.getDeployment(second.deploymentId);
    expect(detail.channel).toBe('rc');
    expect(detail.instanceReason).toBe('channel');

    expect((await deployments.listDeployments({ page: 1, limit: 100 })).items).toHaveLength(2);
  });

  test('a second copy on the same channel is rejected, naming the channel and --channel (#428)', async () => {
    const { drafts, deployments } = makeSystem();
    await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, undefined, 'rc'), name: 'gitea-rc', options: { autoStart: false } });

    await expect(
      deployments.createFromDraft({ draftId: await finalizedDraft(drafts, undefined, 'rc'), name: 'gitea-rc-2', options: { autoStart: false } })
    ).rejects.toThrow(/channel 'rc'.*--channel/s);

    expect((await deployments.listDeployments({ page: 1, limit: 100 })).items).toHaveLength(1);
  });

  test('override supplied but not needed records reason "channel" (#428, clarification Q1)', async () => {
    const { drafts, deployments } = makeSystem();
    await deployments.createFromDraft({ draftId: await finalizedDraft(drafts), name: 'gitea', options: { autoStart: false } });

    // The channel difference alone would have permitted this; allowMultiple is
    // also supplied but wasn't what actually permitted it, so `channel` wins.
    const second = await deployments.createFromDraft({
      draftId: await finalizedDraft(drafts, undefined, 'rc'),
      name: 'gitea-rc',
      allowMultiple: true,
      options: { autoStart: false },
    });
    expect((await deployments.getDeployment(second.deploymentId)).instanceReason).toBe('channel');
  });

  test('override needed (same channel) records reason "operator-override" (#428)', async () => {
    const { drafts, deployments } = makeSystem();
    await deployments.createFromDraft({ draftId: await finalizedDraft(drafts), name: 'gitea', options: { autoStart: false } });

    const second = await deployments.createFromDraft({
      draftId: await finalizedDraft(drafts),
      name: 'gitea-two',
      allowMultiple: true,
      options: { autoStart: false },
    });
    const detail = await deployments.getDeployment(second.deploymentId);
    expect(detail.channel).toBe('stable');
    expect(detail.instanceReason).toBe('operator-override');
  });

  test('a multiInstance app records no instance reason regardless of channel (#428)', async () => {
    const { drafts, deployments } = makeSystem({ multiInstance: true });
    await deployments.createFromDraft({ draftId: await finalizedDraft(drafts), name: 'gitea', options: { autoStart: false } });
    const second = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, undefined, 'rc'), name: 'gitea-rc', options: { autoStart: false } });
    expect((await deployments.getDeployment(second.deploymentId)).instanceReason).toBeUndefined();
  });

  test('persisted channel and instanceReason survive a restart (#428)', async () => {
    const s1 = makeSystem();
    await s1.deployments.createFromDraft({ draftId: await finalizedDraft(s1.drafts), name: 'gitea', options: { autoStart: false } });
    const second = await s1.deployments.createFromDraft({
      draftId: await finalizedDraft(s1.drafts, undefined, 'rc'),
      name: 'gitea-rc',
      options: { autoStart: false },
    });

    const stored = JSON.parse(await readFile(join(dataRoot, 'deployments', second.deploymentId, 'metadata.json'), 'utf8'));
    expect(stored.channel).toBe('rc');
    expect(stored.instanceReason).toBe('channel');

    const s2 = makeSystem();
    const detail = await s2.deployments.getDeployment(second.deploymentId);
    expect(detail.channel).toBe('rc');
    expect(detail.instanceReason).toBe('channel');
  });

  test('a channel copy still needs a distinct subdomain — the default name is a host conflict (#428, FR-017)', async () => {
    const { drafts, deployments } = makeSystem();
    await deployments.createFromDraft({ draftId: await finalizedDraft(drafts), name: 'gitea', options: { autoStart: false } });

    // Same default name on a different channel: the channel difference permits
    // the SECOND-INSTANCE guard, but the existing subdomain-conflict rejection
    // still applies unchanged (FR-017 / clarification: distinct-name rule).
    await expect(
      deployments.createFromDraft({ draftId: await finalizedDraft(drafts, undefined, 'rc'), name: 'gitea', options: { autoStart: false } })
    ).rejects.toThrow(/already in use/);

    expect((await deployments.listDeployments({ page: 1, limit: 100 })).items).toHaveLength(1);
  });

  // --- #431: only a PUBLISHED channel differentiates a second copy ---

  test('a second copy on an UNPUBLISHED channel is rejected, saying the channel has no versions (#431)', async () => {
    const { drafts, deployments } = makeSystem();
    await deployments.createFromDraft({ draftId: await finalizedDraft(drafts), name: 'gitea', options: { autoStart: false } });

    // `banana` is not in the catalog's published channels, so the install
    // resolves the newest STABLE version through the floor (FR-003) — it is not
    // a distinct release track and must not buy a free second copy.
    await expect(
      deployments.createFromDraft({ draftId: await finalizedDraft(drafts, undefined, 'banana'), name: 'gitea-banana', options: { autoStart: false } })
    ).rejects.toThrow(/Channel 'banana' has no versions published for this app/);

    expect((await deployments.listDeployments({ page: 1, limit: 100 })).items).toHaveLength(1);
  });

  test('the same unpublished-channel install succeeds with the override, recording "operator-override" (#431)', async () => {
    const { drafts, deployments } = makeSystem();
    await deployments.createFromDraft({ draftId: await finalizedDraft(drafts), name: 'gitea', options: { autoStart: false } });

    const second = await deployments.createFromDraft({
      draftId: await finalizedDraft(drafts, undefined, 'banana'),
      name: 'gitea-banana',
      allowMultiple: true,
      options: { autoStart: false },
    });
    const detail = await deployments.getDeployment(second.deploymentId);
    expect(detail.channel).toBe('banana');
    // The channel did NOT permit this install; the operator's override did.
    expect(detail.instanceReason).toBe('operator-override');
  });

  test('a FIRST copy may still follow an unpublished channel, with no instance reason (#431)', async () => {
    const { drafts, deployments } = makeSystem();
    const only = await deployments.createFromDraft({
      draftId: await finalizedDraft(drafts, undefined, 'banana'),
      name: 'gitea',
      options: { autoStart: false },
    });
    const detail = await deployments.getDeployment(only.deploymentId);
    // Following a channel the catalog hasn't published yet stays legal (it just
    // receives stable-floor offers); it is only the second-copy differentiation
    // that requires a published channel.
    expect(detail.channel).toBe('banana');
    expect(detail.instanceReason).toBeUndefined();
  });

  test('a draft built from placeholder defaults records channelPublished=false and gets no channel copy (#431, fail-closed)', async () => {
    // The catalog can't resolve a bundle at all, so `getDraftDefaults` falls back
    // to placeholders and reports no `channels` — the published-ness of `rc`
    // cannot be established, so it is treated as unpublished.
    const compose = 'services:\n  gitea:\n    image: gitea:1\n';
    const { drafts, deployments } = makeSystem({ unavailable: true });
    const draftId = await finalizedDraft(drafts, compose, 'rc');
    expect((await drafts.getDraft(draftId)).channelPublished).toBe(false);

    await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, compose), name: 'gitea', options: { autoStart: false } });
    await expect(
      deployments.createFromDraft({ draftId, name: 'gitea-rc', options: { autoStart: false } })
    ).rejects.toThrow(/Channel 'rc' has no versions published for this app/);
  });

  // --- #433: the detail carries its app's live siblings, so the dashboard's
  // instance label is derived from current state instead of from the
  // install-time `instanceReason` (which always lands on the second copy). ---

  test('both copies expose each other as siblings, stable installed first (#433)', async () => {
    const { drafts, deployments } = makeSystem();
    const stable = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts), name: 'gitea', options: { autoStart: false } });
    const rc = await deployments.createFromDraft({
      draftId: await finalizedDraft(drafts, undefined, 'rc'),
      name: 'gitea-rc',
      options: { autoStart: false },
    });

    const stableDetail = await deployments.getDeployment(stable.deploymentId);
    const rcDetail = await deployments.getDeployment(rc.deploymentId);

    // The copy installed FIRST records no reason, but still names its sibling.
    expect(stableDetail.instanceReason).toBeUndefined();
    expect(stableDetail.siblings).toEqual([{ id: rc.deploymentId, name: 'gitea-rc', channel: 'rc' }]);

    expect(rcDetail.instanceReason).toBe('channel');
    expect(rcDetail.siblings).toEqual([{ id: stable.deploymentId, name: 'gitea', channel: 'stable' }]);
  });

  test('both copies expose each other as siblings, rc installed first (#433)', async () => {
    const { drafts, deployments } = makeSystem();
    const rc = await deployments.createFromDraft({
      draftId: await finalizedDraft(drafts, undefined, 'rc'),
      name: 'gitea-rc',
      options: { autoStart: false },
    });
    const stable = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts), name: 'gitea', options: { autoStart: false } });

    const rcDetail = await deployments.getDeployment(rc.deploymentId);
    const stableDetail = await deployments.getDeployment(stable.deploymentId);

    // In THIS order the audit fact lands on the stable copy — the wart in #433 —
    // but each detail still carries the other copy, so both can be labelled.
    expect(rcDetail.instanceReason).toBeUndefined();
    expect(rcDetail.channel).toBe('rc');
    expect(rcDetail.siblings).toEqual([{ id: stable.deploymentId, name: 'gitea', channel: 'stable' }]);

    expect(stableDetail.instanceReason).toBe('channel');
    expect(stableDetail.channel).toBe('stable');
    expect(stableDetail.siblings).toEqual([{ id: rc.deploymentId, name: 'gitea-rc', channel: 'rc' }]);
  });

  test('a lone deployment has no siblings (#433)', async () => {
    const { drafts, deployments } = makeSystem();
    const only = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts), name: 'gitea', options: { autoStart: false } });
    expect((await deployments.getDeployment(only.deploymentId)).siblings).toBeUndefined();
  });

  test('unknown/stale releases and unfinalized drafts fail with typed errors', async () => {
    const { drafts, deployments } = makeSystem();
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts), options: { autoStart: false } });

    await expect(deployments.getRelease(dep.deploymentId, 'bogus')).rejects.toBeInstanceOf(NotFoundError);
    await expect(deployments.rollback(dep.deploymentId, { targetReleaseId: 'bogus' })).rejects.toBeInstanceOf(NotFoundError);

    // Only the current release exists -> nothing to roll back to.
    await expect(deployments.rollback(dep.deploymentId, {})).rejects.toBeInstanceOf(ConflictError);

    // Creating from a non-finalized draft fails and leaves no deployment behind.
    const { draftId: unfinalized } = await drafts.createDraft({ appId: 'gitea' });
    await expect(deployments.createFromDraft({ draftId: unfinalized })).rejects.toBeInstanceOf(ConflictError);

    const list = await deployments.listDeployments({ page: 1, limit: 100 });
    expect(list.items).toHaveLength(1); // only the one valid deployment
  });
});
