// Client-side fan-out for the global SSE stream (#291). The one `/api/events`
// subscription (in AppShell) signals which resource changed; list hooks
// (useDeploymentsApi, useJobsApi) subscribe and refetch, so they stay live
// without each polling. Tiny and synchronous — a UI-local pub/sub.

import { globalCache } from './cache';

export type LiveResource = 'deployments' | 'jobs';

const listeners = new Map<LiveResource, Set<() => void>>();

/** Subscribe to change signals for a resource; returns an unsubscribe fn. */
export function onLive(resource: LiveResource, cb: () => void): () => void {
  let set = listeners.get(resource);
  if (!set) {
    set = new Set();
    listeners.set(resource, set);
  }
  set.add(cb);
  return () => {
    listeners.get(resource)?.delete(cb);
  };
}

/**
 * Notify subscribers that a resource changed (a stream event arrived).
 *
 * Also drops every cached `globalCache` entry for this resource
 * (`useDeploymentsApi`/`useJobsApi` key their cache entries `<resource>-<params>`)
 * — not just the currently-mounted listeners' data. `onLive` only reaches a
 * component that happens to be mounted right now; a page that isn't (e.g.
 * Apps while the operator is on Deployments) would otherwise still serve its
 * stale cache entry on its next mount's unforced fetch, since nothing else
 * ever invalidates it.
 */
export function signalLive(resource: LiveResource): void {
  globalCache.deleteByPattern(new RegExp(`^${resource}-`));
  listeners.get(resource)?.forEach((cb) => {
    try {
      cb();
    } catch {
      // a broken subscriber must not stop the others
    }
  });
}

// --- Connection state -------------------------------------------------------
// The global /api/events subscription publishes whether it's connected, so list
// hooks can PAUSE their polling while the backplane is live (events drive
// freshness) and resume it only as a fallback when SSE drops.

let connected = false;

/** Whether the global event stream is currently connected. */
export function isLiveConnected(): boolean {
  return connected;
}

/** Called by the global subscription when its connection state changes. */
export function setLiveConnected(value: boolean): void {
  connected = value;
}
