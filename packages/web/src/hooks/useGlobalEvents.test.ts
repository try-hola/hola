import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { DeploymentDetail, SSEEvent } from '@hola/shared';
import { queryKeys } from '../state/queryKeys';

// `useGlobalEvents` is now a thin wrapper around `useGlobalQueryEvents` (the
// actual SSE -> QueryClient translation layer, fully covered by
// `state/__tests__/useGlobalQueryEvents.test.ts`). This test is an
// integration-style smoke test proving the whole chain — useGlobalEvents ->
// useGlobalQueryEvents -> handleGlobalEvent -> QueryClient — works end to end.
let capturedOnEvent: ((event: SSEEvent) => void) | undefined;

vi.mock('./useSSE', () => ({
  useSSE: (_url: string, onEvent: (event: SSEEvent) => void) => {
    capturedOnEvent = onEvent;
    return {
      connectionState: 'connected',
      lastEvent: null,
      error: null,
      reconnectAttempt: 0,
      events: [],
      connect: () => {},
      disconnect: () => {},
      isConnected: true,
    };
  },
}));

const { useGlobalEvents } = await import('./useGlobalEvents');

function seedDetail(id: string, overrides: Partial<DeploymentDetail> = {}): DeploymentDetail {
  return {
    id,
    name: 'Test App',
    app: 'test-app',
    icon: 'icon.svg',
    status: 'running',
    resources: { cpu: '0.5', memory: '256Mi' },
    ports: [],
    lastUpdated: new Date(0).toISOString(),
    ...overrides,
  };
}

function createWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

describe('useGlobalEvents', () => {
  it('mounts the SSE subscription and drives the QueryClient on deployment_update', () => {
    const qc = new QueryClient();
    const id = 'app-abc123';

    qc.setQueryData(queryKeys.deployments.detail(id), seedDetail(id));
    qc.setQueryData(queryKeys.deployments.list({}), { items: [], total: 0, page: 1, limit: 20 });

    renderHook(() => useGlobalEvents(), { wrapper: createWrapper(qc) });
    expect(capturedOnEvent).toBeDefined();

    capturedOnEvent!({
      type: 'deployment_update',
      data: { deploymentId: id, status: 'stopped', uptime: '0s', lastUpdated: new Date(1000).toISOString() },
    });

    const patched = qc.getQueryData<DeploymentDetail>(queryKeys.deployments.detail(id));
    expect(patched?.status).toBe('stopped');
    expect(qc.getQueryState(queryKeys.deployments.list({}))?.isInvalidated).toBe(true);
  });

  it('mounts the SSE subscription and drives the QueryClient on deployment_deleted', () => {
    const qc = new QueryClient();
    const id = 'app-abc123';

    qc.setQueryData(queryKeys.deployments.detail(id), seedDetail(id));
    qc.setQueryData(queryKeys.deployments.list({}), { items: [], total: 0, page: 1, limit: 20 });

    renderHook(() => useGlobalEvents(), { wrapper: createWrapper(qc) });
    expect(capturedOnEvent).toBeDefined();

    capturedOnEvent!({ type: 'deployment_deleted', data: { deploymentId: id } });

    expect(qc.getQueryData(queryKeys.deployments.detail(id))).toBeUndefined();
    expect(qc.getQueryState(queryKeys.deployments.list({}))?.isInvalidated).toBe(true);
  });
});
