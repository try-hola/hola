import { render, renderHook, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Backups } from '../../pages/Backups';
import { API } from '@hola/shared';
import { globalCache } from '../../utils/cache';
import { useBackupsApi } from '../../hooks/useBackupsApi';

/**
 * The Backups page offers no control that lies about having changed something
 * (F12).
 *
 * `DELETE /api/backups/:id` answered `{ ok: true }` without deleting anything,
 * and the row's Trash button was the only thing that ever called it. Hola
 * brokers backups rather than performing them (ADR 0004), so there is no server
 * verb behind that button and none is coming in this shape — the route and the
 * button went together.
 *
 * The row is rendered here from a stubbed list to assert it, because the live
 * list is always empty (there is no backup store yet, #160) and an empty table
 * would pass this test for the wrong reason — it would assert nothing at all.
 */

const originalFetch = global.fetch;

const ROW = {
  id: 'backup-1',
  app: 'paperless',
  appId: 'paperless',
  timestamp: '2026-01-01T00:00:00.000Z',
  sizeBytes: 1024,
  status: 'completed' as const,
  type: 'automatic' as const,
};

beforeEach(() => {
  globalCache.clear();
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes(API.backups.base)) {
      return new Response(JSON.stringify({ items: [ROW], page: 1, limit: 10, total: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not Found', { status: 404 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  globalCache.clear();
  cleanup();
});

describe('Backups page offers no fictitious mutations (F12)', () => {
  it('renders a backup row with no Delete control', async () => {
    render(<MemoryRouter><Backups /></MemoryRouter>);

    // The row is really on screen — otherwise the absence below proves nothing.
    expect(await screen.findByText('paperless')).toBeInTheDocument();
    expect(screen.getByTitle('Download')).toBeInTheDocument();

    expect(screen.queryByTitle('Delete')).not.toBeInTheDocument();
  });

  it('exposes no backup-mutating method from the hook', async () => {
    // A typed client method is what makes a dead route reachable, and the page
    // is not the only caller a hook can acquire — `createBackup` was already
    // wired to nothing when it was removed, and it was still one import away
    // from being a button again.
    const { result } = renderHook(() => useBackupsApi());
    await waitFor(() => expect(result.current.data).not.toBeNull());

    expect(Object.keys(result.current).sort()).toEqual(
      ['data', 'downloadBackup', 'error', 'loading', 'refetch'],
    );
  });
});
