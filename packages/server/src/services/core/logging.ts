/**
 * Logging Service - Phase 5
 * 
 * Provides structured logs for jobs and deployments with in-process pub/sub
 * streaming and optional file persistence via the Phase 1 FileLogger.
 */

import { getLogger } from '../../lib/logger';
import { type HealthCheckable, type ServiceHealth } from '../factory';
import type { StorageService } from './storage';
import { getStorageService } from '../factory';
import { getFileLogger, initializeFileLogger, type LogLevel as FileLogLevel } from '../../lib/file-logger';
import type { LogEntry as SharedLogEntry } from '@hola/shared';

type Listener<T> = (event: T) => void;

export type LoggingTarget = { kind: 'job'; id: string } | { kind: 'deployment'; id: string };

export type StructuredLog = SharedLogEntry & { target: LoggingTarget };

export interface LoggingService extends HealthCheckable {
  log(target: LoggingTarget, level: SharedLogEntry['level'], message: string, metadata?: Record<string, unknown>): Promise<void>;
  onLog(target: LoggingTarget, listener: Listener<StructuredLog>): { unsubscribe(): void };
  // Convenience
  logJob(jobId: string, level: SharedLogEntry['level'], message: string, metadata?: Record<string, unknown>): Promise<void>;
  logDeployment(deploymentId: string, level: SharedLogEntry['level'], message: string, metadata?: Record<string, unknown>): Promise<void>;
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
  private initialized = false;

  constructor(storage?: StorageService) {
    this.storage = storage ?? getStorageService();
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

    // Broadcast first for live subscribers
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
    this.bus.emit(this.targetKey(target), entry);
    this.logger.debug('Mock log', { target, level, message });
  }

  onLog(target: LoggingTarget, listener: Listener<StructuredLog>): { unsubscribe(): void } {
    return this.bus.subscribe(this.targetKey(target), listener);
  }

  async logJob(jobId: string, level: SharedLogEntry['level'], message: string, metadata?: Record<string, unknown>): Promise<void> {
    return this.log({ kind: 'job', id: jobId }, level, message, metadata);
  }

  async logDeployment(deploymentId: string, level: SharedLogEntry['level'], message: string, metadata?: Record<string, unknown>): Promise<void> {
    return this.log({ kind: 'deployment', id: deploymentId }, level, message, metadata);
  }
}
