/**
 * Structured logging with request correlation and multiple output sinks
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  requestId?: string;
  userId?: string;
  service?: string;
  operation?: string;
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error, context?: LogContext): void;
  child(baseContext: LogContext): Logger;
}

class StructuredLogger implements Logger {
  constructor(
    private baseContext: LogContext = {},
    private minLevel: LogLevel = 'info',
    private format: 'json' | 'pretty' = 'json'
  ) {}

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }

  private formatEntry(entry: LogEntry): string {
    if (this.format === 'pretty') {
      const { timestamp, level, message, context, error } = entry;
      const ctx = Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : '';
      const err = error ? ` ERROR: ${error.message}` : '';
      return `[${timestamp}] ${level.toUpperCase()}: ${message}${ctx}${err}`;
    }
    return JSON.stringify(entry);
  }

  private log(level: LogLevel, message: string, error?: Error, context: LogContext = {}): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: { ...this.baseContext, ...context },
      ...(error && {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      }),
    };

    console.log(this.formatEntry(entry));

    // TODO: Add file sink to ~/.hola/logs in Phase 1
    // TODO: Add structured export for observability in later phases
  }

  debug(message: string, context: LogContext = {}): void {
    this.log('debug', message, undefined, context);
  }

  info(message: string, context: LogContext = {}): void {
    this.log('info', message, undefined, context);
  }

  warn(message: string, context: LogContext = {}): void {
    this.log('warn', message, undefined, context);
  }

  error(message: string, error?: Error, context: LogContext = {}): void {
    this.log('error', message, error, context);
  }

  child(baseContext: LogContext): Logger {
    return new StructuredLogger(
      { ...this.baseContext, ...baseContext },
      this.minLevel,
      this.format
    );
  }
}

// Global logger instance
let globalLogger: Logger;

/**
 * Initialize the global logger
 */
export function initializeLogger(minLevel: LogLevel = 'info', format: 'json' | 'pretty' = 'json'): void {
  globalLogger = new StructuredLogger({}, minLevel, format);
}

/**
 * Get the global logger instance
 */
export function getLogger(): Logger {
  if (!globalLogger) {
    initializeLogger();
  }
  return globalLogger;
}

/**
 * Create a logger with specific context
 */
export function createLogger(context: LogContext): Logger {
  return getLogger().child(context);
}
