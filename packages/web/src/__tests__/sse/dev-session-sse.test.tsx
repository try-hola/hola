/**
 * Dev Session SSE Integration Tests
 * 
 * Tests the SSE functionality for dev sessions using deterministic mocks
 * and validates proper event handling, connection states, and error scenarios.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { SSETestHelper } from '../utils/helpers/sse-test-helper';
import { useSSE, type EventSourceFactory } from '../../hooks/useSSE';
import { API } from '@hola/shared';
import type { SSEDevSessionStatusEvent, SSELogEvent, SSEEvent } from '@hola/shared';

// Simple test component to debug the issue
const SimpleTestComponent: React.FC = () => {
  return (
    <div>
      <div data-testid="connection-state">connecting</div>
      <div data-testid="error">none</div>
      <div data-testid="event-count">0</div>
    </div>
  );
};

// Test component that uses SSE hook
const DevSessionMonitor: React.FC<{ sessionId: string; eventSourceFactory: EventSourceFactory }> = ({ sessionId, eventSourceFactory }) => {
  const { connectionState, lastEvent, error, events } = useSSE(
    API.dev.events(sessionId),
    {
      reconnect: true,
      reconnectDelay: 100, // Fast reconnect for tests
      eventSourceFactory,
      
    }
  );

  return (
    <div>
      <div data-testid="connection-state">{String(connectionState)}</div>
      <div data-testid="error">{String(error ?? 'none')}</div>
      <div data-testid="event-count">{String(events.length)}</div>
      {lastEvent && (
        <div data-testid="last-event" data-event-type={lastEvent.type}>
          {JSON.stringify(lastEvent)}
        </div>
      )}
      <div data-testid="events">
        {events.map((event, index) => (
          <div key={index} data-testid={`event-${index}`} data-event-type={event.type}>
            {JSON.stringify(event)}
          </div>
        ))}
      </div>
    </div>
  );
};

describe('Dev Session SSE Integration', () => {
  let eventSourceFactory: EventSourceFactory;

  beforeEach(() => {
    eventSourceFactory = SSETestHelper.setup();
  });

  afterEach(() => {
    SSETestHelper.cleanup();
  });

  describe('Connection Management', () => {
    it('establishes connection and updates state', async () => {
      const sessionId = 'test-session-123';
      
      // First test with simple component
      const { container: simpleContainer } = render(<SimpleTestComponent />);
      console.log('Simple container HTML:', simpleContainer.innerHTML);
      
      // Clean up and test with SSE component
      screen.getByTestId('connection-state');
      
      // Now test the SSE component
      const { container } = render(<DevSessionMonitor sessionId={sessionId} eventSourceFactory={eventSourceFactory} />);
      
      // Debug: Log what's actually rendered
      console.log('Container HTML:', container.innerHTML);
      console.log('Container firstChild:', container.firstChild);
      
      // Initially should be connecting (await render stabilization)
      await waitFor(() => {
        const connEl = screen.getByTestId('connection-state');
        expect(connEl).toBeInTheDocument();
      }, { timeout: 3000 });
      
      const connEl = screen.getByTestId('connection-state');
      expect(connEl).toHaveTextContent('connecting');
      
      // Simulate connection open
      await SSETestHelper.simulateOpen();
      
      // Should be connected
      await waitFor(() => {
        expect(screen.getByTestId('connection-state')).toHaveTextContent('connected');
      });
      
      expect(screen.getByTestId('error')).toHaveTextContent('none');
    });

    it('handles connection errors gracefully', async () => {
      const sessionId = 'test-session-456';
      
      render(<DevSessionMonitor sessionId={sessionId} eventSourceFactory={eventSourceFactory} />);
      
      // Simulate connection error
      await SSETestHelper.simulateError();
      
      await waitFor(() => {
        expect(screen.getByTestId('connection-state')).toHaveTextContent('error');
      });
    });

    it('handles connection close and reconnection', async () => {
      const sessionId = 'test-session-789';
      
      render(<DevSessionMonitor sessionId={sessionId} eventSourceFactory={eventSourceFactory} />);
      
      // Establish connection
      await SSETestHelper.simulateOpen();
      await waitFor(() => {
        expect(screen.getByTestId('connection-state')).toHaveTextContent('connected');
      });
      
      // Close connection
      await SSETestHelper.simulateClose();
      
      await waitFor(() => {
        expect(screen.getByTestId('connection-state')).toHaveTextContent('disconnected');
      });
    });
  });

  describe('Dev Session Event Handling', () => {
    it('receives and processes session status events', async () => {
      const sessionId = 'test-session-status';
      
      render(<DevSessionMonitor sessionId={sessionId} eventSourceFactory={eventSourceFactory} />);
      
      // Establish connection
      await SSETestHelper.simulateOpen();
      
      // Send session status event
      await SSETestHelper.sendDevSessionStatusEvent({
        sessionId,
        status: 'running',
        lastActivity: '2023-12-01T10:00:00Z',
        liveReload: true,
        autoSync: false,
      });
      
      await waitFor(() => {
        expect(screen.getByTestId('event-count')).toHaveTextContent('1');
      });
      
      const lastEvent = screen.getByTestId('last-event');
      expect(lastEvent).toHaveAttribute('data-event-type', 'session_status');
      
      const eventData = JSON.parse(lastEvent.textContent || '{}') as SSEDevSessionStatusEvent;
      expect(eventData.type).toBe('session_status');
      expect(eventData.data.sessionId).toBe(sessionId);
      expect(eventData.data.status).toBe('running');
      expect(eventData.data.liveReload).toBe(true);
      expect(eventData.data.autoSync).toBe(false);
    });

    it('receives and processes log events from dev session', async () => {
      const sessionId = 'test-session-logs';
      
      render(<DevSessionMonitor sessionId={sessionId} eventSourceFactory={eventSourceFactory} />);
      
      // Establish connection
      await SSETestHelper.simulateOpen();
      
      // Send log event
      await SSETestHelper.sendLogEvent({
        timestamp: '2023-12-01T10:05:00Z',
        service: `dev-session-${sessionId}`,
        level: 'info',
        message: 'Dev session started successfully',
      });
      
      await waitFor(() => {
        expect(screen.getByTestId('event-count')).toHaveTextContent('1');
      });
      
      const lastEvent = screen.getByTestId('last-event');
      expect(lastEvent).toHaveAttribute('data-event-type', 'log');
      
      const eventData = JSON.parse(lastEvent.textContent || '{}') as SSELogEvent;
      expect(eventData.type).toBe('log');
      expect(eventData.data.service).toBe(`dev-session-${sessionId}`);
      expect(eventData.data.message).toBe('Dev session started successfully');
      expect(eventData.data.level).toBe('info');
    });

    it('handles multiple event types in sequence', async () => {
      const sessionId = 'test-session-multi';
      
      render(<DevSessionMonitor sessionId={sessionId} eventSourceFactory={eventSourceFactory} />);
      
      // Establish connection
      await SSETestHelper.simulateOpen();
      
      // Send multiple events
      await SSETestHelper.sendDevSessionStatusEvent({
        sessionId,
        status: 'starting',
        liveReload: false,
        autoSync: true,
      });
      
      await SSETestHelper.sendLogEvent({
        service: `dev-session-${sessionId}`,
        level: 'info',
        message: 'Session is starting up',
      });
      
      await SSETestHelper.sendDevSessionStatusEvent({
        sessionId,
        status: 'running',
        liveReload: true,
        autoSync: true,
      });
      
      await waitFor(() => {
        expect(screen.getByTestId('event-count')).toHaveTextContent('3');
      });
      
      // Check all events are rendered
      expect(screen.getByTestId('event-0')).toHaveAttribute('data-event-type', 'session_status');
      expect(screen.getByTestId('event-1')).toHaveAttribute('data-event-type', 'log');
      expect(screen.getByTestId('event-2')).toHaveAttribute('data-event-type', 'session_status');
    });
  });

  describe('Event Filtering', () => {
    it('filters events by type when configured', async () => {
      const sessionId = 'test-session-filter';
      
      // Create component that only listens for session_status events
      const FilteredComponent: React.FC = () => {
        const { events } = useSSE(
          API.dev.events(sessionId),
          {
            eventSourceFactory,
             // Only session status events
          }
        );

        return (
          <div>
            <div data-testid="event-count">{events.length}</div>
            {events.map((event, index) => (
              <div key={index} data-testid={`event-${index}`} data-event-type={event.type}>
                {JSON.stringify(event)}
              </div>
            ))}
          </div>
        );
      };
      
      render(<FilteredComponent />);
      
      // Establish connection
      await SSETestHelper.simulateOpen();
      
      // Send mixed events
      await SSETestHelper.sendLogEvent({
        service: `dev-session-${sessionId}`,
        level: 'info',
        message: 'This should be filtered out',
      });
      
      await SSETestHelper.sendDevSessionStatusEvent({
        sessionId,
        status: 'running',
      });
      
      await SSETestHelper.sendLogEvent({
        service: `dev-session-${sessionId}`,
        level: 'warn',
        message: 'This should also be filtered out',
      });
      
      await waitFor(() => {
        // Should only have 1 event (the session_status)
        expect(screen.getByTestId('event-count')).toHaveTextContent('1');
      });
      
      expect(screen.getByTestId('event-0')).toHaveAttribute('data-event-type', 'session_status');
    });
  });

  describe('Error Scenarios', () => {
    it('handles malformed events gracefully', async () => {
      const sessionId = 'test-session-malformed';
      
      render(<DevSessionMonitor sessionId={sessionId} eventSourceFactory={eventSourceFactory} />);
      
      // Establish connection
      await SSETestHelper.simulateOpen();
      
      // Send malformed event (should be handled gracefully) 
      // Create a malformed event object that TypeScript will accept but is missing required fields
      const malformedEvent = {
        type: 'session_status',
        // Missing required data fields
      } as Partial<SSEDevSessionStatusEvent> & { type: 'session_status' };
      
      await SSETestHelper.sendCustomEvent(malformedEvent as SSEEvent);
      
      // Send valid event after malformed one
      await SSETestHelper.sendDevSessionStatusEvent({
        sessionId,
        status: 'running',
      });
      
      await waitFor(() => {
        // Should have processed the valid event despite the malformed one
        expect(screen.getByTestId('event-count')).toHaveTextContent('1');
      });
    });
  });

  describe('Realistic Workflow Simulation', () => {
    it('simulates complete dev session lifecycle', async () => {
      const sessionId = 'test-session-lifecycle';
      
      render(<DevSessionMonitor sessionId={sessionId} eventSourceFactory={eventSourceFactory} />);
      
      // Establish connection
      await SSETestHelper.simulateOpen();
      
      // Simulate dev session lifecycle
      const lifecycleEvents = [
        // Session starting
        {
          type: 'session_status' as const,
          data: { sessionId, status: 'starting', liveReload: false, autoSync: false, lastActivity: new Date().toISOString() }
        },
        // Initial logs
        {
          type: 'log' as const,
          data: {
            timestamp: new Date().toISOString(),
            service: `dev-session-${sessionId}`,
            level: 'info' as const,
            message: 'Initializing dev session...',
          }
        },
        // Session running
        {
          type: 'session_status' as const,
          data: { sessionId, status: 'running', liveReload: true, autoSync: true, lastActivity: new Date().toISOString() }
        },
        // Activity logs
        {
          type: 'log' as const,
          data: {
            timestamp: new Date().toISOString(),
            service: `dev-session-${sessionId}`,
            level: 'info' as const,
            message: 'Hot reload enabled',
          }
        },
        // Status update
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
      await SSETestHelper.simulateWorkflow(lifecycleEvents);
      
      await waitFor(() => {
        expect(screen.getByTestId('event-count')).toHaveTextContent('5');
      });
      
      // Verify the final state shows session is running
      const lastEvent = screen.getByTestId('last-event');
      const eventData = JSON.parse(lastEvent.textContent || '{}');
      expect(eventData.data.status).toBe('running');
      expect(eventData.data.liveReload).toBe(true);
      expect(eventData.data.logs).toEqual(['Recent activity 1', 'Recent activity 2']);
    });
  });
});