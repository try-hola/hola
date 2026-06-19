import React, { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { KeyRound, ShieldCheck, LogIn } from 'lucide-react';

import { useAuth } from '../hooks/useAuth';

/**
 * Login screen. Adapts to the server's auth mode:
 *  - oidc   → a single "Sign in with SSO" button (redirects to Authentik).
 *  - apikey → an admin-key field that posts to the session-login endpoint.
 * Already-authenticated users (or auth-disabled servers) are bounced to the app.
 */
export const Login: React.FC = () => {
  const { status, mode, login, loginError } = useAuth();
  const location = useLocation();
  const [key, setKey] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
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
