/**
 * Promote upgrade skip-guard (#284 Phase 0).
 *
 * Verifies RealDeploymentService.promote enforces the target version's upgrade
 * metadata (minFromVersion floor / required waypoints) BEFORE staging a new
 * release: an illegal jump is rejected with a typed ValidationError that names
 * the next safe version, the active release is untouched, and a legal jump
 * proceeds. The catalog stub returns per-version `upgrade` metadata so the
 * finalized manifest carries it through draft → finalize → promote.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import type { AppUpgradeMeta } from '@hola/shared';
import { RealDeploymentService } from '../../services/core/deployment';
import { MockProvisionerService } from '../../services/core/provisioner';
import { RealDraftService } from '../../services/core/draft';
import { RealStorageService } from '../../services/core/storage';
import { RealRoutingService } from '../../services/core/routing';
import { ValidationError } from '../../middleware/error-mapping';
import type { DockerService } from '../../services/core/docker';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];
type JobArg = ConstructorParameters<typeof RealDeploymentService>[1];

// Per-version upgrade metadata the catalog surfaces for the `immich` fixture.
const UPGRADE_BY_VERSION: Record<string, AppUpgradeMeta | undefined> = {
  '1.107.2': undefined,
  '1.132.3': undefined,
  '1.137.0': { minFromVersion: '1.107.2', waypoints: ['1.132.3'] },
};

function makeCatalog(): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'Immich', icon: '📷' }),
    getVersionDetail: async (_appId: string, version: string) => ({
      defaultEnv: [],
      defaults: { ports: [{ container: 2283, protocol: 'tcp' as const }], volumes: [] },
      upgrade: UPGRADE_BY_VERSION[version],
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

describe('Promote upgrade skip-guard (#284 Phase 0)', () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-skipguard-'));
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  function makeSystem() {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const drafts = new RealDraftService(storage, makeCatalog(), makeValidation());
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const deployments = new RealDeploymentService(storage, makeJobs(), noDocker, drafts, routing, noLogging, new MockProvisionerService());
    return { storage, drafts, routing, deployments };
  }

  async function finalizedDraft(drafts: RealDraftService, version: string): Promise<string> {
    const { draftId } = await drafts.createDraft({ appId: 'immich', version });
    await drafts.updateDraft(draftId, { composeOverride: 'services:\n  immich:\n    image: immich:' + version + '\n' });
    await drafts.finalizeDraft(draftId);
    return draftId;
  }

  test('rejects a promote that skips past a required waypoint', async () => {
    const { deployments, drafts, storage } = makeSystem();
    // Land on a version above the floor but below the waypoint.
    const dep = await deployments.createFromDraft({
      draftId: await finalizedDraft(drafts, '1.107.2'), name: 'immich', options: { autoStart: false },
    });
    const release1 = dep.releaseId;

    // Jump straight to 1.137.0 — must pass through waypoint 1.132.3 first.
    const target = await finalizedDraft(drafts, '1.137.0');
    let err: unknown;
    try {
      await deployments.promote(dep.deploymentId, { draftId: target, options: { autoStart: false } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).message).toContain('1.132.3');

    // The active release is unchanged — no half-staged promote.
    expect(await storage.readFileAsString(`deployments/${dep.deploymentId}/current`)).toBe(release1);
    const releases = await deployments.getReleases(dep.deploymentId);
    expect(releases).toHaveLength(1);
    expect(releases[0].status).toBe('active');
  });

  test('rejects a promote from below the minFromVersion floor', async () => {
    const { deployments, drafts } = makeSystem();
    // Pretend an old deployment that predates the floor.
    const dep = await deployments.createFromDraft({
      draftId: await finalizedDraft(drafts, '1.100.0'), name: 'immich', options: { autoStart: false },
    });
    const target = await finalizedDraft(drafts, '1.137.0');
    let err: unknown;
    try {
      await deployments.promote(dep.deploymentId, { draftId: target, options: { autoStart: false } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).message).toContain('1.107.2');
  });

  test('allows a legal promote through the waypoint', async () => {
    const { deployments, drafts, storage } = makeSystem();
    const dep = await deployments.createFromDraft({
      draftId: await finalizedDraft(drafts, '1.132.3'), name: 'immich', options: { autoStart: false },
    });

    // From the waypoint, the jump to 1.137.0 is legal (floor met, no waypoint ahead).
    const target = await finalizedDraft(drafts, '1.137.0');
    const promoted = await deployments.promote(dep.deploymentId, { draftId: target, options: { autoStart: false } });

    expect(promoted.releaseId).toBeDefined();
    expect(await storage.readFileAsString(`deployments/${dep.deploymentId}/current`)).toBe(promoted.releaseId);
    const releases = await deployments.getReleases(dep.deploymentId);
    expect(releases.find((r) => r.id === promoted.releaseId)?.status).toBe('active');
  });
});
