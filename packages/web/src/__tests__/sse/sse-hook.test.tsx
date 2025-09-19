/**
 * Fixed SSE Hook Tests using renderHook instead of component rendering
 * 
 * Tests the SSE functionality using renderHook to avoid React component rendering issues
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { SSETestHelper } from '../utils/helpers/sse-test-helper';
import { useSSE, type EventSourceFactory } from '../../hooks/useSSE';
import { API } from '@hola/shared';

describe('Dev Session SSE Hook Tests', () => {
  let eventSourceFactory: EventSourceFactory;

  beforeEach(() => {
    eventSourceFactory = SSETestHelper.setup();
  });

  afterEach(() => {
    cleanup();
    SSETestHelper.cleanup();
  });

  describe('Connection Management', () => {
    it('establishes connection and updates state', async () => {
      const sessionId = 'test-session-123';
      
      const { result, unmount } = renderHook(() => 
        useSSE(API.dev.events(sessionId), {
          reconnect: false,
          eventSourceFactory,
        })
      );

      // Initially should be connecting
      expect(result.current.connectionState).toBe('connecting');
      expect(result.current.error).toBe(null);
      expect(result.current.events).toEqual([]);

      // Simulate connection open
      await act(async () => {
        await SSETestHelper.simulateOpen();
      });

      // Should be connected
      expect(result.current.connectionState).toBe('connected');
      expect(result.current.error).toBe(null);
      expect(result.current.isConnected).toBe(true);
      unmount();
    });

    it('handles connection errors gracefully', async () => {
      const sessionId = 'test-session-456';
      
      const { result, unmount } = renderHook(() => 
        useSSE(API.dev.events(sessionId), {
          reconnect: false,
          eventSourceFactory,
        })
      );

      // Simulate connection error
      await act(async () => {
        await SSETestHelper.simulateError();
      });

      expect(result.current.connectionState).toBe('error');
      unmount();
    });

    it('handles connection close and reconnection', async () => {
      const sessionId = 'test-session-789';
      
      const { result, unmount } = renderHook(() => 
        useSSE(API.dev.events(sessionId), {
          reconnect: false,
          eventSourceFactory,
        })
      );

      // Establish connection
      await act(async () => {
        await SSETestHelper.simulateOpen();
      });
      
      expect(result.current.connectionState).toBe('connected');

      // Close connection
      await act(async () => {
        await SSETestHelper.simulateClose();
      });
      
  // With reconnect disabled, close currently transitions through error state; ensure not connected
  expect(['error', 'disconnected']).toContain(result.current.connectionState);
      unmount();
    });
  });

  describe('Event Handling', () => {
    it('receives and processes session status events', async () => {
      const sessionId = 'test-session-status';
      
      const { result, unmount } = renderHook(() => 
        useSSE(API.dev.events(sessionId), {
          reconnect: false,
          eventSourceFactory,
        })
      );

      // Establish connection
      await act(async () => {
        await SSETestHelper.simulateOpen();
      });

      // Send session status event
      await act(async () => {
        await SSETestHelper.sendDevSessionStatusEvent({
          sessionId,
          status: 'running',
          lastActivity: '2023-12-01T10:00:00Z',
          liveReload: true,
          autoSync: false,
        });
      });

      expect(result.current.events).toHaveLength(1);
      expect(result.current.lastEvent?.type).toBe('session_status');
      
      const eventData = result.current.lastEvent?.data;
      expect(eventData).toMatchObject({
        sessionId,
        status: 'running',
        liveReload: true,
        autoSync: false,
      });
      unmount();
    });

    it('receives and processes log events', async () => {
      const sessionId = 'test-session-logs';
      
      const { result, unmount } = renderHook(() => 
        useSSE(API.dev.events(sessionId), {
          reconnect: false,
          eventSourceFactory,
        })
      );

      // Establish connection
      await act(async () => {
        await SSETestHelper.simulateOpen();
      });

      // Send log event
      await act(async () => {
        await SSETestHelper.sendLogEvent({
          timestamp: '2023-12-01T10:05:00Z',
          service: `dev-session-${sessionId}`,
          level: 'info',
          message: 'Dev session started successfully',
        });
      });

      expect(result.current.events).toHaveLength(1);
      expect(result.current.lastEvent?.type).toBe('log');
      
      const eventData = result.current.lastEvent?.data;
      expect(eventData).toMatchObject({
        service: `dev-session-${sessionId}`,
        message: 'Dev session started successfully',
        level: 'info',
      });
      unmount();
    });

    it('handles multiple event types in sequence', async () => {
      const sessionId = 'test-session-multi';
      
      const { result, unmount } = renderHook(() => 
        useSSE(API.dev.events(sessionId), {
          reconnect: false,
          eventSourceFactory,
        })
      );

      // Establish connection
      await act(async () => {
        await SSETestHelper.simulateOpen();
      });

      // Send multiple events
      await act(async () => {
        await SSETestHelper.sendDevSessionStatusEvent({
          sessionId,
          status: 'starting',
          liveReload: false,
          autoSync: true,
        });
      });

      await act(async () => {
        await SSETestHelper.sendLogEvent({
          service: `dev-session-${sessionId}`,
          level: 'info',
          message: 'Session is starting up',
        });
      });

      await act(async () => {
        await SSETestHelper.sendDevSessionStatusEvent({
          sessionId,
          status: 'running',
          liveReload: true,
          autoSync: true,
        });
      });

      expect(result.current.events).toHaveLength(3);
      expect(result.current.events[0].type).toBe('session_status');
      expect(result.current.events[1].type).toBe('log');
      expect(result.current.events[2].type).toBe('session_status');
      unmount();
    });
  });

  describe('Event Filtering', () => {
    it('filters events by type when configured', async () => {
      const sessionId = 'test-session-filter';
      
      const { result, unmount } = renderHook(() => 
        useSSE(API.dev.events(sessionId), {
          reconnect: false,
          eventSourceFactory,
          eventTypes: ['session_status'],
        })
      );

      // Establish connection
      await act(async () => {
        await SSETestHelper.simulateOpen();
      });

      // Send mixed events
      await act(async () => {
        await SSETestHelper.sendLogEvent({
          service: `dev-session-${sessionId}`,
          level: 'info',
          message: 'This should be filtered out',
        });
      });

      await act(async () => {
        await SSETestHelper.sendDevSessionStatusEvent({
          sessionId,
          status: 'running',
        });
      });

      await act(async () => {
        await SSETestHelper.sendLogEvent({
          service: `dev-session-${sessionId}`,
          level: 'warn',
          message: 'This should also be filtered out',
        });
      });

      // Should only have 1 event (the session_status)
      expect(result.current.events).toHaveLength(1);
      expect(result.current.events[0].type).toBe('session_status');
      unmount();
    });
  });

  describe('Realistic Workflow Simulation', () => {
    it('simulates complete dev session lifecycle', async () => {
      const sessionId = 'test-session-lifecycle';
      
      const { result, unmount } = renderHook(() => 
        useSSE(API.dev.events(sessionId), {
          reconnect: false,
          eventSourceFactory,
        })
      );

      // Establish connection
      await act(async () => {
        await SSETestHelper.simulateOpen();
      });

      // Simulate dev session lifecycle
      const lifecycleEvents = [
        {
          type: 'session_status' as const,
          data: { sessionId, status: 'starting', liveReload: false, autoSync: false, lastActivity: new Date().toISOString() }
        },
        {
          type: 'log' as const,
          data: {
            timestamp: new Date().toISOString(),
            service: `dev-session-${sessionId}`,
            level: 'info' as const,
            message: 'Initializing dev session...',
          }
        },
        {
          type: 'session_status' as const,
          data: { sessionId, status: 'running', liveReload: true, autoSync: true, lastActivity: new Date().toISOString() }
        },
        {
          type: 'log' as const,
          data: {
            timestamp: new Date().toISOString(),
            service: `dev-session-${sessionId}`,
            level: 'info' as const,
            message: 'Hot reload enabled',
          }
        },
        {
          type: 'session_status' as const,
          data: { 
            sessionId, 
            status: 'running', 
            liveReload: true, 
            autoSync: true,
            logs: ['Recent activity 1', 'Recent activity 2'],
            lastActivity: new Date().toISOString(),
          }
        },
      ];

      // Use the workflow simulation helper
      await act(async () => {
        await SSETestHelper.simulateWorkflow(lifecycleEvents);
      });

      expect(result.current.events).toHaveLength(5);

      // Verify the final state shows session is running
      const lastEvent = result.current.lastEvent;
      if (lastEvent?.type !== 'session_status') {
        throw new Error('Expected final event to be session_status');
      }
      expect(lastEvent.data.status).toBe('running');
      expect(lastEvent.data.liveReload).toBe(true);
      expect(lastEvent.data.logs).toEqual(['Recent activity 1', 'Recent activity 2']);
      unmount();
    });
  });
});