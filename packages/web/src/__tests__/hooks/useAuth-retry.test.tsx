import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { AuthProvider, useAuth } from '../../hooks/useAuth';

function Probe() {
  const { status, mode } = useAuth();
  return <div data-testid="probe">{`status:${status} mode:${String(mode)}`}</div>;
}

describe('AuthProvider boot config retry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('retries the /api/auth/config fetch on a transient failure instead of forcing apikey', async () => {
    let configCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/config')) {
        configCalls += 1;
        if (configCalls < 2) throw new Error('network blip');
        return new Response(JSON.stringify({ mode: 'none' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </MemoryRouter>,
    );

    // The first fetch threw; the retry succeeds and resolves the REAL mode ('none'),
    // rather than the transient failure forcing mode to 'apikey'.
    await waitFor(
      () => expect(screen.getByTestId('probe').textContent).toContain('mode:none'),
      { timeout: 4000 },
    );
    expect(configCalls).toBeGreaterThanOrEqual(2);
  });
});
