import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { Login } from '../../pages/Login';
import { SSO_ATTEMPTED_KEY, SSO_SIGNED_OUT_KEY } from '../../hooks/useAuth';

// Control the auth context per test; keep the real flag-key constants.
const login = vi.fn();
let authState: { status: string; mode: string | null; loginError: string | null };

vi.mock('../../hooks/useAuth', async (importActual) => {
  const actual = await importActual<typeof import('../../hooks/useAuth')>();
  return {
    ...actual,
    useAuth: () => ({
      ...authState,
      user: null,
      login,
      logout: vi.fn(),
      completeOidcLogin: vi.fn(),
    }),
  };
});

const renderLogin = () => render(<MemoryRouter><Login /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  authState = { status: 'unauthenticated', mode: 'oidc', loginError: null };
});

describe('Login — OIDC auto sign-in', () => {
  it('auto-starts the SSO redirect when unauthenticated with no guard flags', async () => {
    renderLogin();
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    // Shows the quiet "signing you in" state, not the manual button.
    expect(screen.getByText('Signing you in…')).toBeInTheDocument();
    expect(screen.queryByText('Sign in with SSO')).not.toBeInTheDocument();
  });

  it('does NOT auto-redirect right after an explicit logout — shows the manual button', async () => {
    window.sessionStorage.setItem(SSO_SIGNED_OUT_KEY, '1');
    renderLogin();
    expect(await screen.findByText('Sign in with SSO')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
    // The guard is consumed so a later visit can auto-redirect again.
    expect(window.sessionStorage.getItem(SSO_SIGNED_OUT_KEY)).toBeNull();
  });

  it('does NOT loop when a prior attempt returned us here unauthenticated', async () => {
    window.sessionStorage.setItem(SSO_ATTEMPTED_KEY, '1');
    renderLogin();
    expect(await screen.findByText('Sign in with SSO')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(SSO_ATTEMPTED_KEY)).toBeNull();
  });

  it('shows the admin-key form (no auto-redirect) in apikey mode', async () => {
    authState = { status: 'unauthenticated', mode: 'apikey', loginError: null };
    renderLogin();
    expect(await screen.findByPlaceholderText('hola admin key')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });
});
