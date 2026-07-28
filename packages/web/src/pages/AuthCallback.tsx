import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { useAuth } from '../hooks/useAuth';

/**
 * OIDC redirect landing page (/auth/callback). Once the AuthProvider has built
 * its UserManager (mode resolves to 'oidc'), exchange the authorization code and
 * return to the app. Any other mode means we shouldn't be here — go home.
 */
/**
 * True when we're running inside oidc-client-ts's hidden silent-renew iframe.
 * `silent_redirect_uri` defaults to `redirect_uri`, so renewals land on this very
 * route — but they must be completed with signinSilentCallback(), which posts the
 * result up to the parent frame. Completing them as a normal redirect instead
 * leaves the parent's signinSilent() hanging until it times out.
 */
function isSilentRenewFrame(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin access threw — we're framed.
    return true;
  }
}

export const AuthCallback: React.FC = () => {
  const { mode, completeOidcLogin, completeOidcSilentRenew } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const silent = isSilentRenewFrame();

  useEffect(() => {
    if (mode !== 'oidc') return;
    let cancelled = false;
    (async () => {
      try {
        if (silent) {
          // Hand the result to the parent tab; this frame is then discarded.
          await completeOidcSilentRenew();
          return;
        }
        await completeOidcLogin();
        if (!cancelled) { setDone(true); navigate('/', { replace: true }); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Sign-in failed.');
      }
    })();
    return () => { cancelled = true; };
  }, [mode, completeOidcLogin, completeOidcSilentRenew, navigate, silent]);

  // Nothing renders in the renewal iframe — it exists only to relay the result.
  if (silent) return null;

  // We landed here with an authorization code. If auth resolved to non-OIDC, the
  // boot config likely mis-resolved (e.g. it failed and fell back to apikey) —
  // don't silently discard the code; surface an error so the user can retry.
  const hasOidcCode = new URLSearchParams(window.location.search).has('code');

  // Non-OIDC with nothing pending — we shouldn't be here; go home.
  if (mode && mode !== 'oidc' && !hasOidcCode) return <Navigate to="/" replace />;

  const stuck = mode !== null && mode !== 'oidc' && hasOidcCode;

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0 text-text-strong px-4">
      <div className="flex flex-col items-center gap-3 animate-fadein">
        {error || stuck ? (
          <>
            <p className="text-danger text-sm" role="alert">{error ?? "Couldn't complete sign-in. Please try again."}</p>
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
