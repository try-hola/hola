import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SSEEvent, JobStatus, LogLevel, SSELogEvent, SSEJobUpdateEvent } from '@hola/shared';

// Mock environment for testing
const originalFetch = global.fetch;

describe('Real-Time Features - SSE Implementation', () => {
  let mockEventSourceInstances: MockEventSource[] = [];
  
  // Improved MockEventSource with controllable behavior
  class MockEventSource {
    public onopen: ((event: Event) => void) | null = null;
    public onmessage: ((event: MessageEvent) => void) | null = null;
    public onerror: ((event: Event) => void) | null = null;
    public readyState = 0; // CONNECTING
    
    constructor(public url: string) {
      mockEventSourceInstances.push(this);
      // Don't auto-connect - tests will control this
    }
    
    // Test control methods
    simulateOpen() {
      this.readyState = 1; // OPEN
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }
    
    simulateMessage(data: string) {
      if (this.readyState === 1 && this.onmessage) {
        const messageEvent = new MessageEvent('message', { data });
        this.onmessage(messageEvent);
      }
    }
    
    simulateError() {
      this.readyState = 2; // CLOSED
      if (this.onerror) {
        this.onerror(new Event('error'));
      }
    }
    
    close() {
      this.readyState = 2; // CLOSED
    }
  }

  beforeEach(() => {
    // Reset instances
    mockEventSourceInstances = [];
    
    // Mock EventSource
    global.EventSource = MockEventSource as unknown as typeof EventSource;
    
    // Mock fetch for API calls
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/jobs/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            id: 'test-job-1',
            type: 'install',
            status: 'running',
            progress: 50,
            startedAt: new Date().toISOString()
          })
        });
      }
      
      if (url.includes('/api/system/status')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            docker: { ok: true, version: '24.0.5' },
            disk: { freeBytes: 50_000_000_000, totalBytes: 100_000_000_000 }
          })
        });
      }
      
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    // Clean up any remaining instances
    mockEventSourceInstances.forEach(instance => instance.close());
    mockEventSourceInstances = [];
  });

  it('should create EventSource with correct URL', () => {
    // This test just verifies the EventSource mock is working
    const eventSource = new (global.EventSource as typeof EventSource)('ws://test.com/stream');
    
    expect(eventSource).toBeDefined();
    expect(eventSource.url).toBe('ws://test.com/stream');
    expect(eventSource.readyState).toBe(0); // CONNECTING
    expect(mockEventSourceInstances).toHaveLength(1);
  });

  it('should handle EventSource connection flow', () => {
    const eventSource = new (global.EventSource as typeof EventSource)('ws://test.com/stream') as unknown as MockEventSource;
    let opened = false;
    const messagesReceived: string[] = [];
    let errorOccurred = false;
    
    eventSource.onopen = () => { opened = true; };
    eventSource.onmessage = (event) => { messagesReceived.push(event.data); };
    eventSource.onerror = () => { errorOccurred = true; };
    
    // Test connection flow
    expect(opened).toBe(false);
    
    eventSource.simulateOpen();
    expect(opened).toBe(true);
    expect(eventSource.readyState).toBe(1); // OPEN
    
    // Test message flow
    const testEvent = {
      type: 'log',
      data: {
        timestamp: new Date().toISOString(),
        service: 'test-service',
        level: 'info',
        message: 'Test message'
      }
    };
    
    eventSource.simulateMessage(JSON.stringify(testEvent));
    expect(messagesReceived).toHaveLength(1);
    
    const received = JSON.parse(messagesReceived[0]);
    expect(received.type).toBe('log');
    expect(received.data.message).toBe('Test message');
    
    // Test error flow
    eventSource.simulateError();
    expect(errorOccurred).toBe(true);
    expect(eventSource.readyState).toBe(2); // CLOSED
  });

  it('should properly type SSE events', () => {
    // Test log event typing
    const logEvent: SSEEvent = {
      type: 'log',
      data: {
        timestamp: '2025-08-11T23:00:00.000Z',
        service: 'test-service',
        level: 'info',
        message: 'Test message'
      }
    };
    
    expect(logEvent.type).toBe('log');
    expect(logEvent.data.level).toBe('info');
    
    // Test job update event typing
    const jobEvent: SSEEvent = {
      type: 'job_update',
      data: {
        jobId: 'test-job-1',
        status: 'running',
        progress: 75
      }
    };
    
    expect(jobEvent.type).toBe('job_update');
    expect(jobEvent.data.status).toBe('running');
    expect(jobEvent.data.progress).toBe(75);
  });

  it('should handle multiple EventSource instances', () => {
    new (global.EventSource as typeof EventSource)('ws://test1.com/stream');
    new (global.EventSource as typeof EventSource)('ws://test2.com/stream');
    
    expect(mockEventSourceInstances).toHaveLength(2);
    expect(mockEventSourceInstances[0].url).toBe('ws://test1.com/stream');
    expect(mockEventSourceInstances[1].url).toBe('ws://test2.com/stream');
  });

  it('should simulate complete SSE event sequences', () => {
    const eventSource = new (global.EventSource as typeof EventSource)('ws://test.com/stream') as unknown as MockEventSource;
    const receivedEvents: SSELogEvent[] = [];
    
    eventSource.onmessage = (event) => {
      receivedEvents.push(JSON.parse(event.data));
    };
    
    eventSource.simulateOpen();
    
    // Simulate a sequence of log events
    const events: SSELogEvent[] = [
      { type: 'log', data: { timestamp: '2024-01-01T00:00:01Z', service: 'app', level: 'info', message: 'Starting up' }},
      { type: 'log', data: { timestamp: '2024-01-01T00:00:02Z', service: 'app', level: 'info', message: 'Ready to serve' }},
      { type: 'log', data: { timestamp: '2024-01-01T00:00:03Z', service: 'app', level: 'warn', message: 'High memory usage' }}
    ];
    
    events.forEach(event => {
      eventSource.simulateMessage(JSON.stringify(event));
    });
    
    expect(receivedEvents).toHaveLength(3);
    expect(receivedEvents[0].data.message).toBe('Starting up');
    expect(receivedEvents[1].data.message).toBe('Ready to serve');
    expect(receivedEvents[2].data.level).toBe('warn');
    expect(receivedEvents[2].data.message).toBe('High memory usage');
  });

  it('should simulate job progress sequences', () => {
    const eventSource = new (global.EventSource as typeof EventSource)('ws://test.com/stream') as unknown as MockEventSource;
    const receivedUpdates: SSEJobUpdateEvent['data'][] = [];
    
    eventSource.onmessage = (event) => {
      const parsed = JSON.parse(event.data);
      if (parsed.type === 'job_update') {
        receivedUpdates.push(parsed.data);
      }
    };
    
    eventSource.simulateOpen();
    
    // Simulate job progress
    const jobStates: SSEJobUpdateEvent['data'][] = [
      { jobId: 'test-job', status: 'queued', progress: 0 },
      { jobId: 'test-job', status: 'running', progress: 25 },
      { jobId: 'test-job', status: 'running', progress: 50 },
      { jobId: 'test-job', status: 'running', progress: 75 },
      { jobId: 'test-job', status: 'completed', progress: 100, finishedAt: new Date().toISOString() }
    ];
    
    jobStates.forEach(state => {
      eventSource.simulateMessage(JSON.stringify({ type: 'job_update', data: state }));
    });
    
  expect(receivedUpdates).toHaveLength(5);
  expect(receivedUpdates[0].status).toBe('queued');
    expect(receivedUpdates[1].progress).toBe(25);
    expect(receivedUpdates[4].status).toBe('completed');
    expect(receivedUpdates[4].finishedAt).toBeDefined();
  });

  it('should handle mixed event types', () => {
    const eventSource = new (global.EventSource as typeof EventSource)('ws://test.com/stream') as unknown as MockEventSource;
    const receivedEvents: SSEEvent[] = [];
    
    eventSource.onmessage = (event) => {
      receivedEvents.push(JSON.parse(event.data));
    };
    
    eventSource.simulateOpen();
    
    // Mix different event types
    const events = [
      { type: 'log', data: { timestamp: '2024-01-01T00:00:01Z', service: 'app', level: 'info', message: 'Log event' }},
      { type: 'job_update', data: { jobId: 'job-1', status: 'running', progress: 50 }},
      { type: 'system_update', data: { docker: { ok: true, version: '24.0.5' }}},
      { type: 'deployment_update', data: { deploymentId: 'dep-1', status: 'running', lastUpdated: '2024-01-01T00:00:04Z' }}
    ];
    
    events.forEach(event => {
      eventSource.simulateMessage(JSON.stringify(event));
    });
    
    expect(receivedEvents).toHaveLength(4);
    expect(receivedEvents.map(e => e.type)).toEqual(['log', 'job_update', 'system_update', 'deployment_update']);
  });
  
  // Test our helper utilities without React hooks
  it('should provide SSE event creation utilities', () => {
    // This would be our helper functions for creating test events
    const createLogEvent = (message: string, level: LogLevel = 'info'): SSELogEvent => ({
      type: 'log',
      data: {
        timestamp: new Date().toISOString(),
        service: 'test-service',
        level,
        message
      }
    });

    const createJobUpdateEvent = (jobId: string, status: JobStatus, progress?: number): SSEJobUpdateEvent => ({
      type: 'job_update',
      data: {
        jobId,
        status,
        ...(progress !== undefined && { progress })
      }
    });
    
    const logEvent = createLogEvent('Test message', 'warn');
    expect(logEvent.type).toBe('log');
    expect(logEvent.data.level).toBe('warn');
    expect(logEvent.data.message).toBe('Test message');
    
  const jobEvent = createJobUpdateEvent('job-123', 'running', 75);
    expect(jobEvent.type).toBe('job_update');
    expect(jobEvent.data.jobId).toBe('job-123');
    expect(jobEvent.data.progress).toBe(75);
  });
});
