/**
 * RealJobService cancellation + crash-recovery tests.
 *
 * Covers the lifecycle correctness fixes: cancelJob never overwrites a job that
 * already reached a terminal state; a running job cancelled at a cooperative
 * checkpoint ends 'cancelled' (not clobbered back to 'completed'); and jobs left
 * 'running' by a crash are recovered (failed) the next time the service starts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RealStorageService } from '../../services/core/storage';
import { RealDatabaseService } from '../../services/core/database';
import { RealLoggingService } from '../../services/core/logging';
import { RealJobService, JobCancelledError } from '../../services/core/jobs';

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

describe('RealJobService cancellation + recovery', () => {
  let dataRoot: string;
  let storage: RealStorageService;
  let database: RealDatabaseService;
  let logging: RealLoggingService;

  beforeEach(async () => {
    dataRoot = mkdtempSync(join(tmpdir(), 'hola-jobs-'));
    storage = new RealStorageService({ holaDir: dataRoot });
    database = new RealDatabaseService(storage);
    await database.initialize();
    logging = new RealLoggingService(storage);
  });

  afterEach(() => {
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('cancelJob does not overwrite a job that already completed', async () => {
    const jobs = new RealJobService(database, logging);
    jobs.setExecutor(async () => true); // completes immediately
    const job = await jobs.createJob({ type: 'install', deploymentId: 'dep-1' });
    await waitFor(async () => (await jobs.getJob(job.id))?.status === 'completed');

    await jobs.cancelJob(job.id);

    // Still completed — the terminal state was not corrupted to 'cancelled'.
    expect((await jobs.getJob(job.id))?.status).toBe('completed');
  });

  it('a running job cancelled at a checkpoint ends cancelled, not completed', async () => {
    const jobs = new RealJobService(database, logging);
    const started = deferred();
    const release = deferred();
    jobs.setExecutor(async (ctx) => {
      started.resolve();
      await release.promise;
      // Cooperative checkpoint after the (simulated) long-running work.
      if (ctx.isCancelled()) throw new JobCancelledError();
      return true;
    });

    const job = await jobs.createJob({ type: 'install', deploymentId: 'dep-2' });
    await started.promise; // executor is running; DB row is 'running'

    await jobs.cancelJob(job.id); // running → sets the flag only, writes no status
    release.resolve(); // executor resumes, observes cancellation, throws

    // 'cancelled' is a DB-level status surfaced through toShared (the shared
    // JobStatus union doesn't name it), so read it as a string.
    const statusOf = async () => (await jobs.getJob(job.id))?.status as string | undefined;
    await waitFor(async () => (await statusOf()) === 'cancelled');
    expect(await statusOf()).toBe('cancelled');
  });

  it('recovers orphaned running jobs on restart (marks them failed)', async () => {
    // jobsA starts a job whose executor hangs, leaving a 'running' row behind as
    // if the process had crashed mid-job.
    const jobsA = new RealJobService(database, logging);
    const started = deferred();
    jobsA.setExecutor(async () => {
      started.resolve();
      await new Promise(() => {}); // never resolves
      return true;
    });
    const job = await jobsA.createJob({ type: 'install', deploymentId: 'dep-3' });
    await started.promise;
    expect((await jobsA.getJob(job.id))?.status).toBe('running');

    // A fresh service over the same DB treats the orphan as interrupted on start.
    const jobsB = new RealJobService(database, logging);
    await jobsB.listJobs(); // triggers ensureStarted recovery
    expect((await jobsB.getJob(job.id))?.status).toBe('failed');
  });
});
