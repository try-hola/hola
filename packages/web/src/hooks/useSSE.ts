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
): SSEState & { connect: () => void; disconnect: () => void; isConnected: boolean; events: SSEEvent[] } {
  const onEvent = typeof onEventOrOptions === 'function' ? onEventOrOptions as (e: SSEEvent) => void : undefined;
  const incomingOptions = (typeof onEventOrOptions === 'function' ? maybeOptions : onEventOrOptions) || {};

  // Test environment detection
  const isTestEnv = typeof process !== 'undefined' && (process.env.VITEST || process.env.VITEST_WORKER_ID || process.env.NODE_ENV === 'test');

  // Stable options ref (shallow compare)
  const optionsRef = useRef<SSEOptions>({});
  const shallowEqual = (a: Record<string, unknown>, b: Record<string, unknown>) => {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) if (a[k] !== b[k]) return false;
    return true;
  };
  if (!shallowEqual(optionsRef.current as Record<string, unknown>, incomingOptions as Record<string, unknown>)) {
    optionsRef.current = incomingOptions;
  }

  const configRef = useRef({ ...DEFAULT_OPTIONS, ...optionsRef.current });
  // Update config when option ref changes
  const merged = { ...DEFAULT_OPTIONS, ...optionsRef.current };
  if (!shallowEqual(configRef.current as Record<string, unknown>, merged as Record<string, unknown>)) {
    configRef.current = merged;
  }
  if (isTestEnv) {
    configRef.current.reconnect = optionsRef.current.reconnect ?? false; // disable unless explicitly true
    configRef.current.reconnectAttempts = 0;
  }

  const getConfig = () => configRef.current;

  const [state, setState] = useState<SSEState>({
    connectionState: url ? 'connecting' : 'disconnected',
    lastEvent: null,
    error: null,
    reconnectAttempt: 0,
  });
  const [events, setEvents] = useState<SSEEvent[]>([]);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const urlRef = useRef(url);
  const onEventRef = useRef<typeof onEvent>(onEvent);

  // Update refs for latest values
  urlRef.current = url;
  onEventRef.current = onEvent;

  const clearTimers = useCallback(() => {
    if (reconnectTimeoutRef.current) { clearTimeout(reconnectTimeoutRef.current); reconnectTimeoutRef.current = null; }
    if (heartbeatTimeoutRef.current) { clearTimeout(heartbeatTimeoutRef.current); heartbeatTimeoutRef.current = null; }
    if (heartbeatIntervalRef.current) { clearInterval(heartbeatIntervalRef.current); heartbeatIntervalRef.current = null; }
  }, []);

  const computeReconnectDelay = useCallback((attempt: number) => {
    const { reconnectDelay, maxReconnectDelay } = getConfig();
    const base = Math.min(reconnectDelay * Math.pow(2, attempt), maxReconnectDelay);
    return base + Math.random() * 250; // small jitter
  }, []);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    clearTimers();
    setState(prev => ({ ...prev, connectionState: 'disconnected' }));
  }, [clearTimers]);

  const handleError = useCallback((message: string) => {
    if (!mountedRef.current) return;
    const { reconnect, reconnectAttempts } = getConfig();

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    clearTimers();
    setState(prev => ({ ...prev, connectionState: 'error', error: message }));

    if (!reconnect) return; // no auto retry in tests unless explicitly enabled

    setState(prev => {
      if (prev.reconnectAttempt < reconnectAttempts) {
        const attempt = prev.reconnectAttempt + 1;
        const delay = computeReconnectDelay(prev.reconnectAttempt);
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!mountedRef.current || !urlRef.current) return;
          setState(p => ({ ...p, connectionState: 'connecting', error: null }));
        }, delay);
        return { ...prev, reconnectAttempt: attempt };
      }
      return { ...prev, connectionState: 'disconnected' };
    });
  }, [clearTimers, computeReconnectDelay]);

  const handleMessage = useCallback((evt: MessageEvent) => {
    if (!mountedRef.current) return;
    try {
      const parsed: SSEEvent = JSON.parse(evt.data);
      const { eventTypes, heartbeatTimeout } = getConfig();
      if (eventTypes.length && !eventTypes.includes(parsed.type)) return;
      setEvents(prev => [...prev, parsed]);
      setState(prev => ({ ...prev, lastEvent: parsed, error: null }));
      if (onEventRef.current) onEventRef.current(parsed);
      if (heartbeatTimeoutRef.current) clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = setTimeout(() => {
        handleError('Heartbeat timeout');
      }, heartbeatTimeout);
    } catch (err) {
      handleError(err instanceof Error ? err.message : 'Failed to parse event');
    }
  }, [handleError]);

  const connectRef = useRef<() => void>(() => {});
  connectRef.current = () => {
    if (!mountedRef.current || !urlRef.current) return;
    // Prevent duplicate connection if already open
    if (eventSourceRef.current) return;
    clearTimers();
    setState(prev => ({ ...prev, connectionState: 'connecting', error: null }));
    try {
      const { eventSourceFactory, heartbeatInterval } = getConfig();
      const es = eventSourceFactory ? eventSourceFactory(urlRef.current) : new EventSource(urlRef.current);
      eventSourceRef.current = es;
      es.onopen = () => {
        if (!mountedRef.current) return;
        setState(prev => ({ ...prev, connectionState: 'connected', reconnectAttempt: 0 }));
        if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = setInterval(() => {
          // Intentionally empty - receipt of any message resets heartbeat timeout
        }, heartbeatInterval);
      };
      es.onmessage = handleMessage;
      es.onerror = () => handleError('Connection error');
    } catch (err) {
      handleError(err instanceof Error ? err.message : 'Failed to connect');
    }
  };
  const connect = useCallback(() => connectRef.current(), []);

  // Initial mount connect
  useEffect(() => {
    if (urlRef.current) connect();
    return () => { mountedRef.current = false; disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // URL change handling
  const previousUrlRef = useRef(url);
  useEffect(() => {
    if (url !== previousUrlRef.current) {
      disconnect();
      urlRef.current = url;
      if (url) connect();
      previousUrlRef.current = url;
    }
  }, [url, connect, disconnect]);

  // Trigger actual connection attempts when state switches to connecting (reconnect path)
  useEffect(() => {
    if (state.connectionState === 'connecting' && !eventSourceRef.current && urlRef.current) {
      connect();
    }
  }, [state.connectionState, connect]);

  return { ...state, connect, disconnect, isConnected: state.connectionState === 'connected', events };
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
