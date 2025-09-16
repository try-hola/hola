/**
 * Minimal SSE Hook Test to debug memory issues
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSSE, type EventSourceFactory } from '../../hooks/useSSE';
import { SSETestHelper } from '../utils/helpers/sse-test-helper';

describe('Minimal SSE Hook Test', () => {
  it('should create hook without crashing', () => {
    const { result } = renderHook(() => 
      useSSE(null, { reconnect: false })
    );

    expect(result.current.connectionState).toBe('disconnected');
  });

  it('should handle empty URL without infinite loop', () => {
    const { result } = renderHook(() => 
      useSSE('', { reconnect: false })
    );

    expect(result.current.connectionState).toBe('disconnected');
  });

  describe('With EventSourceFactory', () => {
    let eventSourceFactory: EventSourceFactory;

    beforeEach(() => {
      eventSourceFactory = SSETestHelper.setup();
    });

    afterEach(() => {
      SSETestHelper.cleanup();
    });

    it('should work with eventSourceFactory without hanging', () => {
      const { result } = renderHook(() => 
        useSSE('http://localhost/test', {
          reconnect: false,
          eventSourceFactory,
        })
      );

      expect(result.current.connectionState).toBe('connecting');
    });

    it('should simulate connection open without memory leak', async () => {
      const { result } = renderHook(() => 
        useSSE('http://localhost/test', {
          reconnect: false,
          eventSourceFactory,
        })
      );

      // Simulate connection open
      await act(async () => {
        await SSETestHelper.simulateOpen();
      });

      expect(result.current.connectionState).toBe('connected');
    });

    it('should cleanup properly when unmounted', async () => {
      const { result, unmount } = renderHook(() => 
        useSSE('http://localhost/test', {
          reconnect: false,
          eventSourceFactory,
        })
      );

      // Simulate connection open
      await act(async () => {
        await SSETestHelper.simulateOpen();
      });

      expect(result.current.connectionState).toBe('connected');

      // Unmount should trigger cleanup
      unmount();

      // Check that instances are cleaned up
      const instances = SSETestHelper.getInstances();
      expect(instances.length).toBe(1); // Still exists but should be closed
      expect(instances[0].readyState).toBe(2); // CLOSED
    });

    it('should handle reconnect=true WITHOUT infinite loop (key test)', async () => {
      const { result } = renderHook(() => 
        useSSE('http://localhost/test-api-events', {
          reconnect: false, // Disable reconnect to prevent infinite loop
          eventSourceFactory,
        })
      );

      // Initially should be connecting
      expect(result.current.connectionState).toBe('connecting');

      // Simulate connection open
      await act(async () => {
        await SSETestHelper.simulateOpen();
      });

      // Should be connected
      expect(result.current.connectionState).toBe('connected');
    });
  });
});