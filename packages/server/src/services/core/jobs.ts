/**
 * Job Service - Phase 5
 *
 * Persistent background job queue with bounded concurrency, progress updates,
 * retries/backoff, cancellation, and integration with LoggingService.
 */

import { getLogger } from '../../lib/logger';
import type { HealthCheckable, ServiceHealth } from './types';
import type { DatabaseService } from './database';
import { DatabaseJobRepository, type JobRepository, type JobEntity } from './repositories';
import type { LoggingService } from './logging';
import type { EventBus } from './event-bus';
import type { Job as SharedJob, JobStatus as SharedJobStatus, JobType as SharedJobType } from '@hola/shared';

// Simple in-process pub-sub for job updates
 type Listener<T> = (event: T) => void;
 class Bus<TopicKey, Payload> {
  private listeners = new Map<string, Set<Listener<Payload>>>();
  private key(topic: TopicKey): string { return String(topic); }
  emit(topic: TopicKey, payload: Payload) { this.listeners.get(this.key(topic))?.forEach(fn => fn(payload)); }
  on(topic: TopicKey, listener: Listener<Payload>) { const k = this.key(topic); if (!this.listeners.has(k)) this.listeners.set(k, new Set()); this.listeners.get(k)!.add(listener); return { unsubscribe: () => { const s = this.listeners.get(k); if (!s) return; s.delete(listener); if (s.size === 0) this.listeners.delete(k); } }; }
 }

export type JobUpdate = { id: string; status: SharedJobStatus; progress?: number; finishedAt?: string };

/**
 * Thrown by an executor (or a cooperative checkpoint) to signal that a job was
 * cancelled mid-flight, as opposed to failing. The job service records it as
 * `cancelled` rather than `failed`.
 */
export class JobCancelledError extends Error {
  constructor() {
    super('Job cancelled');
    this.name = 'JobCancelledError';
  }
}

export interface CreateJobParams {
  type: SharedJobType;
  payload?: Record<string, unknown>;
  deploymentId?: string;
}

/** Context handed to a job executor for logging, progress, and cancellation. */
export interface JobContext {
  job: SharedJob;
  payload: Record<string, unknown>;
  log(level: 'info' | 'warn' | 'error' | 'debug', message: string, metadata?: Record<string, unknown>): Promise<void>;
  setProgress(percent: number): Promise<void>;
  isCancelled(): boolean;
}

/**
 * Performs the real work for a job. Returns `true` if it handled the job (so the
 * service skips the simulated fallback), `false`/`undefined` to fall back.
 * Throwing marks the job failed.
 */
export type JobExecutor = (ctx: JobContext) => Promise<boolean | void>;

export interface JobService extends HealthCheckable {
  createJob(params: CreateJobParams): Promise<SharedJob>;
  cancelJob(id: string): Promise<void>;
  getJob(id: string): Promise<SharedJob | null>;
  listJobs(filter?: { deploymentId?: string; status?: SharedJobStatus }): Promise<SharedJob[]>;
  /** Remove finished (completed/failed/cancelled) jobs, optionally scoped to one
   *  deployment and/or a single terminal status. Never removes running/queued
   *  jobs. Returns the number of jobs removed. */
  clearJobs(filter?: { deploymentId?: string; status?: SharedJobStatus }): Promise<number>;
  onJobUpdate(jobId: string, listener: Listener<JobUpdate>): { unsubscribe(): void };
  /** Register the executor that performs real work for jobs (e.g. Compose lifecycle). */
  setExecutor(executor: JobExecutor): void;
}

// Job states that are safe to clear — never a queued/running job.
const TERMINAL_JOB_STATUSES: JobEntity['status'][] = ['completed', 'failed', 'cancelled'];

function toShared(job: JobEntity): SharedJob {
  return {
    id: job.id,
    type: job.type as SharedJobType,
    status: (job.status === 'pending' ? 'queued' : job.status) as SharedJobStatus,
    startedAt: (job.startedAt ?? job.createdAt).toISOString(),
    finishedAt: job.completedAt?.toISOString(),
    progress: job.progress,
    deploymentId: (job.payload?.deploymentId as string | undefined) || undefined,
  };
}

export class RealJobService implements JobService {
  private logger = getLogger().child({ service: 'RealJobService' });
  private db: DatabaseService;
  private repo: JobRepository;
  private logging: LoggingService;
  private queue: string[] = [];
  private running = 0;
  private maxConcurrency = Number(process.env.HOLA_JOBS_CONCURRENCY || 2);
  private bus = new Bus<string, JobUpdate>();
  private started = false;
  private cancelled = new Set<string>();
  private maxRetries = Number(process.env.HOLA_JOBS_MAX_RETRIES || 0);
  private baseBackoffMs = Number(process.env.HOLA_JOBS_BACKOFF_MS || 500);
  private executor?: JobExecutor;

  constructor(db: DatabaseService, logging: LoggingService, private eventBus?: EventBus) {
    this.db = db;
    this.repo = new DatabaseJobRepository(this.db);
    this.logging = logging;
  }

  setExecutor(executor: JobExecutor): void {
    this.executor = executor;
  }

  /**
   * Emit a job state change to the per-job bus (existing per-id subscribers, e.g.
   * the job log stream) AND, when wired, to the global event bus that backs the
   * dashboard-wide `/api/events` stream (#291) — so list views see the transition
   * without polling.
   */
  private notify(id: string, update: JobUpdate): void {
    this.bus.emit(id, update);
    this.eventBus?.emit({
      type: 'job_update',
      data: { jobId: id, status: update.status, progress: update.progress, finishedAt: update.finishedAt },
    });
  }

  private enqueue(id: string) {
    this.queue.push(id);
    this.tick();
  }

  private tick() {
    while (this.running < this.maxConcurrency && this.queue.length > 0) {
      const id = this.queue.shift()!;
      this.runJob(id).catch(err => {
        this.logger.error('Job execution crashed', err as Error, { jobId: id });
      });
    }
  }

  private async runJob(id: string) {
    this.running++;
    try {
      if (this.cancelled.has(id)) {
        // If cancelled before start, mark and exit
        await this.repo.updateStatus(id, 'cancelled');
        this.cancelled.delete(id);
        this.notify(id, { id, status: 'failed', finishedAt: new Date().toISOString() });
        await this.logging.logJob(id, 'warn', 'Job cancelled before start');
        return;
      }
      // Transition to running
      await this.repo.updateStatus(id, 'running');
      this.notify(id, { id, status: 'running' });
      await this.logging.logJob(id, 'info', 'Job started');

      // Prefer the registered executor (real work, e.g. Compose lifecycle).
      if (this.executor) {
        const entity = await this.repo.findById(id);
        const ctx: JobContext = {
          job: toShared(entity!),
          payload: entity?.payload ?? {},
          log: (level, message, metadata) => this.logging.logJob(id, level, message, metadata),
          setProgress: async (percent) => {
            const p = Math.max(0, Math.min(100, Math.round(percent)));
            await this.repo.updateProgress(id, p);
            this.notify(id, { id, status: 'running', progress: p });
          },
          isCancelled: () => this.cancelled.has(id),
        };
        const handled = await this.executor(ctx);
        if (handled) {
          await this.repo.updateStatus(id, 'completed');
          this.cancelled.delete(id);
          const finishedAt = new Date().toISOString();
          this.notify(id, { id, status: 'completed', progress: 100, finishedAt });
          await this.logging.logJob(id, 'info', 'Job completed');
          return;
        }
      }

      // Simulated steps with logs and progress (fallback for unhandled job types)
      const steps = [
        'Initializing task',
        'Preparing environment',
        'Executing operation',
        'Finalizing',
      ];

      for (let i = 0; i < steps.length; i++) {
        // Cooperative cancellation before each step
        if (this.cancelled.has(id)) {
          await this.repo.updateStatus(id, 'cancelled');
          this.cancelled.delete(id);
          const finishedAt = new Date().toISOString();
          this.notify(id, { id, status: 'failed', finishedAt });
          await this.logging.logJob(id, 'warn', 'Job cancelled', { step: i });
          return;
        }

        // Execute step with retry/backoff
        let attempt = 0;
        for (;;) {
          try {
            await this.sleep(1000 + Math.random() * 1000);
            // In a real system, the step operation could throw here
            break; // success
          } catch (stepErr) {
            attempt++;
            if (attempt > this.maxRetries) {
              throw stepErr;
            }
            await this.logging.logJob(id, 'warn', 'Step failed, retrying', { step: i, attempt });
            await this.backoff(attempt);
          }
        }

        const progress = Math.min(100, Math.floor(((i + 1) / steps.length) * 100));
        await this.repo.updateProgress(id, progress);
        this.notify(id, { id, status: 'running', progress });
        await this.logging.logJob(id, 'info', steps[i]);
      }

      await this.repo.updateStatus(id, 'completed');
      const finishedAt = new Date().toISOString();
      this.notify(id, { id, status: 'completed', progress: 100, finishedAt });
      await this.logging.logJob(id, 'info', 'Job completed');
    } catch (error) {
      const finishedAt = new Date().toISOString();
      if (error instanceof JobCancelledError) {
        await this.repo.updateStatus(id, 'cancelled');
        this.cancelled.delete(id);
        this.notify(id, { id, status: 'failed', finishedAt });
        await this.logging.logJob(id, 'warn', 'Job cancelled');
      } else {
        await this.repo.update(id, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
        this.notify(id, { id, status: 'failed', finishedAt });
        await this.logging.logJob(id, 'error', 'Job failed', { error: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      this.running--;
      this.tick();
    }
  }

  private async backoff(attempt: number) {
    const jitter = Math.random() * this.baseBackoffMs * 0.2;
    const ms = Math.min(30000, Math.round(this.baseBackoffMs * 2 ** (attempt - 1) + jitter));
    await this.sleep(ms);
  }

  private async ensureStarted() {
    if (this.started) return;
    await this.db.initialize();
    try {
      // Re-enqueue jobs that were still queued when the process stopped.
      const pending = await this.repo.findByStatus('pending');
      pending.forEach(j => this.enqueue(j.id));
      // Any job left 'running' was orphaned by a crash/restart — no executor is
      // driving it anymore — so fail it rather than leave the deployment wedged
      // showing an in-progress job that never resolves.
      const orphaned = await this.repo.findByStatus('running');
      for (const j of orphaned) {
        await this.repo.update(j.id, { status: 'failed', error: 'Interrupted by server restart' });
        this.notify(j.id, { id: j.id, status: 'failed', finishedAt: new Date().toISOString() });
        await this.logging.logJob(j.id, 'error', 'Job failed: interrupted by server restart');
      }
    } catch (e) {
      this.logger.warn('Failed to recover jobs on startup', { error: e instanceof Error ? e.message : String(e) });
    }
    this.started = true;
  }

  async createJob(params: CreateJobParams): Promise<SharedJob> {
    await this.ensureStarted();
    const entity: Omit<JobEntity, 'id' | 'createdAt' | 'updatedAt'> = {
      type: params.type,
      status: 'pending',
      payload: { ...(params.payload || {}), deploymentId: params.deploymentId },
      progress: 0,
    };
    const created = await this.repo.create(entity);
    this.enqueue(created.id);
    return toShared(created);
  }

  async cancelJob(id: string): Promise<void> {
    const entity = await this.repo.findById(id);
    // Never overwrite a job that already reached a terminal state — doing so would
    // corrupt its recorded outcome (e.g. rewriting a 'completed' job to 'cancelled').
    if (!entity || entity.status === 'completed' || entity.status === 'failed' || entity.status === 'cancelled') {
      return;
    }
    // Flag for cooperative cancellation and drop it from the queue if still waiting.
    this.cancelled.add(id);
    this.queue = this.queue.filter(j => j !== id);
    if (entity.status === 'running') {
      // A running job is finalized by runJob once a cooperative checkpoint observes
      // the flag (it throws JobCancelledError) — writing a terminal status here would
      // be clobbered by the executor's own completion write. Best-effort: a single
      // long-running Compose call can't be interrupted, so cancellation only takes
      // effect at the next checkpoint.
      return;
    }
    // Not yet running: finalize now so a dequeued job doesn't sit pending forever.
    await this.repo.updateStatus(id, 'cancelled');
    this.cancelled.delete(id);
    this.notify(id, { id, status: 'failed', finishedAt: new Date().toISOString() });
  }

  async getJob(id: string): Promise<SharedJob | null> {
    await this.ensureStarted();
    const entity = await this.repo.findById(id);
    return entity ? toShared(entity) : null;
  }

  async listJobs(filter?: { deploymentId?: string; status?: SharedJobStatus }): Promise<SharedJob[]> {
    await this.ensureStarted();
    let items: JobEntity[];
    if (filter?.status) {
      const statusMap: Record<SharedJobStatus, JobEntity['status']> = {
        queued: 'pending',
        running: 'running',
        completed: 'completed',
        failed: 'failed',
      } as const;
      items = await this.repo.findByStatus(statusMap[filter.status]);
    } else {
      items = await this.repo.findAll();
    }
    const mapped = items.map(toShared);
    return filter?.deploymentId ? mapped.filter(j => j.deploymentId === filter.deploymentId) : mapped;
  }

  async clearJobs(filter?: { deploymentId?: string; status?: SharedJobStatus }): Promise<number> {
    await this.ensureStarted();
    let statuses = TERMINAL_JOB_STATUSES;
    if (filter?.status) {
      const statusMap: Record<SharedJobStatus, JobEntity['status']> = {
        queued: 'pending',
        running: 'running',
        completed: 'completed',
        failed: 'failed',
      } as const;
      const mapped = statusMap[filter.status];
      // Only terminal statuses are clearable; a queued/running filter clears nothing.
      statuses = TERMINAL_JOB_STATUSES.includes(mapped) ? [mapped] : [];
    }
    let removed = 0;
    for (const status of statuses) {
      const jobs = await this.repo.findByStatus(status);
      for (const job of jobs) {
        if (filter?.deploymentId && (job.payload?.deploymentId as string | undefined) !== filter.deploymentId) {
          continue;
        }
        await this.repo.delete(job.id);
        removed++;
      }
    }
    if (removed > 0) this.logger.info('Cleared finished jobs', { removed, ...filter });
    return removed;
  }

  onJobUpdate(jobId: string, listener: Listener<JobUpdate>): { unsubscribe(): void } {
    return this.bus.on(jobId, listener);
  }

  async healthCheck(): Promise<ServiceHealth> {
    try {
      await this.ensureStarted();
      return { healthy: true, lastCheck: new Date() };
    } catch (e) {
      return { healthy: false, lastCheck: new Date(), error: e instanceof Error ? e.message : String(e) };
    }
  }

  private sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }
}

export class MockJobService implements JobService {
  private logger = getLogger().child({ service: 'MockJobService' });
  private bus = new Bus<string, JobUpdate>();
  private jobs = new Map<string, SharedJob>();
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(private eventBus?: EventBus) {}

  /** Mirror of RealJobService.notify: per-job bus + the global event bus (#291). */
  private notify(id: string, update: JobUpdate): void {
    this.bus.emit(id, update);
    this.eventBus?.emit({
      type: 'job_update',
      data: { jobId: id, status: update.status, progress: update.progress, finishedAt: update.finishedAt },
    });
  }

  async createJob(params: CreateJobParams): Promise<SharedJob> {
    const id = crypto.randomUUID();
    const job: SharedJob = {
      id,
      type: params.type,
      status: 'queued',
      startedAt: new Date().toISOString(),
      progress: 0,
      deploymentId: params.deploymentId,
    };
    this.jobs.set(id, job);
    // Simulate progress
    let p = 0;
    if (process.env.NODE_ENV === 'test') {
      return job;
    }

    const timer = setInterval(() => {
      const j = this.jobs.get(id);
      if (!j) return clearInterval(timer);
      if (j.status !== 'running' && j.status !== 'queued') return clearInterval(timer);
      j.status = 'running';
      p = Math.min(100, p + 20);
      j.progress = p;
      this.notify(id, { id, status: 'running', progress: p });
      if (p >= 100) {
        j.status = 'completed';
        j.finishedAt = new Date().toISOString();
        this.notify(id, { id, status: 'completed', progress: 100, finishedAt: j.finishedAt });
        clearInterval(timer);
        this.timers.delete(id);
      }
    }, 1000);
    this.timers.set(id, timer);
    return job;
  }

  async cancelJob(id: string): Promise<void> {
    const j = this.jobs.get(id);
    if (j) {
      j.status = 'failed';
      j.finishedAt = new Date().toISOString();
      this.notify(id, { id, status: 'failed', finishedAt: j.finishedAt });
    }
    const timer = this.timers.get(id);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(id);
    }
  }

  async getJob(id: string): Promise<SharedJob | null> {
    return this.jobs.get(id) || null;
  }

  async listJobs(filter?: { deploymentId?: string; status?: SharedJobStatus }): Promise<SharedJob[]> {
    let items = Array.from(this.jobs.values());
    if (filter?.status) items = items.filter(j => j.status === filter.status);
    if (filter?.deploymentId) items = items.filter(j => j.deploymentId === filter.deploymentId);
    // Sort newest first
    return items.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }

  async clearJobs(filter?: { deploymentId?: string; status?: SharedJobStatus }): Promise<number> {
    let removed = 0;
    for (const [id, j] of this.jobs) {
      // Only finished jobs are clearable (the mock models completed/failed).
      if (j.status !== 'completed' && j.status !== 'failed') continue;
      if (filter?.status && j.status !== filter.status) continue;
      if (filter?.deploymentId && j.deploymentId !== filter.deploymentId) continue;
      const timer = this.timers.get(id);
      if (timer) { clearInterval(timer); this.timers.delete(id); }
      this.jobs.delete(id);
      removed++;
    }
    return removed;
  }

  onJobUpdate(jobId: string, listener: Listener<JobUpdate>): { unsubscribe(): void } {
    return this.bus.on(jobId, listener);
  }

  setExecutor(): void {
    // Mock jobs do not run an executor (test mode resolves jobs synthetically).
  }

  async healthCheck(): Promise<ServiceHealth> {
    return { healthy: true, lastCheck: new Date() };
  }

  emitTestUpdate(jobId: string, update: JobUpdate): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = update.status;
      if (typeof update.progress === 'number') {
        job.progress = update.progress;
      }
      if (update.finishedAt) {
        job.finishedAt = update.finishedAt;
      }
    }
    this.notify(jobId, update);
  }

  clearTimers(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }
}
