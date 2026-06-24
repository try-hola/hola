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

/**
 * sessionStorage markers that let the login screen auto-start SSO without
 * looping (see Login.tsx):
 *  - SSO_ATTEMPTED is set just before a signin redirect and cleared once we're
 *    authenticated. If we land back on /login with it still set, the silent
 *    sign-in failed — show the manual button instead of bouncing again.
 *  - SSO_SIGNED_OUT is set on an explicit logout so we don't immediately shove
 *    the user back into the IdP after they asked to leave.
 */
export const SSO_ATTEMPTED_KEY = 'hola.sso.attempted';
export const SSO_SIGNED_OUT_KEY = 'hola.sso.signedout';

function setSessionFlag(key: string): void {
  try { window.sessionStorage.setItem(key, '1'); } catch { /* private mode / disabled storage */ }
}
function takeSessionFlag(key: string): boolean {
  try {
    const had = window.sessionStorage.getItem(key) === '1';
    if (had) window.sessionStorage.removeItem(key);
    return had;
  } catch { return false; }
}

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
      // Sign-in succeeded — drop the auto-redirect guard so a future visit can
      // silently bounce again.
      takeSessionFlag(SSO_ATTEMPTED_KEY);
    } else {
      accessTokenRef.current = undefined;
      setStatus('unauthenticated');
    }
  }, []);

  // Boot: discover the auth mode and resolve the initial session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Retry the config fetch a few times: a transient blip (a 502 while the
      // server restarts, a momentary network drop) must NOT force the dashboard to
      // the apikey login on an OIDC deployment — which would also make the OIDC
      // callback discard its authorization code (AuthCallback bails on non-oidc).
      let config: AuthConfigResponse | undefined;
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        try {
          const res = await fetch(apiUrl('/api/auth/config'), { credentials: 'include' });
          if (!res.ok) throw new Error(`auth config ${res.status}`);
          config = (await res.json()) as AuthConfigResponse;
          break;
        } catch {
          if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
      if (cancelled) return;
      if (!config) {
        // Still unreachable after retries — fall back so the UI can surface an
        // error/login (the server is genuinely down, so OIDC couldn't complete anyway).
        setMode('apikey');
        setStatus('unauthenticated');
        return;
      }
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
      // Mark the attempt so the login screen falls back to a manual button if the
      // redirect round-trip returns us here still unauthenticated (a broken callback).
      setSessionFlag(SSO_ATTEMPTED_KEY);
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
      // Suppress the login screen's auto-redirect once, so logging out doesn't
      // immediately bounce the user back into the IdP.
      setSessionFlag(SSO_SIGNED_OUT_KEY);
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
