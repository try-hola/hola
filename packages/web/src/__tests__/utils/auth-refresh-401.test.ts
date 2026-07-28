import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  refreshAuthToken,
  setAuthTokenGetter,
  setTokenRefresher,
  setUnauthorizedHandler,
} from '../../utils/auth-token';
import { safeFetchEnhanced } from '../../utils/error-enhanced';

/**
 * Regression cover for the background-tab 401.
 *
 * Returning to a tab that sat in the background fires `refetchOnWindowFocus` for
 * every mounted query. The renewal timer is throttled while hidden, so those
 * refetches can carry an access token that expired even though the session is
 * still valid. That 401 must be recovered in place, not surfaced as
 * "Could not load apps: Authentication failed".
 */

const unauthorized = new Response(JSON.stringify({ error: { message: 'Authentication failed' } }), {
  status: 401,
  headers: { 'content-type': 'application/json' },
});
const ok = () =>
  new Response(JSON.stringify({ apps: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

function authHeaderOf(call: [RequestInfo | URL, RequestInit?]): string | null {
  return new Headers(call[1]?.headers).get('Authorization');
}

describe('safeFetchEnhanced 401 refresh-and-retry', () => {
  beforeEach(() => {
    setAuthTokenGetter(() => 'stale-token');
    setTokenRefresher(undefined);
    setUnauthorizedHandler(undefined);
  });

  afterEach(() => {
    setAuthTokenGetter(undefined);
    setTokenRefresher(undefined);
    setUnauthorizedHandler(undefined);
    vi.unstubAllGlobals();
  });

  it('refreshes the token and replays the request instead of failing the query', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Headers(init?.headers).get('Authorization') === 'Bearer fresh-token'
        ? ok()
        : unauthorized.clone(),
    );
    vi.stubGlobal('fetch', fetchMock);

    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    setTokenRefresher(async () => 'fresh-token');

    const res = await safeFetchEnhanced('/api/deployments');

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authHeaderOf(fetchMock.mock.calls[0])).toBe('Bearer stale-token');
    expect(authHeaderOf(fetchMock.mock.calls[1])).toBe('Bearer fresh-token');
    // The session was recoverable, so the app must NOT be dropped to login.
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('drops to login when the refresh itself fails', async () => {
    const fetchMock = vi.fn(async () => unauthorized.clone());
    vi.stubGlobal('fetch', fetchMock);

    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    setTokenRefresher(async () => {
      throw new Error('silent renew failed');
    });

    await expect(safeFetchEnhanced('/api/deployments')).rejects.toThrow();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    // One attempt only — a failed refresh means there is nothing to replay with.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('drops to login when the replayed request is also rejected', async () => {
    const fetchMock = vi.fn(async () => unauthorized.clone());
    vi.stubGlobal('fetch', fetchMock);

    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    setTokenRefresher(async () => 'fresh-but-still-rejected');

    await expect(safeFetchEnhanced('/api/deployments')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('does not attempt a refresh for the auth endpoints themselves', async () => {
    const fetchMock = vi.fn(async () => unauthorized.clone());
    vi.stubGlobal('fetch', fetchMock);

    const refresher = vi.fn(async () => 'fresh-token');
    setTokenRefresher(refresher);

    await expect(safeFetchEnhanced('/api/auth/login')).rejects.toThrow();
    // A 401 from login is "wrong key", not an expired session.
    expect(refresher).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cookie mode has no refresher, so a 401 drops straight to login', async () => {
    setAuthTokenGetter(() => undefined);
    const fetchMock = vi.fn(async () => unauthorized.clone());
    vi.stubGlobal('fetch', fetchMock);

    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);

    await expect(safeFetchEnhanced('/api/deployments')).rejects.toThrow();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('refreshAuthToken concurrency', () => {
  afterEach(() => setTokenRefresher(undefined));

  it('shares one renewal across a burst of parallel 401s', async () => {
    // The whole point: a focus refetch 401s every mounted query at once, and they
    // must not each fire their own silent renew.
    let resolveRenewal: (t: string) => void = () => {};
    const refresher = vi.fn(
      () => new Promise<string | undefined>((resolve) => { resolveRenewal = resolve; }),
    );
    setTokenRefresher(refresher);

    const inFlight = [refreshAuthToken(), refreshAuthToken(), refreshAuthToken()];
    resolveRenewal('fresh-token');

    expect(await Promise.all(inFlight)).toEqual(['fresh-token', 'fresh-token', 'fresh-token']);
    expect(refresher).toHaveBeenCalledTimes(1);
  });

  it('allows a new renewal after the previous one settles', async () => {
    const refresher = vi.fn(async () => 'fresh-token');
    setTokenRefresher(refresher);

    expect(await refreshAuthToken()).toBe('fresh-token');
    expect(await refreshAuthToken()).toBe('fresh-token');
    expect(refresher).toHaveBeenCalledTimes(2);
  });
});
