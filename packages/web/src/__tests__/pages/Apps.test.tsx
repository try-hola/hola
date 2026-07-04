import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { API } from '@hola/shared';

import { Apps } from '../../pages/Apps';
import { globalCache } from '../../utils/cache';

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  globalCache.clear(); // hooks cache by key; isolate tests
});

afterEach(() => {
  global.fetch = originalFetch;
});

// The launcher renders from the deployments list alone — name + icon are persisted
// on each deployment at install, so there's no live catalog join here.
function mockApi(deployments: unknown[]) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes(API.deployments.base)) {
      return new Response(JSON.stringify({ items: deployments, page: 1, limit: 100, total: deployments.length }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not Found', { status: 404 });
  }) as unknown as typeof fetch;
}

const renderApps = () => render(<MemoryRouter><Apps /></MemoryRouter>);

describe('Apps landing', () => {
  it('renders the persisted app name + icon and launches the public URL', async () => {
    mockApi(
      [{ id: 'gitea-abc12345', name: 'Gitea', app: 'gitea', icon: '🍵', status: 'running', ports: [], lastUpdated: 'now', url: 'https://gitea.local.hola' }],
    );

    renderApps();

    const link = await screen.findByTitle('Open Gitea');
    expect(link).toHaveAttribute('href', 'https://gitea.local.hola');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByText('Gitea')).toBeInTheDocument();
    expect(screen.getByText('🍵')).toBeInTheDocument(); // persisted icon
    // Running tiles read as launchable ("Open"), not a status pill.
    expect(screen.getByText('Open')).toBeInTheDocument();
    // …and keep a manage shortcut to their deployment detail for troubleshooting.
    expect(screen.getByTitle('Manage & logs')).toHaveAttribute('href', '/deployments/gitea-abc12345');
  });

  it('renders every installed app; running launches externally, others route to detail', async () => {
    mockApi(
      [
        { id: 'a-1', name: 'Alpha', app: 'a', icon: '📦', status: 'running', ports: [], lastUpdated: 'now', url: 'https://a.local.hola' },
        { id: 'b-1', name: 'Bravo', app: 'b', icon: '📦', status: 'stopped', ports: [], lastUpdated: 'now' },
      ],
    );

    renderApps();

    expect(await screen.findByTitle('Open Alpha')).toHaveAttribute('href', 'https://a.local.hola');
    expect(screen.getByTitle('Bravo — view deployment')).toHaveAttribute('href', '/deployments/b-1');
  });

  it('shows the manage shortcut on a non-running (e.g. failed) app too, not just running ones', async () => {
    mockApi(
      [{ id: 'c-1', name: 'Charlie', app: 'c', icon: '📦', status: 'error', ports: [], lastUpdated: 'now' }],
    );

    renderApps();

    // Without this, the only way to reach Remove was clicking the tile itself
    // (not obvious) or hunting through the Deployments list nav.
    expect(await screen.findByTitle('Manage & logs')).toHaveAttribute('href', '/deployments/c-1');
  });

  it('falls back to the app id when the deployment has no display name', async () => {
    mockApi(
      [{ id: 'x-1', name: '', app: 'uptime-kuma', icon: '📦', status: 'installing', ports: [], lastUpdated: 'now' }],
    );

    renderApps();

    const link = await screen.findByTitle('uptime-kuma — view deployment');
    expect(link).toHaveAttribute('href', '/deployments/x-1');
  });

  it('filters the grid by the search box', async () => {
    mockApi(
      [
        { id: 'a-1', name: 'Alpha', app: 'a', icon: '📦', status: 'running', ports: [], lastUpdated: 'now', url: 'https://a.local.hola' },
        { id: 'b-1', name: 'Bravo', app: 'b', icon: '📦', status: 'running', ports: [], lastUpdated: 'now', url: 'https://b.local.hola' },
      ],
    );

    renderApps();

    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search apps…'), { target: { value: 'brav' } });

    expect(screen.getByText('Bravo')).toBeInTheDocument();
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
  });

  it('shows an empty state when nothing is installed', async () => {
    mockApi([]);
    renderApps();
    await waitFor(() => {
      expect(screen.getByText(/No apps installed yet/i)).toBeInTheDocument();
    });
  });
});
