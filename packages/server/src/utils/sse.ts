import type { SSEEvent } from '@hola/shared';
import type { Logger } from '../lib/logger';

const encoder = new TextEncoder();

export interface SSERawEvent {
  id?: string;
  event?: string;
  data?: unknown;
}

export interface SSEStreamController {
  send(event: SSEEvent): void;
  sendRaw(event: SSERawEvent): void;
  heartbeat(data?: unknown): void;
  close(): void;
}

export interface SSEStreamOptions {
  onSubscribe: (controller: SSEStreamController) => void | (() => void);
  heartbeatIntervalMs?: number;
  logger?: Logger;
  keepAliveEvent?: () => SSERawEvent;
}

function formatSSEEvent(event: SSERawEvent): string {
  const lines: string[] = [];
  if (event.id) {
    lines.push(`id: ${event.id}`);
  }
  if (event.event) {
    lines.push(`event: ${event.event}`);
  }
  if (event.data !== undefined) {
    const payload = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
    lines.push(`data: ${payload}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function createSSEStream(options: SSEStreamOptions): ReadableStream<Uint8Array> {
  const { onSubscribe, heartbeatIntervalMs = 15000, logger, keepAliveEvent } = options;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let isClosed = false;
      let cleanup: (() => void) | undefined;
      let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

      const safeEmit = (event: SSERawEvent) => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(formatSSEEvent(event)));
        } catch (error) {
          isClosed = true;
          logger?.debug?.('SSE enqueue failed; closing stream', {
            error: error instanceof Error ? error.message : String(error),
          });
          try {
            controller.close();
          } catch {
            // ignore double close
          }
          cleanup?.();
        }
      };

      const api: SSEStreamController = {
        send(event) {
          safeEmit({ event: 'message', data: event });
        },
        sendRaw(event) {
          safeEmit(event);
        },
        heartbeat(data = {}) {
          safeEmit({ event: 'heartbeat', data });
        },
        close() {
          if (isClosed) return;
          isClosed = true;
          cleanup?.();
          controller.close();
        },
      };

      const clear = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = undefined;
        }
        if (cleanup) {
          try {
            cleanup();
          } catch (error) {
            logger?.debug?.('Error during SSE cleanup', {
              error: error instanceof Error ? error.message : String(error),
            });
          }
          cleanup = undefined;
        }
      };

      try {
        if (heartbeatIntervalMs > 0) {
          heartbeatTimer = setInterval(() => {
            if (keepAliveEvent) {
              safeEmit(keepAliveEvent());
            } else {
              api.heartbeat();
            }
          }, heartbeatIntervalMs);
        }

        const maybeCleanup = onSubscribe(api);
        if (typeof maybeCleanup === 'function') {
          cleanup = maybeCleanup;
        }
      } catch (error) {
        logger?.error?.('SSE subscription failed', error instanceof Error ? error : undefined);
        api.sendRaw({ event: 'error', data: { message: 'internal_error' } });
        api.close();
        return clear;
      }

      return () => {
        isClosed = true;
        clear();
      };
    },
    cancel() {
      // No-op: cleanup handled by start return function
    },
  });
}

export function createSSEHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  result.set('content-type', 'text/event-stream');
  result.set('cache-control', 'no-cache');
  result.set('connection', 'keep-alive');
  return result;
}
