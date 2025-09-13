import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { SSETestHelper } from './helpers/sse-test-helper';
import type { SSEEvent } from '@hola/shared';

describe('useSSE Hook with Dependency Injection', () => {
  let eventSourceFactory: (url: string) => EventSource;

  beforeEach(() => {
    eventSourceFactory = SSETestHelper.setup();
  });

  afterEach(() => {
    SSETestHelper.cleanup();
  });

  it('should use injected EventSource factory', async () => {
    const { useSSE } = await import('../hooks/useSSE');
    
    const receivedEvents: SSEEvent[] = [];
    const onEvent = (event: SSEEvent) => {
      receivedEvents.push(event);
    };
    
    const { result } = renderHook(() => useSSE(
      'ws://test.com/stream',
      onEvent,
      { eventSourceFactory }
    ));
    
    // Initially should be connecting
    expect(result.current.connectionState).toBe('connecting');
    
    // Verify that our mock EventSource was created
    expect(SSETestHelper.getInstances()).toHaveLength(1);
    expect(SSETestHelper.getLastInstance()?.url).toBe('ws://test.com/stream');
    
    // Simulate connection opening
    await SSETestHelper.simulateOpen();
    
    // Wait for connection to establish
    await waitFor(() => {
      expect(result.current.connectionState).toBe('connected');
    });
    
    expect(result.current.isConnected).toBe(true);
  });

  it('should receive SSE events through injected EventSource', async () => {
    const { useSSE } = await import('../hooks/useSSE');
    
    const receivedEvents: SSEEvent[] = [];
    const onEvent = (event: SSEEvent) => {
      receivedEvents.push(event);
    };
    
    const { result } = renderHook(() => useSSE(
      'ws://test.com/stream',
      onEvent,
      { eventSourceFactory }
    ));
    
    // Open connection
    await SSETestHelper.simulateOpen();
    
    await waitFor(() => {
      expect(result.current.connectionState).toBe('connected');
    });
    
    // Send a log event
    await SSETestHelper.sendLogEvent({
      message: 'Test message',
      level: 'info'
    });
    
    // Verify event was received
    await waitFor(() => {
      expect(receivedEvents).toHaveLength(1);
    });
    
    expect(receivedEvents[0].type).toBe('log');
    expect(receivedEvents[0].data.message).toBe('Test message');
    expect(receivedEvents[0].data.level).toBe('info');
  });

  it('should handle connection errors', async () => {
    const { useSSE } = await import('../hooks/useSSE');
    
    const receivedEvents: SSEEvent[] = [];
    const onEvent = (event: SSEEvent) => {
      receivedEvents.push(event);
    };
    
    const { result } = renderHook(() => useSSE(
      'ws://test.com/stream',
      onEvent,
      { 
        eventSourceFactory,
        reconnect: false // Disable reconnection for this test
      }
    ));
    
    // Simulate connection error
    await SSETestHelper.simulateError();
    
    await waitFor(() => {
      expect(result.current.connectionState).toBe('error');
    });
    
    expect(result.current.isConnected).toBe(false);
    expect(result.current.error).toBeTruthy();
  });

  it('should filter events by type', async () => {
    const { useSSE } = await import('../hooks/useSSE');
    
    const receivedEvents: SSEEvent[] = [];
    const onEvent = (event: SSEEvent) => {
      receivedEvents.push(event);
    };
    
    const { result } = renderHook(() => useSSE(
      'ws://test.com/stream',
      onEvent,
      {
        eventSourceFactory,
        eventTypes: ['log'] // Only log events
      }
    ));
    
    // Open connection
    await SSETestHelper.simulateOpen();
    
    await waitFor(() => {
      expect(result.current.connectionState).toBe('connected');
    });
    
    // Send mixed event types
    await SSETestHelper.sendLogEvent({ message: 'Log event' });
    await SSETestHelper.sendJobUpdateEvent({ 
      jobId: 'test-job', 
      status: 'running', 
      progress: 50 
    });
    await SSETestHelper.sendLogEvent({ message: 'Another log event' });
    
    await waitFor(() => {
      expect(receivedEvents.length).toBe(2);
    });
    
    // Should only receive log events
    expect(receivedEvents.every(event => event.type === 'log')).toBe(true);
    expect(receivedEvents[0].data.message).toBe('Log event');
    expect(receivedEvents[1].data.message).toBe('Another log event');
  });
});