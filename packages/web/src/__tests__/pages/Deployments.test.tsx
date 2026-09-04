import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { sdkAdapter } from '../../utils/sdk-adapter';
import { mockFetch, createMockResponse } from '../../setupTests';
import type { GetDeploymentsResponse, GetDeploymentsRequest, DeploymentListItem } from '@hola/shared';

const mockDeployments: DeploymentListItem[] = [
  {
    id: 'nextcloud-prod',
    name: 'Nextcloud',
    app: 'nextcloud',
    icon: '☁️',
    status: 'running',
    uptime: '15 days',
    version: '28.0.2',
    resources: { cpu: '12%', memory: '256MB' },
    ports: ['8080:80', '8443:443'],
    lastUpdated: '2 days ago',
    url: 'https://nextcloud.local'
  },
  {
    id: 'grafana-monitoring',
    name: 'Grafana',
    app: 'grafana',
    icon: '📊',
    status: 'stopped',
    uptime: '0 days',
    version: '10.3.1',
    resources: { cpu: '0%', memory: '0MB' },
    ports: ['3000:3000'],
    lastUpdated: '1 hour ago',
    url: 'https://grafana.local'
  }
];

// Test the SDK adapter deployments functionality directly
describe('Deployments - SDK Adapter', () => {
  beforeEach(() => {
    // Clear the mock and any cached data between tests
    mockFetch.mockClear();
    sdkAdapter.clearCache();
  });

  it('fetches deployments list when API call succeeds', async () => {
    const mockResponse: GetDeploymentsResponse = {
      items: mockDeployments,
      page: 1,
      limit: 10,
      total: 2
    };

    mockFetch.mockResolvedValueOnce(createMockResponse(mockResponse));

    const params: GetDeploymentsRequest = { page: 1, limit: 10 };
    const result = await sdkAdapter.deployments.list(params);

    expect(result).toBeDefined();
    expect(result.items).toHaveLength(2);
    expect(result.items[0].name).toBe('Nextcloud');
    expect(result.items[1].name).toBe('Grafana');
    expect(result.total).toBe(2);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('handles API error gracefully', async () => {
    const errorResponse = createMockResponse(
      { 
        error: { 
          code: 'PERMISSION_DENIED', 
          message: 'Permission denied' 
        } 
      },
      { status: 403, ok: false }
    );

    mockFetch.mockResolvedValueOnce(errorResponse);

    const params: GetDeploymentsRequest = { page: 1, limit: 10 };
    
    await expect(sdkAdapter.deployments.list(params)).rejects.toThrow('Permission denied');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('filters deployments by status correctly', async () => {
    const filteredMockResponse: GetDeploymentsResponse = {
      items: [mockDeployments[0]], // Only running deployment
      page: 1,
      limit: 10,
      total: 1
    };

    mockFetch.mockResolvedValueOnce(createMockResponse(filteredMockResponse));

    const params: GetDeploymentsRequest = { page: 1, limit: 10, status: 'running' };
    const result = await sdkAdapter.deployments.list(params);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].status).toBe('running');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/deployments?page=1&limit=10&status=running'),
      expect.any(Object)
    );
  });

  it('shows empty state when no deployments', async () => {
    const emptyResponse: GetDeploymentsResponse = {
      items: [],
      page: 1,
      limit: 10,
      total: 0
    };

    mockFetch.mockResolvedValueOnce(createMockResponse(emptyResponse));

    const params: GetDeploymentsRequest = { page: 1, limit: 10 };
    const result = await sdkAdapter.deployments.list(params);

    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('uses correct API endpoint with query parameters', async () => {
    const mockResponse: GetDeploymentsResponse = {
      items: mockDeployments,
      page: 2,
      limit: 5,
      total: 2
    };

    mockFetch.mockResolvedValueOnce(createMockResponse(mockResponse));

    const params: GetDeploymentsRequest = { 
      page: 2, 
      limit: 5, 
      q: 'nextcloud',
      status: 'running'
    };
    
    await sdkAdapter.deployments.list(params);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/deployments?page=2&limit=5&q=nextcloud&status=running'),
      expect.any(Object)
    );
  });
});

// #428: the deployments list renders a channel pill for a non-stable row.
// `vi.mock` factories are hoisted above the module's own top-level code, so a
// mock that needs a per-test-controllable return value must route through
// `vi.hoisted` — a bare closure over a later `const` would see it as
// undefined at hoist time.
const { listApi } = vi.hoisted(() => ({ listApi: vi.fn() }));
vi.mock('../../utils/api-hybrid', () => ({
  api: { deployments: { list: (...args: unknown[]) => listApi(...args) } },
}));

describe('Deployments - channel pill (#428)', () => {
  async function renderList(items: DeploymentListItem[]) {
    listApi.mockResolvedValueOnce({ items, page: 1, limit: 100, total: items.length });
    const { Deployments } = await import('../../pages/Deployments');
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <Deployments />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  beforeEach(() => {
    listApi.mockClear();
  });

  it('renders a pill for a non-stable channel', async () => {
    await renderList([{ ...mockDeployments[0], channel: 'rc' }]);
    expect(await screen.findByText('rc')).toBeInTheDocument();
    cleanup();
  });

  it('renders no pill for a stable channel', async () => {
    await renderList([{ ...mockDeployments[0], channel: 'stable' }]);
    await screen.findByText(mockDeployments[0].name);
    expect(screen.queryByText('stable')).not.toBeInTheDocument();
    cleanup();
  });

  it('renders no pill when channel is absent (pre-feature record)', async () => {
    await renderList([{ ...mockDeployments[0], channel: undefined }]);
    await screen.findByText(mockDeployments[0].name);
    expect(screen.queryByText('stable')).not.toBeInTheDocument();
    cleanup();
  });

  it('the update pill names a non-stable target channel (#428, US3)', async () => {
    await renderList([{
      ...mockDeployments[0],
      channel: 'rc',
      updateAvailable: true,
      latestVersion: '1.3.0-rc.2',
      latestVersionChannel: 'rc',
    }]);
    expect(await screen.findByText(/1\.3\.0-rc\.2 \(rc\)/)).toBeInTheDocument();
    cleanup();
  });
});
