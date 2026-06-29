// Client-side fan-out for the global SSE stream (#291). The one `/api/events`
// subscription (in AppShell) signals which resource changed; list hooks
// (useDeploymentsApi, useJobsApi) subscribe and refetch, so they stay live
// without each polling. Tiny and synchronous — a UI-local pub/sub.

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

/** Notify subscribers that a resource changed (a stream event arrived). */
export function signalLive(resource: LiveResource): void {
  listeners.get(resource)?.forEach((cb) => {
    try {
      cb();
    } catch {
      // a broken subscriber must not stop the others
    }
  });
}
