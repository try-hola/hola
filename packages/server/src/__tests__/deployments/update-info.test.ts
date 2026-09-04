/**
 * Per-app update notifications (#284): deployment list/detail responses are
 * annotated with `latestVersion` + `updateAvailable` from the catalog. The
 * enrichment is fail-safe and a no-op when no catalog is wired.
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
import { MockDockerService } from '../../services/core/docker';
import type { CatalogService } from '../../services/core/catalog';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type JobArg = ConstructorParameters<typeof RealDeploymentService>[1];

type UpgradeMeta = {
  breaking?: boolean;
  minFromVersion?: string;
  waypoints?: string[];
  upgradeNotesUrl?: string;
  preUpgradeBackup?: 'required' | 'recommended' | 'none';
};

// A catalog version entry as fed to makeCatalog: a bare string (implies
// `stable`, unchanged from before #428) or `{ version, channel }` so channel
// tests can serve a mixed stable/rc list.
type CatalogVersionInput = string | { version: string; channel?: string };

function makeCatalog(versions: CatalogVersionInput[], opts?: { upgrade?: UpgradeMeta; detailThrows?: boolean }) {
  const versionStrings = () => versions.map((v) => (typeof v === 'string' ? v : v.version));
  const channelOfVersion = (version: string): string | undefined => {
    const entry = versions.find((v) => (typeof v === 'string' ? v : v.version) === version);
    if (!entry) return undefined;
    return typeof entry === 'string' ? 'stable' : (entry.channel ?? 'stable');
  };
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'Gitea', icon: '🍵' }),
    // #299: the on-demand update-check pulls this for the target version's
    // `upgrade` metadata. `detailThrows` simulates an unreachable *target* bundle
    // (only the newest version, never the 1.0.0 install path draft-create uses) so
    // the fail-safe fallback (cheap signal only) is exercised. `channel` (#428) is
    // echoed from the matching catalog entry (falling back to the caller-supplied
    // channel, then `stable`) so createDraft's channel resolution works against
    // this stub the same way it does against RealCatalogService.
    getVersionDetail: async (_appId: string, version: string, _source?: string, channel?: string) => {
      const vs = versionStrings();
      if (opts?.detailThrows && version === vs[vs.length - 1]) throw new Error('bundle unreachable');
      return {
        version,
        channel: channelOfVersion(version) ?? channel ?? 'stable',
        defaultEnv: [],
        defaults: { ports: [], volumes: [] },
        ...(opts?.upgrade ? { upgrade: opts.upgrade } : {}),
      };
    },
    getVersions: async () => ({
      items: versions.map((v) =>
        typeof v === 'string'
          ? { version: v, createdAt: '2020-01-01', channel: 'stable' }
          : { version: v.version, createdAt: '2020-01-01', channel: v.channel ?? 'stable' },
      ),
      total: versions.length,
    }),
  };
}
function makeValidation() {
  return { validateDraft: async () => ({ ok: true, errors: [], warnings: [] }), preflightCheck: async () => ({ ok: true, checks: [] }) };
}
function makeJobs(): JobArg {
  return {
    createJob: async (p: { type: string; deploymentId?: string }) => ({ id: crypto.randomUUID(), type: p.type, status: 'queued', startedAt: new Date().toISOString(), deploymentId: p.deploymentId }),
    listJobs: async () => [],
    cancelJob: async () => {},
    getJob: async () => null,
    onJobUpdate: () => ({ unsubscribe() {} }),
    setExecutor: () => {},
    healthCheck: async () => ({ healthy: true, lastCheck: new Date() }),
  } as unknown as JobArg;
}
const noLogging = { log: async () => {}, onLog: () => ({ unsubscribe() {} }), logJob: async () => {}, logDeployment: async () => {}, healthCheck: async () => ({ healthy: true, lastCheck: new Date() }) } as unknown as ConstructorParameters<typeof RealDeploymentService>[5];

describe('Per-app update notifications (#284)', () => {
  let dataRoot: string;
  beforeEach(async () => { dataRoot = await mkdtemp(join(tmpdir(), 'hola-upd-')); });
  afterEach(async () => { await rm(dataRoot, { recursive: true, force: true }); });

  function makeSystem(catalogVersions: CatalogVersionInput[] | null, opts?: { upgrade?: UpgradeMeta; detailThrows?: boolean }) {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const catalog = makeCatalog(catalogVersions ?? ['1.0.0'], opts);
    const drafts = new RealDraftService(storage, catalog as unknown as CatalogArg, makeValidation() as unknown as ConstructorParameters<typeof RealDraftService>[2]);
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const deployments = new RealDeploymentService(
      storage, makeJobs(), new MockDockerService(), drafts, routing, noLogging, new MockProvisionerService(),
      catalogVersions === null ? undefined : (catalog as unknown as CatalogService),
    );
    return { drafts, deployments, storage };
  }

  async function deploy(drafts: RealDraftService, deployments: RealDeploymentService, version: string, channel?: string) {
    const { draftId } = await drafts.createDraft({ appId: 'gitea', version, channel });
    await drafts.updateDraft(draftId, { composeOverride: 'services:\n  gitea:\n    image: gitea/gitea:latest\n' });
    await drafts.finalizeDraft(draftId);
    return deployments.createFromDraft({ draftId, name: 'gitea', options: { autoStart: false } });
  }

  test('a stable deployment is offered the newest stable version, never a pre-release (#428)', async () => {
    const { drafts, deployments } = makeSystem([
      { version: '1.1.0', channel: 'stable' },
      { version: '1.2.0', channel: 'stable' },
      { version: '1.3.0-rc.1', channel: 'rc' },
    ]);
    await deploy(drafts, deployments, '1.1.0');

    const list = await deployments.listDeployments({ page: 1, limit: 10 });
    expect(list.items[0].latestVersion).toBe('1.2.0');
    expect(list.items[0].updateAvailable).toBe(true);
    expect(list.items[0].latestVersionChannel).toBe('stable');
    expect(list.items[0].channel).toBe('stable');
  });

  test('an rc deployment is offered rc-eligible newer builds, then the graduated stable release (#428, US3)', async () => {
    const versions: CatalogVersionInput[] = [
      { version: '1.3.0-rc.1', channel: 'rc' },
      { version: '1.3.0-rc.2', channel: 'rc' },
    ];
    const { drafts, deployments } = makeSystem(versions);
    await deploy(drafts, deployments, '1.3.0-rc.1', 'rc');

    let list = await deployments.listDeployments({ page: 1, limit: 10 });
    expect(list.items[0].channel).toBe('rc');
    expect(list.items[0].latestVersion).toBe('1.3.0-rc.2');
    expect(list.items[0].latestVersionChannel).toBe('rc');
    expect(list.items[0].updateAvailable).toBe(true);

    // 1.3.0 graduates to stable — the rc deployment is offered it too (stable
    // is the floor every channel includes, FR-003).
    versions.push({ version: '1.3.0', channel: 'stable' });
    list = await deployments.listDeployments({ page: 1, limit: 10 });
    expect(list.items[0].latestVersion).toBe('1.3.0');
    expect(list.items[0].latestVersionChannel).toBe('stable');
  });

  test('a stable deployment with only a newer rc build available is offered nothing (#428, US3)', async () => {
    const { drafts, deployments } = makeSystem([
      { version: '1.2.0', channel: 'stable' },
      { version: '1.3.0-rc.2', channel: 'rc' },
    ]);
    await deploy(drafts, deployments, '1.2.0', 'stable');
    const list = await deployments.listDeployments({ page: 1, limit: 10 });
    expect(list.items[0].updateAvailable).toBe(false);
    // Its own newest ELIGIBLE version — i.e. itself, not the rc build.
    expect(list.items[0].latestVersion).toBe('1.2.0');
  });

  test('the channel is sticky across a promote: an rc deployment taking a stable release stays on rc (#428, US3/US4)', async () => {
    const versions: CatalogVersionInput[] = [
      { version: '1.3.0-rc.2', channel: 'rc' },
      { version: '1.3.0', channel: 'stable' },
    ];
    const { drafts, deployments } = makeSystem(versions);
    const dep = await deploy(drafts, deployments, '1.3.0-rc.2', 'rc');
    expect((await deployments.getDeployment(dep.deploymentId)).channel).toBe('rc');

    const target = await deployments.resolveUpgradeTarget(dep.deploymentId);
    expect(target.version).toBe('1.3.0');
    expect(target.channel).toBe('rc');

    const { draftId } = await drafts.createDraft({ appId: 'gitea', version: target.version, channel: target.channel });
    await drafts.updateDraft(draftId, { composeOverride: 'services:\n  gitea:\n    image: gitea/gitea:latest\n' });
    await drafts.finalizeDraft(draftId);
    await deployments.promote(dep.deploymentId, { draftId, options: { autoStart: false } });

    const detail = await deployments.getDeployment(dep.deploymentId);
    expect(detail.version).toBe('1.3.0');
    expect(detail.channel).toBe('rc');
  });

  test('an explicit upgrade to a version outside the deployment channel is rejected (#428, US3)', async () => {
    const { drafts, deployments } = makeSystem([
      { version: '1.2.0', channel: 'stable' },
      { version: '1.3.0-rc.1', channel: 'rc' },
    ]);
    const dep = await deploy(drafts, deployments, '1.2.0', 'stable');
    await expect(deployments.resolveUpgradeTarget(dep.deploymentId, '1.3.0-rc.1')).rejects.toMatchObject({
      code: 'VERSION_NOT_ON_CHANNEL',
      status: 400,
    });
  });

  test('records without a stored channel are treated as stable (#428, pre-feature records)', async () => {
    const { drafts, deployments, storage } = makeSystem(['1.0.0', '2.0.0']);
    const { deploymentId } = await deploy(drafts, deployments, '1.0.0');

    // Simulate a pre-feature record: strip `channel` from the persisted metadata.
    const metaPath = `deployments/${deploymentId}/metadata.json`;
    const raw = JSON.parse(await storage.readFileAsString(metaPath)) as Record<string, unknown>;
    delete raw.channel;
    await storage.writeFile(metaPath, JSON.stringify(raw));

    // Reload a fresh service instance so it rehydrates from the edited file.
    const { deployments: reloaded } = makeSystem(['1.0.0', '2.0.0']);
    const list = await reloaded.listDeployments({ page: 1, limit: 10 });
    expect(list.items[0].channel).toBe('stable');
  });

  test('flags updateAvailable + latestVersion when the catalog has a newer version', async () => {
    const { drafts, deployments } = makeSystem(['1.0.0', '2.0.0']);
    await deploy(drafts, deployments, '1.0.0');

    const list = await deployments.listDeployments({ page: 1, limit: 10 });
    expect(list.items[0].latestVersion).toBe('2.0.0');
    expect(list.items[0].updateAvailable).toBe(true);

    const detail = await deployments.getDeployment(list.items[0].id);
    expect(detail.updateAvailable).toBe(true);
    expect(detail.latestVersion).toBe('2.0.0');
  });

  test('no update when installed is already the newest', async () => {
    const { drafts, deployments } = makeSystem(['1.0.0', '2.0.0']);
    await deploy(drafts, deployments, '2.0.0');
    const list = await deployments.listDeployments({ page: 1, limit: 10 });
    expect(list.items[0].latestVersion).toBe('2.0.0');
    expect(list.items[0].updateAvailable).toBe(false);
  });

  test('a deployment pinned to "latest" is never flagged as out-of-date', async () => {
    const { drafts, deployments } = makeSystem(['1.0.0', '2.0.0']);
    await deploy(drafts, deployments, 'latest');
    const list = await deployments.listDeployments({ page: 1, limit: 10 });
    // latestVersion is still surfaced, but there's no spurious "update available"
    // (we don't know the concrete installed version behind "latest").
    expect(list.items[0].latestVersion).toBe('2.0.0');
    expect(list.items[0].updateAvailable).toBe(false);
  });

  test('no catalog wired → fields left unset (no enrichment)', async () => {
    const { drafts, deployments } = makeSystem(null);
    await deploy(drafts, deployments, '1.0.0');
    const list = await deployments.listDeployments({ page: 1, limit: 10 });
    expect(list.items[0].latestVersion).toBeUndefined();
    expect(list.items[0].updateAvailable).toBeUndefined();
  });
});

describe('On-demand richer update check (#299)', () => {
  let dataRoot: string;
  beforeEach(async () => { dataRoot = await mkdtemp(join(tmpdir(), 'hola-upd299-')); });
  afterEach(async () => { await rm(dataRoot, { recursive: true, force: true }); });

  function makeSystem(catalogVersions: CatalogVersionInput[] | null, opts?: { upgrade?: UpgradeMeta; detailThrows?: boolean }) {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const catalog = makeCatalog(catalogVersions ?? ['1.0.0'], opts);
    const drafts = new RealDraftService(storage, catalog as unknown as CatalogArg, makeValidation() as unknown as ConstructorParameters<typeof RealDraftService>[2]);
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const deployments = new RealDeploymentService(
      storage, makeJobs(), new MockDockerService(), drafts, routing, noLogging, new MockProvisionerService(),
      catalogVersions === null ? undefined : (catalog as unknown as CatalogService),
    );
    return { drafts, deployments };
  }

  async function deploy(drafts: RealDraftService, deployments: RealDeploymentService, version: string, channel?: string) {
    const { draftId } = await drafts.createDraft({ appId: 'gitea', version, channel });
    await drafts.updateDraft(draftId, { composeOverride: 'services:\n  gitea:\n    image: gitea/gitea:latest\n' });
    await drafts.finalizeDraft(draftId);
    return deployments.createFromDraft({ draftId, name: 'gitea', options: { autoStart: false } });
  }

  test('surfaces breaking + waypoint path + backup + notes for a guided upgrade', async () => {
    const { drafts, deployments } = makeSystem(['1.0.0', '1.5.0', '2.0.0'], {
      upgrade: { breaking: true, waypoints: ['1.5.0'], preUpgradeBackup: 'required', upgradeNotesUrl: 'https://notes.example/2' },
    });
    const dep = await deploy(drafts, deployments, '1.0.0');

    const check = await deployments.getUpdateCheck(dep.deploymentId);
    expect(check.installedVersion).toBe('1.0.0');
    expect(check.latestVersion).toBe('2.0.0');
    expect(check.updateAvailable).toBe(true);
    expect(check.breaking).toBe(true);
    expect(check.preUpgradeBackup).toBe('required');
    expect(check.upgradeNotesUrl).toBe('https://notes.example/2');
    // Can't jump 1.0.0 → 2.0.0 past the 1.5.0 waypoint.
    expect(check.path).toEqual({
      ok: false,
      code: 'waypoint-required',
      message: expect.stringContaining('1.5.0'),
      suggestedVersion: '1.5.0',
    });
  });

  test('a clean upgrade reports a passable path and no breaking flag', async () => {
    const { drafts, deployments } = makeSystem(['1.0.0', '2.0.0'], { upgrade: { preUpgradeBackup: 'recommended' } });
    const dep = await deploy(drafts, deployments, '1.0.0');

    const check = await deployments.getUpdateCheck(dep.deploymentId);
    expect(check.updateAvailable).toBe(true);
    expect(check.path).toEqual({ ok: true });
    expect(check.breaking).toBeUndefined();
    expect(check.preUpgradeBackup).toBe('recommended');
  });

  test('no update available → cheap signal only, no path / no bundle richness', async () => {
    const { drafts, deployments } = makeSystem(['1.0.0', '2.0.0'], { upgrade: { breaking: true } });
    const dep = await deploy(drafts, deployments, '2.0.0'); // already newest

    const check = await deployments.getUpdateCheck(dep.deploymentId);
    expect(check.updateAvailable).toBe(false);
    expect(check.latestVersion).toBe('2.0.0');
    expect(check.path).toBeUndefined();
    expect(check.breaking).toBeUndefined();
  });

  test('fail-safe: a bundle pull error falls back to the cheap signal', async () => {
    const { drafts, deployments } = makeSystem(['1.0.0', '2.0.0'], { detailThrows: true });
    const dep = await deploy(drafts, deployments, '1.0.0');

    const check = await deployments.getUpdateCheck(dep.deploymentId);
    // The cheap #284 signal still resolves...
    expect(check.updateAvailable).toBe(true);
    expect(check.latestVersion).toBe('2.0.0');
    // ...but the target-bundle richness is absent rather than throwing.
    expect(check.path).toBeUndefined();
    expect(check.breaking).toBeUndefined();
  });

  test('mock service (no catalog) → base signal, no throw', async () => {
    const { drafts, deployments } = makeSystem(null);
    const dep = await deploy(drafts, deployments, '1.0.0');
    const check = await deployments.getUpdateCheck(dep.deploymentId);
    expect(check.installedVersion).toBe('1.0.0');
    expect(check.updateAvailable).toBe(false);
    expect(check.path).toBeUndefined();
  });

  test('update-check response carries channel and latestVersionChannel (#428)', async () => {
    const { drafts, deployments } = makeSystem([
      { version: '1.1.0-rc.1', channel: 'rc' },
      { version: '1.1.0-rc.2', channel: 'rc' },
    ]);
    const dep = await deploy(drafts, deployments, '1.1.0-rc.1', 'rc');
    const check = await deployments.getUpdateCheck(dep.deploymentId);
    expect(check.channel).toBe('rc');
    expect(check.latestVersion).toBe('1.1.0-rc.2');
    expect(check.latestVersionChannel).toBe('rc');
    expect(check.updateAvailable).toBe(true);
  });
});
