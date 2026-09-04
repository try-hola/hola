/**
 * Promote (upgrade) endpoint — POST /api/deployments/:id/promote (#284 Phase 2).
 *
 * Hermetic route-layer tests against the in-process server with mock services.
 * The full upgrade orchestration (draft → env carry-forward → finalize → promote →
 * pgautoupgrade migration) is exercised end-to-end on a disposable VM; here we
 * pin the operator-facing contract: a seeded deployment with no newer catalog
 * version can't be promoted without an explicit target.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { setupTestServer, teardownTestServer } from '../utils/bun-server';

const baseURL = 'http://localhost:3002';

describe('POST /api/deployments/:id/promote', () => {
  beforeAll(async () => {
    await setupTestServer(3002, { NODE_ENV: 'test' });
  });

  afterAll(async () => {
    await teardownTestServer();
  });

  test('400 NO_TARGET_VERSION when the deployment has no newer version and none is given', async () => {
    // seed-nextcloud is a mock-seeded deployment with no `latestVersion`.
    const res = await fetch(`${baseURL}/api/deployments/seed-nextcloud/promote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('NO_TARGET_VERSION');
  });
});

// ---------------------------------------------------------------------------
// Release channels (#428, US3): the promote target/draft is channel-aware.
//
// The HTTP harness above always runs against `MockCatalogService` (test env),
// which is deliberately empty (Constitution II) — it can't serve channel-
// tagged versions. So these exercise the same `RealDeploymentService` +
// `RealDraftService` seam the promote ROUTE (server.ts) itself calls
// (`resolveUpgradeTarget` → `drafts.createDraft({ …, channel })`), against a
// duck-typed channel-aware catalog stub — same pattern as
// deployments/channels.test.ts and deployments/update-info.test.ts.
// ---------------------------------------------------------------------------
import { mkdtemp, rm, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { AppUpgradeMeta } from '@hola/shared';
import { RealDeploymentService } from '../../services/core/deployment';
import { MockProvisionerService } from '../../services/core/provisioner';
import { RealDraftService } from '../../services/core/draft';
import { RealStorageService } from '../../services/core/storage';
import { RealRoutingService } from '../../services/core/routing';
import { MockDockerService } from '../../services/core/docker';
import type { CatalogService } from '../../services/core/catalog';

type CatalogArg2 = ConstructorParameters<typeof RealDraftService>[1];
type JobArg2 = ConstructorParameters<typeof RealDeploymentService>[1];

type ChannelVersionEntry = { version: string; channel: string; upgrade?: AppUpgradeMeta };

/** The stub counts its `getVersions` calls so a test can pin how many
 *  catalog version-list fetches one promote resolution costs (#432). */
type CountingCatalog = CatalogArg2 & { getVersionsCalls: number };

function makeChannelCatalog(entries: ChannelVersionEntry[]): CountingCatalog {
  const catalog = {
    getVersionsCalls: 0,
    getApp: async (appId: string) => ({ id: appId, name: 'Demo', icon: '📦' }),
    getVersionDetail: async (_appId: string, version: string) => {
      const entry = entries.find((e) => e.version === version);
      return {
        version,
        channel: entry?.channel ?? 'stable',
        defaultEnv: [],
        defaults: { ports: [{ host: 3000, container: 3000, protocol: 'tcp' as const }], volumes: [] },
        ...(entry?.upgrade ? { upgrade: entry.upgrade } : {}),
      };
    },
    getVersions: async () => {
      catalog.getVersionsCalls++;
      return {
        items: entries.map((e) => ({ version: e.version, createdAt: '2020-01-01', channel: e.channel })),
        total: entries.length,
      };
    },
  };
  return catalog as unknown as CountingCatalog;
}

function makeValidation2() {
  return { validateDraft: async () => ({ ok: true, errors: [], warnings: [] }), preflightCheck: async () => ({ ok: true, checks: [] }) };
}

function makeJobs2(): JobArg2 {
  return {
    createJob: async (p: { type: string; deploymentId?: string }) => ({ id: crypto.randomUUID(), type: p.type, status: 'queued', startedAt: new Date().toISOString(), deploymentId: p.deploymentId }),
    listJobs: async () => [],
    cancelJob: async () => {},
    getJob: async () => null,
    onJobUpdate: () => ({ unsubscribe() {} }),
    setExecutor: () => {},
    healthCheck: async () => ({ healthy: true, lastCheck: new Date() }),
  } as unknown as JobArg2;
}
const noLogging2 = { log: async () => {}, onLog: () => ({ unsubscribe() {} }), logJob: async () => {}, logDeployment: async () => {}, healthCheck: async () => ({ healthy: true, lastCheck: new Date() }) } as unknown as ConstructorParameters<typeof RealDeploymentService>[5];

describe('Promote target resolution + draft channel (#428, US3)', () => {
  let dataRoot: string;
  let appsRoot: string;
  let prevAppsBindRoot: string | undefined;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-promote-ch-data-'));
    appsRoot = await mkdtemp(join(tmpdir(), 'hola-promote-ch-apps-'));
    prevAppsBindRoot = process.env.HOLA_APPS_BIND_ROOT;
    process.env.HOLA_APPS_BIND_ROOT = appsRoot;
  });

  afterEach(async () => {
    if (prevAppsBindRoot === undefined) delete process.env.HOLA_APPS_BIND_ROOT;
    else process.env.HOLA_APPS_BIND_ROOT = prevAppsBindRoot;
    await rm(dataRoot, { recursive: true, force: true });
    await rm(appsRoot, { recursive: true, force: true });
  });

  function makeSystem(entries: ChannelVersionEntry[]) {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const catalog = makeChannelCatalog(entries);
    const drafts = new RealDraftService(storage, catalog, makeValidation2() as unknown as ConstructorParameters<typeof RealDraftService>[2]);
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const deployments = new RealDeploymentService(
      storage, makeJobs2(), new MockDockerService(), drafts, routing, noLogging2, new MockProvisionerService(),
      catalog as unknown as CatalogService,
    );
    return { drafts, deployments, catalog };
  }

  async function finalizedDraft(drafts: RealDraftService, version: string, channel?: string): Promise<string> {
    const { draftId } = await drafts.createDraft({ appId: 'demo', version, channel });
    await drafts.updateDraft(draftId, { composeOverride: 'services:\n  demo:\n    image: demo:1\n' });
    await drafts.finalizeDraft(draftId);
    return draftId;
  }

  test('an explicit target outside the deployment channel is rejected, naming the PATCH hint', async () => {
    const { drafts, deployments } = makeSystem([
      { version: '1.2.0', channel: 'stable' },
      { version: '1.3.0-rc.1', channel: 'rc' },
    ]);
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '1.2.0', 'stable'), name: 'demo', options: { autoStart: false } });

    await expect(deployments.resolveUpgradeTarget(dep.deploymentId, '1.3.0-rc.1')).rejects.toMatchObject({
      code: 'VERSION_NOT_ON_CHANNEL',
      status: 400,
      message: expect.stringContaining(`PATCH /api/deployments/${dep.deploymentId}`),
    });
  });

  test('the promote route\'s resolution costs a single catalog version-list fetch (#432)', async () => {
    const { drafts, deployments, catalog } = makeSystem([
      { version: '1.3.0-rc.1', channel: 'rc' },
      { version: '1.3.0-rc.2', channel: 'rc' },
    ]);
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '1.3.0-rc.1', 'rc'), name: 'demo', options: { autoStart: false } });
    catalog.getVersionsCalls = 0;

    // Exactly the promote route's shape: one getDeployment, whose detail is
    // handed to resolveUpgradeTarget — so the only version-list fetch is the
    // one enrichUpdateInfo already makes for `latestVersion`.
    const detail = await deployments.getDeployment(dep.deploymentId);
    const target = await deployments.resolveUpgradeTarget(dep.deploymentId, undefined, { detail });

    expect(target).toEqual({ version: '1.3.0-rc.2', channel: 'rc' });
    expect(catalog.getVersionsCalls).toBe(1);
  });

  test('an explicit target adds exactly one eligibility fetch, never a third (#432)', async () => {
    const { drafts, deployments, catalog } = makeSystem([
      { version: '1.3.0-rc.1', channel: 'rc' },
      { version: '1.3.0-rc.2', channel: 'rc' },
    ]);
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '1.3.0-rc.1', 'rc'), name: 'demo', options: { autoStart: false } });
    catalog.getVersionsCalls = 0;

    const detail = await deployments.getDeployment(dep.deploymentId);
    const target = await deployments.resolveUpgradeTarget(dep.deploymentId, '1.3.0-rc.2', { detail });

    expect(target).toEqual({ version: '1.3.0-rc.2', channel: 'rc' });
    // The detail's own enrichment fetch + the channel-eligibility lookup.
    expect(catalog.getVersionsCalls).toBe(2);
  });

  test('with no explicit version, an rc deployment resolves the rc-eligible newest as the target', async () => {
    const { drafts, deployments } = makeSystem([
      { version: '1.3.0-rc.1', channel: 'rc' },
      { version: '1.3.0-rc.2', channel: 'rc' },
    ]);
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '1.3.0-rc.1', 'rc'), name: 'demo', options: { autoStart: false } });

    const target = await deployments.resolveUpgradeTarget(dep.deploymentId);
    expect(target.version).toBe('1.3.0-rc.2');
    expect(target.channel).toBe('rc');
  });

  test('the draft built for the upgrade is created with the deployment\'s channel (mirrors the promote route)', async () => {
    const { drafts, deployments } = makeSystem([
      { version: '1.3.0-rc.1', channel: 'rc' },
      { version: '1.3.0-rc.2', channel: 'rc' },
    ]);
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '1.3.0-rc.1', 'rc'), name: 'demo', options: { autoStart: false } });

    const target = await deployments.resolveUpgradeTarget(dep.deploymentId);
    // Same call shape as the server.ts promote route.
    const { draftId } = await drafts.createDraft({ appId: 'demo', version: target.version, channel: target.channel });
    const draft = await drafts.getDraft(draftId);
    expect(draft.channel).toBe('rc');
  });

  // The target (stable 1.3.0) requires >= 1.3.0-rc.2 and a mandatory backup —
  // exactly the H2/H7 shape a stable→stable upgrade would declare.
  const FR014_ENTRIES: ChannelVersionEntry[] = [
    { version: '1.3.0-rc.1', channel: 'rc' },
    { version: '1.3.0-rc.2', channel: 'rc' },
    { version: '1.3.0', channel: 'stable', upgrade: { minFromVersion: '1.3.0-rc.2', preUpgradeBackup: 'required' } },
  ];

  test('FR-014: the skip-guard blocks an rc→stable jump below the floor, exactly as a stable→stable jump would be', async () => {
    const { drafts, deployments } = makeSystem(FR014_ENTRIES);
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '1.3.0-rc.1', 'rc'), name: 'demo', options: { autoStart: false } });
    await expect(
      deployments.promote(dep.deploymentId, { draftId: await finalizedDraft(drafts, '1.3.0', 'rc'), options: { autoStart: false } })
    ).rejects.toMatchObject({ message: expect.stringContaining('1.3.0-rc.2') });
  });

  test('FR-014: from the floor, an rc→stable promote triggers the pre-upgrade snapshot path and stays on rc', async () => {
    const { drafts, deployments } = makeSystem(FR014_ENTRIES);
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '1.3.0-rc.2', 'rc'), name: 'demo', options: { autoStart: false } });
    const appRoot = join(appsRoot, dep.deploymentId);
    const fs = await import('fs/promises');
    await fs.mkdir(appRoot, { recursive: true });
    await fs.writeFile(join(appRoot, 'state.txt'), 'v-rc2-data');

    // preUpgradeBackup: "required" captures a pre-upgrade snapshot before
    // switching the release — the same path #284 Phase 1 exercises for
    // stable-to-stable upgrades, now exercised across a channel-tagged jump.
    await deployments.promote(dep.deploymentId, { draftId: await finalizedDraft(drafts, '1.3.0', 'rc'), options: { autoStart: false } });

    const detail = await deployments.getDeployment(dep.deploymentId);
    expect(detail.version).toBe('1.3.0');
    expect(detail.channel).toBe('rc'); // sticky (#428): the promote never touches channel.

    const snapshotsDir = join(dataRoot, 'deployments', dep.deploymentId, 'snapshots');
    const snaps = await readdir(snapshotsDir);
    expect(snaps.length).toBeGreaterThan(0);
    expect(existsSync(join(snapshotsDir, snaps[0], 'data.tar.gz'))).toBe(true);
  });
});
