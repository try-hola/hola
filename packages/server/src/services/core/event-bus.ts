import type { SSEEvent } from '@hola/shared';

/**
 * Process-wide event bus for the global SSE stream (#291). Services emit typed
 * `SSEEvent`s (job/deployment/system updates) and the `GET /api/events` handler
 * fans them out to every connected dashboard, so list views stay live from one
 * subscription instead of each polling.
 *
 * Deliberately tiny and synchronous — a single host, in one process. A throwing
 * subscriber must not break the others (one stuck SSE client shouldn't wedge the
 * bus), so `emit` isolates each listener.
 */
export type EventListener = (event: SSEEvent) => void;

export interface EventBus {
  emit(event: SSEEvent): void;
  subscribe(listener: EventListener): { unsubscribe(): void };
}

export class InProcessEventBus implements EventBus {
  private listeners = new Set<EventListener>();

  emit(event: SSEEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A broken/slow subscriber must not break delivery to the rest.
      }
    }
  }

  subscribe(listener: EventListener): { unsubscribe(): void } {
    this.listeners.add(listener);
    return {
      unsubscribe: () => {
        this.listeners.delete(listener);
      },
    };
  }
}
