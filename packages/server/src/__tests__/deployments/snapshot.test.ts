/**
 * Pre-upgrade snapshot + data-aware rollback (#284 Phase 1).
 *
 * Exercises the snapshot primitive end-to-end against a real (temp) app-data
 * bind root: a gated `promote` tars the app data keyed by the outgoing release,
 * and a `rollback({ restoreData: true })` stops the containers and restores that
 * snapshot before bringing the target release back up. Uses the success-
 * simulating MockDockerService so it runs without a real Docker daemon.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { AppUpgradeMeta, AppBackupDeclaration } from '@hola/shared';
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

// Per-version upgrade metadata, settable per test (drives `preUpgradeBackup`).
let upgradeByVersion: Record<string, AppUpgradeMeta | undefined> = {};
// Per-version backup declaration (spec 004: singular or plural), settable per test.
let backupByVersion: Record<string, AppBackupDeclaration | undefined> = {};

function makeCatalog(): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'Gitea', icon: '🍵' }),
    getVersionDetail: async (_appId: string, version: string) => ({
      defaultEnv: [],
      defaults: { ports: [{ host: 3000, container: 3000, protocol: 'tcp' as const }], volumes: [] },
      upgrade: upgradeByVersion[version],
      backup: backupByVersion[version],
    }),
  } as unknown as CatalogArg;
}

/** Records every exec so tests can assert which hook ran, in what order. */
class ExecSpy extends MockDockerService {
  execs: Array<{ service: string; command: string[] }> = [];
  /** Service names whose exec should fail (simulating a broken dump). */
  failForServices: string[] = [];

  override async composeExec(
    projectPath: string,
    projectName: string,
    service: string,
    command: string[],
    opts?: { user?: string; profiles?: string[] },
  ): Promise<{ success: boolean; output: string }> {
    this.execs.push({ service, command });
    if (this.failForServices.includes(service)) {
      return { success: false, output: 'FATAL: could not connect to server' };
    }
    return super.composeExec(projectPath, projectName, service, command, opts);
  }

  execsFor(phase: 'pre' | 'post'): string[] {
    return this.execs
      .filter((e) => (phase === 'pre' ? e.command.join(' ').includes('pg_dump') : e.command.includes('rm')))
      .map((e) => e.service);
  }
}

function makeValidation(): ValidationArg {
  return {
    validateDraft: async () => ({ ok: true, errors: [], warnings: [] }),
    preflightCheck: async () => ({ ok: true, checks: [] }),
  } as unknown as ValidationArg;
}

const COMPOSE = 'services:\n  gitea:\n    image: gitea/gitea:latest\n';

async function waitForJob(jobs: RealJobService, id: string, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const job = await jobs.getJob(id);
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    if (Date.now() - start > timeoutMs) throw new Error(`Job ${id} did not finish (last: ${job?.status})`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('Pre-upgrade snapshot + data-aware rollback (#284 Phase 1)', () => {
  let dataRoot: string;
  let appsRoot: string;
  let prevAppsBindRoot: string | undefined;
  let docker: ExecSpy;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-snap-data-'));
    appsRoot = await mkdtemp(join(tmpdir(), 'hola-snap-apps-'));
    prevAppsBindRoot = process.env.HOLA_APPS_BIND_ROOT;
    process.env.HOLA_APPS_BIND_ROOT = appsRoot;
    upgradeByVersion = {};
    backupByVersion = {};
    docker = new ExecSpy();
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
    const { draftId } = await drafts.createDraft({ appId: 'gitea', version });
    await drafts.updateDraft(draftId, { composeOverride: COMPOSE });
    await drafts.finalizeDraft(draftId);
    return draftId;
  }

  /** Write a single marker file into a deployment's app-data root. */
  async function writeAppData(deploymentId: string, content: string) {
    const dir = join(appsRoot, deploymentId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'state.txt'), content);
  }
  async function readAppData(deploymentId: string): Promise<string> {
    return readFile(join(appsRoot, deploymentId, 'state.txt'), 'utf8');
  }
  function snapshotsPath(deploymentId: string) {
    return join(dataRoot, 'deployments', deploymentId, 'snapshots');
  }

  test('opt-in promote snapshots the app data, keyed by the outgoing release', async () => {
    const { drafts, deployments } = makeSystem();
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '1.0.0'), name: 'gitea', options: { autoStart: false } });
    await writeAppData(dep.deploymentId, 'v1-data');

    await deployments.promote(dep.deploymentId, { draftId: await finalizedDraft(drafts, '2.0.0'), snapshot: true, options: { autoStart: false } });

    const snaps = await readdir(snapshotsPath(dep.deploymentId));
    expect(snaps).toHaveLength(1);
    expect(existsSync(join(snapshotsPath(dep.deploymentId), snaps[0], 'data.tar.gz'))).toBe(true);
    const meta = JSON.parse(await readFile(join(snapshotsPath(dep.deploymentId), snaps[0], 'meta.json'), 'utf8'));
    expect(meta.fromReleaseId).toBe(dep.releaseId); // keyed by the release active at promote time
    expect(meta.fromVersion).toBe('1.0.0');
  });

  test('a promote without the flag (and no required backup) takes no snapshot', async () => {
    const { drafts, deployments } = makeSystem();
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '1.0.0'), name: 'gitea', options: { autoStart: false } });
    await writeAppData(dep.deploymentId, 'v1-data');

    await deployments.promote(dep.deploymentId, { draftId: await finalizedDraft(drafts, '2.0.0'), options: { autoStart: false } });

    expect(existsSync(snapshotsPath(dep.deploymentId))).toBe(false);
  });

  test('preUpgradeBackup: "required" forces a snapshot even without the flag', async () => {
    upgradeByVersion = { '2.0.0': { preUpgradeBackup: 'required' } };
    const { drafts, deployments } = makeSystem();
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '1.0.0'), name: 'gitea', options: { autoStart: false } });
    await writeAppData(dep.deploymentId, 'v1-data');

    await deployments.promote(dep.deploymentId, { draftId: await finalizedDraft(drafts, '2.0.0'), options: { autoStart: false } });

    expect(await readdir(snapshotsPath(dep.deploymentId))).toHaveLength(1);
  });

  test('a fresh deployment with no app data is promoted without a snapshot', async () => {
    const { drafts, deployments } = makeSystem();
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '1.0.0'), name: 'gitea', options: { autoStart: false } });
    // No writeAppData — the data root is empty/absent.
    await deployments.promote(dep.deploymentId, { draftId: await finalizedDraft(drafts, '2.0.0'), snapshot: true, options: { autoStart: false } });
    expect(existsSync(snapshotsPath(dep.deploymentId))).toBe(false);
  });

  test('data-aware rollback restores the pre-upgrade app data', async () => {
    const { jobs, drafts, deployments } = makeSystem();
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '1.0.0'), name: 'gitea', options: { autoStart: false } });
    const release1 = dep.releaseId;
    await writeAppData(dep.deploymentId, 'v1-data');

    // Upgrade to v2 with a snapshot (captures v1-data keyed by release1)…
    await deployments.promote(dep.deploymentId, { draftId: await finalizedDraft(drafts, '2.0.0'), snapshot: true, options: { autoStart: false } });
    // …then the new release "migrates" the data forward.
    await writeAppData(dep.deploymentId, 'v2-data-migrated');

    // Data-aware rollback to release1 should restore the captured v1 data.
    const rb = await deployments.rollback(dep.deploymentId, { targetReleaseId: release1, restoreData: true });
    await waitForJob(jobs, rb.jobId);

    expect(await readAppData(dep.deploymentId)).toBe('v1-data');
  });

  test('a rollback without restoreData leaves the app data untouched (containers-only)', async () => {
    const { jobs, drafts, deployments } = makeSystem();
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '1.0.0'), name: 'gitea', options: { autoStart: false } });
    const release1 = dep.releaseId;
    await writeAppData(dep.deploymentId, 'v1-data');
    await deployments.promote(dep.deploymentId, { draftId: await finalizedDraft(drafts, '2.0.0'), snapshot: true, options: { autoStart: false } });
    await writeAppData(dep.deploymentId, 'v2-data-migrated');

    const rb = await deployments.rollback(dep.deploymentId, { targetReleaseId: release1 });
    await waitForJob(jobs, rb.jobId);

    // No restore requested → the forward-migrated data is left as-is.
    expect(await readAppData(dep.deploymentId)).toBe('v2-data-migrated');
  });

  test('a two-participation outgoing release runs both pre-hooks before the tar and both post-hooks after (spec 004)', async () => {
    backupByVersion = {
      '1.0.0': [
        { id: 'app-db', preHook: { service: 'app-db', command: ['pg_dump', 'app'] }, postHook: { service: 'app-db', command: ['rm', 'app.sql'] } },
        { id: 'gitea-db', preHook: { service: 'gitea-db', command: ['pg_dump', 'gitea'] }, postHook: { service: 'gitea-db', command: ['rm', 'gitea.sql'] } },
      ],
    };
    const { drafts, deployments } = makeSystem();
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '1.0.0'), name: 'gitea', options: { autoStart: false } });
    await writeAppData(dep.deploymentId, 'v1-data');

    await deployments.promote(dep.deploymentId, { draftId: await finalizedDraft(drafts, '2.0.0'), snapshot: true, options: { autoStart: false } });

    expect(docker.execsFor('pre')).toEqual(['app-db', 'gitea-db']);
    expect(docker.execsFor('post')).toEqual(['app-db', 'gitea-db']);
    expect(await readdir(snapshotsPath(dep.deploymentId))).toHaveLength(1);
  });

  test('when the second of three pre-hooks fails, it throws, cleans up the two started participations, and never starts a third', async () => {
    backupByVersion = {
      '1.0.0': [
        { id: 'first', preHook: { service: 'first-db', command: ['pg_dump', 'first'] }, postHook: { service: 'first-db', command: ['rm', 'first.sql'] } },
        { id: 'second', preHook: { service: 'second-db', command: ['pg_dump', 'second'] }, postHook: { service: 'second-db', command: ['rm', 'second.sql'] } },
        { id: 'third', preHook: { service: 'third-db', command: ['pg_dump', 'third'] }, postHook: { service: 'third-db', command: ['rm', 'third.sql'] } },
      ],
    };
    docker.failForServices = ['second-db'];
    const { drafts, deployments } = makeSystem();
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '1.0.0'), name: 'gitea', options: { autoStart: false } });
    await writeAppData(dep.deploymentId, 'v1-data');

    // Required so the failure propagates instead of being swallowed as best-effort.
    upgradeByVersion = { '2.0.0': { preUpgradeBackup: 'required' } };

    await expect(
      deployments.promote(dep.deploymentId, { draftId: await finalizedDraft(drafts, '2.0.0'), options: { autoStart: false } }),
    ).rejects.toThrow(/preHook failed/);

    expect(docker.execsFor('pre')).toEqual(['first-db', 'second-db']); // third never started
    expect(docker.execsFor('post')).toEqual(['first-db', 'second-db']); // both started ones cleaned up
    expect(existsSync(snapshotsPath(dep.deploymentId))).toBe(false); // no tar was taken
  });

  test('a post-hook-only participation still has its post-hook run (FR-002)', async () => {
    // No preHook means nothing "starts", but the cleanup is still declared and
    // still ran under the pre-spec-004 singular block — dropping it here would
    // leave the app's own cleanup un-run on every upgrade.
    backupByVersion = {
      '1.0.0': { postHook: { service: 'gitea', command: ['rm', 'gitea.sql'] } },
    };
    const { drafts, deployments } = makeSystem();
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '1.0.0'), name: 'gitea', options: { autoStart: false } });
    await writeAppData(dep.deploymentId, 'v1-data');

    await deployments.promote(dep.deploymentId, { draftId: await finalizedDraft(drafts, '2.0.0'), snapshot: true, options: { autoStart: false } });

    expect(docker.execsFor('pre')).toEqual([]);
    expect(docker.execsFor('post')).toEqual(['gitea']);
    expect(await readdir(snapshotsPath(dep.deploymentId))).toHaveLength(1);
  });

  test('a plural post-hook-only participation runs alongside the hooked ones', async () => {
    backupByVersion = {
      '1.0.0': [
        { id: 'app-db', preHook: { service: 'app-db', command: ['pg_dump', 'app'] }, postHook: { service: 'app-db', command: ['rm', 'app.sql'] } },
        { id: 'cleanup-only', postHook: { service: 'scratch', command: ['rm', 'scratch'] } },
      ],
    };
    const { drafts, deployments } = makeSystem();
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '1.0.0'), name: 'gitea', options: { autoStart: false } });
    await writeAppData(dep.deploymentId, 'v1-data');

    await deployments.promote(dep.deploymentId, { draftId: await finalizedDraft(drafts, '2.0.0'), snapshot: true, options: { autoStart: false } });

    expect(docker.execsFor('pre')).toEqual(['app-db']);
    expect(docker.execsFor('post')).toEqual(['app-db', 'scratch']);
  });

  test('a singular backup fixture behaves unchanged', async () => {
    backupByVersion = {
      '1.0.0': {
        preHook: { service: 'gitea', command: ['pg_dump', 'gitea'] },
        postHook: { service: 'gitea', command: ['rm', 'gitea.sql'] },
      },
    };
    const { drafts, deployments } = makeSystem();
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '1.0.0'), name: 'gitea', options: { autoStart: false } });
    await writeAppData(dep.deploymentId, 'v1-data');

    await deployments.promote(dep.deploymentId, { draftId: await finalizedDraft(drafts, '2.0.0'), snapshot: true, options: { autoStart: false } });

    expect(docker.execsFor('pre')).toEqual(['gitea']);
    expect(docker.execsFor('post')).toEqual(['gitea']);
    expect(await readdir(snapshotsPath(dep.deploymentId))).toHaveLength(1);
  });

  test('retention keeps only the most recent N snapshots', async () => {
    const { drafts, deployments } = makeSystem();
    const dep = await deployments.createFromDraft({ draftId: await finalizedDraft(drafts, '1.0.0'), name: 'gitea', options: { autoStart: false } });
    await writeAppData(dep.deploymentId, 'data');

    // Promote 7 times with a snapshot each; retention bound is 5.
    for (let i = 2; i <= 8; i++) {
      await deployments.promote(dep.deploymentId, { draftId: await finalizedDraft(drafts, `${i}.0.0`), snapshot: true, options: { autoStart: false } });
      await new Promise((r) => setTimeout(r, 5)); // distinct ISO timestamps for ordering
    }
    expect((await readdir(snapshotsPath(dep.deploymentId))).length).toBe(5);
  });
});
