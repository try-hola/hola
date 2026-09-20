/**
 * The capability contract broker (ADR 0004 §6, closing #298).
 *
 * #121 gave apps a way to declare `pg_dump`-style hooks, and the server ran them
 * around its OWN pre-upgrade snapshot — never around Backrest's scheduled restic
 * run, because the server wasn't in that loop. These tests cover the loop being
 * closed: a provider announces its run, the server executes every accepting app's
 * hook in that app's own containers, and the provider never touches another app.
 *
 * Runs against RealDeploymentService with a docker double that records every
 * `compose exec` — no containers, but the real acceptor lookup, job plumbing and
 * failure semantics.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { RealDeploymentService } from '../../services/core/deployment';
import { RealDraftService } from '../../services/core/draft';
import { RealStorageService } from '../../services/core/storage';
import { RealRoutingService } from '../../services/core/routing';
import { RealDatabaseService } from '../../services/core/database';
import { RealLoggingService } from '../../services/core/logging';
import { RealJobService } from '../../services/core/jobs';
import { MockDockerService } from '../../services/core/docker';
import { NoneProvisionerService } from '../../services/core/provisioner';
import type { AppBackupConfig, AppBackupDeclaration, AppBackupParticipation } from '@hola/shared';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

const COMPOSE = 'services:\n  app:\n    image: nginx:1.27\n';

const PG_BACKUP: AppBackupConfig = {
  preHook: { service: 'db', command: ['sh', '-c', 'pg_dump -U app app > /backups/app.sql'] },
  postHook: { service: 'db', command: ['rm', '-f', '/backups/app.sql'] },
};

/** A two-participation manifest (spec 004): an app with its own DB and a workflow engine's DB. */
const PLURAL_BACKUP: AppBackupParticipation[] = [
  {
    id: 'app-db',
    preHook: { service: 'postiz-postgres', command: ['sh', '-c', 'pg_dump -U app app > /backups/app.sql'] },
    postHook: { service: 'postiz-postgres', command: ['rm', '-f', '/backups/app.sql'] },
  },
  {
    id: 'temporal-db',
    preHook: { service: 'temporal-postgres', command: ['sh', '-c', 'pg_dump -U temporal temporal > /backups/temporal.sql'] },
    postHook: { service: 'temporal-postgres', command: ['rm', '-f', '/backups/temporal.sql'] },
  },
];

/** A three-participation manifest, for the "stop after the second failure" scenario. */
const TRIPLE_BACKUP: AppBackupParticipation[] = [
  ...PLURAL_BACKUP,
  {
    id: 'third-db',
    preHook: { service: 'third-postgres', command: ['sh', '-c', 'pg_dump -U third third > /backups/third.sql'] },
    postHook: { service: 'third-postgres', command: ['rm', '-f', '/backups/third.sql'] },
  },
];

/** Records every exec so tests can assert which hook ran where. */
class ExecSpy extends MockDockerService {
  execs: Array<{ projectName: string; service: string; command: string[] }> = [];
  /** Deployment id substrings whose exec should fail (simulating a broken dump). */
  failFor: string[] = [];
  /** Service names whose exec should fail — for targeting one of several
   *  participations within the SAME app/project. */
  failForServices: string[] = [];
  /** Runs before each exec is answered, so a test can cancel mid-prepare. */
  onExec?: (e: { projectName: string; service: string; command: string[] }) => void | Promise<void>;

  override async composeExec(
    projectPath: string,
    projectName: string,
    service: string,
    command: string[],
    opts?: { user?: string; profiles?: string[] },
  ): Promise<{ success: boolean; output: string }> {
    this.execs.push({ projectName, service, command });
    await this.onExec?.({ projectName, service, command });
    if (this.failFor.some(f => projectName.includes(f)) || this.failForServices.includes(service)) {
      return { success: false, output: 'FATAL: could not connect to server' };
    }
    return super.composeExec(projectPath, projectName, service, command, opts);
  }

  /** Hook commands run for a given phase, keyed by the compose project. */
  execsFor(phase: 'pre' | 'post'): string[] {
    return this.execs
      .filter(e => (phase === 'pre' ? e.command.join(' ').includes('pg_dump') : e.command.includes('rm')))
      .map(e => e.projectName);
  }
}

function makeCatalog(opts: { accepts?: string[]; provides?: string[]; backup?: AppBackupDeclaration }): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: appId, icon: '📦' }),
    getVersionDetail: async () => ({
      defaultEnv: [],
      defaults: { ports: [], volumes: [] },
      accepts: opts.accepts,
      provides: opts.provides,
      backup: opts.backup,
    }),
  } as unknown as CatalogArg;
}

function makeValidation(): ValidationArg {
  return {
    validateDraft: async () => ({ ok: true, errors: [], warnings: [] }),
    preflightCheck: async () => ({ ok: true, checks: [] }),
  } as unknown as ValidationArg;
}

/** Poll until `predicate` holds, so a timer-driven assertion isn't a fixed sleep. */
async function waitFor(predicate: () => boolean, what: string, timeoutMs = 3000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 10));
  }
}

async function waitForJob(jobs: RealJobService, id: string, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const job = await jobs.getJob(id);
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    if (Date.now() - start > timeoutMs) throw new Error(`Job ${id} did not finish (last: ${job?.status})`);
    await new Promise(r => setTimeout(r, 10));
  }
}

describe('capability contract broker: backup@1', () => {
  let dataRoot: string;
  let docker: ExecSpy;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-broker-'));
    docker = new ExecSpy();
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  /** A system whose catalog stub gives every app the same accepts/backup shape. */
  function makeSystem(opts: { accepts?: string[]; provides?: string[]; backup?: AppBackupDeclaration }) {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage);
    const logging = new RealLoggingService(storage);
    const jobs = new RealJobService(database, logging);
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const drafts = new RealDraftService(storage, makeCatalog(opts), makeValidation());
    const deployments = new RealDeploymentService(
      storage, jobs, docker, drafts, routing, logging, new NoneProvisionerService(),
    );
    return { storage, jobs, drafts, deployments };
  }

  async function install(sys: ReturnType<typeof makeSystem>, appId: string, grants?: string[]): Promise<string> {
    const { draftId } = await sys.drafts.createDraft({ appId, version: '1.0.0' });
    await sys.drafts.updateDraft(draftId, { composeOverride: COMPOSE });
    await sys.drafts.finalizeDraft(draftId);
    const created = await sys.deployments.createFromDraft({ draftId, name: appId, grants });
    expect((await waitForJob(sys.jobs, created.jobId!)).status).toBe('completed');
    return created.deploymentId;
  }

  test('runs every accepting app\'s preHook before the provider captures, and postHook after', async () => {
    const sys = makeSystem({ accepts: ['backup@1'], backup: PG_BACKUP });
    const paperless = await install(sys, 'paperless');
    const mealie = await install(sys, 'mealie');

    const prepared = await sys.deployments.prepareContractBackup();
    expect(prepared.apps.sort()).toEqual([mealie, paperless].sort());
    expect((await waitForJob(sys.jobs, prepared.jobId!)).status).toBe('completed');

    // Each dump ran in its OWN app's compose project — the provider never reaches
    // into another app; the server execs on its behalf.
    const dumped = docker.execsFor('pre');
    expect(dumped).toHaveLength(2);
    expect(dumped.some(p => p.includes(paperless))).toBe(true);
    expect(dumped.some(p => p.includes(mealie))).toBe(true);
    expect(docker.execsFor('post')).toHaveLength(0); // not yet — the capture happens here

    const finalized = await sys.deployments.finalizeContractBackup();
    expect(finalized.ok).toBe(true);
    expect(finalized.results.map(r => r.deploymentId).sort()).toEqual([mealie, paperless].sort());
    expect(docker.execsFor('post')).toHaveLength(2);
  });

  test('an app that accepts the contract but declares no hook is already covered', async () => {
    // SQLite/flat-file apps are consistent under a plain file copy. They accept
    // backup@1 and need nothing run — which is exactly why acceptance is declared
    // rather than inferred from the presence of a `backup` block.
    const sys = makeSystem({ accepts: ['backup@1'] });
    await install(sys, 'uptime-kuma');

    const prepared = await sys.deployments.prepareContractBackup();
    expect(prepared.apps).toEqual([]);
    expect(prepared.jobId).toBeUndefined(); // no job at all, so the provider just proceeds
    expect(docker.execs).toHaveLength(0);
  });

  test('an app with hooks that never accepted the contract is left alone', async () => {
    // Declaring hooks is not opting in. A manifest that predates ADR 0004 keeps
    // working for the pre-upgrade snapshot but does not silently join the fleet
    // backup — the server reports the discrepancy instead of assuming consent.
    const sys = makeSystem({ backup: PG_BACKUP });
    await install(sys, 'immich');

    const prepared = await sys.deployments.prepareContractBackup();
    expect(prepared.apps).toEqual([]);
    expect(docker.execs).toHaveLength(0);
  });

  test('a stopped app is skipped — nothing is writing to its files anyway', async () => {
    const sys = makeSystem({ accepts: ['backup@1'], backup: PG_BACKUP });
    const paperless = await install(sys, 'paperless');
    const stopped = await install(sys, 'mealie');

    const action = await sys.deployments.executeAction(stopped, { action: 'stop' });
    expect((await waitForJob(sys.jobs, action.jobId!)).status).toBe('completed');

    const prepared = await sys.deployments.prepareContractBackup();
    expect(prepared.apps).toEqual([paperless]);
  });

  test('a failed preHook fails the job and cleans up the dumps that did land', async () => {
    // Fail-closed (spec 004 FR-006/007): the provider aborts rather than capture
    // files it would report as transaction-consistent, and cleanup runs the
    // postHook of every participation that was STARTED (in ascending-deployment-id
    // order) before the failure — never one that comes after it. App ids are
    // chosen so "ok" sorts before "broken" and is therefore the one that starts
    // (and gets cleaned up); a participation reached AFTER the failure (a third
    // app, or — see the plural-participation tests above — a later participation
    // in the same app) never starts and gets no cleanup.
    const sys = makeSystem({ accepts: ['backup@1'], backup: PG_BACKUP });
    const ok = await install(sys, 'a-app-ok');
    const broken = await install(sys, 'z-app-broken');
    docker.failFor = [broken];

    const prepared = await sys.deployments.prepareContractBackup();
    const job = await waitForJob(sys.jobs, prepared.jobId!);
    expect(job.status).toBe('failed');

    const cleaned = docker.execsFor('post');
    expect(cleaned.some(p => p.includes(ok))).toBe(true);
  });

  test('with no apps installed at all, prepare is a no-op rather than an error', async () => {
    const sys = makeSystem({ accepts: ['backup@1'], backup: PG_BACKUP });
    expect(await sys.deployments.prepareContractBackup()).toEqual({ apps: [], participations: [] });
    expect(await sys.deployments.finalizeContractBackup()).toEqual({ ok: true, results: [] });
  });

  describe('plural participation (spec 004, US1)', () => {
    test('runs both pre-hooks in declaration order and both post-hooks on finalize', async () => {
      const sys = makeSystem({ accepts: ['backup@1'], backup: PLURAL_BACKUP });
      const postiz = await install(sys, 'postiz');

      const prepared = await sys.deployments.prepareContractBackup();
      expect(prepared.apps).toEqual([postiz]);
      expect(prepared.participations).toEqual([
        { deploymentId: postiz, participationId: 'app-db' },
        { deploymentId: postiz, participationId: 'temporal-db' },
      ]);
      expect((await waitForJob(sys.jobs, prepared.jobId!)).status).toBe('completed');

      const preExecs = docker.execs.filter((e) => e.command.join(' ').includes('pg_dump'));
      expect(preExecs.map((e) => e.service)).toEqual(['postiz-postgres', 'temporal-postgres']);

      const finalized = await sys.deployments.finalizeContractBackup();
      expect(finalized.ok).toBe(true);
      expect(finalized.results).toEqual([
        { deploymentId: postiz, participationId: 'app-db', ok: true, output: expect.any(String) },
        { deploymentId: postiz, participationId: 'temporal-db', ok: true, output: expect.any(String) },
      ]);
    });

    test('a failing second pre-hook fails the job, runs the post-hooks of app-db and temporal-db, and never starts a third', async () => {
      const sys = makeSystem({ accepts: ['backup@1'], backup: TRIPLE_BACKUP });
      const postiz = await install(sys, 'postiz');
      docker.failForServices = ['temporal-postgres'];

      const prepared = await sys.deployments.prepareContractBackup();
      expect(prepared.participations.map((p) => p.participationId)).toEqual(['app-db', 'temporal-db', 'third-db']);
      const job = await waitForJob(sys.jobs, prepared.jobId!);
      expect(job.status).toBe('failed');
      expect(job.error).toContain('1 of 3 participation(s)');
      expect(job.error).toContain(`${postiz}/temporal-db`);

      // app-db and temporal-db were STARTED (their preHook ran), so both get
      // cleanup; third-db's preHook never started, so it gets none.
      const cleaned = docker.execs.filter((e) => e.command.includes('rm')).map((e) => e.service);
      expect(cleaned.sort()).toEqual(['postiz-postgres', 'temporal-postgres'].sort());
      expect(cleaned).not.toContain('third-postgres');

      // third-db's preHook never ran at all.
      const preExecs = docker.execs.filter((e) => e.command.join(' ').includes('pg_dump')).map((e) => e.service);
      expect(preExecs).toEqual(['postiz-postgres', 'temporal-postgres']);
    });

    test('cancelling mid-prepare still cleans up the participations that already dumped', async () => {
      // A cancel aborts the capture as surely as a failure does, and the provider
      // will never call finalize for a prepare that never completed — so the
      // dumps already written have to be cleaned up here (FR-007) or they sit in
      // the app's data root until something else happens to remove them.
      const sys = makeSystem({ accepts: ['backup@1'], backup: TRIPLE_BACKUP });
      await install(sys, 'postiz');

      const prepared = await sys.deployments.prepareContractBackup();
      // Cancel as soon as the FIRST dump has run: the next loop checkpoint sees
      // the flag, so app-db is started and temporal-db/third-db never are.
      docker.onExec = async (e) => {
        if (e.service === 'postiz-postgres' && e.command.join(' ').includes('pg_dump')) {
          await sys.jobs.cancelJob(prepared.jobId!);
        }
      };

      const start = Date.now();
      for (;;) {
        const job = await sys.jobs.getJob(prepared.jobId!);
        if (job && job.status !== 'queued' && job.status !== 'running') break;
        if (Date.now() - start > 5000) throw new Error(`Job did not settle (last: ${job?.status})`);
        await new Promise((r) => setTimeout(r, 10));
      }

      const preExecs = docker.execs.filter((e) => e.command.join(' ').includes('pg_dump')).map((e) => e.service);
      expect(preExecs).toEqual(['postiz-postgres']);
      const cleaned = docker.execs.filter((e) => e.command.includes('rm')).map((e) => e.service);
      expect(cleaned).toEqual(['postiz-postgres']);
    });

    test('prepare response lists participations in execution order, distinct from apps', async () => {
      const sys = makeSystem({ accepts: ['backup@1'], backup: PLURAL_BACKUP });
      const postiz = await install(sys, 'postiz');

      const prepared = await sys.deployments.prepareContractBackup();
      expect(prepared.apps).toEqual([postiz]);
      expect(prepared.participations).toHaveLength(2);
      await waitForJob(sys.jobs, prepared.jobId!);
    });

    test('two apps run in ascending deployment id order', async () => {
      // Slug prefixes chosen so ascending deployment-id order is deterministic
      // regardless of the random id suffix.
      const sys = makeSystem({ accepts: ['backup@1'], backup: PG_BACKUP });
      const zebra = await install(sys, 'zzz-app');
      const alpha = await install(sys, 'aaa-app');
      expect(alpha < zebra).toBe(true);

      const prepared = await sys.deployments.prepareContractBackup();
      expect(prepared.apps).toEqual([alpha, zebra]);
      await waitForJob(sys.jobs, prepared.jobId!);

      const preOrder = docker.execs.filter((e) => e.command.join(' ').includes('pg_dump')).map((e) => e.projectName);
      expect(preOrder).toEqual([`hola-${alpha}`, `hola-${zebra}`]);
    });

    test('a singular manifest reports the participation "default", exec sequence unchanged', async () => {
      const sys = makeSystem({ accepts: ['backup@1'], backup: PG_BACKUP });
      const paperless = await install(sys, 'paperless');

      const prepared = await sys.deployments.prepareContractBackup();
      expect(prepared.participations).toEqual([{ deploymentId: paperless, participationId: 'default' }]);
      await waitForJob(sys.jobs, prepared.jobId!);

      const finalized = await sys.deployments.finalizeContractBackup();
      expect(finalized.results).toEqual([{ deploymentId: paperless, participationId: 'default', ok: true, output: expect.any(String) }]);
    });

    test('finalize keeps going past a failing post-hook', async () => {
      const sys = makeSystem({ accepts: ['backup@1'], backup: PLURAL_BACKUP });
      const postiz = await install(sys, 'postiz');
      docker.failForServices = ['postiz-postgres'];

      const finalized = await sys.deployments.finalizeContractBackup();
      expect(finalized.ok).toBe(false);
      expect(finalized.results).toEqual([
        { deploymentId: postiz, participationId: 'app-db', ok: false, output: expect.any(String) },
        { deploymentId: postiz, participationId: 'temporal-db', ok: true, output: expect.any(String) },
      ]);
    });
  });

  /**
   * ADR 0004 §6: "a per-contract timeout after which `finalize` runs regardless."
   *
   * Between prepare and finalize every acceptor is holding a dump in its own data
   * root — and those roots are exactly what the NEXT backup captures. A provider
   * that crashed mid-capture never calls finalize, so without an expiry the dump
   * stays forever and is copied into every later snapshot looking like a fresh
   * one. backrest's shipped hook script already tells its reader the server
   * applies this timeout; until #472 it did not.
   */
  describe('a prepare the provider never finalizes expires (#472)', () => {
    const originalTimeout = process.env.HOLA_BACKUP_PREPARE_TIMEOUT_MS;
    afterEach(() => {
      if (originalTimeout === undefined) delete process.env.HOLA_BACKUP_PREPARE_TIMEOUT_MS;
      else process.env.HOLA_BACKUP_PREPARE_TIMEOUT_MS = originalTimeout;
    });

    test('the armed timer releases the apps with no second prepare at all', async () => {
      // The case the timeout exists for: the provider crashed mid-capture and
      // nothing else ever happens on this host. Nobody calls finalize; the server
      // runs the postHooks anyway.
      process.env.HOLA_BACKUP_PREPARE_TIMEOUT_MS = '40';
      const sys = makeSystem({ accepts: ['backup@1'], backup: PG_BACKUP });
      await install(sys, 'paperless');

      const first = await sys.deployments.prepareContractBackup();
      expect((await waitForJob(sys.jobs, first.jobId!)).status).toBe('completed');
      expect(docker.execsFor('pre')).toHaveLength(1);

      await waitFor(() => docker.execsFor('post').length === 1, 'the expiry to run postHooks');

      const rollup = (await sys.deployments.getContracts()).items.find(i => i.ref === 'backup@1');
      expect(rollup?.activity?.openSince).toBeUndefined();
    });

    test('the next prepare releases a stranded one first', async () => {
      // A server restart disarms the timer but not the record, so the check has
      // to happen on the prepare path too. Modelled by arming a long timeout and
      // then shortening it — the timer never fires, the next prepare still
      // notices.
      process.env.HOLA_BACKUP_PREPARE_TIMEOUT_MS = String(10 * 60 * 1000);
      const sys = makeSystem({ accepts: ['backup@1'], backup: PG_BACKUP });
      await install(sys, 'paperless');

      const first = await sys.deployments.prepareContractBackup();
      expect((await waitForJob(sys.jobs, first.jobId!)).status).toBe('completed');
      expect(docker.execsFor('pre')).toHaveLength(1);
      expect(docker.execsFor('post')).toHaveLength(0); // the provider then died

      process.env.HOLA_BACKUP_PREPARE_TIMEOUT_MS = '1';
      await new Promise(r => setTimeout(r, 5));

      const second = await sys.deployments.prepareContractBackup();
      // The stranded dump is cleaned up BEFORE the new run's own pre-hooks.
      expect(docker.execsFor('post')).toHaveLength(1);
      expect((await waitForJob(sys.jobs, second.jobId!)).status).toBe('completed');
      expect(docker.execsFor('pre')).toHaveLength(2);
    });

    test('a provider still inside its window is left alone', async () => {
      // The failure mode that would be worse than the leak: deleting a dump the
      // provider is still reading turns a slow backup into a corrupt one.
      process.env.HOLA_BACKUP_PREPARE_TIMEOUT_MS = String(10 * 60 * 1000);
      const sys = makeSystem({ accepts: ['backup@1'], backup: PG_BACKUP });
      await install(sys, 'paperless');

      const first = await sys.deployments.prepareContractBackup();
      expect((await waitForJob(sys.jobs, first.jobId!)).status).toBe('completed');

      const second = await sys.deployments.prepareContractBackup();
      expect((await waitForJob(sys.jobs, second.jobId!)).status).toBe('completed');
      expect(docker.execsFor('post')).toHaveLength(0);
    });

    test('finalize closes it, so nothing expires afterwards', async () => {
      // Finalize must also DISARM the timer, or a healthy run has its postHooks
      // re-run half an hour later for no reason.
      process.env.HOLA_BACKUP_PREPARE_TIMEOUT_MS = '40';
      const sys = makeSystem({ accepts: ['backup@1'], backup: PG_BACKUP });
      await install(sys, 'paperless');

      const first = await sys.deployments.prepareContractBackup();
      expect((await waitForJob(sys.jobs, first.jobId!)).status).toBe('completed');
      await sys.deployments.finalizeContractBackup();
      expect(docker.execsFor('post')).toHaveLength(1);

      await new Promise(r => setTimeout(r, 120)); // well past the timeout
      expect(docker.execsFor('post')).toHaveLength(1); // the timer was disarmed

      const second = await sys.deployments.prepareContractBackup();
      expect((await waitForJob(sys.jobs, second.jobId!)).status).toBe('completed');
      expect(docker.execsFor('post')).toHaveLength(1); // nothing was open to expire
    });

    test('a prepare with nothing to run opens nothing to expire', async () => {
      process.env.HOLA_BACKUP_PREPARE_TIMEOUT_MS = '5';
      const sys = makeSystem({ accepts: ['backup@1'] }); // no hooks: SQLite app
      await install(sys, 'uptime-kuma');

      expect(await sys.deployments.prepareContractBackup()).toEqual({ apps: [], participations: [] });
      await new Promise(r => setTimeout(r, 5));
      await sys.deployments.prepareContractBackup();
      expect(docker.execs).toHaveLength(0);
    });

    test('the rollup reports whether the provider has ever announced a backup', async () => {
      // The apps#159 signal: an install that DECLARES the provider role makes
      // every acceptor render as covered, whether or not it has ever called the
      // broker. These are different facts and the dashboard shows both.
      const sys = makeSystem({ accepts: ['backup@1'], provides: ['backup@1'], backup: PG_BACKUP });
      await install(sys, 'backrest', ['backup@1']);

      const before = (await sys.deployments.getContracts()).items.find(i => i.ref === 'backup@1');
      expect(before?.providers).toHaveLength(1);
      expect(before?.activity?.lastPrepareAt).toBeUndefined();

      const prepared = await sys.deployments.prepareContractBackup();
      expect((await waitForJob(sys.jobs, prepared.jobId!)).status).toBe('completed');

      const during = (await sys.deployments.getContracts()).items.find(i => i.ref === 'backup@1');
      expect(during?.activity?.lastPrepareAt).toBeTruthy();
      expect(during?.activity?.openSince).toBeTruthy();

      await sys.deployments.finalizeContractBackup();
      const after = (await sys.deployments.getContracts()).items.find(i => i.ref === 'backup@1');
      expect(after?.activity?.openSince).toBeUndefined();
      expect(after?.activity?.lastFinalizeAt).toBeTruthy();
      expect(after?.activity?.lastFinalizeWasExpiry).toBe(false);

      // A contract with no provider carries no activity — "never announced" would
      // be trivially true there and would read as a problem.
      const auth = (await sys.deployments.getContracts()).items.find(i => i.ref === 'auth@1');
      expect(auth?.activity).toBeUndefined();
    });
  });
});
