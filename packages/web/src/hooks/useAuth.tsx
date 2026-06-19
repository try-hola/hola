/* eslint-disable react-refresh/only-export-components -- provider + hook are intentionally colocated */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import type { AuthConfigResponse, Principal } from '@hola/shared';

import { getWebBaseUrl } from '../utils/sdk-adapter';
import { setAuthTokenGetter, setUnauthorizedHandler } from '../utils/auth-token';

/**
 * Dashboard authentication. Reads /api/auth/config at boot to learn the mode:
 *   - none   → auth disabled; the app loads directly.
 *   - oidc   → Authorization Code + PKCE against Authentik (oidc-client-ts); the
 *              access token is sent as a Bearer header by the fetch layer.
 *   - apikey → admin-key fallback; login posts the key, the server sets an
 *              HttpOnly session cookie, and we authenticate by cookie thereafter.
 */

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';
export type AuthMode = 'none' | 'oidc' | 'apikey';

export interface AuthUser {
  name?: string;
  email?: string;
}

interface AuthContextValue {
  status: AuthStatus;
  mode: AuthMode | null;
  user: AuthUser | null;
  /** OIDC: start the redirect. apikey: pass the admin key. */
  login: (key?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Last login error (e.g. wrong admin key), cleared on the next attempt. */
  loginError: string | null;
  /** Completes the OIDC redirect; called by the /auth/callback route. */
  completeOidcLogin: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Same-origin in prod (nginx) / via the Vite proxy in dev; absolute only in tests. */
function apiUrl(path: string): string {
  return `${getWebBaseUrl()}${path}`;
}

function buildUserManager(oidc: NonNullable<AuthConfigResponse['oidc']>): UserManager {
  return new UserManager({
    // oidc-client-ts appends /.well-known/openid-configuration; strip the trailing
    // slash the Authentik issuer carries so we don't get a doubled slash.
    authority: oidc.issuer.replace(/\/$/, ''),
    client_id: oidc.clientId,
    redirect_uri: oidc.redirectUri,
    response_type: 'code',
    scope: oidc.scopes.join(' '),
    automaticSilentRenew: true,
    userStore: new WebStorageStateStore({ store: window.localStorage }),
    post_logout_redirect_uri: `${window.location.origin}/login`,
  });
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [mode, setMode] = useState<AuthMode | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  const managerRef = useRef<UserManager | null>(null);
  const accessTokenRef = useRef<string | undefined>(undefined);

  // Keep the fetch layer's token getter pointed at the current OIDC access token.
  useEffect(() => {
    setAuthTokenGetter(() => accessTokenRef.current);
    return () => setAuthTokenGetter(undefined);
  }, []);

  const applyOidcUser = useCallback((u: User | null) => {
    if (u && !u.expired) {
      accessTokenRef.current = u.access_token;
      setUser({ name: u.profile?.name, email: u.profile?.email });
      setStatus('authenticated');
    } else {
      accessTokenRef.current = undefined;
      setStatus('unauthenticated');
    }
  }, []);

  // Boot: discover the auth mode and resolve the initial session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let config: AuthConfigResponse;
      try {
        const res = await fetch(apiUrl('/api/auth/config'), { credentials: 'include' });
        config = (await res.json()) as AuthConfigResponse;
      } catch {
        // Can't reach the server — treat as unauthenticated so the UI can show an error.
        if (!cancelled) { setMode('apikey'); setStatus('unauthenticated'); }
        return;
      }
      if (cancelled) return;
      setMode(config.mode);

      if (config.mode === 'none') {
        setStatus('authenticated');
        return;
      }

      if (config.mode === 'oidc' && config.oidc) {
        const manager = buildUserManager(config.oidc);
        managerRef.current = manager;
        // Refresh the in-memory token when silent-renew issues a new one.
        manager.events.addUserLoaded((u) => applyOidcUser(u));
        manager.events.addUserUnloaded(() => applyOidcUser(null));
        try {
          applyOidcUser(await manager.getUser());
        } catch {
          if (!cancelled) setStatus('unauthenticated');
        }
        return;
      }

      // apikey: probe whether the session cookie already authenticates us.
      try {
        const me = await fetch(apiUrl('/api/auth/me'), { credentials: 'include' });
        if (!cancelled) {
          if (me.ok) {
            const principal = (await me.json()) as Principal;
            setUser({ name: principal.name, email: principal.email });
            setStatus('authenticated');
          } else {
            setStatus('unauthenticated');
          }
        }
      } catch {
        if (!cancelled) setStatus('unauthenticated');
      }
    })();
    return () => { cancelled = true; };
  }, [applyOidcUser]);

  // On a 401 from any API call, drop to unauthenticated so the guard shows login.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      accessTokenRef.current = undefined;
      // 'none' mode can't 401; ignore so we never trap a no-auth dev server.
      setStatus((s) => (mode === 'none' ? s : 'unauthenticated'));
    });
    return () => setUnauthorizedHandler(undefined);
  }, [mode]);

  const login = useCallback(async (key?: string) => {
    setLoginError(null);
    if (mode === 'oidc') {
      await managerRef.current?.signinRedirect();
      return;
    }
    if (mode === 'apikey') {
      if (!key) { setLoginError('Enter your admin key.'); return; }
      try {
        const res = await fetch(apiUrl('/api/auth/login'), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
        });
        if (!res.ok) { setLoginError('That key was not accepted.'); return; }
        const data = (await res.json()) as { principal?: Principal };
        setUser({ name: data.principal?.name, email: data.principal?.email });
        setStatus('authenticated');
      } catch {
        setLoginError('Could not reach the server.');
      }
    }
  }, [mode]);

  const logout = useCallback(async () => {
    if (mode === 'oidc') {
      const m = managerRef.current;
      accessTokenRef.current = undefined;
      try { await m?.signoutRedirect(); }
      catch { await m?.removeUser(); setStatus('unauthenticated'); }
      return;
    }
    if (mode === 'apikey') {
      try { await fetch(apiUrl('/api/auth/logout'), { method: 'POST', credentials: 'include' }); }
      finally { setUser(null); setStatus('unauthenticated'); }
    }
  }, [mode]);

  const completeOidcLogin = useCallback(async () => {
    const m = managerRef.current;
    if (!m) throw new Error('OIDC is not configured');
    const u = await m.signinRedirectCallback();
    applyOidcUser(u);
  }, [applyOidcUser]);

  return (
    <AuthContext.Provider value={{ status, mode, user, login, logout, loginError, completeOidcLogin }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
