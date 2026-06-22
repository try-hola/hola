/**
 * Logging Service - Phase 5
 * 
 * Provides structured logs for jobs and deployments with in-process pub/sub
 * streaming and optional file persistence via the Phase 1 FileLogger.
 */

import { getLogger } from '../../lib/logger';
import { type HealthCheckable, type ServiceHealth } from './types';
import type { StorageService } from './storage';
import { getServices } from '../simple-factory';
import { getFileLogger, initializeFileLogger, type LogLevel as FileLogLevel } from '../../lib/file-logger';
import type { LogEntry as SharedLogEntry } from '@hola/shared';

type Listener<T> = (event: T) => void;

export type LoggingTarget = { kind: 'job'; id: string } | { kind: 'deployment'; id: string };

export type StructuredLog = SharedLogEntry & { target: LoggingTarget };

export interface LoggingService extends HealthCheckable {
  log(target: LoggingTarget, level: SharedLogEntry['level'], message: string, metadata?: Record<string, unknown>): Promise<void>;
  onLog(target: LoggingTarget, listener: Listener<StructuredLog>): { unsubscribe(): void };
  /** Recent buffered log lines for a target, oldest-first. Lets the Logs tab
   *  show why a finished/failed job ended instead of "No logs available"
   *  (the live SSE stream alone has nothing to replay once the job is over). */
  recentLogs(target: LoggingTarget, limit?: number): StructuredLog[];
  // Convenience
  logJob(jobId: string, level: SharedLogEntry['level'], message: string, metadata?: Record<string, unknown>): Promise<void>;
  logDeployment(deploymentId: string, level: SharedLogEntry['level'], message: string, metadata?: Record<string, unknown>): Promise<void>;
}

/** Per-target in-memory ring buffer of recent log lines. Bounded two ways so a
 *  long-lived server can't leak: at most MAX_LINES per target, and at most
 *  MAX_TARGETS distinct targets (oldest target evicted first). */
class LogRingBuffer {
  private static readonly MAX_LINES = 1000;
  private static readonly MAX_TARGETS = 256;
  private buffers = new Map<string, StructuredLog[]>();

  push(key: string, entry: StructuredLog): void {
    let buf = this.buffers.get(key);
    if (!buf) {
      buf = [];
      this.buffers.set(key, buf);
      if (this.buffers.size > LogRingBuffer.MAX_TARGETS) {
        const oldest = this.buffers.keys().next().value;
        if (oldest !== undefined) this.buffers.delete(oldest);
      }
    }
    buf.push(entry);
    if (buf.length > LogRingBuffer.MAX_LINES) buf.splice(0, buf.length - LogRingBuffer.MAX_LINES);
  }

  recent(key: string, limit?: number): StructuredLog[] {
    const buf = this.buffers.get(key) ?? [];
    return limit && limit < buf.length ? buf.slice(buf.length - limit) : [...buf];
  }
}

class SimplePubSub<TopicKey, Payload> {
  private listeners = new Map<string, Set<Listener<Payload>>>();

  private key(topic: TopicKey): string {
    return String(topic);
  }

  emit(topic: TopicKey, payload: Payload) {
    const set = this.listeners.get(this.key(topic));
    if (!set) return;
    for (const fn of set) fn(payload);
  }

  subscribe(topic: TopicKey, listener: Listener<Payload>): { unsubscribe(): void } {
    const k = this.key(topic);
    if (!this.listeners.has(k)) this.listeners.set(k, new Set());
    this.listeners.get(k)!.add(listener);
    return {
      unsubscribe: () => {
        const set = this.listeners.get(k);
        if (!set) return;
        set.delete(listener);
        if (set.size === 0) this.listeners.delete(k);
      }
    };
  }
}

/**
 * Real logging service: writes to file logger and broadcasts to subscribers.
 */
export class RealLoggingService implements LoggingService {
  private logger = getLogger().child({ service: 'RealLoggingService' });
  private storage: StorageService;
  private bus = new SimplePubSub<string, StructuredLog>();
  private buffer = new LogRingBuffer();
  private initialized = false;

  constructor(storage?: StorageService) {
    this.storage = storage ?? getServices().storage;
  }

  private targetKey(target: LoggingTarget): string {
    return target.kind + ':' + target.id;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    try {
      await this.storage.initialize();
      // Ensure file logger exists
      const logger = getFileLogger() ?? initializeFileLogger(this.storage);
      // Touch logger by logging a debug line (no-op if level > debug)
      await logger.debug('LoggingService initialized', { service: 'logging' });
      this.initialized = true;
      this.logger.info('Logging service initialized');
    } catch (error) {
      this.logger.warn('Failed to initialize logging service; will operate best-effort', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async healthCheck(): Promise<ServiceHealth> {
    try {
      await this.initialize();
      return { healthy: true, lastCheck: new Date() };
    } catch (e) {
      return { healthy: false, lastCheck: new Date(), error: e instanceof Error ? e.message : String(e) };
    }
  }

  async log(target: LoggingTarget, level: SharedLogEntry['level'], message: string, metadata?: Record<string, unknown>): Promise<void> {
  const entry: StructuredLog = {
      timestamp: new Date().toISOString(),
      level,
      service: metadata?.service as string || (target.kind === 'job' ? 'job-runner' : 'deployment'),
      message,
      target,
    };

    // Retain for the snapshot/replay buffer, then broadcast to live subscribers.
    this.buffer.push(this.targetKey(target), entry);
    this.bus.emit(this.targetKey(target), entry);

    // Persist via file logger (best-effort)
    try {
      const fileLogger = getFileLogger() ?? initializeFileLogger(this.storage);
      await fileLogger.log(level as FileLogLevel, message, { service: entry.service, target, ...metadata });
    } catch (error) {
      this.logger.debug('File logging failed (non-fatal)', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  onLog(target: LoggingTarget, listener: Listener<StructuredLog>): { unsubscribe(): void } {
    return this.bus.subscribe(this.targetKey(target), listener);
  }

  recentLogs(target: LoggingTarget, limit?: number): StructuredLog[] {
    return this.buffer.recent(this.targetKey(target), limit);
  }

  async logJob(jobId: string, level: SharedLogEntry['level'], message: string, metadata?: Record<string, unknown>): Promise<void> {
    return this.log({ kind: 'job', id: jobId }, level, message, metadata);
  }

  async logDeployment(deploymentId: string, level: SharedLogEntry['level'], message: string, metadata?: Record<string, unknown>): Promise<void> {
    return this.log({ kind: 'deployment', id: deploymentId }, level, message, metadata);
  }
}

/**
 * Mock logging service: in-memory pub/sub only.
 */
export class MockLoggingService implements LoggingService {
  private logger = getLogger().child({ service: 'MockLoggingService' });
  private bus = new SimplePubSub<string, StructuredLog>();
  private buffer = new LogRingBuffer();

  private targetKey(target: LoggingTarget): string {
    return target.kind + ':' + target.id;
  }

  async healthCheck(): Promise<ServiceHealth> {
    return { healthy: true, lastCheck: new Date() };
  }

  async log(target: LoggingTarget, level: SharedLogEntry['level'], message: string, metadata?: Record<string, unknown>): Promise<void> {
  const entry: StructuredLog = {
      timestamp: new Date().toISOString(),
      level,
      service: metadata?.service as string || (target.kind === 'job' ? 'job-runner' : 'deployment'),
      message,
      target,
    };
    this.buffer.push(this.targetKey(target), entry);
    this.bus.emit(this.targetKey(target), entry);
    this.logger.debug('Mock log', { target, level, message });
  }

  onLog(target: LoggingTarget, listener: Listener<StructuredLog>): { unsubscribe(): void } {
    return this.bus.subscribe(this.targetKey(target), listener);
  }

  recentLogs(target: LoggingTarget, limit?: number): StructuredLog[] {
    return this.buffer.recent(this.targetKey(target), limit);
  }

  async logJob(jobId: string, level: SharedLogEntry['level'], message: string, metadata?: Record<string, unknown>): Promise<void> {
    return this.log({ kind: 'job', id: jobId }, level, message, metadata);
  }

  async logDeployment(deploymentId: string, level: SharedLogEntry['level'], message: string, metadata?: Record<string, unknown>): Promise<void> {
    return this.log({ kind: 'deployment', id: deploymentId }, level, message, metadata);
  }
}
