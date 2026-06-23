/**
 * Basic metrics collection for observability
 * 
 * Provides counters, timers, and gauges for monitoring system health
 * and performance. Extensible for OpenTelemetry integration later.
 */

export interface MetricLabels {
  [key: string]: string | number;
}

export interface Counter {
  increment(labels?: MetricLabels): void;
  get(labels?: MetricLabels): number;
}

export interface Timer {
  start(): () => void; // Returns function to end timer
  record(duration: number, labels?: MetricLabels): void;
  getStats(labels?: MetricLabels): { count: number; sum: number; avg: number };
}

export interface Gauge {
  set(value: number, labels?: MetricLabels): void;
  get(labels?: MetricLabels): number;
}

export interface Metrics {
  counter(name: string): Counter;
  timer(name: string): Timer;
  gauge(name: string): Gauge;
  getAll(): Record<string, unknown>;
  reset(): void;
}

class InMemoryMetrics implements Metrics {
  private counters = new Map<string, Map<string, number>>();
  private timers = new Map<string, Map<string, { count: number; sum: number }>>();
  private gauges = new Map<string, Map<string, number>>();

  private getLabelKey(labels?: MetricLabels): string {
    if (!labels) return '_default';
    return JSON.stringify(labels);
  }

  counter(name: string): Counter {
    if (!this.counters.has(name)) {
      this.counters.set(name, new Map());
    }
    
    const counterMap = this.counters.get(name)!;
    
    return {
      increment: (labels?: MetricLabels) => {
        const key = this.getLabelKey(labels);
        const current = counterMap.get(key) || 0;
        counterMap.set(key, current + 1);
      },
      get: (labels?: MetricLabels) => {
        const key = this.getLabelKey(labels);
        return counterMap.get(key) || 0;
      }
    };
  }

  timer(name: string): Timer {
    if (!this.timers.has(name)) {
      this.timers.set(name, new Map());
    }
    
    const timerMap = this.timers.get(name)!;
    
    return {
      start: () => {
        const startTime = Date.now();
        return () => {
          const duration = Date.now() - startTime;
          this.timer(name).record(duration);
        };
      },
      record: (duration: number, labels?: MetricLabels) => {
        const key = this.getLabelKey(labels);
        const current = timerMap.get(key) || { count: 0, sum: 0 };
        timerMap.set(key, {
          count: current.count + 1,
          sum: current.sum + duration
        });
      },
      getStats: (labels?: MetricLabels) => {
        const key = this.getLabelKey(labels);
        const stats = timerMap.get(key) || { count: 0, sum: 0 };
        return {
          ...stats,
          avg: stats.count > 0 ? stats.sum / stats.count : 0
        };
      }
    };
  }

  gauge(name: string): Gauge {
    if (!this.gauges.has(name)) {
      this.gauges.set(name, new Map());
    }
    
    const gaugeMap = this.gauges.get(name)!;
    
    return {
      set: (value: number, labels?: MetricLabels) => {
        const key = this.getLabelKey(labels);
        gaugeMap.set(key, value);
      },
      get: (labels?: MetricLabels) => {
        const key = this.getLabelKey(labels);
        return gaugeMap.get(key) || 0;
      }
    };
  }

  getAll(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    
    // Export counters with parsed labels
    for (const [name, counterMap] of this.counters) {
      const counterData: Record<string, unknown> = {};
      for (const [key, value] of counterMap) {
        const labelKey = key === '_default' ? 'total' : key;
        try {
          // Try to parse JSON labels back to readable format
          const labels = JSON.parse(labelKey);
          const readableKey = Object.entries(labels)
            .map(([k, v]) => `${k}=${v}`)
            .join(',');
          counterData[readableKey] = value;
        } catch {
          // If not JSON, use the key as-is
          counterData[labelKey] = value;
        }
      }
      result[name] = counterData;
    }
    
    // Export timers with parsed labels
    for (const [name, timerMap] of this.timers) {
      const timerData: Record<string, unknown> = {};
      for (const [key, value] of timerMap) {
        const labelKey = key === '_default' ? 'total' : key;
        try {
          // Try to parse JSON labels back to readable format
          const labels = JSON.parse(labelKey);
          const readableKey = Object.entries(labels)
            .map(([k, v]) => `${k}=${v}`)
            .join(',');
          timerData[readableKey] = {
            ...value,
            avg: value.count > 0 ? value.sum / value.count : 0
          };
        } catch {
          // If not JSON, use the key as-is
          timerData[labelKey] = {
            ...value,
            avg: value.count > 0 ? value.sum / value.count : 0
          };
        }
      }
      result[name] = timerData;
    }
    
    // Export gauges with parsed labels
    for (const [name, gaugeMap] of this.gauges) {
      const gaugeData: Record<string, unknown> = {};
      for (const [key, value] of gaugeMap) {
        const labelKey = key === '_default' ? 'current' : key;
        try {
          // Try to parse JSON labels back to readable format
          const labels = JSON.parse(labelKey);
          const readableKey = Object.entries(labels)
            .map(([k, v]) => `${k}=${v}`)
            .join(',');
          gaugeData[readableKey] = value;
          // Also export simplified keys when labels contain a single 'type'
          if (labels && typeof labels === 'object' && 'type' in labels && Object.keys(labels).length === 1) {
            const simpleKey = `type=${(labels as Record<string, unknown>).type}`;
            gaugeData[simpleKey] = value;
          }
        } catch {
          // If not JSON, use the key as-is
          gaugeData[labelKey] = value;
        }
      }
      result[name] = gaugeData;
    }
    
    return result;
  }

  reset(): void {
    this.counters.clear();
    this.timers.clear();
    this.gauges.clear();
  }
}

// Global metrics instance
let globalMetrics: Metrics;

/**
 * Initialize the global metrics system
 */
export function initializeMetrics(): void {
  globalMetrics = new InMemoryMetrics();
  
  // Initialize standard metrics
  const memoryUsage = globalMetrics.gauge('memory_usage');
  
  // Track process metrics
  setInterval(() => {
    const memStats = process.memoryUsage();
    memoryUsage.set(memStats.heapUsed, { type: 'heap_used' });
    memoryUsage.set(memStats.heapTotal, { type: 'heap_total' });
    memoryUsage.set(memStats.external, { type: 'external' });
    memoryUsage.set(memStats.rss, { type: 'rss' });
  }, 10000); // Every 10 seconds
}

/**
 * Get the global metrics instance
 */
export function getMetrics(): Metrics {
  if (!globalMetrics) {
    initializeMetrics();
  }
  return globalMetrics;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEPLOY_ID_RE = /^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/i; // slug + 8 hex (makeDeploymentId)
const JOB_ID_RE = /^job_\d+_[a-z0-9]+$/i;
const HEX_ID_RE = /^[0-9a-f]{12,}$/i;

/**
 * Collapse per-resource identifiers (deployment/draft/job ids, UUIDs, numbers)
 * in a request path to placeholders, so the path used as a metric label has
 * BOUNDED cardinality. Without this, every distinct id mints a permanent new
 * label series in the (never-evicted) counter/timer maps — an unbounded memory
 * leak that an attacker hitting random paths could amplify.
 */
export function templateMetricPath(path: string): string {
  return path
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      if (/^\d+$/.test(seg)) return ':n';
      if (UUID_RE.test(seg) || DEPLOY_ID_RE.test(seg) || JOB_ID_RE.test(seg) || HEX_ID_RE.test(seg)) {
        return ':id';
      }
      return seg;
    })
    .join('/');
}

/**
 * Standard metrics for HTTP requests
 */
export function recordHttpRequest(method: string, path: string, status: number, duration: number): void {
  const metrics = getMetrics();
  const templatedPath = templateMetricPath(path);

  metrics.counter('http_requests').increment({
    method,
    path: templatedPath,
    status: status.toString(),
    status_class: `${Math.floor(status / 100)}xx`
  });

  metrics.timer('http_request_duration').record(duration, {
    method,
    path: templatedPath,
    status: status.toString()
  });
}

/**
 * Health metrics
 */
export function recordHealthCheck(component: string, healthy: boolean): void {
  const metrics = getMetrics();
  
  metrics.counter('health_checks').increment({
    component,
    status: healthy ? 'healthy' : 'unhealthy'
  });
}

/**
 * Service activation metrics
 */
export function recordServiceActivation(service: string, mode: 'real' | 'mock', success: boolean): void {
  const metrics = getMetrics();
  
  metrics.counter('service_activations').increment({
    service,
    mode,
    result: success ? 'success' : 'fallback'
  });
}

/**
 * Error metrics
 */
export function recordErrorMetric(errorCode: string, statusCode: number): void {
  const metrics = getMetrics();
  
  metrics.counter('errors').increment({
    code: errorCode,
    status: statusCode.toString(),
    status_class: `${Math.floor(statusCode / 100)}xx`
  });
}
