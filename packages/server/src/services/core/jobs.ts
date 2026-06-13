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
  onJobUpdate(jobId: string, listener: Listener<JobUpdate>): { unsubscribe(): void };
  /** Register the executor that performs real work for jobs (e.g. Compose lifecycle). */
  setExecutor(executor: JobExecutor): void;
}

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

  constructor(db: DatabaseService, logging: LoggingService) {
    this.db = db;
    this.repo = new DatabaseJobRepository(this.db);
    this.logging = logging;
  }

  setExecutor(executor: JobExecutor): void {
    this.executor = executor;
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
        this.bus.emit(id, { id, status: 'failed', finishedAt: new Date().toISOString() });
        await this.logging.logJob(id, 'warn', 'Job cancelled before start');
        return;
      }
      // Transition to running
      await this.repo.updateStatus(id, 'running');
      this.bus.emit(id, { id, status: 'running' });
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
            this.bus.emit(id, { id, status: 'running', progress: p });
          },
          isCancelled: () => this.cancelled.has(id),
        };
        const handled = await this.executor(ctx);
        if (handled) {
          await this.repo.updateStatus(id, 'completed');
          const finishedAt = new Date().toISOString();
          this.bus.emit(id, { id, status: 'completed', progress: 100, finishedAt });
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
          this.bus.emit(id, { id, status: 'failed', finishedAt });
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
        this.bus.emit(id, { id, status: 'running', progress });
        await this.logging.logJob(id, 'info', steps[i]);
      }

      await this.repo.updateStatus(id, 'completed');
      const finishedAt = new Date().toISOString();
      this.bus.emit(id, { id, status: 'completed', progress: 100, finishedAt });
      await this.logging.logJob(id, 'info', 'Job completed');
    } catch (error) {
      await this.repo.update(id, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
      const finishedAt = new Date().toISOString();
      this.bus.emit(id, { id, status: 'failed', finishedAt });
      await this.logging.logJob(id, 'error', 'Job failed', { error: error instanceof Error ? error.message : String(error) });
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
    // Re-enqueue any pending jobs
    try {
      const pending = await this.repo.findByStatus('pending');
      pending.forEach(j => this.enqueue(j.id));
    } catch (e) {
      this.logger.warn('Failed to load pending jobs', { error: e instanceof Error ? e.message : String(e) });
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
  // Mark for cooperative cancellation and remove from queue if present
  this.cancelled.add(id);
  this.queue = this.queue.filter(j => j !== id);
  await this.repo.updateStatus(id, 'cancelled');
  this.bus.emit(id, { id, status: 'failed', finishedAt: new Date().toISOString() });
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
      this.bus.emit(id, { id, status: 'running', progress: p });
      if (p >= 100) {
        j.status = 'completed';
        j.finishedAt = new Date().toISOString();
        this.bus.emit(id, { id, status: 'completed', progress: 100, finishedAt: j.finishedAt });
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
      this.bus.emit(id, { id, status: 'failed', finishedAt: j.finishedAt });
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
    this.bus.emit(jobId, update);
  }

  clearTimers(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }
}
