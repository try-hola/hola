import type { SSEEvent, SSEConnectionState } from '@hola/shared';
import type { EventSourceFactory, SSEOptions, SSEState } from './sse-types';

export interface SSEClient {
  connect(): void;
  disconnect(): void;
  updateUrl(url: string | null): void;
  updateConfig(options: SSEOptions): void;
  subscribe(listener: (event: SSEEvent) => void): () => void;
  subscribeState(listener: (state: SSEState) => void): () => void;
  getState(): SSEState;
}

const DEFAULT_OPTIONS: Required<Omit<SSEOptions, 'eventSourceFactory'>> & { eventSourceFactory?: EventSourceFactory } = {
  reconnect: true,
  reconnectDelay: 1000,
  maxReconnectDelay: 30000,
  reconnectAttempts: 10,
  heartbeatInterval: 30000,
  // Watchdog window for a silent-but-open stream. Must comfortably exceed the
  // server's heartbeat cadence (15s) so a single delayed/dropped keep-alive
  // doesn't tear down an idle log stream. At 5s, any stream not emitting a log
  // line every 5s (an idle app, or a failed deploy with no containers) was
  // killed on a loop — which is why streaming logs appeared never to work.
  heartbeatTimeout: 45000,
  eventTypes: [],
  headers: {},
  eventSourceFactory: undefined,
};

const TEST_ENV = typeof process !== 'undefined' && (
  process.env.VITEST || process.env.VITEST_WORKER_ID || process.env.NODE_ENV === 'test'
);

export function createSSEClient(initialOptions: SSEOptions = {}): SSEClient {
  let config = applyDefaults(initialOptions);
  let currentUrl: string | null = null;
  let eventSource: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  let connectionState: SSEConnectionState = 'disconnected';
  let reconnectAttempt = 0;
  let lastEvent: SSEEvent | null = null;
  let error: string | null = null;

  const eventListeners = new Set<(event: SSEEvent) => void>();
  const stateListeners = new Set<(state: SSEState) => void>();

  function getState(): SSEState {
    return { connectionState, lastEvent, error, reconnectAttempt };
  }

  function notifyState() {
    const state = getState();
    stateListeners.forEach(listener => listener(state));
  }

  function setState(next: Partial<SSEState>) {
    const state = getState();
    const newState: SSEState = {
      connectionState: next.connectionState ?? state.connectionState,
      lastEvent: next.lastEvent ?? state.lastEvent,
      error: next.error ?? state.error,
      reconnectAttempt: next.reconnectAttempt ?? state.reconnectAttempt,
    };
    connectionState = newState.connectionState;
    lastEvent = newState.lastEvent;
    error = newState.error;
    reconnectAttempt = newState.reconnectAttempt;
    notifyState();
  }

  function clearTimers() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function closeEventSource() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  function cleanup() {
    clearTimers();
    closeEventSource();
  }

  function scheduleHeartbeat() {
    clearHeartbeatTimeout();
    heartbeatTimer = setTimeout(() => {
      handleError('Heartbeat timeout');
    }, config.heartbeatTimeout);
  }

  function clearHeartbeatTimeout() {
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function handleMessage(raw: MessageEvent<string>) {
    scheduleHeartbeat();
    try {
      const evt: SSEEvent = JSON.parse(raw.data);
      if (config.eventTypes.length > 0 && !config.eventTypes.includes(evt.type)) {
        return;
      }
      lastEvent = evt;
      eventListeners.forEach(listener => listener(evt));
      setState({ lastEvent: evt, error: null });
    } catch (err) {
      handleError(err instanceof Error ? err.message : 'Failed to parse event');
    }
  }

  function computeReconnectDelay(attempt: number) {
    const base = Math.min(config.reconnectDelay * Math.pow(2, attempt), config.maxReconnectDelay);
    return base + Math.random() * 250;
  }

  function handleError(message: string) {
    cleanup();
    setState({ connectionState: 'error', error: message });

    if (!config.reconnect) return;
    if (reconnectAttempt >= config.reconnectAttempts) {
      setState({ connectionState: 'disconnected' });
      return;
    }

    const attempt = reconnectAttempt + 1;
    reconnectAttempt = attempt;
    notifyState();

    reconnectTimer = setTimeout(() => {
      if (!currentUrl) return;
      connect();
    }, computeReconnectDelay(attempt - 1));
  }

  function connect() {
    if (!currentUrl) {
      return;
    }
    cleanup();
    try {
      const factory = config.eventSourceFactory ?? (url => new EventSource(url));
      eventSource = factory(currentUrl);
      setState({ connectionState: 'connecting', error: null });

      eventSource.onopen = () => {
        reconnectAttempt = 0;
        setState({ connectionState: 'connected', error: null });
        scheduleHeartbeat();
      };

      eventSource.onmessage = handleMessage;
      // The server sends keep-alives as a NAMED `heartbeat` SSE event, which the
      // EventSource spec routes to addEventListener('heartbeat', …), NOT to
      // onmessage. Without this listener the watchdog never saw heartbeats and
      // an idle stream timed out. (Guarded for mock EventSources used in tests.)
      if (typeof eventSource.addEventListener === 'function') {
        eventSource.addEventListener('heartbeat', () => scheduleHeartbeat());
      }
      eventSource.onerror = () => handleError('Connection error');
    } catch (err) {
      handleError(err instanceof Error ? err.message : 'Failed to connect');
    }
  }

  function disconnect() {
    cleanup();
    setState({ connectionState: 'disconnected' });
  }

  function updateUrl(url: string | null) {
    if (currentUrl === url) return;
    currentUrl = url;
    if (!url) {
      disconnect();
      return;
    }
    if (connectionState !== 'disconnected') {
      connect();
    }
  }

  function updateConfig(options: SSEOptions) {
    config = applyDefaults(options);
  }

  function subscribe(listener: (event: SSEEvent) => void): () => void {
    eventListeners.add(listener);
    return () => {
      eventListeners.delete(listener);
    };
  }

  function subscribeState(listener: (state: SSEState) => void): () => void {
    stateListeners.add(listener);
    listener(getState());
    return () => {
      stateListeners.delete(listener);
    };
  }

  return {
    connect,
    disconnect,
    updateUrl,
    updateConfig,
    subscribe,
    subscribeState,
    getState,
  };
}

function applyDefaults(options: SSEOptions): typeof DEFAULT_OPTIONS {
  const merged = { ...DEFAULT_OPTIONS, ...options };
  if (TEST_ENV) {
    merged.reconnect = options.reconnect ?? false;
    merged.reconnectAttempts = 0;
  }
  return merged;
}
