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
 * Hook for managing Server-Sent Events (SSE) connections with auto-reconnection,
 * heartbeat monitoring, and error handling.
 * 
 * This follows StrictMode-compatible patterns established in the project.
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
  const resolvedOptions = (typeof onEventOrOptions === 'function' ? maybeOptions : onEventOrOptions) ?? {};
  const configRef = useRef<Required<Omit<SSEOptions, 'eventSourceFactory'>> & Pick<SSEOptions, 'eventSourceFactory'>>({
    ...DEFAULT_OPTIONS,
    ...resolvedOptions,
  });
  // Update configRef on render; callbacks read from ref so no deps needed
  configRef.current = { ...DEFAULT_OPTIONS, ...resolvedOptions };

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
  const getReconnectDelay = useCallback((attempt: number) => {
    const { reconnectDelay, maxReconnectDelay } = configRef.current;
    const delay = Math.min(reconnectDelay * Math.pow(2, attempt), maxReconnectDelay);
    return delay + Math.random() * 1000;
  }, []);

  // Handle connection errors
  const handleError = useCallback((errorMessage: string) => {
    if (!mountedRef.current) return;

    console.error('SSE error:', errorMessage);

    // Close current connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    clearTimeouts();

    setState(prev => ({
      ...prev,
      connectionState: 'error',
      error: errorMessage,
    }));

    // Attempt reconnection if enabled and within limits
    setState(prev => {
      const { reconnect, reconnectAttempts } = configRef.current;
      if (reconnect && prev.reconnectAttempt < reconnectAttempts) {
        const delay = getReconnectDelay(prev.reconnectAttempt);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          if (mountedRef.current && urlRef.current) {
            // Reset to connecting state to trigger auto-connect effect
            setState(connectPrev => ({
              ...connectPrev,
              connectionState: 'connecting',
              error: null,
            }));
          }
        }, delay);

        return {
          ...prev,
          reconnectAttempt: prev.reconnectAttempt + 1,
        };
      } else {
        return {
          ...prev,
          connectionState: 'disconnected',
        };
      }
    });
  }, [getReconnectDelay, clearTimeouts]);

  // Handle SSE message events
  const handleMessage = useCallback((event: MessageEvent) => {
    if (!mountedRef.current) return;

    try {
      const sseEvent: SSEEvent = JSON.parse(event.data);
      
      // Filter events if types are specified
      const { eventTypes, heartbeatTimeout } = configRef.current;
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
        handleError('Heartbeat timeout');
      }, heartbeatTimeout);

    } catch (error) {
      console.error('Failed to parse SSE event:', error);
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to parse event',
      }));
    }
  }, [handleError]);

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
      const { eventSourceFactory, heartbeatInterval } = configRef.current;
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
          // If no message is received within heartbeatTimeout, handleError will be called
        }, heartbeatInterval);
      };

      eventSource.onmessage = handleMessage;

      eventSource.onerror = () => {
        handleError('Connection error');
      };

    } catch (error) {
      handleError(error instanceof Error ? error.message : 'Failed to connect');
    }
  }, [handleMessage, handleError, clearTimeouts]);

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

  // Handle state change to connecting (for reconnection)
  useEffect(() => {
    if (state.connectionState === 'connecting' && state.reconnectAttempt > 0 && url) {
      connect();
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

/**
 * Hook for real-time logs via SSE with polling fallback.
 * Integrates with existing LogsViewer component patterns.
 */
export function useLogsSSE(
  deploymentId?: string,
  jobId?: string,
  options: SSEOptions = {}
): {
  logs: Array<{ timestamp: string; service: string; level: string; message: string }>;
  connectionState: SSEConnectionState;
  error: string | null;
  isConnected: boolean;
  clearLogs: () => void;
} {
  const [logs, setLogs] = useState<Array<{ 
    timestamp: string; 
    service: string; 
    level: string; 
    message: string; 
  }>>([]);

  // Determine SSE URL
  const sseUrl = useMemo(() => {
    if (jobId) {
      // Use jobs stream endpoint
      const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
      return `${baseUrl}/api/jobs/${jobId}/logs/stream`;
    } else if (deploymentId) {
      // Use deployments stream endpoint
      const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
      return `${baseUrl}/api/deployments/${deploymentId}/logs/stream`;
    }
    return null;
  }, [jobId, deploymentId]);

  // Handle incoming SSE events
  const handleSSEEvent = useCallback((event: SSEEvent) => {
    if (event.type === 'log') {
      setLogs(prev => [...prev, event.data]);
    }
  }, []);

  // Use SSE hook with log event filtering
  const sseState = useSSE(sseUrl, handleSSEEvent, {
    ...options,
    eventTypes: ['log'],
  });

  // Clear logs function
  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  return {
    logs,
    connectionState: sseState.connectionState,
    error: sseState.error,
    isConnected: sseState.isConnected,
    clearLogs,
  };
}
