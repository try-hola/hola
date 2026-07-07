import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { DeploymentDetail, SSEConnectionState, SSEEvent } from '@hola/shared';
import { queryKeys } from '../queryKeys';

// Mock the underlying SSE hook so `useGlobalQueryEvents` (T027a) can be
// rendered without a real EventSource; the connection state is driven by the
// mutable `mockConnectionState` below and re-read on every render.
let mockConnectionState: SSEConnectionState = 'connected';

vi.mock('../../hooks/useSSE', () => ({
  useSSE: (_url: string, onEvent: (event: SSEEvent) => void) => {
    void onEvent;
    return {
      connectionState: mockConnectionState,
      lastEvent: null,
      error: null,
      reconnectAttempt: 0,
      events: [],
      connect: () => {},
      disconnect: () => {},
      isConnected: mockConnectionState === 'connected',
    };
  },
}));

import { handleGlobalEvent, useGlobalQueryEvents } from '../useGlobalQueryEvents';

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

describe('handleGlobalEvent', () => {
  describe('deployment_update (T008)', () => {
    it('patches a seeded detail query and invalidates deployments/jobs/summary', () => {
      const qc = new QueryClient();
      const id = 'app-1';

      qc.setQueryData(queryKeys.deployments.detail(id), seedDetail(id));
      qc.setQueryData(queryKeys.deployments.list({}), { items: [], total: 0, page: 1, limit: 20 });
      qc.setQueryData(queryKeys.jobs.list({}), { items: [], total: 0, page: 1, limit: 20 });
      qc.setQueryData(queryKeys.summary, { apps: 0, running: 0, stopped: 0, jobs: 0 });

      const event: SSEEvent = {
        type: 'deployment_update',
        data: { deploymentId: id, status: 'stopped', uptime: '0s', lastUpdated: new Date(1000).toISOString() },
      };

      handleGlobalEvent(qc, event);

      const patched = qc.getQueryData<DeploymentDetail>(queryKeys.deployments.detail(id));
      expect(patched?.status).toBe('stopped');
      expect(patched?.uptime).toBe('0s');
      expect(patched?.lastUpdated).toBe(new Date(1000).toISOString());
      // Untouched fields survive the patch.
      expect(patched?.name).toBe('Test App');

      expect(qc.getQueryState(queryKeys.deployments.list({}))?.isInvalidated).toBe(true);
      expect(qc.getQueryState(queryKeys.jobs.list({}))?.isInvalidated).toBe(true);
      expect(qc.getQueryState(queryKeys.summary)?.isInvalidated).toBe(true);
    });

    it('is a no-op for an uncached id (FR-010): no throw, no phantom cache entry', () => {
      const qc = new QueryClient();
      const uncachedId = 'app-never-loaded';

      const event: SSEEvent = {
        type: 'deployment_update',
        data: { deploymentId: uncachedId, status: 'running', lastUpdated: new Date().toISOString() },
      };

      expect(() => handleGlobalEvent(qc, event)).not.toThrow();
      expect(qc.getQueryData(queryKeys.deployments.detail(uncachedId))).toBeUndefined();
    });
  });

  describe('deployment_update prefix invalidation across sibling list readers (T010)', () => {
    it('invalidates both a Deployments-page and an Apps-page list query on one event', () => {
      const qc = new QueryClient();
      const paramsA = { page: 1, limit: 100 };
      const paramsB = { status: 'running' as const };

      qc.setQueryData(queryKeys.deployments.list(paramsA), { items: [], total: 0, page: 1, limit: 100 });
      qc.setQueryData(queryKeys.deployments.list(paramsB), { items: [], total: 0, page: 1, limit: 20 });

      const event: SSEEvent = {
        type: 'deployment_update',
        data: { deploymentId: 'app-1', status: 'running', lastUpdated: new Date().toISOString() },
      };

      handleGlobalEvent(qc, event);

      expect(qc.getQueryState(queryKeys.deployments.list(paramsA))?.isInvalidated).toBe(true);
      expect(qc.getQueryState(queryKeys.deployments.list(paramsB))?.isInvalidated).toBe(true);
    });
  });

  describe('deployment_update out-of-order convergence (T010a)', () => {
    it('keeps the newest lastUpdated/status when a stale event arrives after a fresher one', () => {
      const qc = new QueryClient();
      const id = 'app-1';
      const t1 = new Date(1000).toISOString();
      const t2 = new Date(2000).toISOString();

      qc.setQueryData(queryKeys.deployments.detail(id), seedDetail(id, { lastUpdated: new Date(0).toISOString() }));

      // Newer event arrives first.
      handleGlobalEvent(qc, {
        type: 'deployment_update',
        data: { deploymentId: id, status: 'running', lastUpdated: t2 },
      });

      // Stale/out-of-order event arrives second.
      handleGlobalEvent(qc, {
        type: 'deployment_update',
        data: { deploymentId: id, status: 'installing', lastUpdated: t1 },
      });

      const final = qc.getQueryData<DeploymentDetail>(queryKeys.deployments.detail(id));
      expect(final?.status).toBe('running');
      expect(final?.lastUpdated).toBe(t2);
    });
  });

  describe('deployment_deleted (T017)', () => {
    it('removes detail/config/history for the id, invalidates deployments+summary, and calls the callback', () => {
      const qc = new QueryClient();
      const id = 'app-1';

      qc.setQueryData(queryKeys.deployments.detail(id), seedDetail(id));
      qc.setQueryData(queryKeys.deployments.config(id), { env: {} });
      qc.setQueryData(queryKeys.deployments.history(id, 1), { items: [], total: 0, page: 1, limit: 20 });
      qc.setQueryData(queryKeys.deployments.list({}), { items: [], total: 0, page: 1, limit: 20 });
      qc.setQueryData(queryKeys.summary, { apps: 0, running: 0, stopped: 0, jobs: 0 });

      const onDeploymentDeleted = vi.fn();
      handleGlobalEvent(qc, { type: 'deployment_deleted', data: { deploymentId: id } }, { onDeploymentDeleted });

      expect(qc.getQueryData(queryKeys.deployments.detail(id))).toBeUndefined();
      expect(qc.getQueryData(queryKeys.deployments.config(id))).toBeUndefined();
      expect(qc.getQueryData(queryKeys.deployments.history(id, 1))).toBeUndefined();

      expect(qc.getQueryState(queryKeys.deployments.list({}))?.isInvalidated).toBe(true);
      expect(qc.getQueryState(queryKeys.summary)?.isInvalidated).toBe(true);

      expect(onDeploymentDeleted).toHaveBeenCalledWith(id);
    });

    it('is a safe no-op for a never-loaded id (FR-010) but still invokes the callback', () => {
      const qc = new QueryClient();
      const neverLoadedId = 'app-never-loaded';
      const onDeploymentDeleted = vi.fn();

      expect(() =>
        handleGlobalEvent(qc, { type: 'deployment_deleted', data: { deploymentId: neverLoadedId } }, { onDeploymentDeleted })
      ).not.toThrow();

      expect(onDeploymentDeleted).toHaveBeenCalledWith(neverLoadedId);
    });
  });

  describe('job_update (T022)', () => {
    it('invalidates jobs and summary', () => {
      const qc = new QueryClient();

      qc.setQueryData(queryKeys.jobs.list({}), { items: [], total: 0, page: 1, limit: 20 });
      qc.setQueryData(queryKeys.summary, { apps: 0, running: 0, stopped: 0, jobs: 0 });

      handleGlobalEvent(qc, {
        type: 'job_update',
        data: { jobId: 'job-1', status: 'running' },
      });

      expect(qc.getQueryState(queryKeys.jobs.list({}))?.isInvalidated).toBe(true);
      expect(qc.getQueryState(queryKeys.summary)?.isInvalidated).toBe(true);
    });
  });

  describe('out-of-scope events', () => {
    it('ignores log and system_update events without throwing or touching the cache', () => {
      const qc = new QueryClient();
      qc.setQueryData(queryKeys.summary, { apps: 0, running: 0, stopped: 0, jobs: 0 });

      expect(() =>
        handleGlobalEvent(qc, {
          type: 'log',
          data: { timestamp: new Date().toISOString(), service: 'x', level: 'info', message: 'hi' },
        })
      ).not.toThrow();
      expect(() => handleGlobalEvent(qc, { type: 'system_update', data: {} })).not.toThrow();

      expect(qc.getQueryState(queryKeys.summary)?.isInvalidated).toBe(false);
    });
  });
});

describe('useGlobalQueryEvents reconnect invalidation (T027a)', () => {
  it('does not invalidate on the initial connect, but does on a subsequent reconnect', () => {
    mockConnectionState = 'connected';
    const qc = new QueryClient();

    qc.setQueryData(queryKeys.deployments.list({}), { items: [], total: 0, page: 1, limit: 20 });
    qc.setQueryData(queryKeys.jobs.list({}), { items: [], total: 0, page: 1, limit: 20 });
    qc.setQueryData(queryKeys.summary, { apps: 0, running: 0, stopped: 0, jobs: 0 });

    const { rerender } = renderHook(() => useGlobalQueryEvents(), { wrapper: createWrapper(qc) });

    // Initial mount connects for the first time — must NOT invalidate.
    expect(qc.getQueryState(queryKeys.deployments.list({}))?.isInvalidated).toBe(false);
    expect(qc.getQueryState(queryKeys.jobs.list({}))?.isInvalidated).toBe(false);
    expect(qc.getQueryState(queryKeys.summary)?.isInvalidated).toBe(false);

    // Connection drops.
    mockConnectionState = 'disconnected';
    rerender();
    expect(qc.getQueryState(queryKeys.deployments.list({}))?.isInvalidated).toBe(false);

    // ... and reconnects: this is a genuine reconnect, so invalidate.
    mockConnectionState = 'connected';
    rerender();

    expect(qc.getQueryState(queryKeys.deployments.list({}))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(queryKeys.jobs.list({}))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(queryKeys.summary)?.isInvalidated).toBe(true);
  });
});
