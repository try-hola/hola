import * as React from 'react';
import { useSSE } from './useSSE';
import { signalLive } from '../utils/live-bus';
import { globalCache } from '../utils/cache';
import type { SSEEvent, DeploymentDetail } from '@hola/shared';

/**
 * The single dashboard-wide subscription to the global event stream (#291).
 * Mounted once in AppShell: it translates `job_update` / `deployment_update`
 * events into live-bus signals (so list views refetch) and patches the cached
 * deployment detail so an open detail page reflects a status change instantly.
 *
 * Uses a RELATIVE URL so it resolves against the page origin in production
 * (same-origin) and the Vite proxy in development — no API-base guesswork.
 */
export function useGlobalEvents(): void {
  const onEvent = React.useCallback((event: SSEEvent) => {
    if (event.type === 'job_update') {
      signalLive('jobs');
    } else if (event.type === 'deployment_update') {
      const key = `deployment-detail-${event.data.deploymentId}`;
      const cached = globalCache.get(key);
      if (cached?.data && typeof cached.data === 'object') {
        globalCache.set(key, {
          ...cached,
          data: {
            ...(cached.data as DeploymentDetail),
            status: event.data.status,
            uptime: event.data.uptime,
            lastUpdated: event.data.lastUpdated,
          },
          timestamp: Date.now(),
        });
      }
      // A deployment status change usually rides alongside a lifecycle job, so
      // refresh both the deployments list and the job tracker.
      signalLive('deployments');
      signalLive('jobs');
    }
  }, []);

  useSSE('/api/events', onEvent, {
    eventTypes: ['job_update', 'deployment_update'],
    reconnect: true,
    reconnectDelay: 2000,
    maxReconnectDelay: 15000,
  });
}
