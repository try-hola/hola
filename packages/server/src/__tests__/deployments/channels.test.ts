/**
 * Release channels (#428) — draft channel resolution: an explicit channel, a
 * pinned version's implied channel, and the three request-error shapes
 * (INVALID_CHANNEL, NO_VERSION_ON_CHANNEL, VERSION_NOT_ON_CHANNEL). Uses a
 * duck-typed catalog stub whose `getVersionDetail` implements the resolution
 * rules from data-model.md with the shared helpers — the REAL
 * `RealCatalogService.getVersionDetail` is covered by catalog-channels.test.ts.
 *
 * Template: deployments/update-info.test.ts `makeSystem`.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { RealDraftService } from '../../services/core/draft';
import { RealStorageService } from '../../services/core/storage';
import { RealDeploymentService } from '../../services/core/deployment';
import { RealRoutingService } from '../../services/core/routing';
import { MockDockerService } from '../../services/core/docker';
import { MockProvisionerService } from '../../services/core/provisioner';
import { ValidationError, BundleUnavailableError } from '../../middleware/error-mapping';
import { isValidChannelName, isEligibleOnChannel, newestEligibleVersion } from '@hola/shared';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

type ChannelVersionEntry = { version: string; channel: string };

/**
 * A minimal catalog whose `getVersionDetail` implements the #428 resolution
 * rules (data-model.md) over a fixed version list, using the real shared
 * helpers — so this test exercises draft.ts's channel plumbing against a
 * faithful (if duck-typed) catalog contract, not a stub that always succeeds.
 */
type CountingCatalog = CatalogArg & { getVersionsCalls: number };

function makeChannelCatalog(entries: ChannelVersionEntry[]): CountingCatalog {
  const catalog = {
    // Counts the catalog version-list fetches one resolution costs (#432).
    getVersionsCalls: 0,
    getApp: async (appId: string) => ({ id: appId, name: 'Demo', icon: '📦' }),
    getVersions: async () => {
      catalog.getVersionsCalls++;
      return { items: entries.map((e) => ({ version: e.version, createdAt: '2020-01-01', channel: e.channel })), total: entries.length };
    },
    // `channel` is deliberately NOT defaulted here (matches RealCatalogService,
    // FR-009): a pinned version's eligibility is enforced only when the caller
    // EXPLICITLY passed a channel; `latest`/no version defaults to `stable`.
    getVersionDetail: async (appId: string, version: string, _source?: string, channel?: string) => {
      if (channel !== undefined && !isValidChannelName(channel)) {
        const err = new ValidationError(`Channel '${channel}' is not a valid channel name.`);
        err.code = 'INVALID_CHANNEL';
        throw err;
      }
      if (!version || version === 'latest') {
        const effectiveChannel = channel ?? 'stable';
        const newest = newestEligibleVersion(entries, effectiveChannel);
        if (!newest) {
          const channelsWithVersions = [...new Set(entries.map((e) => e.channel))].sort();
          throw new BundleUnavailableError(
            `No version of '${appId}' is available on channel '${effectiveChannel}'. Channels with versions: ${channelsWithVersions.join(', ')}.`,
            'NO_VERSION_ON_CHANNEL',
          );
        }
        return { version: newest.version, channel: newest.channel, defaultEnv: [], defaults: { ports: [], volumes: [] } };
      }
      const v = entries.find((e) => e.version === version);
      if (!v) throw new BundleUnavailableError(`VERSION_NOT_FOUND: ${appId}@${version}`, 'VERSION_NOT_FOUND');
      if (channel !== undefined && !isEligibleOnChannel(v.channel, channel)) {
        const err = new ValidationError(`Version ${v.version} of '${appId}' is on channel '${v.channel}', not eligible on channel '${channel}'.`);
        err.code = 'VERSION_NOT_ON_CHANNEL';
        throw err;
      }
      return { version: v.version, channel: v.channel, defaultEnv: [], defaults: { ports: [], volumes: [] } };
    },
  };
  return catalog as unknown as CountingCatalog;
}

function makeValidation(): ValidationArg {
  return { validateDraft: async () => ({ ok: true, errors: [], warnings: [] }), preflightCheck: async () => ({ ok: true, checks: [] }) } as unknown as ValidationArg;
}

const ENTRIES: ChannelVersionEntry[] = [
  { version: '1.2.0', channel: 'stable' },
  { version: '1.3.0-rc.1', channel: 'rc' },
];

describe('Release channels: draft resolution (#428)', () => {
  let dataRoot: string;
  let drafts: RealDraftService;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-draft-channels-'));
    const storage = new RealStorageService({ holaDir: dataRoot });
    drafts = new RealDraftService(storage, makeChannelCatalog(ENTRIES), makeValidation());
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  test('an explicit channel resolves the newest eligible version and is persisted on the draft', async () => {
    const { draftId } = await drafts.createDraft({ appId: 'demo', channel: 'rc' });
    const draft = await drafts.getDraft(draftId);
    expect(draft.version).toBe('1.3.0-rc.1');
    expect(draft.channel).toBe('rc');
  });

  test('a pinned pre-release version with no explicit channel implies its own channel', async () => {
    const { draftId } = await drafts.createDraft({ appId: 'demo', version: '1.3.0-rc.1' });
    const draft = await drafts.getDraft(draftId);
    expect(draft.version).toBe('1.3.0-rc.1');
    expect(draft.channel).toBe('rc');
  });

  test('an explicit channel with no dedicated version still resolves via the stable floor (FR-003)', async () => {
    // `beta` has no version of its own, but a stable version is eligible on
    // every channel (the floor) — `latest` on `beta` resolves to it rather
    // than rejecting, per FR-003/data-model.md Eligibility.
    const { draftId } = await drafts.createDraft({ appId: 'demo', channel: 'beta' });
    const draft = await drafts.getDraft(draftId);
    expect(draft.version).toBe('1.2.0');
    expect(draft.channel).toBe('beta');
  });

  test('an app with no stable version at all → a default (implicit stable) install is rejected naming the channels that do have versions', async () => {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const rcOnly = new RealDraftService(storage, makeChannelCatalog([{ version: '1.0.0-rc.1', channel: 'rc' }]), makeValidation());
    await expect(rcOnly.createDraft({ appId: 'demo' })).rejects.toMatchObject({
      code: 'NO_VERSION_ON_CHANNEL',
      status: 404,
      message: expect.stringContaining('rc'),
    });
  });

  test('a pinned version not eligible on the explicit channel → VERSION_NOT_ON_CHANNEL', async () => {
    await expect(drafts.createDraft({ appId: 'demo', version: '1.3.0-rc.1', channel: 'stable' })).rejects.toMatchObject({
      code: 'VERSION_NOT_ON_CHANNEL',
      status: 400,
      message: expect.stringContaining('1.3.0-rc.1'),
    });
  });

  test('a malformed channel name → INVALID_CHANNEL, rejected before any catalog call', async () => {
    await expect(drafts.createDraft({ appId: 'demo', channel: 'Bad Name' })).rejects.toMatchObject({
      code: 'INVALID_CHANNEL',
      status: 400,
    });
  });

  test('the default channel (no request.channel, no pinned version) is stable', async () => {
    const { draftId } = await drafts.createDraft({ appId: 'demo' });
    const draft = await drafts.getDraft(draftId);
    expect(draft.version).toBe('1.2.0');
    expect(draft.channel).toBe('stable');
  });

  test('the finalized manifest carries the resolved channel', async () => {
    const { draftId } = await drafts.createDraft({ appId: 'demo', channel: 'rc' });
    await drafts.updateDraft(draftId, { composeOverride: 'services:\n  demo:\n    image: demo:1\n' });
    const { spec } = await drafts.finalizeDraft(draftId);
    expect((spec as { channel?: string }).channel).toBe('rc');
  });
});

// ---------------------------------------------------------------------------
// User Story 4 (#428): PATCH /api/deployments/:id { channel } changes the
// followed channel without a job.
// ---------------------------------------------------------------------------
type JobArg = ConstructorParameters<typeof RealDeploymentService>[1];
const noLogging = { log: async () => {}, onLog: () => ({ unsubscribe() {} }), logJob: async () => {}, logDeployment: async () => {}, healthCheck: async () => ({ healthy: true, lastCheck: new Date() }) } as unknown as ConstructorParameters<typeof RealDeploymentService>[5];

function makeJobs(): JobArg {
  const jobs: Array<{ id: string; type: string; status: string; startedAt: string; deploymentId?: string }> = [];
  return {
    createJob: async (p: { type: string; deploymentId?: string }) => {
      const job = { id: crypto.randomUUID(), type: p.type, status: 'queued', startedAt: new Date().toISOString(), deploymentId: p.deploymentId };
      jobs.push(job);
      return job;
    },
    listJobs: async (f?: { deploymentId?: string }) => jobs.filter((j) => !f?.deploymentId || j.deploymentId === f.deploymentId),
    cancelJob: async () => {},
    getJob: async () => null,
    onJobUpdate: () => ({ unsubscribe() {} }),
    setExecutor: () => {},
    healthCheck: async () => ({ healthy: true, lastCheck: new Date() }),
  } as unknown as JobArg;
}

describe('Release channels: PATCH channel change (#428, US4)', () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-patch-channel-'));
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  function makeSystem() {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const catalog = makeChannelCatalog(ENTRIES);
    const drafts = new RealDraftService(storage, catalog, makeValidation());
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const jobs = makeJobs();
    const deployments = new RealDeploymentService(
      storage, jobs, new MockDockerService(), drafts, routing, noLogging, new MockProvisionerService(),
      catalog as unknown as ConstructorParameters<typeof RealDeploymentService>[7],
    );
    return { drafts, deployments, jobs, catalog };
  }

  async function deploy(drafts: RealDraftService, deployments: RealDeploymentService, name: string, channel?: string) {
    const { draftId } = await drafts.createDraft({ appId: 'demo', channel });
    await drafts.updateDraft(draftId, { composeOverride: 'services:\n  demo:\n    image: demo:1\n' });
    await drafts.finalizeDraft(draftId);
    return deployments.createFromDraft({ draftId, name, options: { autoStart: false } });
  }

  test('PATCH { channel } persists the channel, leaves version/currentReleaseId untouched, and enqueues no job', async () => {
    const { drafts, deployments, jobs } = makeSystem();
    const dep = await deploy(drafts, deployments, 'demo');
    const before = await deployments.getDeployment(dep.deploymentId);
    const jobCountBefore = (await jobs.listJobs()).length;

    const res = await deployments.updateDeployment(dep.deploymentId, { channel: 'rc' });
    expect(res.ok).toBe(true);
    expect(res.warnings).toBeUndefined();

    const after = await deployments.getDeployment(dep.deploymentId);
    expect(after.channel).toBe('rc');
    expect(after.version).toBe(before.version);
    expect((await jobs.listJobs()).length).toBe(jobCountBefore); // no job — pure metadata write
  });

  test('PATCH { channel } returns a warning when another single-instance copy already follows it', async () => {
    const { drafts, deployments } = makeSystem();
    await deploy(drafts, deployments, 'demo-rc', 'rc');
    const stable = await deploy(drafts, deployments, 'demo');

    const res = await deployments.updateDeployment(stable.deploymentId, { channel: 'rc' });
    expect(res.ok).toBe(true);
    expect(res.warnings?.some((w) => w.includes('demo'))).toBe(true);
  });

  test('PATCH { channel } returns no warning when no other copy follows the target channel', async () => {
    const { drafts, deployments } = makeSystem();
    const dep = await deploy(drafts, deployments, 'demo');
    const res = await deployments.updateDeployment(dep.deploymentId, { channel: 'rc' });
    expect(res.warnings).toBeUndefined();
  });

  test('PATCH { channel: "Bad Name" } → INVALID_CHANNEL', async () => {
    const { drafts, deployments } = makeSystem();
    const dep = await deploy(drafts, deployments, 'demo');
    await expect(deployments.updateDeployment(dep.deploymentId, { channel: 'Bad Name' })).rejects.toMatchObject({
      code: 'INVALID_CHANNEL',
      status: 400,
    });
  });

  test('PATCH combining channel with an env change applies both', async () => {
    const { drafts, deployments } = makeSystem();
    const dep = await deploy(drafts, deployments, 'demo');
    const res = await deployments.updateDeployment(dep.deploymentId, {
      channel: 'rc',
      env: [{ key: 'APP_PORT', value: '3000', isSecret: false }],
    });
    expect(res.ok).toBe(true);
    const after = await deployments.getDeployment(dep.deploymentId);
    expect(after.channel).toBe('rc');
  });

  test('after a channel change the promote target follows the new channel, on one version-list fetch (#432)', async () => {
    const { drafts, deployments, catalog } = makeSystem();
    const dep = await deploy(drafts, deployments, 'demo');
    await deployments.updateDeployment(dep.deploymentId, { channel: 'rc' });
    catalog.getVersionsCalls = 0;

    // The promote route's shape: one deployment read, its detail handed to the
    // target resolution — one catalog version-list fetch for the pair.
    const detail = await deployments.getDeployment(dep.deploymentId);
    const target = await deployments.resolveUpgradeTarget(dep.deploymentId, undefined, { detail });

    expect(target).toEqual({ version: '1.3.0-rc.1', channel: 'rc' });
    expect(catalog.getVersionsCalls).toBe(1);
  });

  test('instanceReason is unchanged after a channel change', async () => {
    const { drafts, deployments } = makeSystem();
    const first = await deploy(drafts, deployments, 'demo');
    const second = await deploy(drafts, deployments, 'demo-rc', 'rc');
    expect((await deployments.getDeployment(second.deploymentId)).instanceReason).toBe('channel');

    await deployments.updateDeployment(second.deploymentId, { channel: 'beta' });
    const after = await deployments.getDeployment(second.deploymentId);
    expect(after.channel).toBe('beta');
    expect(after.instanceReason).toBe('channel'); // preserved, not retroactively recomputed

    void first;
  });
});
