import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

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

function mockCatalog(apps: unknown[]) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/catalog/apps')) {
      return new Response(JSON.stringify({ items: apps, page: 1, limit: 100, total: apps.length }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not Found', { status: 404 });
  }) as unknown as typeof fetch;
}

const app = (over: Record<string, unknown> = {}) => ({
  id: 'webtop', name: 'Ubuntu Webtop', description: 'Ubuntu desktop in your browser',
  category: 'Productivity', icon: '🖥️', version: '1.1.1', tags: [],
  rating: 5, downloads: 0, featured: false, source: 'hola', trust: 'official', ...over,
});

describe('Catalog', () => {
  it('renders catalog cards that link straight into the install wizard', async () => {
    mockCatalog([app()]);

    render(<MemoryRouter><Catalog /></MemoryRouter>);

    expect(await screen.findByText('Ubuntu Webtop')).toBeInTheDocument();
    expect(screen.getByText('Ubuntu desktop in your browser')).toBeInTheDocument();
  });

  it('renders an image icon as a logo, never as literal URL text', async () => {
    // Regression guard: the card must go through AppIcon. A render site that
    // interpolates `app.icon` directly prints the raw URL for the URL-icon apps
    // that make up most of the catalog.
    const iconUrl = 'https://raw.githubusercontent.com/try-hola/apps/main/icons/webtop.svg';
    mockCatalog([app({ icon: iconUrl })]);

    render(<MemoryRouter><Catalog /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('Ubuntu Webtop')).toBeInTheDocument());
    expect(screen.queryByText(iconUrl)).not.toBeInTheDocument();
    const img = screen.getByAltText('Ubuntu Webtop icon') as HTMLImageElement;
    expect(img.src).toBe(iconUrl);
  });
});
