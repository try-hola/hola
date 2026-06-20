import { render, screen, waitFor } from '@testing-library/react';
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

function mockApi(deployments: unknown[], catalog: unknown[]) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes(API.catalog.apps)) {
      return new Response(JSON.stringify({ items: catalog, page: 1, limit: 100, total: catalog.length }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
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
  it('shows the catalog product name (not the deployment name) and links to the public URL', async () => {
    mockApi(
      [{ id: 'gitea-abc12345', name: 'deployment-gitea-abc12345', app: 'gitea', icon: '📦', status: 'running', ports: [], lastUpdated: 'now', url: 'https://gitea.local.hola' }],
      [{ id: 'gitea', name: 'Gitea', description: '', icon: '🍵', category: 'apps', rating: 0, downloads: 0, tags: [], featured: false }],
    );

    renderApps();

    const link = await screen.findByTitle('Open Gitea');
    expect(link).toHaveAttribute('href', 'https://gitea.local.hola');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByText('Gitea')).toBeInTheDocument();
    // The deployment's internal name must NOT be shown.
    expect(screen.queryByText('deployment-gitea-abc12345')).not.toBeInTheDocument();
    expect(screen.getByText('🍵')).toBeInTheDocument(); // catalog icon wins over fallback
    expect(screen.getByText('Running')).toBeInTheDocument(); // status pill label
  });

  it('renders every installed app, not just running ones', async () => {
    mockApi(
      [
        { id: 'a-1', name: 'deployment-a-1', app: 'a', icon: '📦', status: 'running', ports: [], lastUpdated: 'now', url: 'https://a.local.hola' },
        { id: 'b-1', name: 'deployment-b-1', app: 'b', icon: '📦', status: 'stopped', ports: [], lastUpdated: 'now' },
      ],
      [
        { id: 'a', name: 'Alpha', description: '', icon: '📦', category: 'apps', rating: 0, downloads: 0, tags: [], featured: false },
        { id: 'b', name: 'Bravo', description: '', icon: '📦', category: 'apps', rating: 0, downloads: 0, tags: [], featured: false },
      ],
    );

    renderApps();

    // Running app opens externally; stopped app links to its detail page. Tiles
    // show the catalog product name.
    expect(await screen.findByTitle('Open Alpha')).toHaveAttribute('href', 'https://a.local.hola');
    expect(screen.getByTitle('Bravo')).toHaveAttribute('href', '/deployments/b-1');
  });

  it('falls back to the app id when the catalog has no match', async () => {
    mockApi(
      [{ id: 'x-1', name: 'deployment-x-1', app: 'uptime-kuma', icon: '📦', status: 'installing', ports: [], lastUpdated: 'now' }],
      [],
    );

    renderApps();

    // No catalog entry → fall back to the app id, never the deployment name.
    const link = await screen.findByTitle('uptime-kuma');
    expect(link).toHaveAttribute('href', '/deployments/x-1');
    expect(screen.queryByText('deployment-x-1')).not.toBeInTheDocument();
  });

  it('shows an empty state when nothing is installed', async () => {
    mockApi([], []);
    renderApps();
    await waitFor(() => {
      expect(screen.getByText(/No apps installed yet/i)).toBeInTheDocument();
    });
  });
});
