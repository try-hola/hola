import { describe, it, expect, beforeEach } from 'vitest';
import { globalCache } from './cache';
import { onLive, signalLive } from './live-bus';

describe('signalLive', () => {
  beforeEach(() => {
    globalCache.clear();
  });

  it('drops every cached entry for the resource, not just ones a currently-mounted listener would refetch', () => {
    // Simulates useDeploymentsApi caching two different param combinations
    // (e.g. Apps.tsx vs Deployments.tsx) plus an unrelated jobs entry.
    globalCache.set('deployments-{"page":1,"limit":100}', { data: {}, timestamp: Date.now() });
    globalCache.set('deployments-{"status":"running"}', { data: {}, timestamp: Date.now() });
    globalCache.set('jobs-{"page":1}', { data: {}, timestamp: Date.now() });

    signalLive('deployments');

    expect(globalCache.get('deployments-{"page":1,"limit":100}')).toBeNull();
    expect(globalCache.get('deployments-{"status":"running"}')).toBeNull();
    // A different resource's cache is untouched.
    expect(globalCache.get('jobs-{"page":1}')).not.toBeNull();
  });

  it('still notifies currently-mounted listeners', () => {
    let called = 0;
    const unsubscribe = onLive('deployments', () => { called++; });
    signalLive('deployments');
    expect(called).toBe(1);
    unsubscribe();
  });
});
