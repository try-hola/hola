import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import type { SSEEvent, SSEConnectionState } from '@hola/shared';

// EventSource factory type for dependency injection
export type EventSourceFactory = (url: string) => EventSource;

// Configuration for SSE connection
export interface SSEOptions {
  // Reconnection configuration
  reconnect?: boolean;
  reconnectDelay?: number;
  maxReconnectDelay?: number;
  reconnectAttempts?: number;
  
  // Heartbeat configuration
  heartbeatInterval?: number;
  heartbeatTimeout?: number;
  
  // Event filtering
  eventTypes?: SSEEvent['type'][];
  
  // Headers for authentication if needed
  headers?: Record<string, string>;
  
  // Dependency injection for testing
  eventSourceFactory?: EventSourceFactory;
}

// SSE hook state
export interface SSEState {
  connectionState: SSEConnectionState;
  lastEvent: SSEEvent | null;
  error: string | null;
  reconnectAttempt: number;
}

// Default configuration
const DEFAULT_OPTIONS: Required<Omit<SSEOptions, 'eventSourceFactory'>> & Pick<SSEOptions, 'eventSourceFactory'> = {
  reconnect: true,
  reconnectDelay: 1000,
  maxReconnectDelay: 30000,
  reconnectAttempts: 10,
  heartbeatInterval: 30000,
  heartbeatTimeout: 5000,
  eventTypes: [],
  headers: {},
  eventSourceFactory: undefined,
};

/**
 * Fixed Hook for managing Server-Sent Events (SSE) connections with auto-reconnection,
 * heartbeat monitoring, and error handling. This version eliminates circular dependencies.
 */
export function useSSE(
  url: string | null,
  onEvent: (event: SSEEvent) => void,
  options?: SSEOptions
): SSEState & { connect: () => void; disconnect: () => void; isConnected: boolean; events: SSEEvent[] };
export function useSSE(
  url: string | null,
  options?: SSEOptions
): SSEState & { connect: () => void; disconnect: () => void; isConnected: boolean; events: SSEEvent[] };
export function useSSE(
  url: string | null,
  onEventOrOptions?: ((event: SSEEvent) => void) | SSEOptions,
  maybeOptions?: SSEOptions
): SSEState & {
  connect: () => void;
  disconnect: () => void;
  isConnected: boolean;
  events: SSEEvent[];
} {
  const providedOnEvent = typeof onEventOrOptions === 'function' ? onEventOrOptions as (event: SSEEvent) => void : undefined;
  const resolvedOptions = useMemo(() => (
    (typeof onEventOrOptions === 'function' ? maybeOptions : onEventOrOptions) ?? {}
  ), [onEventOrOptions, maybeOptions]);
  const config = useMemo(() => ({
    ...DEFAULT_OPTIONS,
    ...resolvedOptions,
  }), [resolvedOptions]);

  const initialConnectionState: SSEConnectionState = url ? 'connecting' : 'disconnected';
  const [state, setState] = useState<SSEState>({
    connectionState: initialConnectionState,
    lastEvent: null,
    error: null,
    reconnectAttempt: 0,
  });

  const [events, setEvents] = useState<SSEEvent[]>([]);

  // Refs for managing connection lifecycle
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const urlRef = useRef(url);
  const onEventRef = useRef<((event: SSEEvent) => void) | undefined>(providedOnEvent);

  // Update refs when props change
  urlRef.current = url;
  onEventRef.current = providedOnEvent;

  // Cleanup timeouts
  const clearTimeouts = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = null;
    }
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  // Calculate reconnection delay with exponential backoff
  const { reconnectDelay, maxReconnectDelay, heartbeatTimeout, heartbeatInterval, eventTypes, eventSourceFactory, reconnect, reconnectAttempts } = config;

  const getReconnectDelay = useCallback((attempt: number) => {
    const delay = Math.min(
      reconnectDelay * Math.pow(2, attempt),
      maxReconnectDelay
    );
    // Add jitter to prevent thundering herd
    return delay + Math.random() * 1000;
  }, [reconnectDelay, maxReconnectDelay]);

  // Disconnect SSE
  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    clearTimeouts();

    if (mountedRef.current) {
      setState(prev => ({
        ...prev,
        connectionState: 'disconnected',
        error: null,
        reconnectAttempt: 0,
      }));
    }
  }, [clearTimeouts]);

  // Schedule reconnection without circular dependencies
  const scheduleReconnection = useCallback((attempt: number) => {
    if (!reconnect || attempt >= reconnectAttempts || !mountedRef.current) {
      setState(prev => ({
        ...prev,
        connectionState: 'disconnected',
      }));
      return;
    }

    const delay = getReconnectDelay(attempt);
    reconnectTimeoutRef.current = setTimeout(() => {
      if (!mountedRef.current || !urlRef.current) return;
      
      setState(prev => ({
        ...prev,
        connectionState: 'connecting',
        error: null,
        reconnectAttempt: attempt + 1,
      }));
    }, delay);
  }, [reconnect, reconnectAttempts, getReconnectDelay]);

  // Establish SSE connection
  const connect = useCallback(() => {
    if (!urlRef.current || !mountedRef.current) return;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    clearTimeouts();

    setState(prev => ({
      ...prev,
      connectionState: 'connecting',
      error: null,
    }));

    try {
      // Use injected factory or default EventSource
      const eventSource = eventSourceFactory 
        ? eventSourceFactory(urlRef.current)
        : new EventSource(urlRef.current);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        if (!mountedRef.current) return;
        
        setState(prev => ({
          ...prev,
          connectionState: 'connected',
          error: null,
          reconnectAttempt: 0,
        }));

        // Start heartbeat monitoring
        heartbeatIntervalRef.current = setInterval(() => {
          // The heartbeat is monitored by expecting regular messages
          // If no message is received within heartbeatTimeout, error handler will be called
        }, heartbeatInterval);
      };

      eventSource.onmessage = (event: MessageEvent) => {
        if (!mountedRef.current) return;

        try {
          const sseEvent: SSEEvent = JSON.parse(event.data);
          
          // Filter events if types are specified
          if (eventTypes.length > 0 && !eventTypes.includes(sseEvent.type)) {
            return;
          }

          setState(prev => ({
            ...prev,
            lastEvent: sseEvent,
            error: null,
          }));
          setEvents(prev => [...prev, sseEvent]);
          if (onEventRef.current) {
            onEventRef.current(sseEvent);
          }

          // Reset heartbeat timeout when we receive any message
          if (heartbeatTimeoutRef.current) {
            clearTimeout(heartbeatTimeoutRef.current);
          }
          heartbeatTimeoutRef.current = setTimeout(() => {
            if (!mountedRef.current) return;
            console.warn('SSE heartbeat timeout');
            // Handle heartbeat timeout as connection error
            if (eventSourceRef.current) {
              eventSourceRef.current.close();
              eventSourceRef.current = null;
            }
            setState(prev => {
              const nextAttempt = prev.reconnectAttempt + 1;
              scheduleReconnection(nextAttempt);
              return {
                ...prev,
                connectionState: 'error',
                error: 'Heartbeat timeout',
                reconnectAttempt: nextAttempt,
              };
            });
          }, heartbeatTimeout);

        } catch (error) {
          console.error('Failed to parse SSE event:', error);
          setState(prev => ({
            ...prev,
            error: error instanceof Error ? error.message : 'Failed to parse event',
          }));
        }
      };

      eventSource.onerror = () => {
        if (!mountedRef.current) return;
        console.error('SSE connection error');

        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }

        clearTimeouts();

        setState(prev => {
          const nextAttempt = prev.reconnectAttempt + 1;
          scheduleReconnection(nextAttempt);
          return {
            ...prev,
            connectionState: 'error',
            error: 'Connection error',
            reconnectAttempt: nextAttempt,
          };
        });
      };

    } catch (error) {
      setState(prev => {
        const nextAttempt = prev.reconnectAttempt + 1;
        scheduleReconnection(nextAttempt);
        return {
          ...prev,
          connectionState: 'error',
          error: error instanceof Error ? error.message : 'Failed to connect',
          reconnectAttempt: nextAttempt,
        };
      });
    }
  }, [heartbeatInterval, eventSourceFactory, eventTypes, heartbeatTimeout, clearTimeouts, scheduleReconnection]);

  // Auto-connect when URL is provided
  useEffect(() => {
    if (url) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [url, connect, disconnect]);

  // Handle reconnection when state changes to connecting (for reconnection attempts)
  useEffect(() => {
    if (state.connectionState === 'connecting' && state.reconnectAttempt > 0 && url) {
      // This is a reconnection attempt - call connect
      const timeoutId = setTimeout(() => {
        connect();
      }, 100); // Small delay to prevent race conditions

      return () => clearTimeout(timeoutId);
    }
  }, [state.connectionState, state.reconnectAttempt, url, connect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      disconnect();
    };
  }, [disconnect]);

  return {
    ...state,
    connect,
    disconnect,
    isConnected: state.connectionState === 'connected',
    events,
  };
}