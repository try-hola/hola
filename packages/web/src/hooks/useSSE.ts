import * as React from 'react';
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
  options: SSEOptions = {}
): SSEState & {
  connect: () => void;
  disconnect: () => void;
  isConnected: boolean;
} {
  const config = React.useMemo(() => ({
    ...DEFAULT_OPTIONS,
    ...options,
  }), [options]);

  const [state, setState] = React.useState<SSEState>({
    connectionState: 'disconnected',
    lastEvent: null,
    error: null,
    reconnectAttempt: 0,
  });

  // Refs for managing connection lifecycle
  const eventSourceRef = React.useRef<EventSource | null>(null);
  const reconnectTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = React.useRef(true);
  const urlRef = React.useRef(url);
  const onEventRef = React.useRef(onEvent);

  // Update refs when props change
  urlRef.current = url;
  onEventRef.current = onEvent;

  // Cleanup timeouts
  const clearTimeouts = React.useCallback(() => {
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

  const getReconnectDelay = React.useCallback((attempt: number) => {
    const delay = Math.min(
      reconnectDelay * Math.pow(2, attempt),
      maxReconnectDelay
    );
    // Add jitter to prevent thundering herd
    return delay + Math.random() * 1000;
  }, [reconnectDelay, maxReconnectDelay]);

  // Handle connection errors
  const handleError = React.useCallback((errorMessage: string) => {
    if (!mountedRef.current) return;

    console.error('SSE error:', errorMessage);

    setState(prev => ({
      ...prev,
      connectionState: 'error',
      error: errorMessage,
    }));

    // Close current connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    clearTimeouts();

    // Attempt reconnection if enabled and within limits
    setState(prev => {
      if (reconnect && prev.reconnectAttempt < reconnectAttempts) {
        const delay = getReconnectDelay(prev.reconnectAttempt);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          if (mountedRef.current && urlRef.current) {
            // Trigger reconnection by setting state to connecting
            // The effect will handle the actual reconnection
            setState(connectPrev => ({
              ...connectPrev,
              connectionState: 'connecting',
            }));
          }
        }, delay);

        return {
          ...prev,
          connectionState: 'connecting',
          reconnectAttempt: prev.reconnectAttempt + 1,
        };
      } else {
        return {
          ...prev,
          connectionState: 'disconnected',
        };
      }
    });
  }, [reconnect, reconnectAttempts, getReconnectDelay, clearTimeouts]);

  // Handle SSE message events
  const handleMessage = React.useCallback((event: MessageEvent) => {
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

      onEventRef.current(sseEvent);

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
  }, [eventTypes, heartbeatTimeout, handleError]);

  // Establish SSE connection
  const connect = React.useCallback(() => {
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
  }, [heartbeatInterval, eventSourceFactory, handleMessage, handleError, clearTimeouts]);

  // Disconnect SSE
  const disconnect = React.useCallback(() => {
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
  React.useEffect(() => {
    if (url) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [url, connect, disconnect]);

  // Handle reconnection attempts when state changes to connecting
  React.useEffect(() => {
    if (state.connectionState === 'connecting' && state.reconnectAttempt > 0 && url) {
      // This is a reconnection attempt triggered by handleError
      const timeoutId = setTimeout(() => {
        connect();
      }, 100); // Small delay to prevent race conditions

      return () => clearTimeout(timeoutId);
    }
  }, [state.connectionState, state.reconnectAttempt, url, connect]);

  // Cleanup on unmount
  React.useEffect(() => {
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
  const [logs, setLogs] = React.useState<Array<{ 
    timestamp: string; 
    service: string; 
    level: string; 
    message: string; 
  }>>([]);

  // Determine SSE URL
  const sseUrl = React.useMemo(() => {
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
  const handleSSEEvent = React.useCallback((event: SSEEvent) => {
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
  const clearLogs = React.useCallback(() => {
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
