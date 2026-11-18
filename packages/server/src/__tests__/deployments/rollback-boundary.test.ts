/**
 * #584: an image-only rollback across a one-way upgrade boundary is refused at
 * request time with 409 `ROLLBACK_REQUIRES_DATA_RESTORE`, unless the caller
 * asks for the data restore (`restoreData`) or acknowledges the image-only
 * rollback (`imageOnly`). A boundary is a release this deployment ran, with a
 * version in (target, current], whose manifest declares
 * `upgrade.preUpgradeBackup: "required"` or `upgrade.breaking: true` — and
 * whose upgrade block is not the target's own (a copied block is a migration
 * the data crossed before the target ran).
 *
 * Runs against the real deployment service with a temp data root and the
 * success-simulating MockDockerService (no Docker daemon).
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import type { AppUpgradeMeta } from '@hola/shared';
import { RealDeploymentService } from '../../services/core/deployment';
import { MockProvisionerService } from '../../services/core/provisioner';
import { RealDraftService } from '../../services/core/draft';
import { RealStorageService } from '../../services/core/storage';
import { RealRoutingService } from '../../services/core/routing';
import { RealDatabaseService } from '../../services/core/database';
import { RealLoggingService } from '../../services/core/logging';
import { RealJobService } from '../../services/core/jobs';
import { MockDockerService } from '../../services/core/docker';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

let upgradeByVersion: Record<string, AppUpgradeMeta | undefined> = {};

function makeCatalog(): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'Gitea', icon: '🍵' }),
    getVersionDetail: async (_appId: string, version: string) => ({
      defaultEnv: [],
      defaults: { ports: [{ host: 3000, container: 3000, protocol: 'tcp' as const }], volumes: [] },
      upgrade: upgradeByVersion[version],
    }),
  } as unknown as CatalogArg;
}

function makeValidation(): ValidationArg {
  return {
    validateDraft: async () => ({ ok: true, errors: [], warnings: [] }),
    preflightCheck: async () => ({ ok: true, checks: [] }),
  } as unknown as ValidationArg;
}

const COMPOSE = 'services:\n  gitea:\n    image: gitea/gitea:1.27.3\n';

async function waitForJob(jobs: RealJobService, id: string, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const job = await jobs.getJob(id);
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    if (Date.now() - start > timeoutMs) throw new Error(`Job ${id} did not finish (last: ${job?.status})`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** The structured refusal, or a failure if the call did not throw. */
async function refusal(p: Promise<unknown>): Promise<{ status?: number; code?: string; message: string; details: Record<string, unknown> }> {
  try {
    await p;
  } catch (err) {
    const e = err as { status?: number; code?: string; message: string; details?: Record<string, unknown> };
    return { status: e.status, code: e.code, message: e.message, details: e.details ?? {} };
  }
  throw new Error('expected the rollback to be refused');
}

describe('rollback across a one-way upgrade boundary (#584)', () => {
  let dataRoot: string;
  let appsRoot: string;
  let prevAppsBindRoot: string | undefined;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-rb-boundary-data-'));
    appsRoot = await mkdtemp(join(tmpdir(), 'hola-rb-boundary-apps-'));
    prevAppsBindRoot = process.env.HOLA_APPS_BIND_ROOT;
    process.env.HOLA_APPS_BIND_ROOT = appsRoot;
    upgradeByVersion = {};
  });

  afterEach(async () => {
    if (prevAppsBindRoot === undefined) delete process.env.HOLA_APPS_BIND_ROOT;
    else process.env.HOLA_APPS_BIND_ROOT = prevAppsBindRoot;
    await rm(dataRoot, { recursive: true, force: true });
    await rm(appsRoot, { recursive: true, force: true });
  });

  function makeSystem() {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage);
    const logging = new RealLoggingService(storage);
    const jobs = new RealJobService(database, logging);
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const drafts = new RealDraftService(storage, makeCatalog(), makeValidation());
    const deployments = new RealDeploymentService(storage, jobs, new MockDockerService(), drafts, routing, logging, new MockProvisionerService());
    return { jobs, drafts, deployments };
  }

  async function finalizedDraft(drafts: RealDraftService, version: string): Promise<string> {
    const { draftId } = await drafts.createDraft({ appId: 'gitea', version });
    await drafts.updateDraft(draftId, { composeOverride: COMPOSE });
    await drafts.finalizeDraft(draftId);
    return draftId;
  }

  async function writeAppData(deploymentId: string, content: string) {
    const dir = join(appsRoot, deploymentId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'state.txt'), content);
  }
  const readAppData = (deploymentId: string) => readFile(join(appsRoot, deploymentId, 'state.txt'), 'utf8');

  /**
   * Install 1.0.0 with data, upgrade to 2.0.0 (whose upgrade metadata the test
   * sets), and let 2.0.0 "migrate" the data. `snapshot` forces a capture when
   * the metadata does not already require one.
   */
  async function upgradedOnce(sys: ReturnType<typeof makeSystem>, opts: { snapshot?: boolean } = {}) {
    const dep = await sys.deployments.createFromDraft({ draftId: await finalizedDraft(sys.drafts, '1.0.0'), name: 'gitea', options: { autoStart: false } });
    await writeAppData(dep.deploymentId, 'v1-data');
    const up = await sys.deployments.promote(dep.deploymentId, {
      draftId: await finalizedDraft(sys.drafts, '2.0.0'),
      ...(opts.snapshot ? { snapshot: true } : {}),
      options: { autoStart: false },
    });
    await writeAppData(dep.deploymentId, 'v2-data-migrated');
    return { deploymentId: dep.deploymentId, release1: dep.releaseId, release2: up.releaseId };
  }

  test('preUpgradeBackup: required + no flag → refused with ROLLBACK_REQUIRES_DATA_RESTORE, nothing changed', async () => {
    upgradeByVersion = { '2.0.0': { preUpgradeBackup: 'required' } };
    const sys = makeSystem();
    const { deploymentId, release1, release2 } = await upgradedOnce(sys);
    const before = await sys.deployments.getDeployment(deploymentId);

    const r = await refusal(sys.deployments.rollback(deploymentId, { targetReleaseId: release1 }));
    expect(r.status).toBe(409);
    expect(r.code).toBe('CONFLICT');
    expect(r.details).toMatchObject({
      code: 'ROLLBACK_REQUIRES_DATA_RESTORE',
      deploymentId,
      targetReleaseId: release1,
      targetVersion: '1.0.0',
      fromVersion: '2.0.0',
      boundaryVersions: ['2.0.0'],
      snapshotAvailable: true,
    });
    expect(r.message).toMatch(/--restore-data/);

    // Refused before anything moved: same active release, version, status.
    const after = await sys.deployments.getDeployment(deploymentId);
    expect(after.version).toBe('2.0.0');
    expect(after.status).toBe(before.status);
    expect((await sys.deployments.listDeployments({})).items.find((d) => d.id === deploymentId)?.version).toBe('2.0.0');
    expect(after.rollbackTarget?.releaseId).toBe(release1);
    void release2;
    expect(await readAppData(deploymentId)).toBe('v2-data-migrated');
  });

  test('a default-target rollback (no targetReleaseId) is refused the same way', async () => {
    upgradeByVersion = { '2.0.0': { preUpgradeBackup: 'required' } };
    const sys = makeSystem();
    const { deploymentId } = await upgradedOnce(sys);
    const r = await refusal(sys.deployments.rollback(deploymentId, {}));
    expect(r.details.code).toBe('ROLLBACK_REQUIRES_DATA_RESTORE');
  });

  test('boundary + restoreData → enqueued as a data-aware rollback that restores the snapshot', async () => {
    upgradeByVersion = { '2.0.0': { preUpgradeBackup: 'required' } };
    const sys = makeSystem();
    const { deploymentId, release1 } = await upgradedOnce(sys);

    const rb = await sys.deployments.rollback(deploymentId, { targetReleaseId: release1, restoreData: true });
    const job = await waitForJob(sys.jobs, rb.jobId);
    expect(job.status).toBe('completed');
    expect(await readAppData(deploymentId)).toBe('v1-data');
    expect((await sys.deployments.getDeployment(deploymentId)).version).toBe('1.0.0');
  });

  test('boundary + imageOnly → enqueued as an image-only rollback, data left as it is', async () => {
    upgradeByVersion = { '2.0.0': { preUpgradeBackup: 'required' } };
    const sys = makeSystem();
    const { deploymentId, release1 } = await upgradedOnce(sys);

    const rb = await sys.deployments.rollback(deploymentId, { targetReleaseId: release1, imageOnly: true });
    const job = await waitForJob(sys.jobs, rb.jobId);
    expect(job.status).toBe('completed');
    expect(await readAppData(deploymentId)).toBe('v2-data-migrated');
  });

  test('restoreData and imageOnly together are refused as contradictory', async () => {
    upgradeByVersion = { '2.0.0': { preUpgradeBackup: 'required' } };
    const sys = makeSystem();
    const { deploymentId, release1 } = await upgradedOnce(sys);
    const r = await refusal(sys.deployments.rollback(deploymentId, { targetReleaseId: release1, restoreData: true, imageOnly: true }));
    expect(r.status).toBe(400);
    expect(r.details.code).toBe('ROLLBACK_OPTIONS_CONFLICT');
  });

  test('no boundary (the upgrade declares neither) → an image-only rollback runs unchanged', async () => {
    upgradeByVersion = { '2.0.0': { preUpgradeBackup: 'recommended' } };
    const sys = makeSystem();
    const { deploymentId, release1 } = await upgradedOnce(sys, { snapshot: true });

    expect((await sys.deployments.getDeployment(deploymentId)).rollbackTarget).toMatchObject({
      releaseId: release1,
      boundary: 'none',
      snapshotAvailable: true,
    });
    const rb = await sys.deployments.rollback(deploymentId, { targetReleaseId: release1 });
    const job = await waitForJob(sys.jobs, rb.jobId);
    expect(job.status).toBe('completed');
    expect(await readAppData(deploymentId)).toBe('v2-data-migrated');
  });

  test('legacy record whose versions cannot be read → not refused (pre-#584 behaviour)', async () => {
    upgradeByVersion = { '2.0.0': { preUpgradeBackup: 'required' } };
    const sys = makeSystem();
    const { deploymentId, release1, release2 } = await upgradedOnce(sys);
    // A record that predates staged manifests: the active release has none.
    await rm(join(dataRoot, 'deployments', deploymentId, 'releases', release2, 'manifest.json'));
    // A fresh service reads the record back from disk, as after a restart.
    const fresh = makeSystem();

    expect((await fresh.deployments.getDeployment(deploymentId)).rollbackTarget?.boundary).toBe('unknown');
    const rb = await fresh.deployments.rollback(deploymentId, { targetReleaseId: release1 });
    expect(rb.jobId).toBeTruthy();
    expect(rb.targetReleaseId).toBe(release1);
  });

  test('breaking: true is a boundary too; with no snapshot the refusal says the data cannot be restored', async () => {
    upgradeByVersion = { '2.0.0': { breaking: true } };
    const sys = makeSystem();
    const { deploymentId, release1 } = await upgradedOnce(sys); // no snapshot taken

    const r = await refusal(sys.deployments.rollback(deploymentId, { targetReleaseId: release1 }));
    expect(r.details).toMatchObject({ code: 'ROLLBACK_REQUIRES_DATA_RESTORE', snapshotAvailable: false, boundaryVersions: ['2.0.0'] });
    expect(r.message).toMatch(/No pre-upgrade data snapshot exists/);
    expect(r.message).toMatch(/--image-only/);
  });

  test('restoreData with NO snapshot is accepted at request time and the job still fails (#524)', async () => {
    upgradeByVersion = { '2.0.0': { breaking: true } };
    const sys = makeSystem();
    const { deploymentId, release1 } = await upgradedOnce(sys);

    const rb = await sys.deployments.rollback(deploymentId, { targetReleaseId: release1, restoreData: true });
    const job = await waitForJob(sys.jobs, rb.jobId);
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/No pre-upgrade snapshot exists/);
    expect(await readAppData(deploymentId)).toBe('v2-data-migrated');
  });

  test('the boundary is judged over the whole range: 1.0 → 2.0 (required) → 3.0 back to 1.0 is refused', async () => {
    upgradeByVersion = { '2.0.0': { preUpgradeBackup: 'required' } };
    const sys = makeSystem();
    const { deploymentId, release1 } = await upgradedOnce(sys);
    await sys.deployments.promote(deploymentId, { draftId: await finalizedDraft(sys.drafts, '3.0.0'), options: { autoStart: false } });

    const r = await refusal(sys.deployments.rollback(deploymentId, { targetReleaseId: release1 }));
    expect(r.details).toMatchObject({ code: 'ROLLBACK_REQUIRES_DATA_RESTORE', fromVersion: '3.0.0', boundaryVersions: ['2.0.0'] });
  });

  test('rolling back over a release that declares nothing, when the boundary is below the target, is not refused', async () => {
    upgradeByVersion = { '2.0.0': { preUpgradeBackup: 'required' } };
    const sys = makeSystem();
    const { deploymentId, release2 } = await upgradedOnce(sys);
    await sys.deployments.promote(deploymentId, { draftId: await finalizedDraft(sys.drafts, '3.0.0'), options: { autoStart: false } });

    // 3.0.0 → 2.0.0: the range (2.0.0, 3.0.0] holds only 3.0.0, which declares nothing.
    const rb = await sys.deployments.rollback(deploymentId, { targetReleaseId: release2 });
    expect(rb.targetReleaseId).toBe(release2);
  });

  test('rolling FORWARD after a data-aware rollback is not a boundary crossing', async () => {
    upgradeByVersion = { '2.0.0': { preUpgradeBackup: 'required' } };
    const sys = makeSystem();
    const { deploymentId, release1, release2 } = await upgradedOnce(sys);
    const back = await sys.deployments.rollback(deploymentId, { targetReleaseId: release1, restoreData: true });
    await waitForJob(sys.jobs, back.jobId);

    expect((await sys.deployments.getDeployment(deploymentId)).rollbackTarget).toMatchObject({ releaseId: release2, boundary: 'none' });
    const fwd = await sys.deployments.rollback(deploymentId, { targetReleaseId: release2 });
    expect(fwd.targetReleaseId).toBe(release2);
  });

  test('the detail read exposes what the dashboard needs to default the restore on', async () => {
    upgradeByVersion = { '2.0.0': { preUpgradeBackup: 'required' } };
    const sys = makeSystem();
    const { deploymentId, release1 } = await upgradedOnce(sys);
    expect((await sys.deployments.getDeployment(deploymentId)).rollbackTarget).toEqual({
      releaseId: release1,
      version: '1.0.0',
      fromVersion: '2.0.0',
      snapshotAvailable: true,
      boundary: 'one-way',
      boundaryVersions: ['2.0.0'],
    });
  });

  /** Install `versions[0]`, then promote through the rest in order. */
  async function chain(sys: ReturnType<typeof makeSystem>, versions: string[]) {
    const dep = await sys.deployments.createFromDraft({ draftId: await finalizedDraft(sys.drafts, versions[0]), name: 'gitea', options: { autoStart: false } });
    const releases = [dep.releaseId];
    for (const v of versions.slice(1)) {
      const up = await sys.deployments.promote(dep.deploymentId, { draftId: await finalizedDraft(sys.drafts, v), snapshot: true, options: { autoStart: false } });
      releases.push(up.releaseId);
    }
    return { deploymentId: dep.deploymentId, releases };
  }

  // The catalog copies a major's `upgrade` block onto that major's patch bumps
  // verbatim (uptime-kuma 2.0.2/2.0.3 both `breaking: true, required`); a
  // block identical to the target's is a migration crossed before the target.
  describe('a copied upgrade block is not a boundary', () => {
    const KUMA2: AppUpgradeMeta = { breaking: true, preUpgradeBackup: 'required' };

    test('patch within a major (2.0.3 -> 2.0.2, same block) -> allowed, boundary none', async () => {
      upgradeByVersion = { '2.0.2': KUMA2, '2.0.3': { ...KUMA2 } };
      const sys = makeSystem();
      const { deploymentId, releases } = await chain(sys, ['2.0.2', '2.0.3']);
      expect((await sys.deployments.getDeployment(deploymentId)).rollbackTarget).toMatchObject({ releaseId: releases[0], boundary: 'none' });
      const rb = await sys.deployments.rollback(deploymentId, {});
      expect(rb.targetReleaseId).toBe(releases[0]);
      expect((await waitForJob(sys.jobs, rb.jobId)).status).toBe('completed');
      expect((await sys.deployments.getDeployment(deploymentId)).version).toBe('2.0.2');
    });

    test('a missing field and its default compare equal', async () => {
      upgradeByVersion = { '2.0.2': { breaking: true, preUpgradeBackup: 'none', waypoints: [] }, '2.0.3': { breaking: true } };
      const sys = makeSystem();
      const { deploymentId } = await chain(sys, ['2.0.2', '2.0.3']);
      expect((await sys.deployments.getDeployment(deploymentId)).rollbackTarget?.boundary).toBe('none');
    });

    test('major boundary (3.0.0 required -> 2.0.2 breaking/recommended: blocks differ) -> refused', async () => {
      upgradeByVersion = { '2.0.2': { breaking: true, preUpgradeBackup: 'recommended' }, '3.0.0': { breaking: true, preUpgradeBackup: 'required' } };
      const sys = makeSystem();
      const { deploymentId, releases } = await chain(sys, ['2.0.2', '3.0.0']);
      const r = await refusal(sys.deployments.rollback(deploymentId, {}));
      expect(r.details).toMatchObject({ code: 'ROLLBACK_REQUIRES_DATA_RESTORE', targetReleaseId: releases[0], targetVersion: '2.0.2', boundaryVersions: ['3.0.0'] });
    });

    test('multi-hop (1.0.0 -> 2.0.0 required -> 2.0.1 same block) back to 1.0.0 -> refused, reported once at 2.0.0', async () => {
      upgradeByVersion = { '2.0.0': KUMA2, '2.0.1': { ...KUMA2 } };
      const sys = makeSystem();
      const { deploymentId, releases } = await chain(sys, ['1.0.0', '2.0.0', '2.0.1']);
      const r = await refusal(sys.deployments.rollback(deploymentId, { targetReleaseId: releases[0] }));
      expect(r.details).toMatchObject({ code: 'ROLLBACK_REQUIRES_DATA_RESTORE', fromVersion: '2.0.1', boundaryVersions: ['2.0.0'] });
      // ...while 2.0.1 -> 2.0.0 (same block) is a plain rollback.
      const rb = await sys.deployments.rollback(deploymentId, { targetReleaseId: releases[1] });
      expect(rb.targetReleaseId).toBe(releases[1]);
    });

    test('a target with NO upgrade block vs a release with one -> differs -> refused', async () => {
      upgradeByVersion = { '1.0.1': { breaking: true } };
      const sys = makeSystem();
      const { deploymentId } = await chain(sys, ['1.0.0', '1.0.1']);
      const r = await refusal(sys.deployments.rollback(deploymentId, {}));
      expect(r.details).toMatchObject({ code: 'ROLLBACK_REQUIRES_DATA_RESTORE', boundaryVersions: ['1.0.1'] });
    });

    test('an identical block on a DIFFERENT major is a new migration -> refused', async () => {
      upgradeByVersion = { '3.0.0': KUMA2, '4.0.0': { ...KUMA2 } };
      const sys = makeSystem();
      const { deploymentId } = await chain(sys, ['3.0.0', '4.0.0']);
      const r = await refusal(sys.deployments.rollback(deploymentId, {}));
      expect(r.details).toMatchObject({ code: 'ROLLBACK_REQUIRES_DATA_RESTORE', boundaryVersions: ['4.0.0'] });
    });

    test("a block that repeats the target's across an intermediate with none -> allowed", async () => {
      upgradeByVersion = { '2.0.2': KUMA2, '2.0.5': { ...KUMA2 } };
      const sys = makeSystem();
      const { deploymentId, releases } = await chain(sys, ['2.0.2', '2.0.4', '2.0.5']);
      const rb = await sys.deployments.rollback(deploymentId, { targetReleaseId: releases[0] });
      expect(rb.targetReleaseId).toBe(releases[0]);
    });
  });

  // After upgrade(3.0.0) -> rollback(2.0.2) -> upgrade(3.0.0 again), the newest
  // OTHER release is the first 3.0.0: the default target must be the release
  // on a different version, or "rolling back" replaces 3.0.0 with 3.0.0.
  describe('the default rollback target', () => {
    const G2: AppUpgradeMeta = { breaking: true, preUpgradeBackup: 'recommended' };
    const G3: AppUpgradeMeta = { breaking: true, preUpgradeBackup: 'required' };

    test('is the most recent release on a DIFFERENT version than the active one', async () => {
      upgradeByVersion = { '2.0.2': G2, '3.0.0': G3 };
      const sys = makeSystem();
      const { deploymentId, releases } = await chain(sys, ['2.0.2', '3.0.0']);
      const back = await sys.deployments.rollback(deploymentId, { restoreData: true });
      expect(back.targetReleaseId).toBe(releases[0]);
      await waitForJob(sys.jobs, back.jobId);
      const again = await sys.deployments.promote(deploymentId, { draftId: await finalizedDraft(sys.drafts, '3.0.0'), snapshot: true, options: { autoStart: false } });

      // Detail (dashboard + CLI) and the request agree on the 2.0.2 release.
      const detail = await sys.deployments.getDeployment(deploymentId);
      expect(detail.version).toBe('3.0.0');
      expect(detail.rollbackTarget).toMatchObject({ releaseId: releases[0], version: '2.0.2', fromVersion: '3.0.0', boundary: 'one-way' });
      const r = await refusal(sys.deployments.rollback(deploymentId, {}));
      expect(r.details).toMatchObject({ targetReleaseId: releases[0], targetVersion: '2.0.2' });
      const rb = await sys.deployments.rollback(deploymentId, { restoreData: true });
      expect(rb.targetReleaseId).toBe(releases[0]);
      expect(rb.previousReleaseId).toBe(again.releaseId);
      expect((await waitForJob(sys.jobs, rb.jobId)).status).toBe('completed');
      expect((await sys.deployments.getDeployment(deploymentId)).version).toBe('2.0.2');
    });

    test('falls back to the newest other release when every other release shares the active version', async () => {
      const sys = makeSystem();
      const { deploymentId, releases } = await chain(sys, ['1.0.0', '1.0.0']);
      expect((await sys.deployments.getDeployment(deploymentId)).rollbackTarget?.releaseId).toBe(releases[0]);
    });

    test('falls back to the newest other release when the active version is unknown (legacy record)', async () => {
      const sys = makeSystem();
      const { deploymentId, releases } = await chain(sys, ['1.0.0', '2.0.0', '3.0.0']);
      await rm(join(dataRoot, 'deployments', deploymentId, 'releases', releases[2], 'manifest.json'));
      const fresh = makeSystem();
      const target = (await fresh.deployments.getDeployment(deploymentId)).rollbackTarget;
      expect(target).toMatchObject({ releaseId: releases[1], boundary: 'unknown' });
    });
  });

  test('a single-release deployment carries no rollbackTarget', async () => {
    const sys = makeSystem();
    const dep = await sys.deployments.createFromDraft({ draftId: await finalizedDraft(sys.drafts, '1.0.0'), name: 'gitea', options: { autoStart: false } });
    expect((await sys.deployments.getDeployment(dep.deploymentId)).rollbackTarget).toBeUndefined();
  });
});
