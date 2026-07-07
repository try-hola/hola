// The SSE → QueryClient translation layer (specs/001-web-state-freshness).
//
// This module is the single writer that keeps the reactive query cache fresh
// from platform events delivered over the existing global `/api/events`
// stream. See contracts/events.md for the authoritative event→action
// contract and data-model.md for the query families involved.
//
// MUST NOT touch `globalCache` or `live-bus` — those are being retired by
// this migration (FR-011).

import * as React from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { DeploymentDetail, SSEEvent } from '@hola/shared';
import { useSSE } from '../hooks/useSSE';
import { queryKeys } from './queryKeys';

/**
 * Apply a single `SSEEvent` to the given `QueryClient`.
 *
 * A pure, directly-testable function: given a `QueryClient` (typically from
 * `useQueryClient()`) and an event off the wire, perform the imperative cache
 * actions described in contracts/events.md. Never throws — a bad/unexpected
 * event must not break the caller's event loop.
 */
export function handleGlobalEvent(
  qc: QueryClient,
  event: SSEEvent,
  opts?: { onDeploymentDeleted?: (deploymentId: string) => void }
): void {
  try {
    switch (event.type) {
      case 'deployment_update': {
        const { deploymentId, status, uptime, lastUpdated } = event.data;

        qc.setQueryData<DeploymentDetail>(
          queryKeys.deployments.detail(deploymentId),
          prev => {
            if (prev === undefined) {
              // Uncached id: a true no-op. Returning `prev` (undefined) here
              // avoids materializing a phantom cache entry.
              return prev;
            }
            // Latest-wins: drop a strictly-older event (an out-of-order burst
            // can't clobber fresher cached data). An equal-timestamp event is
            // applied — it carries the same lastUpdated, and the sibling
            // invalidate-refetch below reconciles the detail against the server
            // regardless, so the tie-break is not load-bearing.
            const incoming = new Date(lastUpdated).getTime();
            const cached = new Date(prev.lastUpdated).getTime();
            if (incoming < cached) {
              return prev;
            }
            return { ...prev, status, uptime, lastUpdated };
          }
        );

        qc.invalidateQueries({ queryKey: queryKeys.deployments.all });
        qc.invalidateQueries({ queryKey: queryKeys.jobs.all });
        qc.invalidateQueries({ queryKey: queryKeys.summary });
        break;
      }

      case 'deployment_deleted': {
        const { deploymentId } = event.data;

        qc.removeQueries({ queryKey: queryKeys.deployments.detail(deploymentId), exact: true });
        qc.removeQueries({ queryKey: queryKeys.deployments.config(deploymentId), exact: true });
        qc.removeQueries({
          predicate: query =>
            query.queryKey[0] === 'deployments' &&
            query.queryKey[1] === 'history' &&
            query.queryKey[2] === deploymentId,
        });

        qc.invalidateQueries({ queryKey: queryKeys.deployments.all });
        qc.invalidateQueries({ queryKey: queryKeys.summary });

        opts?.onDeploymentDeleted?.(deploymentId);
        break;
      }

      case 'job_update': {
        qc.invalidateQueries({ queryKey: queryKeys.jobs.all });
        qc.invalidateQueries({ queryKey: queryKeys.summary });
        break;
      }

      default:
        // `log` / `system_update` are out of scope for this handler — they
        // live on their own separate streams/consumers.
        break;
    }
  } catch {
    // No throw escapes: mirrors today's `signalLive` guarantee that one bad
    // event can't break the SSE subscription.
  }
}

// A tiny pub-sub so a currently-mounted `DeploymentDetail` page can react
// instantly when ITS OWN deployment is deleted (redirect + notice), without
// needing the single global (AppShell-mounted) subscription to know which
// page is currently open. A later task consumes this from the detail page.
const deploymentDeletedSubscribers = new Set<(deploymentId: string) => void>();

export function subscribeDeploymentDeleted(cb: (deploymentId: string) => void): () => void {
  deploymentDeletedSubscribers.add(cb);
  return () => {
    deploymentDeletedSubscribers.delete(cb);
  };
}

function notifyDeploymentDeleted(deploymentId: string): void {
  for (const cb of deploymentDeletedSubscribers) {
    try {
      cb(deploymentId);
    } catch {
      // One throwing subscriber must not stop the others from being notified.
    }
  }
}

/**
 * Mount once (in `AppShell`, via `useGlobalEvents`): subscribes to the global
 * `/api/events` stream and translates in-scope events into `QueryClient`
 * actions via `handleGlobalEvent`.
 */
export function useGlobalQueryEvents(): void {
  const qc = useQueryClient();

  const onEvent = React.useCallback(
    (event: SSEEvent) => {
      handleGlobalEvent(qc, event, { onDeploymentDeleted: notifyDeploymentDeleted });
    },
    [qc]
  );

  const sse = useSSE('/api/events', onEvent, {
    eventTypes: ['job_update', 'deployment_update', 'deployment_deleted'],
    reconnect: true,
    reconnectDelay: 2000,
    maxReconnectDelay: 15000,
  });

  // FR-009: SSE reconnect does not replay missed events, so on a genuine
  // reconnect (connected -> non-connected -> connected), invalidate the
  // in-scope families to reconcile anything missed during the outage. The
  // very first connect is not a reconnect and must not trigger this.
  const hasConnectedOnceRef = React.useRef(false);
  const wasConnectedRef = React.useRef(false);

  React.useEffect(() => {
    const isConnected = sse.connectionState === 'connected';

    if (isConnected) {
      if (hasConnectedOnceRef.current && !wasConnectedRef.current) {
        qc.invalidateQueries({ queryKey: queryKeys.deployments.all });
        qc.invalidateQueries({ queryKey: queryKeys.jobs.all });
        qc.invalidateQueries({ queryKey: queryKeys.summary });
      }
      hasConnectedOnceRef.current = true;
    }

    wasConnectedRef.current = isConnected;
  }, [sse.connectionState, qc]);
}
