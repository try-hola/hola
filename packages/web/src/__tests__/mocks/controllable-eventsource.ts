/**
 * Controllable EventSource mock for deterministic testing.
 * Provides full control over connection state and event emission.
 */

export interface ControllableEventSourceInstance {
  url: string;
  readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
  
  // Test control methods
  simulateOpen(): void;
  simulateMessage(data: string): void;
  simulateError(): void;
  simulateClose(): void;
}

export interface ControllableEventSourceController {
  getInstances(): ControllableEventSourceInstance[];
  getLastInstance(): ControllableEventSourceInstance | null;
  simulateOpenAll(): void;
  simulateMessageAll(data: string): void;
  simulateErrorAll(): void;
  simulateCloseAll(): void;
  reset(): void;
}

class ControllableEventSourceImpl implements ControllableEventSourceInstance {
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public readyState = 0; // CONNECTING

  constructor(
    public url: string,
    private controller: ControllableEventSourceControllerImpl
  ) {
    this.controller.addInstance(this);
  }

  close(): void {
    this.readyState = 2; // CLOSED
  }

  // Test control methods
  simulateOpen(): void {
    this.readyState = 1; // OPEN
    if (this.onopen) {
      this.onopen(new Event('open'));
    }
  }

  simulateMessage(data: string): void {
    if (this.readyState === 1 && this.onmessage) {
      const messageEvent = new MessageEvent('message', { data });
      this.onmessage(messageEvent);
    }
  }

  simulateError(): void {
    this.readyState = 2; // CLOSED
    if (this.onerror) {
      this.onerror(new Event('error'));
    }
  }

  simulateClose(): void {
    this.readyState = 2; // CLOSED
  }
}

class ControllableEventSourceControllerImpl implements ControllableEventSourceController {
  private instances: ControllableEventSourceImpl[] = [];

  addInstance(instance: ControllableEventSourceImpl): void {
    this.instances.push(instance);
  }

  getInstances(): ControllableEventSourceInstance[] {
    return [...this.instances];
  }

  getLastInstance(): ControllableEventSourceInstance | null {
    return this.instances[this.instances.length - 1] || null;
  }

  simulateOpenAll(): void {
    this.instances.forEach(instance => instance.simulateOpen());
  }

  simulateMessageAll(data: string): void {
    this.instances.forEach(instance => instance.simulateMessage(data));
  }

  simulateErrorAll(): void {
    this.instances.forEach(instance => instance.simulateError());
  }

  simulateCloseAll(): void {
    this.instances.forEach(instance => instance.simulateClose());
  }

  reset(): void {
    this.instances.forEach(instance => instance.close());
    this.instances = [];
  }
}

// Global controller instance
const globalController = new ControllableEventSourceControllerImpl();

// Mock EventSource constructor that creates controllable instances
export const ControllableEventSource = function(this: ControllableEventSourceInstance, url: string) {
  const instance = new ControllableEventSourceImpl(url, globalController);
  
  // Copy properties to 'this' to match EventSource behavior
  Object.assign(this, instance);
  
  return instance;
} as new (url: string) => ControllableEventSourceInstance & {
  readonly CONNECTING: 0;
  readonly OPEN: 1;
  readonly CLOSED: 2;
};

// Add static constants
ControllableEventSource.CONNECTING = 0;
ControllableEventSource.OPEN = 1;
ControllableEventSource.CLOSED = 2;

// Export the controller for test use
export const eventSourceController = globalController;

// Helper function to create SSE event data
export function createSSEEventData(event: Record<string, unknown>): string {
  return JSON.stringify(event);
}

// Common SSE event creators for tests
export const SSEEventCreators = {
  log: (data: {
    timestamp?: string;
    service?: string;
    level?: string;
    message: string;
  }) => createSSEEventData({
    type: 'log',
    data: {
      timestamp: data.timestamp || new Date().toISOString(),
      service: data.service || 'test-service',
      level: data.level || 'info',
      message: data.message,
    },
  }),

  jobUpdate: (data: {
    jobId: string;
    status: string;
    progress?: number;
    finishedAt?: string;
  }) => createSSEEventData({
    type: 'job_update',
    data,
  }),

  systemUpdate: (data: Record<string, unknown>) => createSSEEventData({
    type: 'system_update',
    data,
  }),

  deploymentUpdate: (data: {
    deploymentId: string;
    status: string;
    uptime?: string;
    lastUpdated?: string;
  }) => createSSEEventData({
    type: 'deployment_update',
    data: {
      ...data,
      lastUpdated: data.lastUpdated || new Date().toISOString(),
    },
  }),
};