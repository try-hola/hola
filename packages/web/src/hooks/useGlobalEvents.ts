import { useGlobalQueryEvents } from '../state/useGlobalQueryEvents';

/**
 * The single dashboard-wide subscription to the global event stream, mounted
 * once in AppShell. Delegates to useGlobalQueryEvents, which translates SSE
 * events into QueryClient cache actions (see specs/001-web-state-freshness).
 */
export function useGlobalEvents(): void {
  useGlobalQueryEvents();
}
