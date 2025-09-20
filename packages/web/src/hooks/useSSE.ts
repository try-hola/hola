import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { SSEEvent } from '@hola/shared';
import { createSSEClient, type SSEClient } from '../utils/sse-client';
import type { SSEOptions, SSEState } from '../utils/sse-types';

export type { SSEOptions, SSEState } from '../utils/sse-types';
export type { EventSourceFactory } from '../utils/sse-types';

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
  const externalListener = typeof onEventOrOptions === 'function' ? onEventOrOptions : undefined;
  const resolvedOptions = useMemo(
    () => (typeof onEventOrOptions === 'function' ? maybeOptions : onEventOrOptions) || {},
    [onEventOrOptions, maybeOptions]
  );

  const clientRef = useRef<SSEClient | null>(null);
  const [state, setState] = useState<SSEState>({
    connectionState: url ? 'connecting' : 'disconnected',
    lastEvent: null,
    error: null,
    reconnectAttempt: 0,
  });
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const listenerRef = useRef<typeof externalListener>(externalListener);
  listenerRef.current = externalListener;

  if (!clientRef.current) {
    clientRef.current = createSSEClient(resolvedOptions);
  }
  const client = clientRef.current;

  useEffect(() => {
    client.updateConfig(resolvedOptions);
  }, [client, resolvedOptions]);

  useEffect(() => {
    const unsubscribeState = client.subscribeState(next => setState(next));
    const unsubscribeEvents = client.subscribe(event => {
      setEvents(prev => [...prev, event]);
      if (listenerRef.current) listenerRef.current(event);
    });
    return () => {
      unsubscribeState();
      unsubscribeEvents();
    };
  }, [client]);

  useEffect(() => {
    client.updateUrl(url);
    if (url) {
      setEvents([]);
      client.connect();
    } else {
      client.disconnect();
      setEvents([]);
    }
    return () => {
      client.disconnect();
    };
  }, [client, url]);

  const connect = useCallback(() => {
    client.connect();
  }, [client]);

  const disconnect = useCallback(() => {
    client.disconnect();
  }, [client]);

  return {
    ...state,
    events,
    connect,
    disconnect,
    isConnected: state.connectionState === 'connected',
  };
}
