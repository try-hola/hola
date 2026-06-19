import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Backups } from '../../pages/Backups';
import { API } from '@hola/shared';

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
});

const BackupsWithRouter = () => (
  <MemoryRouter>
    <Backups />
  </MemoryRouter>
);

describe('Backups Error Handling', () => {
  it('shows ErrorResponse message on API failure', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes(API.backups.base)) {
        return new Response(JSON.stringify({ 
          error: { 
            code: 'PERMISSION_DENIED', 
            message: 'Permission denied' 
          } 
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    }) as unknown as typeof fetch;

    render(<BackupsWithRouter />);

    // The authenticated fetch layer surfaces the server's ErrorResponse message.
    await waitFor(() => {
      expect(screen.getByText(/permission denied/i)).toBeInTheDocument();
    });
  });

  it('shows fallback message on malformed error response', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes(API.backups.base)) {
        return new Response('Internal Server Error', {
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
      return new Response('Not Found', { status: 404 });
    }) as unknown as typeof fetch;

    render(<BackupsWithRouter />);

    // A non-JSON 5xx falls back to the status-based server-error message.
    await waitFor(() => {
      expect(screen.getByText(/server encountered an error/i)).toBeInTheDocument();
    });
  });

  it('handles network errors gracefully', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('Network request failed');
    }) as unknown as typeof fetch;

    render(<BackupsWithRouter />);

    await waitFor(() => {
      expect(screen.getByText(/network request failed/i)).toBeInTheDocument();
    });
  });

  it('uses shared API constants for all backup operations', async () => {
    global.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({
        items: [],
        page: 1,
        limit: 10,
        total: 0
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    render(<BackupsWithRouter />);

    await waitFor(() => {
      // Routed through the authenticated fetch layer, so the request carries
      // same-origin credentials (and a Bearer token when an OIDC session exists).
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/backups?page=1&limit=10",
        expect.objectContaining({ credentials: 'include' })
      );
    });
  });
});
