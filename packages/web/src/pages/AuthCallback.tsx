import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { useAuth } from '../hooks/useAuth';

/**
 * OIDC redirect landing page (/auth/callback). Once the AuthProvider has built
 * its UserManager (mode resolves to 'oidc'), exchange the authorization code and
 * return to the app. Any other mode means we shouldn't be here — go home.
 */
export const AuthCallback: React.FC = () => {
  const { mode, completeOidcLogin } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (mode !== 'oidc') return;
    let cancelled = false;
    (async () => {
      try {
        await completeOidcLogin();
        if (!cancelled) { setDone(true); navigate('/', { replace: true }); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Sign-in failed.');
      }
    })();
    return () => { cancelled = true; };
  }, [mode, completeOidcLogin, navigate]);

  // Server isn't using OIDC (or auth is off) — nothing to complete here.
  if (mode && mode !== 'oidc') return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0 text-text-strong px-4">
      <div className="flex flex-col items-center gap-3 animate-fadein">
        {error ? (
          <>
            <p className="text-danger text-sm" role="alert">{error}</p>
            <button
              onClick={() => navigate('/login', { replace: true })}
              className="h-9 px-4 bg-surface-2 border border-border rounded-[9px] text-sm hover:border-primary transition"
            >
              Back to sign in
            </button>
          </>
        ) : (
          <>
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
            <p className="text-text-muted text-sm">{done ? 'Signed in.' : 'Completing sign-in…'}</p>
          </>
        )}
      </div>
    </div>
  );
};

export default AuthCallback;
