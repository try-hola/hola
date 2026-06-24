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

  // Teardown shared between start() and cancel(). The Streams runtime does NOT
  // treat start()'s return value as a teardown hook — only cancel() runs when the
  // client disconnects — so cancel() must invoke this to stop the heartbeat timer
  // and run the onSubscribe cleanup. Otherwise every dropped connection leaks a
  // timer and its subscription (e.g. a `docker compose logs -f` child process).
  let teardown: (() => void) | undefined;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let isClosed = false;
      let cleanup: (() => void) | undefined;
      let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

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
          clear();
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
          clear();
          controller.close();
        },
      };

      // Expose teardown so cancel() (client disconnect) stops the heartbeat timer
      // and runs the onSubscribe cleanup.
      teardown = () => {
        if (isClosed) return;
        isClosed = true;
        clear();
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
      }
    },
    cancel() {
      // The client disconnected (or the reader was cancelled): stop the heartbeat
      // timer and run the onSubscribe cleanup so nothing leaks per dropped stream.
      teardown?.();
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
