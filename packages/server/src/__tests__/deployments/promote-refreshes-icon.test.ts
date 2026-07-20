/**
 * Promote refreshes the deployment's cached catalog icon.
 *
 * `icon` is persisted onto the deployment record at install (createFromDraft) so
 * the launcher can render a tile without a live catalog lookup. Nothing refreshed
 * it afterwards, so an app whose catalog package changed its logo kept the icon it
 * had on install day forever — even across upgrades. promote() resolves the new
 * manifest anyway, so it now syncs the icon alongside the version.
 *
 * `name` is deliberately excluded: a caller-supplied name wins at install and the
 * record can't tell one from a manifest-derived default, so refreshing it would
 * clobber an operator's rename. That exclusion is asserted here too.
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
import type { DockerService } from '../../services/core/docker';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];
type JobArg = ConstructorParameters<typeof RealDeploymentService>[1];

const EMOJI_ICON = '🖥️';
const LOGO_ICON = 'https://raw.githubusercontent.com/try-hola/apps/main/icons/remo.svg';

/** Catalog whose icon can change between installs, as a real one does when a package ships a logo. */
function makeCatalog(icon: { current: string }): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'Remo', icon: icon.current }),
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

function makeJobs(): JobArg {
  const jobs: Array<{ id: string; type: string; status: string; startedAt: string; deploymentId?: string }> = [];
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

describe('promote refreshes the cached catalog icon', () => {
  let dataRoot: string;
  const icon = { current: EMOJI_ICON };

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-promote-icon-'));
    icon.current = EMOJI_ICON;
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  function makeSystem() {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const drafts = new RealDraftService(storage, makeCatalog(icon), makeValidation());
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const deployments = new RealDeploymentService(storage, makeJobs(), noDocker, drafts, routing, noLogging, new MockProvisionerService());
    return { drafts, deployments };
  }

  async function finalizedDraft(drafts: RealDraftService, version: string): Promise<string> {
    const { draftId } = await drafts.createDraft({ appId: 'remo', version });
    await drafts.updateDraft(draftId, { composeOverride: 'services:\n  remo-web:\n    image: remo-web:' + version + '\n' });
    await drafts.finalizeDraft(draftId);
    return draftId;
  }

  test('picks up a new catalog logo on upgrade, and bumps the version with it', async () => {
    const { deployments, drafts } = makeSystem();

    const dep = await deployments.createFromDraft({
      draftId: await finalizedDraft(drafts, '0.4.6'), name: 'remo', options: { autoStart: false },
    });
    expect((await deployments.getDeployment(dep.deploymentId)).icon).toBe(EMOJI_ICON);

    // The catalog package swaps its emoji for a real logo and cuts a new version.
    icon.current = LOGO_ICON;
    await deployments.promote(dep.deploymentId, {
      draftId: await finalizedDraft(drafts, '0.5.0'), options: { autoStart: false },
    });

    const after = await deployments.getDeployment(dep.deploymentId);
    expect(after.icon).toBe(LOGO_ICON);
    expect(after.version).toBe('0.5.0');
  });

  test('leaves an operator-chosen deployment name alone', async () => {
    const { deployments, drafts } = makeSystem();

    const dep = await deployments.createFromDraft({
      draftId: await finalizedDraft(drafts, '0.4.6'), name: 'my-terminal', options: { autoStart: false },
    });

    icon.current = LOGO_ICON;
    await deployments.promote(dep.deploymentId, {
      draftId: await finalizedDraft(drafts, '0.5.0'), options: { autoStart: false },
    });

    const after = await deployments.getDeployment(dep.deploymentId);
    expect(after.name).toBe('my-terminal'); // not overwritten by the manifest's "Remo"
    expect(after.icon).toBe(LOGO_ICON); // …but the icon still refreshes
  });

  test('an unchanged icon survives a promote (no spurious rewrite)', async () => {
    const { deployments, drafts } = makeSystem();

    const dep = await deployments.createFromDraft({
      draftId: await finalizedDraft(drafts, '0.4.6'), name: 'remo', options: { autoStart: false },
    });
    await deployments.promote(dep.deploymentId, {
      draftId: await finalizedDraft(drafts, '0.5.0'), options: { autoStart: false },
    });

    const after = await deployments.getDeployment(dep.deploymentId);
    expect(after.icon).toBe(EMOJI_ICON);
    expect(after.version).toBe('0.5.0');
  });

  test('RECOVERY: a same-version re-promote still refreshes a stale icon', async () => {
    const { deployments, drafts } = makeSystem();

    // Upgraded to 0.5.0 on a server that predates the icon-refresh fix, so the
    // record kept the old emoji and there is no newer version left to promote to.
    const dep = await deployments.createFromDraft({
      draftId: await finalizedDraft(drafts, '0.5.0'), name: 'remo', options: { autoStart: false },
    });
    expect((await deployments.getDeployment(dep.deploymentId)).icon).toBe(EMOJI_ICON);

    icon.current = LOGO_ICON;
    // Re-promote to the SAME version (what `hola upgrade --app-version 0.5.0` does).
    await deployments.promote(dep.deploymentId, {
      draftId: await finalizedDraft(drafts, '0.5.0'), options: { autoStart: false },
    });

    const after = await deployments.getDeployment(dep.deploymentId);
    expect(after.icon).toBe(LOGO_ICON);
    expect(after.version).toBe('0.5.0');
  });
});
