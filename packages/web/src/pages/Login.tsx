import React, { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { KeyRound, ShieldCheck, LogIn, Loader2 } from 'lucide-react';

import { useAuth, SSO_ATTEMPTED_KEY, SSO_SIGNED_OUT_KEY } from '../hooks/useAuth';

/** Read and clear a sessionStorage marker; false if absent or storage is blocked. */
function takeFlag(key: string): boolean {
  try {
    const had = window.sessionStorage.getItem(key) === '1';
    if (had) window.sessionStorage.removeItem(key);
    return had;
  } catch { return false; }
}

/**
 * Login screen. Adapts to the server's auth mode:
 *  - oidc   → auto-starts the SSO redirect so a user who already has an IdP
 *             session lands in the app with no click; falls back to a manual
 *             "Sign in with SSO" button after a logout or a failed round-trip.
 *  - apikey → an admin-key field that posts to the session-login endpoint.
 * Already-authenticated users (or auth-disabled servers) are bounced to the app.
 */
export const Login: React.FC = () => {
  const { status, mode, login, loginError } = useAuth();
  const location = useLocation();
  const [key, setKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Assume OIDC will auto-redirect so the spinner shows immediately (no button
  // flash); the effect flips this off if we fall back to the manual button.
  const [autoRedirecting, setAutoRedirecting] = useState(mode === 'oidc');
  const decided = useRef(false);

  // OIDC: auto-start the redirect once. We skip (showing the manual button) when
  // the user just logged out, or when a prior attempt bounced us back here still
  // unauthenticated — either case would otherwise loop straight back to the IdP.
  useEffect(() => {
    if (mode !== 'oidc' || status !== 'unauthenticated' || decided.current) return;
    decided.current = true;
    const justSignedOut = takeFlag(SSO_SIGNED_OUT_KEY);
    const priorAttemptFailed = takeFlag(SSO_ATTEMPTED_KEY);
    if (justSignedOut || priorAttemptFailed) {
      setAutoRedirecting(false); // fall through to the manual button
      return;
    }
    setAutoRedirecting(true);
    void login();
  }, [mode, status, login]);

  if (status === 'authenticated') {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  // While the auto-redirect (or the post-config 'loading' window for OIDC) is in
  // flight, show a quiet "signing you in" state rather than flashing the button.
  if (status === 'loading' || autoRedirecting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-0 text-text-strong px-4">
        <div className="flex flex-col items-center gap-3 animate-fadein">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
          <p className="text-text-muted text-sm">Signing you in…</p>
        </div>
      </div>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(key);
    } finally {
      setSubmitting(false);
    }
  };

  const onSso = async () => {
    setSubmitting(true);
    try {
      await login();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0 text-text-strong px-4">
      <div className="w-full max-w-[380px] animate-fadein">
        <div className="flex items-center gap-3 mb-7 justify-center">
          <div className="w-10 h-10 rounded-[11px] bg-primary/15 border border-primary/30 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-primary" />
          </div>
          <div className="font-semibold text-[20px] tracking-[-0.01em]">Hola</div>
        </div>

        <div className="bg-surface-1 border border-border rounded-[15px] p-7 shadow-xl">
          <h1 className="text-[17px] font-semibold mb-1">Sign in</h1>
          <p className="text-text-muted text-[13px] mb-6">
            {mode === 'oidc'
              ? 'Continue with your single sign-on provider.'
              : 'Enter the admin API key for this deployment.'}
          </p>

          {mode === 'oidc' ? (
            <button
              onClick={onSso}
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 h-11 px-4 bg-primary text-white rounded-[10px] text-sm font-semibold shadow-primary-glow hover:brightness-110 transition disabled:opacity-60"
            >
              <LogIn className="w-[18px] h-[18px]" />
              {submitting ? 'Redirecting…' : 'Sign in with SSO'}
            </button>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-3">
              <label className="text-[12px] font-medium text-text-muted" htmlFor="adminKey">
                Admin key
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-text-faint absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="adminKey"
                  type="password"
                  autoFocus
                  autoComplete="current-password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="hola admin key"
                  className="w-full h-11 bg-surface-0 border border-border rounded-[9px] text-text-strong pl-9 pr-3 text-[13px] font-mono outline-none focus:border-primary"
                />
              </div>
              <button
                type="submit"
                disabled={submitting || !key}
                className="w-full flex items-center justify-center gap-2 h-11 px-4 bg-primary text-white rounded-[10px] text-sm font-semibold shadow-primary-glow hover:brightness-110 transition disabled:opacity-60"
              >
                {submitting ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}

          {loginError && (
            <p className="mt-4 text-[12px] text-danger" role="alert">
              {loginError}
            </p>
          )}
        </div>

        <p className="text-center text-text-faint text-[11px] mt-5">
          {mode === 'apikey'
            ? 'Find the key on the host: docker compose exec server cat /data/config/admin-api-key'
            : 'Authenticated by your organization’s identity provider.'}
        </p>
      </div>
    </div>
  );
};

export default Login;
