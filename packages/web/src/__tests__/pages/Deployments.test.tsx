import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
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

// #428 / spec 005: the deployments list renders a channel pill (via `pillFor`
// → `ChannelPill`) for a non-stable row, and a "Pre-release" filter chip that
// sends `prerelease=true` server-side (US5).
// `vi.mock` factories are hoisted above the module's own top-level code, so a
// mock that needs a per-test-controllable return value must route through
// `vi.hoisted` — a bare closure over a later `const` would see it as
// undefined at hoist time.
const { listApi, removeApi, prereleaseEnrolled } = vi.hoisted(() => ({
  listApi: vi.fn(),
  removeApi: vi.fn(),
  prereleaseEnrolled: vi.fn(() => false),
}));
vi.mock('../../utils/api-hybrid', () => ({
  api: { deployments: { list: (...args: unknown[]) => listApi(...args) } },
}));
// The list page reaches for `utils/api` (not the hybrid client) for the
// destructive DELETE and the catalog re-check, so the remove flow below is
// driven through this second mock.
vi.mock('../../utils/api', () => ({
  api: {
    deployments: { remove: (...args: unknown[]) => removeApi(...args) },
    catalog: { refresh: vi.fn(async () => ({})) },
  },
}));
// usePrereleaseEnrolment is backed by a settings fetch through a different
// path (useSettingsApi/safeFetchEnhanced) than the mocked deployments list
// above; stubbing the hook directly keeps this suite focused on Deployments'
// own pill/chip logic rather than re-testing settings plumbing.
vi.mock('../../hooks/usePrereleaseEnrolment', () => ({
  usePrereleaseEnrolment: () => prereleaseEnrolled(),
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
    prereleaseEnrolled.mockReset();
    prereleaseEnrolled.mockReturnValue(false);
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

  // --- pillFor cases (spec 005, data-model.md "Pill selection") ---

  it('pillFor: a running build on a non-stable channel wins ("Running a beta build")', async () => {
    await renderList([{ ...mockDeployments[0], channel: 'stable', versionChannel: 'beta' }]);
    const pill = await screen.findByTitle('Running a beta build');
    expect(pill).toHaveTextContent('beta');
    cleanup();
  });

  it('pillFor: falls back to the followed channel when versionChannel is unknown ("Follows the beta channel")', async () => {
    await renderList([{ ...mockDeployments[0], channel: 'beta', versionChannel: undefined }]);
    const pill = await screen.findByTitle('Follows the beta channel');
    expect(pill).toHaveTextContent('beta');
    cleanup();
  });

  it('pillFor: stable channel + stable running build renders no pill at all', async () => {
    await renderList([{ ...mockDeployments[0], channel: 'stable', versionChannel: 'stable' }]);
    await screen.findByText(mockDeployments[0].name);
    expect(screen.queryByTitle(/Follows the .* channel/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Running a .* build/)).not.toBeInTheDocument();
    cleanup();
  });

  // --- "Pre-release" filter chip (spec 005, US5) ---

  it('shows the Pre-release chip when enrolled, even though every visible row is stable', async () => {
    prereleaseEnrolled.mockReturnValue(true);
    await renderList([{ ...mockDeployments[0], channel: 'stable', versionChannel: 'stable' }]);
    expect(await screen.findByText('Pre-release')).toBeInTheDocument();
    cleanup();
  });

  it('shows the Pre-release chip when any visible row is non-stable, even when not enrolled', async () => {
    prereleaseEnrolled.mockReturnValue(false);
    await renderList([{ ...mockDeployments[0], channel: 'rc' }]);
    expect(await screen.findByText('Pre-release')).toBeInTheDocument();
    cleanup();
  });

  it('hides the Pre-release chip when not enrolled and every visible row is stable', async () => {
    prereleaseEnrolled.mockReturnValue(false);
    await renderList([{ ...mockDeployments[0], channel: 'stable', versionChannel: 'stable' }]);
    await screen.findByText(mockDeployments[0].name);
    expect(screen.queryByText('Pre-release')).not.toBeInTheDocument();
    cleanup();
  });

  it('clicking the Pre-release chip filters server-side and resets the page; toggling off drops the param', async () => {
    prereleaseEnrolled.mockReturnValue(true); // chip visible from the start regardless of rows
    const page1Items: DeploymentListItem[] = Array.from({ length: 12 }, (_, i) => ({
      ...mockDeployments[0],
      id: `d-${i}`,
      name: `App ${i}`,
    }));

    listApi.mockResolvedValueOnce({ items: page1Items, page: 1, limit: 12, total: 20 });
    const { Deployments } = await import('../../pages/Deployments');
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <Deployments />
        </MemoryRouter>
      </QueryClientProvider>
    );
    await screen.findByText('App 0');
    expect(listApi).toHaveBeenCalledTimes(1);

    // Move to page 2 first, to prove the chip click below resets it to 1.
    listApi.mockResolvedValueOnce({ items: page1Items, page: 2, limit: 12, total: 20 });
    fireEvent.click(screen.getByTitle('Next page'));
    await waitFor(() => expect(listApi).toHaveBeenCalledTimes(2));
    expect(listApi.mock.calls[1]![0]).toMatchObject({ page: 2 });
    expect((listApi.mock.calls[1]![0] as { prerelease?: boolean }).prerelease).toBeUndefined();

    // Click the chip: prerelease=true is sent and the page resets to 1.
    listApi.mockResolvedValueOnce({ items: [], page: 1, limit: 12, total: 0 });
    fireEvent.click(screen.getByText('Pre-release'));
    await waitFor(() => expect(listApi).toHaveBeenCalledTimes(3));
    expect(listApi.mock.calls[2]![0]).toMatchObject({ page: 1, prerelease: true });

    // Toggle the chip back off: the param is dropped from the next call.
    listApi.mockResolvedValueOnce({ items: page1Items, page: 1, limit: 12, total: 20 });
    fireEvent.click(screen.getByText('Pre-release'));
    await waitFor(() => expect(listApi).toHaveBeenCalledTimes(4));
    expect((listApi.mock.calls[3]![0] as { prerelease?: boolean }).prerelease).toBeUndefined();

    cleanup();
  });
});

// #446: the list-level remove confirmation is the shared `ConfirmDialog` with
// `danger` — same copy, same handlers, same busy/error states as before.
describe('Deployments - remove confirmation (#446)', () => {
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
    removeApi.mockReset();
    prereleaseEnrolled.mockReset();
    prereleaseEnrolled.mockReturnValue(false);
  });

  it('opens a danger-styled dialog naming the row and removes it on confirm', async () => {
    removeApi.mockResolvedValue({ ok: true });
    await renderList([mockDeployments[0]]);

    fireEvent.click(await screen.findByTitle('Remove'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Remove Nextcloud?')).toBeInTheDocument();
    expect(
      within(dialog).getByText(/This permanently removes the deployment: it stops and deletes the containers/)
    ).toBeInTheDocument();

    // The destructive confirm carries ConfirmDialog's `danger` styling.
    const confirm = within(dialog).getByRole('button', { name: 'Remove' });
    expect(confirm).toHaveClass('bg-danger');

    listApi.mockResolvedValueOnce({ items: [], page: 1, limit: 100, total: 0 });
    fireEvent.click(confirm);
    await waitFor(() => expect(removeApi).toHaveBeenCalledWith('nextcloud-prod'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    cleanup();
  });

  it('keeps the dialog open and shows the failure inline when removal fails', async () => {
    removeApi.mockRejectedValue(new Error('teardown failed'));
    await renderList([mockDeployments[0]]);

    fireEvent.click(await screen.findByTitle('Remove'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    expect(await within(dialog).findByText('teardown failed')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    cleanup();
  });

  it('treats a 404 as success (idempotent DELETE) and closes the dialog', async () => {
    removeApi.mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }));
    await renderList([mockDeployments[0]]);

    fireEvent.click(await screen.findByTitle('Remove'));
    listApi.mockResolvedValueOnce({ items: [], page: 1, limit: 100, total: 0 });
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    cleanup();
  });

  it('closes without removing when Cancel is clicked', async () => {
    await renderList([mockDeployments[0]]);

    fireEvent.click(await screen.findByTitle('Remove'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(removeApi).not.toHaveBeenCalled();
    cleanup();
  });
});
