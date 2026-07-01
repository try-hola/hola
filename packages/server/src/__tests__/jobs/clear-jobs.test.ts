/**
 * clearJobs — bulk removal of finished jobs (DELETE /api/jobs).
 *
 * Invariants: only terminal jobs (completed/failed/cancelled) are removed;
 * running/queued jobs are never touched; the clear can be scoped to a single
 * deployment and/or a single terminal status; and it returns how many it removed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RealStorageService } from '../../services/core/storage';
import { RealDatabaseService } from '../../services/core/database';
import { RealLoggingService } from '../../services/core/logging';
import { RealJobService, MockJobService } from '../../services/core/jobs';

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

describe('RealJobService.clearJobs', () => {
  let dataRoot: string;
  let storage: RealStorageService;
  let database: RealDatabaseService;
  let logging: RealLoggingService;

  beforeEach(async () => {
    dataRoot = mkdtempSync(join(tmpdir(), 'hola-clearjobs-'));
    storage = new RealStorageService({ holaDir: dataRoot });
    database = new RealDatabaseService(storage);
    await database.initialize();
    logging = new RealLoggingService(storage);
  });

  afterEach(() => {
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('removes finished jobs and returns the count, never a running job', async () => {
    const jobs = new RealJobService(database, logging);
    jobs.setExecutor(async () => true); // completes immediately
    const a = await jobs.createJob({ type: 'install', deploymentId: 'dep-a' });
    const b = await jobs.createJob({ type: 'install', deploymentId: 'dep-b' });
    await waitFor(async () => (await jobs.getJob(a.id))?.status === 'completed');
    await waitFor(async () => (await jobs.getJob(b.id))?.status === 'completed');

    // A running job that blocks on a gate so it stays 'running' across the clear.
    const gate = deferred();
    jobs.setExecutor(async () => { await gate.promise; return true; });
    const running = await jobs.createJob({ type: 'install', deploymentId: 'dep-a' });
    await waitFor(async () => (await jobs.getJob(running.id))?.status === 'running');

    const cleared = await jobs.clearJobs();
    expect(cleared).toBe(2);
    expect(await jobs.getJob(a.id)).toBeNull();
    expect(await jobs.getJob(b.id)).toBeNull();
    expect((await jobs.getJob(running.id))?.status).toBe('running');

    gate.resolve();
    await waitFor(async () => (await jobs.getJob(running.id))?.status === 'completed');
  });

  it('scopes the clear to a single deployment', async () => {
    const jobs = new RealJobService(database, logging);
    jobs.setExecutor(async () => true);
    const a = await jobs.createJob({ type: 'install', deploymentId: 'dep-a' });
    const b = await jobs.createJob({ type: 'install', deploymentId: 'dep-b' });
    await waitFor(async () => (await jobs.getJob(a.id))?.status === 'completed');
    await waitFor(async () => (await jobs.getJob(b.id))?.status === 'completed');

    const cleared = await jobs.clearJobs({ deploymentId: 'dep-a' });
    expect(cleared).toBe(1);
    expect(await jobs.getJob(a.id)).toBeNull();
    expect((await jobs.getJob(b.id))?.status).toBe('completed');
  });

  it('clears only the requested terminal status', async () => {
    const jobs = new RealJobService(database, logging);
    jobs.setExecutor(async () => true);
    const ok = await jobs.createJob({ type: 'install', deploymentId: 'dep-a' });
    await waitFor(async () => (await jobs.getJob(ok.id))?.status === 'completed');

    jobs.setExecutor(async () => { throw new Error('boom'); });
    const bad = await jobs.createJob({ type: 'install', deploymentId: 'dep-a' });
    await waitFor(async () => (await jobs.getJob(bad.id))?.status === 'failed');

    const cleared = await jobs.clearJobs({ status: 'failed' });
    expect(cleared).toBe(1);
    expect((await jobs.getJob(ok.id))?.status).toBe('completed');
    expect(await jobs.getJob(bad.id)).toBeNull();
  });

  it('is a no-op when there are no finished jobs', async () => {
    const jobs = new RealJobService(database, logging);
    expect(await jobs.clearJobs()).toBe(0);
  });
});

describe('MockJobService.clearJobs', () => {
  it('never removes a queued/running job', async () => {
    const jobs = new MockJobService();
    const j = await jobs.createJob({ type: 'install', deploymentId: 'dep-a' });
    const cleared = await jobs.clearJobs();
    expect(cleared).toBe(0);
    expect((await jobs.getJob(j.id))?.status).toBe('queued');
  });
});
