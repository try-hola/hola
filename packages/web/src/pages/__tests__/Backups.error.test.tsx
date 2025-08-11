import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Backups } from '../Backups';
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
    }) as typeof fetch;

    render(<BackupsWithRouter />);

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
    }) as typeof fetch;

    render(<BackupsWithRouter />);

    await waitFor(() => {
      expect(screen.getByText(/request failed.*500.*internal server error/i)).toBeInTheDocument();
    });
  });

  it('handles network errors gracefully', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('Network request failed');
    }) as typeof fetch;

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
    }) as typeof fetch;

    render(<BackupsWithRouter />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(API.backups.base),
        expect.any(Object)
      );
    });
  });
});
