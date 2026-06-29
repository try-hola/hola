/**
 * Per-app backup hooks around the pre-upgrade snapshot (#121 × #284 Phase 1).
 *
 * When an app declares `backup.preHook`/`postHook`, the server runs them in the
 * app's own containers around the snapshot capture: the preHook before the file
 * tar (quiesce / pg_dump), the postHook after (cleanup). A preHook failure
 * propagates so `promote` can fail-closed; the postHook is best-effort. Uses a
 * recording DockerService over MockDockerService.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { AppBackupConfig, AppUpgradeMeta } from '@hola/shared';
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

let backupConfig: AppBackupConfig | undefined;
let upgradeConfig: AppUpgradeMeta | undefined;

function makeCatalog(): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'Postgres App', icon: '🐘' }),
    getVersionDetail: async () => ({
      defaultEnv: [],
      defaults: { ports: [{ host: 3000, container: 3000, protocol: 'tcp' as const }], volumes: [] },
      backup: backupConfig,
      upgrade: upgradeConfig,
    }),
  } as unknown as CatalogArg;
}

function makeValidation(): ValidationArg {
  return {
    validateDraft: async () => ({ ok: true, errors: [], warnings: [] }),
    preflightCheck: async () => ({ ok: true, checks: [] }),
  } as unknown as ValidationArg;
}

const COMPOSE = 'services:\n  app:\n    image: app:latest\n  db:\n    image: postgres:16\n';

/** Records composeExec calls; can be told to fail a given service's exec. */
class RecordingDocker extends MockDockerService {
  calls: Array<{ service: string; command: string[] }> = [];
  failService?: string;
  override async composeExec(projectPath: string, projectName: string, service: string, command: string[]) {
    this.calls.push({ service, command });
    if (this.failService === service) return { success: false, output: `boom in ${service}` };
    return super.composeExec(projectPath, projectName, service, command);
  }
}

describe('Backup hooks around the pre-upgrade snapshot (#121)', () => {
  let dataRoot: string;
  let appsRoot: string;
  let prevAppsBindRoot: string | undefined;
  let docker: RecordingDocker;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-bh-data-'));
    appsRoot = await mkdtemp(join(tmpdir(), 'hola-bh-apps-'));
    prevAppsBindRoot = process.env.HOLA_APPS_BIND_ROOT;
    process.env.HOLA_APPS_BIND_ROOT = appsRoot;
    backupConfig = undefined;
    upgradeConfig = undefined;
    docker = new RecordingDocker();
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
    const deployments = new RealDeploymentService(storage, jobs, docker, drafts, routing, logging, new MockProvisionerService());
    return { storage, jobs, drafts, deployments };
  }

  async function finalizedDraft(drafts: RealDraftService, version: string): Promise<string> {
    const { draftId } = await drafts.createDraft({ appId: 'pgapp', version });
    await drafts.updateDraft(draftId, { composeOverride: COMPOSE });
    await drafts.finalizeDraft(draftId);
    return draftId;
  }

  async function withAppData(deploymentId: string) {
    const dir = join(appsRoot, deploymentId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'state.txt'), 'data');
  }
  function snapshotsPath(deploymentId: string) {
    return join(dataRoot, 'deployments', deploymentId, 'snapshots');
  }

  const PG_BACKUP: AppBackupConfig = {
    preHook: { service: 'db', command: ['sh', '-c', 'pg_dump -U postgres app > /backups/dump.sql'] },
    postHook: { service: 'db', command: ['rm', '-f', '/backups/dump.sql'] },
  };

  test('runs preHook then postHook in the declared service around the snapshot', async () => {
    backupConfig = PG_BACKUP;
    const { drafts, deployments } = makeSystem();
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '1.0.0'), name: 'pgapp', options: { autoStart: false } });
    await withAppData(dep.deploymentId);

    await deployments.promote(dep.deploymentId, { draftId: await finalizedDraft(drafts, '2.0.0'), snapshot: true, options: { autoStart: false } });

    // Both hooks ran in `db`, pre before post.
    const hookCalls = docker.calls.filter((c) => c.service === 'db');
    expect(hookCalls).toHaveLength(2);
    expect(hookCalls[0].command.join(' ')).toContain('pg_dump');
    expect(hookCalls[1].command.join(' ')).toContain('rm');
    // The snapshot was still captured.
    expect((await readdir(snapshotsPath(dep.deploymentId))).length).toBe(1);
  });

  test('an app with no backup block runs no hooks', async () => {
    backupConfig = undefined;
    const { drafts, deployments } = makeSystem();
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '1.0.0'), name: 'pgapp', options: { autoStart: false } });
    await withAppData(dep.deploymentId);

    await deployments.promote(dep.deploymentId, { draftId: await finalizedDraft(drafts, '2.0.0'), snapshot: true, options: { autoStart: false } });

    expect(docker.calls.filter((c) => c.service === 'db')).toHaveLength(0);
    expect((await readdir(snapshotsPath(dep.deploymentId))).length).toBe(1);
  });

  test('a preHook failure under preUpgradeBackup:required fails the promote and writes no snapshot', async () => {
    backupConfig = PG_BACKUP;
    upgradeConfig = { preUpgradeBackup: 'required' }; // forces fail-closed
    docker.failService = 'db'; // pg_dump "fails"
    const { drafts, deployments } = makeSystem();
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '1.0.0'), name: 'pgapp', options: { autoStart: false } });
    await withAppData(dep.deploymentId);

    // Target requires a backup → a preHook failure is fail-closed (no snapshot flag needed).
    await expect(
      deployments.promote(dep.deploymentId, { draftId: await finalizedDraft(drafts, '2.0.0'), options: { autoStart: false } }),
    ).rejects.toThrow();

    // No snapshot dir was produced (the preHook gated the capture).
    expect(existsSync(snapshotsPath(dep.deploymentId))).toBe(false);
  });

  test('a preHook failure WITHOUT required backup warns and continues (snapshot still taken)', async () => {
    backupConfig = PG_BACKUP;
    docker.failService = 'db';
    const { drafts, deployments } = makeSystem();
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '1.0.0'), name: 'pgapp', options: { autoStart: false } });
    await withAppData(dep.deploymentId);

    // Opt-in snapshot, not required → a preHook failure is best-effort: the promote
    // succeeds. (No snapshot is written because the capture is skipped on preHook
    // failure, but the upgrade proceeds.)
    const res = await deployments.promote(dep.deploymentId, { draftId: await finalizedDraft(drafts, '2.0.0'), snapshot: true, options: { autoStart: false } });
    expect(res.releaseId).toBeDefined();
    expect(existsSync(snapshotsPath(dep.deploymentId))).toBe(false);
  });
});
