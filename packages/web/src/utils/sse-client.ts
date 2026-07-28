import type { SSEEvent, SSEConnectionState } from '@hola/shared';
import type { EventSourceFactory, SSEOptions, SSEState } from './sse-types';
import { getAuthToken, notifyUnauthorized, refreshAuthToken } from './auth-token';

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
  // Abort handle for the fetch-based transport (the default). Native EventSource
  // can't send an Authorization header, so OIDC/Bearer auth needs a fetch stream
  // instead; this lets cleanup() tear that fetch down.
  let abortController: AbortController | null = null;
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

  function closeTransport() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    if (abortController) {
      // Aborting rejects the in-flight fetch / pending reader.read(); the
      // transport's own abort guard swallows the resulting AbortError.
      abortController.abort();
      abortController = null;
    }
  }

  function cleanup() {
    clearTimers();
    closeTransport();
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

  // A data payload arrived (from either transport). Any traffic also resets the
  // heartbeat watchdog, since it proves the stream is still flowing.
  function handleData(data: string) {
    scheduleHeartbeat();
    try {
      const evt: SSEEvent = JSON.parse(data);
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

  // Parse one SSE frame (the lines between blank-line separators) and route it.
  // The server emits the data payload as a named `message` event and keep-alives
  // as a `heartbeat` event — mirror EventSource's dispatch for the fetch path.
  function dispatchFrame(frame: string) {
    let eventName = 'message';
    const dataLines: string[] = [];
    for (const line of frame.split('\n')) {
      if (line === '' || line.startsWith(':')) continue; // blank or comment/keep-alive
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') eventName = value;
      else if (field === 'data') dataLines.push(value);
      // `id`/`retry` are not used by this client
    }
    if (eventName === 'heartbeat') {
      scheduleHeartbeat();
      return;
    }
    if (dataLines.length === 0) return;
    const data = dataLines.join('\n');
    if (eventName === 'error') {
      handleError('Stream error');
      return;
    }
    handleData(data);
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

  function onTransportOpen() {
    reconnectAttempt = 0;
    setState({ connectionState: 'connected', error: null });
    scheduleHeartbeat();
  }

  // EventSource transport — used only when a factory is injected (tests, and the
  // dev/admin-key cookie flow). It can't carry an Authorization header, which is
  // why it isn't the default.
  function connectEventSource(factory: EventSourceFactory, url: string) {
    eventSource = factory(url);
    eventSource.onopen = onTransportOpen;
    eventSource.onmessage = (raw: MessageEvent<string>) => handleData(raw.data);
    // The server sends keep-alives as a NAMED `heartbeat` SSE event, which the
    // EventSource spec routes to addEventListener('heartbeat', …), NOT to
    // onmessage. Without this listener the watchdog never saw heartbeats and
    // an idle stream timed out. (Guarded for mock EventSources used in tests.)
    if (typeof eventSource.addEventListener === 'function') {
      eventSource.addEventListener('heartbeat', () => scheduleHeartbeat());
    }
    eventSource.onerror = () => handleError('Connection error');
  }

  // Default transport: fetch + ReadableStream. Unlike EventSource it can attach
  // the OIDC Bearer token (and same-origin credentials for the admin-key cookie),
  // so authenticated log streams actually connect instead of 401-looping. Mirrors
  // the REST layer's auth (safeFetchEnhanced).
  function connectFetch(url: string, authRetried = false) {
    const controller = new AbortController();
    abortController = controller;
    const token = getAuthToken();
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (token) headers.Authorization = `Bearer ${token}`;

    fetch(url, { method: 'GET', headers, credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          // As in the REST layer: a 401 can just be a token that went stale while
          // the tab was backgrounded. Refresh once and reconnect before giving up.
          if (!authRetried) {
            const fresh = await refreshAuthToken();
            if (controller.signal.aborted) return;
            if (fresh) {
              connectFetch(url, true);
              return;
            }
          }
          notifyUnauthorized();
          handleError('Unauthorized');
          return;
        }
        if (!response.ok || !response.body) {
          handleError(`HTTP ${response.status}`);
          return;
        }
        onTransportOpen();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (controller.signal.aborted) return;
          if (done) {
            handleError('Stream closed');
            return;
          }
          // Accumulate and dispatch complete frames (separated by a blank line).
          // CRLF is normalized so a split \r\n across chunks can't hide a boundary.
          buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
          let sep: number;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            dispatchFrame(buffer.slice(0, sep));
            buffer = buffer.slice(sep + 2);
          }
        }
      })
      .catch(err => {
        if (controller.signal.aborted) return;
        handleError(err instanceof Error ? err.message : 'Connection error');
      });
  }

  function connect() {
    if (!currentUrl) {
      return;
    }
    cleanup();
    try {
      setState({ connectionState: 'connecting', error: null });
      if (config.eventSourceFactory) {
        connectEventSource(config.eventSourceFactory, currentUrl);
      } else {
        connectFetch(currentUrl);
      }
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
