import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { SSEEvent } from '@hola/shared';

// Mock environment for testing
const originalFetch = global.fetch;
const originalEventSource = global.EventSource;

// Mock EventSource for testing
class MockEventSource {
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public readyState = 0; // CONNECTING
  
  constructor(public url: string) {
    // Simulate connection opening
    setTimeout(() => {
      this.readyState = 1; // OPEN
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
      
      // Send test messages
      this.sendTestMessages();
    }, 100);
  }
  
  private sendTestMessages() {
    let count = 0;
    const interval = setInterval(() => {
      count++;
      if (this.onmessage && this.readyState === 1) {
        const testEvent = {
          type: 'log',
          data: {
            timestamp: new Date().toISOString(),
            service: 'test-service',
            level: 'info',
            message: `Test log message ${count}`
          }
        };
        
        const messageEvent = new MessageEvent('message', {
          data: JSON.stringify(testEvent)
        });
        
        this.onmessage(messageEvent);
      }
      
      if (count >= 3) {
        clearInterval(interval);
      }
    }, 500);
  }
  
  close() {
    this.readyState = 2; // CLOSED
  }
}

describe('Real-Time Features - SSE Implementation', () => {
  beforeAll(() => {
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

  afterAll(() => {
    global.fetch = originalFetch;
    global.EventSource = originalEventSource;
  });

  it('should establish SSE connection and receive log events', async () => {
    const { useLogsSSE } = await import('../hooks/useSSE');
    const { renderHook, waitFor } = await import('@testing-library/react');
    
    const { result } = renderHook(() => useLogsSSE(undefined, 'test-job-1'));
    
    // Initially should be connecting
    expect(result.current.connectionState).toBe('connecting');
    
    // Wait for connection to establish
    await waitFor(() => {
      expect(result.current.connectionState).toBe('connected');
    }, { timeout: 1000 });
    
    expect(result.current.isConnected).toBe(true);
    
    // Wait for log messages
    await waitFor(() => {
      expect(result.current.logs.length).toBeGreaterThan(0);
    }, { timeout: 2000 });
    
    // Verify log structure
    const firstLog = result.current.logs[0];
    expect(firstLog).toHaveProperty('timestamp');
    expect(firstLog).toHaveProperty('service', 'test-service');
    expect(firstLog).toHaveProperty('level', 'info');
    expect(firstLog).toHaveProperty('message');
    expect(firstLog.message).toContain('Test log message');
  });

  it('should handle SSE connection errors gracefully', async () => {
    // Mock EventSource that fails
    global.EventSource = class extends MockEventSource {
      constructor(url: string) {
        super(url);
        setTimeout(() => {
          this.readyState = 2; // CLOSED
          if (this.onerror) {
            this.onerror(new Event('error'));
          }
        }, 100);
      }
    } as unknown as typeof EventSource;
    
    const { useLogsSSE } = await import('../hooks/useSSE');
    const { renderHook, waitFor } = await import('@testing-library/react');
    
    const { result } = renderHook(() => useLogsSSE(undefined, 'test-job-1'));
    
    await waitFor(() => {
      expect(result.current.connectionState).toBe('error');
    }, { timeout: 1000 });
    
    expect(result.current.isConnected).toBe(false);
    expect(result.current.error).toBeTruthy();
  });

  it('should update job progress via live updates hook', async () => {
    const { useLiveJobUpdates } = await import('../hooks/useLiveUpdates');
    const { renderHook, waitFor } = await import('@testing-library/react');
    
    const { result } = renderHook(() => useLiveJobUpdates('test-job-1'));
    
    // Should eventually load job data
    await waitFor(() => {
      expect(result.current.status).toBeTruthy();
    }, { timeout: 2000 });
    
    expect(result.current.status).toBe('running');
    expect(result.current.progress).toBe(50);
  });

  it('should monitor system status with live updates', async () => {
    const { useLiveSystemStatus } = await import('../hooks/useLiveUpdates');
    const { renderHook, waitFor } = await import('@testing-library/react');
    
    const { result } = renderHook(() => useLiveSystemStatus());
    
    // Should eventually load system status
    await waitFor(() => {
      expect(result.current.systemStatus).toBeTruthy();
    }, { timeout: 2000 });
    
    expect(result.current.systemStatus?.docker.ok).toBe(true);
    expect(result.current.systemStatus?.docker.version).toBe('24.0.5');
    expect(result.current.systemStatus?.disk.totalBytes).toBe(100_000_000_000);
  });

  it('should provide comprehensive dashboard live updates', async () => {
    const { useLiveDashboard } = await import('../hooks/useLiveUpdates');
    const { renderHook, waitFor } = await import('@testing-library/react');
    
    const { result } = renderHook(() => useLiveDashboard());
    
    // Should load dashboard data
    await waitFor(() => {
      expect(result.current.systemStatus).toBeTruthy();
    }, { timeout: 2000 });
    
    expect(result.current.systemStatus?.docker.ok).toBe(true);
    expect(result.current.refreshTrigger).toBeGreaterThanOrEqual(0);
  });
});

describe('SSE Event Types', () => {
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
});

describe('StrictMode Compatibility', () => {
  it('should handle React StrictMode double-execution gracefully', async () => {
    const { useLogsSSE } = await import('../hooks/useSSE');
    const { renderHook, waitFor } = await import('@testing-library/react');
    
    // Simulate StrictMode by rendering twice
    const { result: result1 } = renderHook(() => useLogsSSE(undefined, 'test-job-1'));
    const { result: result2 } = renderHook(() => useLogsSSE(undefined, 'test-job-1'));
    
    // Both should work independently
    await waitFor(() => {
      expect(result1.current.connectionState).toBe('connected');
      expect(result2.current.connectionState).toBe('connected');
    }, { timeout: 1000 });
    
    expect(result1.current.isConnected).toBe(true);
    expect(result2.current.isConnected).toBe(true);
  });
});
