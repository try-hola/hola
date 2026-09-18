import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { globalCache } from '../../utils/cache';

const originalFetch = global.fetch;

const page = (items: unknown[]) => ({ items, page: 1, limit: 100, total: items.length });

/**
 * `PrereleaseCard` reads settings via `useSettingsApi` (raw `fetch` through
 * `safeFetchEnhanced`) and the deployments list via `useDeploymentsApi`
 * (TanStack Query over `api-hybrid`, which itself calls `fetch`) — so a single
 * `global.fetch` stub covers both, matching the pattern already proven in
 * `Catalog.test.tsx`.
 */
function mockApi(showPrerelease: boolean, deployments: unknown[] = []) {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/settings') && (!init || init.method === undefined || init.method === 'GET')) {
      return new Response(JSON.stringify({ channels: { showPrerelease } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/api/settings') && init?.method === 'PATCH') {
      return new Response(JSON.stringify({ channels: { showPrerelease } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/api/deployments')) {
      return new Response(JSON.stringify(page(deployments)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not Found', { status: 404 });
  }) as unknown as typeof fetch;
}

const deployment = (over: Record<string, unknown> = {}) => ({
  id: 'app-ab12cd34', name: 'App', app: 'app', icon: '📦',
  status: 'running', ports: [], lastUpdated: 'now', channel: 'stable', ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  globalCache.clear(); // useSettingsApi caches by key; isolate tests
});

afterEach(() => {
  global.fetch = originalFetch;
  cleanup();
});

const { PrereleaseCard } = await import('../../pages/Settings');

const renderCard = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PrereleaseCard />
    </QueryClientProvider>
  );
};

describe('Settings → Pre-release apps', () => {
  it('renders the heading, explainer and a switch reflecting the current setting (off)', async () => {
    mockApi(false, []);
    renderCard();

    expect(await screen.findByText('Pre-release apps')).toBeInTheDocument();
    expect(screen.getByText(
      'Pre-release versions may be unstable. You can join or leave a channel per app at any time.'
    )).toBeInTheDocument();

    const toggle = await screen.findByRole('switch', { name: /Show pre-release channels \(beta, rc\)/i });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
  });

  it('reflects an enrolled setting as checked', async () => {
    mockApi(true, []);
    renderCard();

    const toggle = await screen.findByRole('switch', { name: /Show pre-release channels \(beta, rc\)/i });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  });

  it('shows the count of deployments following a pre-release channel when not enrolled', async () => {
    mockApi(false, [
      deployment({ id: 'a', channel: 'beta' }),
      deployment({ id: 'b', channel: 'rc' }),
      deployment({ id: 'c', channel: 'stable' }),
    ]);
    renderCard();

    expect(await screen.findByText('2 installed apps currently follow a pre-release channel')).toBeInTheDocument();
  });

  it('shows the count of deployments following a pre-release channel when enrolled too', async () => {
    mockApi(true, [
      deployment({ id: 'a', channel: 'beta' }),
      deployment({ id: 'b', channel: 'rc' }),
      deployment({ id: 'c', channel: 'stable' }),
    ]);
    renderCard();

    expect(await screen.findByText('2 installed apps currently follow a pre-release channel')).toBeInTheDocument();
  });

  it('shows no count line when no deployment follows a pre-release channel', async () => {
    mockApi(false, [
      deployment({ id: 'a', channel: 'stable' }),
      deployment({ id: 'b', channel: 'stable' }),
    ]);
    renderCard();

    await screen.findByText('Pre-release apps');
    expect(screen.queryByText(/currently follow a pre-release channel/)).not.toBeInTheDocument();
  });

  it('toggling the switch PATCHes /api/settings with the new value', async () => {
    mockApi(false, []);
    renderCard();

    const toggle = await screen.findByRole('switch', { name: /Show pre-release channels \(beta, rc\)/i });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));

    fireEvent.click(toggle);

    await waitFor(() => {
      const patchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([input, init]: [RequestInfo | URL, RequestInit?]) =>
          String(input).includes('/api/settings') && init?.method === 'PATCH'
      );
      expect(patchCall).toBeTruthy();
      expect(JSON.parse((patchCall![1] as RequestInit).body as string)).toEqual({
        channels: { showPrerelease: true },
      });
    });
  });

  it('toggling off PATCHes showPrerelease: false', async () => {
    mockApi(true, []);
    renderCard();

    const toggle = await screen.findByRole('switch', { name: /Show pre-release channels \(beta, rc\)/i });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));

    fireEvent.click(toggle);

    await waitFor(() => {
      const patchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([input, init]: [RequestInfo | URL, RequestInit?]) =>
          String(input).includes('/api/settings') && init?.method === 'PATCH'
      );
      expect(patchCall).toBeTruthy();
      expect(JSON.parse((patchCall![1] as RequestInit).body as string)).toEqual({
        channels: { showPrerelease: false },
      });
    });
  });
});
