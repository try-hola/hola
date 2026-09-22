/**
 * RealJobService startup recovery (F11).
 *
 * Startup does two different things to two disjoint sets of jobs, and the order
 * they happen in is the whole correctness property:
 *
 *   - jobs left `running` by the PREVIOUS process are orphans — no executor is
 *     driving them — and must be failed;
 *   - jobs left `pending` must be resumed.
 *
 * Resuming a pending job transitions it to `running`, so a recovery that
 * resumes first and then queries `running` marks the jobs it has just resumed
 * as orphans while their executors are live. These tests pin the ordering, the
 * once-only-ness of recovery under concurrent callers, the stale-error clear,
 * and the fact that a resumed job is dispatched through the same
 * per-deployment partition as a fresh one (F10/#541).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RealStorageService } from '../../services/core/storage';
import { RealDatabaseService } from '../../services/core/database';
import { RealLoggingService } from '../../services/core/logging';
import { DatabaseJobRepository, type JobEntity } from '../../services/core/repositories';
import { RealJobService } from '../../services/core/jobs';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function waitFor(predicate: () => Promise<boolean> | boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('timeout waiting for condition');
}

describe('RealJobService startup recovery (F11)', () => {
  let dataRoot: string;
  let storage: RealStorageService;
  let database: RealDatabaseService;
  let logging: RealLoggingService;
  let repo: DatabaseJobRepository;

  /** Seed a row straight into the DB, as the previous process would have left it. */
  const seed = (status: JobEntity['status'], deploymentId: string, error?: string) =>
    repo.create({
      type: 'install',
      status,
      payload: { deploymentId },
      progress: 0,
      ...(error ? { error } : {}),
    });

  beforeEach(async () => {
    dataRoot = mkdtempSync(join(tmpdir(), 'hola-jobs-recovery-'));
    storage = new RealStorageService({ holaDir: dataRoot });
    database = new RealDatabaseService(storage);
    await database.initialize();
    logging = new RealLoggingService(storage);
    repo = new DatabaseJobRepository(database);
  });

  afterEach(() => {
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('a pending job resumed at startup is not reported as a restart orphan', async () => {
    const pending = await seed('pending', 'dep-resume');

    const jobs = new RealJobService(database, logging);
    const started = deferred();
    const release = deferred();
    jobs.setExecutor(async () => {
      started.resolve();
      await release.promise;
      return true;
    });

    await jobs.listJobs(); // triggers ensureStarted
    await started.promise; // the seeded job's executor is live RIGHT NOW

    const live = await jobs.getJob(pending.id);
    expect(live?.status).toBe('running');
    expect(live?.error).toBeUndefined();

    release.resolve();
    await waitFor(async () => (await jobs.getJob(pending.id))?.status === 'completed');
    // ...and success left no stale failure reason behind.
    expect((await jobs.getJob(pending.id))?.error).toBeUndefined();
  });

  it('still fails a job the previous process left running', async () => {
    const orphan = await seed('running', 'dep-orphan');

    const jobs = new RealJobService(database, logging);
    jobs.setExecutor(async () => true);
    await jobs.listJobs();

    const recovered = await jobs.getJob(orphan.id);
    expect(recovered?.status).toBe('failed');
    expect(recovered?.error).toBe('Interrupted by server restart');
  });

  it('reconciles the orphan set without touching jobs it resumes in the same pass', async () => {
    const orphan = await seed('running', 'dep-a');
    const pending = await seed('pending', 'dep-b');

    const jobs = new RealJobService(database, logging);
    const release = deferred();
    jobs.setExecutor(async () => { await release.promise; return true; });

    await jobs.listJobs();

    expect((await jobs.getJob(orphan.id))?.status).toBe('failed');
    expect((await jobs.getJob(pending.id))?.status).toBe('running');

    release.resolve();
    await waitFor(async () => (await jobs.getJob(pending.id))?.status === 'completed');
  });

  it('concurrent startup callers share one recovery, so pending work resumes exactly once', async () => {
    await seed('pending', 'dep-once');

    const jobs = new RealJobService(database, logging);
    let runs = 0;
    jobs.setExecutor(async () => { runs++; return true; });

    // Three entry points racing on a cold service — none awaits the others.
    await Promise.all([jobs.listJobs(), jobs.getJob('nope'), jobs.healthCheck()]);
    await waitFor(async () => (await jobs.listJobs({ status: 'completed' })).length === 1);
    await new Promise((r) => setTimeout(r, 100)); // let any duplicate dispatch land

    expect(runs).toBe(1);
  });

  it('clears a stale error when a job completes successfully', async () => {
    const stale = await seed('pending', 'dep-stale', 'Interrupted by server restart');

    const jobs = new RealJobService(database, logging);
    jobs.setExecutor(async () => true);
    await jobs.listJobs();

    await waitFor(async () => (await jobs.getJob(stale.id))?.status === 'completed');
    expect((await jobs.getJob(stale.id))?.error).toBeUndefined();
  });

  it('resumed jobs are dispatched through the per-deployment lock (F10)', async () => {
    await seed('pending', 'dep-same');
    await seed('pending', 'dep-same');
    await seed('pending', 'dep-other');

    const jobs = new RealJobService(database, logging);
    const inFlight = new Map<string, number>();
    let maxForSameDeployment = 0;
    const seen = new Set<string>();
    const release = deferred();
    jobs.setExecutor(async (ctx) => {
      const dep = ctx.payload.deploymentId as string;
      seen.add(dep);
      const now = (inFlight.get(dep) ?? 0) + 1;
      inFlight.set(dep, now);
      if (dep === 'dep-same') maxForSameDeployment = Math.max(maxForSameDeployment, now);
      await release.promise;
      inFlight.set(dep, (inFlight.get(dep) ?? 1) - 1);
      return true;
    });

    await jobs.listJobs();
    // Both deployments got a slot: the partition is per deployment, not global.
    await waitFor(() => seen.has('dep-same') && seen.has('dep-other'));
    expect(maxForSameDeployment).toBe(1);

    release.resolve();
    await waitFor(async () => (await jobs.listJobs({ status: 'completed' })).length === 3);
    expect(maxForSameDeployment).toBe(1);
  });
});
