/**
 * File Logger - Phase 1 Observability
 * 
 * Provides file-based logging with rotation and structured output.
 * Built on top of StorageService for file operations.
 */

import { getLogger } from './logger';
import type { StorageService } from '../services/core/storage';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  requestId?: string;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface FileLoggerConfig {
  logDir: string;
  maxFileSize: number; // bytes
  maxFiles: number;
  logLevel: LogLevel;
  format: 'json' | 'text';
  flushInterval: number; // milliseconds
}

export interface FileLogger {
  log(level: LogLevel, message: string, metadata?: Record<string, unknown>): Promise<void>;
  debug(message: string, metadata?: Record<string, unknown>): Promise<void>;
  info(message: string, metadata?: Record<string, unknown>): Promise<void>;
  warn(message: string, metadata?: Record<string, unknown>): Promise<void>;
  error(message: string, error?: Error, metadata?: Record<string, unknown>): Promise<void>;
  flush(): Promise<void>;
  rotate(): Promise<void>;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * Real file logger implementation
 */
export class RealFileLogger implements FileLogger {
  private logger = getLogger().child({ service: 'FileLogger' });
  private storage: StorageService;
  private config: FileLoggerConfig;
  private currentLogFile: string;
  private buffer: LogEntry[] = [];
  private flushTimer?: NodeJS.Timeout;
  private initialized = false;
  // Serializes flush() calls (the 5s timer and synchronous error-level logging
  // both trigger it) so they can't interleave and drop already-drained entries.
  private flushChain: Promise<void> = Promise.resolve();

  private readonly levelPriorities: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(storage: StorageService, config?: Partial<FileLoggerConfig>) {
    this.storage = storage;
    this.config = {
      logDir: storage.resolveHolaPath('logs'),
      maxFileSize: 50 * 1024 * 1024, // 50MB
      maxFiles: 10,
      logLevel: 'info',
      format: 'json',
      flushInterval: 5000, // 5 seconds
      ...config,
    };
    
    this.currentLogFile = this.getCurrentLogFileName();
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.info('Initializing file logger', {
      logDir: this.config.logDir,
      maxFileSize: this.config.maxFileSize,
      maxFiles: this.config.maxFiles,
      logLevel: this.config.logLevel,
    });

    try {
      // Ensure log directory exists
      await this.storage.ensureDir(this.config.logDir);

      // Start flush timer
      this.startFlushTimer();

      this.initialized = true;
      this.logger.info('File logger initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize file logger', error as Error);
      throw error;
    }
  }

  async log(level: LogLevel, message: string, metadata?: Record<string, unknown>): Promise<void> {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: metadata?.service as string || 'unknown',
      message,
      requestId: metadata?.requestId as string,
      metadata: metadata ? { ...metadata } : undefined,
    };

    // Remove service and requestId from metadata to avoid duplication
    if (entry.metadata) {
      delete entry.metadata.service;
      delete entry.metadata.requestId;
      if (Object.keys(entry.metadata).length === 0) {
        entry.metadata = undefined;
      }
    }

    this.buffer.push(entry);

    // Immediate flush for error level
    if (level === 'error') {
      await this.flush();
    }
  }

  async debug(message: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.log('debug', message, metadata);
  }

  async info(message: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.log('info', message, metadata);
  }

  async warn(message: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.log('warn', message, metadata);
  }

  async error(message: string, error?: Error, metadata?: Record<string, unknown>): Promise<void> {
    const errorMetadata = error ? {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      ...metadata,
    } : metadata;

    await this.log('error', message, errorMetadata);
  }

  async flush(): Promise<void> {
    // Chain onto the previous flush so only one runs at a time; keep the chain
    // alive even if a flush rejects (catch on the stored chain) so one failure
    // doesn't wedge every future flush. The caller still observes this flush's
    // result via `run`.
    const run = this.flushChain.then(() => this.doFlush());
    this.flushChain = run.catch(() => {});
    return run;
  }

  private async doFlush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    const entries = [...this.buffer];
    this.buffer = [];

    try {
      const content = this.formatEntries(entries);

      // Check if rotation is needed
      await this.checkRotation();

      // Append to the current log file rather than read-modify-write the whole
      // file: O(append) instead of O(file size) per flush, and no read-then-write
      // window for a concurrent flush to clobber (flushes are also serialized).
      const logFilePath = this.storage.resolveHolaPath('logs', this.currentLogFile);
      await this.storage.appendFile(logFilePath, content);

      this.logger.debug('Log entries flushed', {
        count: entries.length,
        file: this.currentLogFile
      });
    } catch (error) {
      this.logger.error('Failed to flush log entries', error as Error);
      // Keep entries in buffer for retry
      this.buffer.unshift(...entries);
    }
  }

  async rotate(): Promise<void> {
    this.logger.info('Rotating log file', { currentFile: this.currentLogFile });

    try {
      // Flush any pending entries
      await this.flush();

      // Generate new log file name
      this.currentLogFile = this.getCurrentLogFileName();

      // Clean up old log files
      await this.cleanupOldLogs();

      this.logger.info('Log rotation completed', { newFile: this.currentLogFile });
    } catch (error) {
      this.logger.error('Log rotation failed', error as Error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down file logger');

    // Stop flush timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }

    // Flush any remaining entries
    await this.flush();

    this.initialized = false;
    this.logger.info('File logger shutdown completed');
  }

  private shouldLog(level: LogLevel): boolean {
    const messagePriority = this.levelPriorities[level];
    const configPriority = this.levelPriorities[this.config.logLevel];
    return messagePriority >= configPriority;
  }

  private formatEntries(entries: LogEntry[]): string {
    if (this.config.format === 'json') {
      return entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
    } else {
      return entries.map(entry => {
        const timestamp = entry.timestamp;
        const level = entry.level.toUpperCase().padEnd(5);
        const service = `[${entry.service}]`.padEnd(15);
        const requestId = entry.requestId ? `[${entry.requestId}]` : '';
        return `${timestamp} ${level} ${service} ${requestId} ${entry.message}`;
      }).join('\n') + '\n';
    }
  }

  private getCurrentLogFileName(): string {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
    return `hola-${dateStr}-${timeStr}.log`;
  }

  private async checkRotation(): Promise<void> {
    const logFilePath = this.storage.resolveHolaPath('logs', this.currentLogFile);
    
    if (await this.storage.fileExists(logFilePath)) {
      const metadata = await this.storage.getMetadata(logFilePath);
      if (metadata.size >= this.config.maxFileSize) {
        await this.rotate();
      }
    }
  }

  private async cleanupOldLogs(): Promise<void> {
    try {
      const logFiles = await this.storage.listDir(this.config.logDir);
      const holaLogFiles = logFiles
        .filter(file => file.startsWith('hola-') && file.endsWith('.log'))
        .sort()
        .reverse(); // Newest first

      // Keep only the specified number of files
      const filesToDelete = holaLogFiles.slice(this.config.maxFiles);
      
      for (const file of filesToDelete) {
        const filePath = this.storage.resolveHolaPath('logs', file);
        await this.storage.deleteFile(filePath);
        this.logger.debug('Deleted old log file', { file });
      }

      if (filesToDelete.length > 0) {
        this.logger.info('Cleaned up old log files', { deleted: filesToDelete.length });
      }
    } catch (error) {
      this.logger.error('Failed to cleanup old logs', error as Error);
    }
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch(error => {
        this.logger.error('Scheduled flush failed', error as Error);
      });
    }, this.config.flushInterval);
  }
}

/**
 * Mock file logger for testing/fallback
 */
export class MockFileLogger implements FileLogger {
  private logger = getLogger().child({ service: 'MockFileLogger' });
  private logs: LogEntry[] = [];

  async initialize(): Promise<void> {
    this.logger.info('Mock file logger initialized');
  }

  async log(level: LogLevel, message: string, metadata?: Record<string, unknown>): Promise<void> {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: metadata?.service as string || 'unknown',
      message,
      requestId: metadata?.requestId as string,
      metadata,
    };

    this.logs.push(entry);
    this.logger.debug('Mock log entry added', { level, message });
  }

  async debug(message: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.log('debug', message, metadata);
  }

  async info(message: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.log('info', message, metadata);
  }

  async warn(message: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.log('warn', message, metadata);
  }

  async error(message: string, error?: Error, metadata?: Record<string, unknown>): Promise<void> {
    const errorMetadata = error ? {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      ...metadata,
    } : metadata;

    await this.log('error', message, errorMetadata);
  }

  async flush(): Promise<void> {
    // Mock implementation - no-op
  }

  async rotate(): Promise<void> {
    this.logger.debug('Mock log rotation');
  }

  async shutdown(): Promise<void> {
    this.logger.info('Mock file logger shutdown');
  }

  // Testing helper
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  clearLogs(): void {
    this.logs = [];
  }
}

/**
 * Initialize global file logger instance
 */
let globalFileLogger: FileLogger | undefined;

export function initializeFileLogger(storage: StorageService, config?: Partial<FileLoggerConfig>): FileLogger {
  if (globalFileLogger) {
    return globalFileLogger;
  }

  globalFileLogger = new RealFileLogger(storage, config);
  globalFileLogger.initialize().catch(error => {
    const logger = getLogger().child({ service: 'FileLoggerInit' });
    logger.error('Failed to initialize file logger', error as Error);
  });
  
  return globalFileLogger;
}

export function getFileLogger(): FileLogger | undefined {
  return globalFileLogger;
}

export function shutdownFileLogger(): Promise<void> {
  if (globalFileLogger) {
    return globalFileLogger.shutdown();
  }
  return Promise.resolve();
}
