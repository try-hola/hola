import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { queryKeys } from '../../state/queryKeys';

const tailscaleIngress = {
  get: vi.fn(async (_id: string) => ({ setting: null, credentialHeld: false })),
  set: vi.fn(async (_id: string, _body: unknown) => ({ ok: true, jobId: 'j1' })),
  disable: vi.fn(async (_id: string) => ({ ok: true })),
};

vi.mock('../../utils/api-hybrid', () => ({ api: { deployments: { tailscaleIngress } } }));

const { useTailscaleIngressApi } = await import('../../hooks/useTailscaleIngressApi');

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(qc, 'invalidateQueries');
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { Wrapper, spy };
}

describe('useTailscaleIngressApi (spec 010)', () => {
  it('reads the setting and keys it per deployment', async () => {
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useTailscaleIngressApi('dep-1'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(tailscaleIngress.get).toHaveBeenCalledWith('dep-1');
    expect(queryKeys.deployments.tailscaleIngress('dep-1')).toEqual(['deployments', 'tailscale-ingress', 'dep-1']);
  });

  it('set passes the body through and invalidates this key and the detail', async () => {
    const { Wrapper, spy } = wrapper();
    const { result } = renderHook(() => useTailscaleIngressApi('dep-1'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    await act(async () => { await result.current.setIngress({ serviceName: 'svc:a', tag: 'tag:t' }); });
    expect(tailscaleIngress.set).toHaveBeenCalledWith('dep-1', { serviceName: 'svc:a', tag: 'tag:t' });
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(queryKeys.deployments.tailscaleIngress('dep-1')));
    expect(keys).toContain(JSON.stringify(queryKeys.deployments.detail('dep-1')));
  });

  it('disable calls the API and invalidates', async () => {
    const { Wrapper, spy } = wrapper();
    const { result } = renderHook(() => useTailscaleIngressApi('dep-1'), { wrapper: Wrapper });
    await act(async () => { await result.current.disableIngress(); });
    expect(tailscaleIngress.disable).toHaveBeenCalledWith('dep-1');
    expect(spy).toHaveBeenCalled();
  });
});
