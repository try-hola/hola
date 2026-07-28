import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { AuthCallback } from '../../pages/AuthCallback';

/**
 * oidc-client-ts renews by loading `silent_redirect_uri` in a hidden iframe. That
 * URI defaults to `redirect_uri`, so renewals land on /auth/callback — the same
 * route as an interactive login. The two must NOT be completed the same way:
 * only signinSilentCallback() posts the result back to the parent frame, and
 * without it the parent's signinSilent() hangs until it times out. That failure
 * is invisible: the session simply expires early and the next focus refetch 401s.
 */

const completeOidcLogin = vi.fn(async () => {});
const completeOidcSilentRenew = vi.fn(async () => {});

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    mode: 'oidc',
    completeOidcLogin,
    completeOidcSilentRenew,
  }),
}));

function renderCallback() {
  return render(
    <MemoryRouter>
      <AuthCallback />
    </MemoryRouter>,
  );
}

describe('AuthCallback silent-renew handling', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('relays the result to the parent when framed, without running the login path', async () => {
    // window.self !== window.top is what a renewal iframe looks like.
    vi.stubGlobal('top', {} as Window);

    const { container } = renderCallback();

    await waitFor(() => expect(completeOidcSilentRenew).toHaveBeenCalledTimes(1));
    expect(completeOidcLogin).not.toHaveBeenCalled();
    // The frame is throwaway — it must not paint a "Completing sign-in…" screen.
    expect(container).toBeEmptyDOMElement();
  });

  it('completes an interactive login normally when not framed', async () => {
    vi.stubGlobal('top', window);

    renderCallback();

    await waitFor(() => expect(completeOidcLogin).toHaveBeenCalledTimes(1));
    expect(completeOidcSilentRenew).not.toHaveBeenCalled();
    expect(screen.getByText(/Completing sign-in|Signed in/)).toBeTruthy();
  });
});
