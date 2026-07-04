import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { globalCache } from '../utils/cache';
import type { SSEEvent } from '@hola/shared';

// `useGlobalEvents` is mounted once (in AppShell) and is the ONLY thing that
// hears every SSE event — a page that isn't currently mounted (e.g. Apps
// while the operator is on Deployments) has no live-bus subscriber of its
// own, so the fix must invalidate the shared `globalCache` directly rather
// than relying on `signalLive` reaching a listener that doesn't exist yet.
let capturedOnEvent: ((event: SSEEvent) => void) | undefined;
vi.mock('./useSSE', () => ({
  useSSE: (_url: string, onEvent: (event: SSEEvent) => void) => {
    capturedOnEvent = onEvent;
    return { isConnected: true };
  },
}));

const { useGlobalEvents } = await import('./useGlobalEvents');

describe('useGlobalEvents cache invalidation', () => {
  beforeEach(() => {
    globalCache.clear();
    capturedOnEvent = undefined;
  });

  it('drops every cached deployments-list variant on deployment_deleted, not just a currently-mounted one', () => {
    // Two different param combinations, e.g. Apps.tsx vs Deployments.tsx.
    globalCache.set('deployments-{"page":1,"limit":100}', { data: {}, timestamp: Date.now() });
    globalCache.set('deployments-{"status":"running"}', { data: {}, timestamp: Date.now() });
    globalCache.set('deployment-detail-app-abc123', { data: {}, timestamp: Date.now() });

    renderHook(() => useGlobalEvents());
    expect(capturedOnEvent).toBeDefined();

    capturedOnEvent!({ type: 'deployment_deleted', data: { deploymentId: 'app-abc123' } });

    expect(globalCache.get('deployments-{"page":1,"limit":100}')).toBeNull();
    expect(globalCache.get('deployments-{"status":"running"}')).toBeNull();
    expect(globalCache.get('deployment-detail-app-abc123')).toBeNull();
  });

  it('drops every cached deployments-list variant on deployment_update too', () => {
    globalCache.set('deployments-{"page":1,"limit":100}', { data: {}, timestamp: Date.now() });

    renderHook(() => useGlobalEvents());
    capturedOnEvent!({
      type: 'deployment_update',
      data: { deploymentId: 'app-abc123', status: 'running', lastUpdated: new Date(0).toISOString() },
    });

    expect(globalCache.get('deployments-{"page":1,"limit":100}')).toBeNull();
  });
});
