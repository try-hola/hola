import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Catalog } from '../../pages/Catalog';
import { globalCache } from '../../utils/cache';

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  globalCache.clear(); // the catalog hook caches by key; isolate tests
});

afterEach(() => {
  global.fetch = originalFetch;
});

const page = (items: unknown[]) => ({ items, page: 1, limit: 100, total: items.length });

function mockApi(apps: unknown[], deployments: unknown[] = [], showPrerelease = false) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('/api/catalog/apps')
      ? page(apps)
      : url.includes('/api/deployments')
        ? page(deployments)
        : url.includes('/api/settings')
          ? { channels: { showPrerelease } }
          : null;
    if (!body) return new Response('Not Found', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
}

const app = (over: Record<string, unknown> = {}) => ({
  id: 'webtop', name: 'Ubuntu Webtop', description: 'Ubuntu desktop in your browser',
  category: 'Productivity', icon: '🖥️', version: '1.1.1', tags: [],
  rating: 5, downloads: 0, featured: false, source: 'hola', trust: 'official', ...over,
});

const deployment = (over: Record<string, unknown> = {}) => ({
  id: 'webtop-ab12cd34', name: 'Ubuntu Webtop', app: 'webtop', icon: '🖥️',
  status: 'running', ports: [], lastUpdated: 'now', ...over,
});

// Catalog now reads the deployments list (TanStack Query) to tell installed apps apart.
const renderCatalog = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><Catalog /></MemoryRouter>
    </QueryClientProvider>
  );
};

describe('Catalog', () => {
  it('renders catalog cards that link straight into the install wizard', async () => {
    mockApi([app()]);

    renderCatalog();

    expect(await screen.findByText('Ubuntu Webtop')).toBeInTheDocument();
    expect(screen.getByText('Ubuntu desktop in your browser')).toBeInTheDocument();
    const install = screen.getByRole('link', { name: /install/i });
    expect(install).toHaveAttribute('href', '/catalog/webtop/install');
  });

  it('renders an image icon as a logo, never as literal URL text', async () => {
    // Regression guard: the card must go through AppIcon. A render site that
    // interpolates `app.icon` directly prints the raw URL for the URL-icon apps
    // that make up most of the catalog.
    const iconUrl = 'https://raw.githubusercontent.com/try-hola/apps/main/icons/webtop.svg';
    mockApi([app({ icon: iconUrl })]);

    renderCatalog();

    await waitFor(() => expect(screen.getByText('Ubuntu Webtop')).toBeInTheDocument());
    expect(screen.queryByText(iconUrl)).not.toBeInTheDocument();
    const img = screen.getByAltText('Ubuntu Webtop icon') as HTMLImageElement;
    expect(img.src).toBe(iconUrl);
  });

  describe('already-installed apps', () => {
    it('replaces Install with an Installed marker and a link to the deployment', async () => {
      mockApi([app()], [deployment()]);

      renderCatalog();

      await waitFor(() => expect(screen.getByText('Installed ✓')).toBeInTheDocument());
      // No install affordance survives — the app is already here.
      expect(screen.queryByRole('link', { name: /install/i })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: /manage/i }))
        .toHaveAttribute('href', '/deployments/webtop-ab12cd34');
    });

    it('offers an "install another" link when the installed copy is multi-instance (#246)', async () => {
      mockApi([app()], [deployment({ multiInstance: true })]);

      renderCatalog();

      await waitFor(() => expect(screen.getByText('Installed ✓')).toBeInTheDocument());
      expect(screen.getByRole('link', { name: /another/i }))
        .toHaveAttribute('href', '/catalog/webtop/install?another=1');
    });

    it('counts a non-running deployment as installed', async () => {
      // The Traefik host is owned by app name regardless of status, so a stopped
      // or errored deployment still blocks a second install server-side.
      mockApi([app()], [deployment({ status: 'stopped' })]);

      renderCatalog();

      await waitFor(() => expect(screen.getByText('Installed ✓')).toBeInTheDocument());
      expect(screen.queryByRole('link', { name: /install/i })).not.toBeInTheDocument();
    });

    it('leaves other apps installable', async () => {
      mockApi([app(), app({ id: 'remo', name: 'Remo', description: 'Browser terminal' })], [deployment()]);

      renderCatalog();

      await waitFor(() => expect(screen.getByText('Remo')).toBeInTheDocument());
      // webtop is installed; remo is not, so exactly one Install link remains.
      const installs = screen.getAllByRole('link', { name: /install/i });
      expect(installs).toHaveLength(1);
      expect(installs[0]).toHaveAttribute('href', '/catalog/remo/install');
    });

    it('still offers Install when the deployments list is unavailable', async () => {
      // Non-fatal degradation: /api/deployments 404s, so nothing is known to be
      // installed and the catalog behaves as it did before this feature.
      global.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/catalog/apps')) {
          return new Response(JSON.stringify(page([app()])), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('Not Found', { status: 404 });
      }) as unknown as typeof fetch;

      renderCatalog();

      await waitFor(() => expect(screen.getByText('Ubuntu Webtop')).toBeInTheDocument());
      expect(screen.getByRole('link', { name: /install/i })).toBeInTheDocument();
      expect(screen.queryByText('Installed ✓')).not.toBeInTheDocument();
    });
  });

  // #428
  describe('release channels', () => {
    it.each([false, true])('shows no "available" hint and no per-channel install link when enrolled=%s', async (showPrerelease) => {
      mockApi([app({ channels: ['stable', 'rc'] })], [], showPrerelease);
      renderCatalog();
      await waitFor(() => expect(screen.getByText('Ubuntu Webtop')).toBeInTheDocument());
      expect(screen.queryByText(/rc available/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/available$/)).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /install on rc/i })).not.toBeInTheDocument();
    });

    it.each([false, true])('shows no "available" hint or install link for an installed app when enrolled=%s', async (showPrerelease) => {
      mockApi([app({ channels: ['stable', 'rc'] })], [deployment({ channel: 'stable' })], showPrerelease);
      renderCatalog();
      await waitFor(() => expect(screen.getByText('Installed ✓')).toBeInTheDocument());
      expect(screen.queryByText(/rc available/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /install on rc/i })).not.toBeInTheDocument();
    });

    it('shows the published-channel pill only when enrolled and the app has non-stable channels', async () => {
      mockApi([app({ channels: ['stable', 'rc'] })], [], true);
      renderCatalog();
      expect(await screen.findByTitle('Also published on rc')).toBeInTheDocument();
      expect(screen.getByText('rc')).toBeInTheDocument();
    });

    it('hides the published-channel pill when not enrolled', async () => {
      mockApi([app({ channels: ['stable', 'rc'] })], [], false);
      renderCatalog();
      await waitFor(() => expect(screen.getByText('Ubuntu Webtop')).toBeInTheDocument());
      expect(screen.queryByTitle(/Also published on/)).not.toBeInTheDocument();
    });

    it('hides the published-channel pill for a stable-only app even when enrolled', async () => {
      mockApi([app({ channels: ['stable'] })], [], true);
      renderCatalog();
      await waitFor(() => expect(screen.getByText('Ubuntu Webtop')).toBeInTheDocument());
      expect(screen.queryByTitle(/Also published on/)).not.toBeInTheDocument();
    });

    it('shows no version and routes the primary install to the first channel for an app with no stable version', async () => {
      mockApi([app({ version: undefined, channels: ['rc'] })]);
      renderCatalog();
      await waitFor(() => expect(screen.getByText('Ubuntu Webtop')).toBeInTheDocument());
      expect(screen.queryByText(/· v/)).not.toBeInTheDocument();
      const install = screen.getByRole('link', { name: /install/i });
      expect(install).toHaveAttribute('href', '/catalog/webtop/install?channel=rc');
    });

    it('does not offer "+ Another" for a single-instance installed app', async () => {
      mockApi([app({ channels: ['stable', 'rc'] })], [deployment({ channel: 'stable' })]);
      renderCatalog();
      await waitFor(() => expect(screen.getByText('Installed ✓')).toBeInTheDocument());
      expect(screen.queryByRole('link', { name: /another/i })).not.toBeInTheDocument();
    });

    it('offers "+ Another" when the installed deployment reports multiInstance', async () => {
      mockApi([app({ channels: ['stable', 'rc'] })], [deployment({ channel: 'stable', multiInstance: true })]);
      renderCatalog();
      await waitFor(() => expect(screen.getByText('Installed ✓')).toBeInTheDocument());
      expect(screen.getByRole('link', { name: /another/i }))
        .toHaveAttribute('href', '/catalog/webtop/install?another=1');
    });

    it('always shows "Installed ✓" and "Manage" for an installed app', async () => {
      mockApi([app()], [deployment()]);
      renderCatalog();
      await waitFor(() => expect(screen.getByText('Installed ✓')).toBeInTheDocument());
      expect(screen.getByRole('link', { name: /manage/i }))
        .toHaveAttribute('href', '/deployments/webtop-ab12cd34');
    });
  });
});
