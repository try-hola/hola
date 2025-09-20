import type { SSEEvent, SSEConnectionState } from '@hola/shared';

export type EventSourceFactory = (url: string) => EventSource;

export interface SSEOptions {
  reconnect?: boolean;
  reconnectDelay?: number;
  maxReconnectDelay?: number;
  reconnectAttempts?: number;
  heartbeatInterval?: number;
  heartbeatTimeout?: number;
  eventTypes?: SSEEvent['type'][];
  headers?: Record<string, string>;
  eventSourceFactory?: EventSourceFactory;
}

export interface SSEState {
  connectionState: SSEConnectionState;
  lastEvent: SSEEvent | null;
  error: string | null;
  reconnectAttempt: number;
}
