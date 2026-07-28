/**
 * Bridge between the React auth layer (useAuth) and the non-React fetch layer.
 *
 * The API clients (sdk-adapter, api.ts) both funnel through safeFetchEnhanced,
 * which lives outside React. This module lets the AuthProvider register:
 *   - a token getter — returns the current OIDC access token (Bearer), if any;
 *     the admin-key fallback uses an HttpOnly cookie instead, so it returns none.
 *   - an unauthorized handler — invoked when an API call returns 401 so the app
 *     can drop to the login screen (e.g. a token expired and refresh failed).
 */

type TokenGetter = () => string | undefined;
type TokenRefresher = () => Promise<string | undefined>;

let tokenGetter: TokenGetter | undefined;
let tokenRefresher: TokenRefresher | undefined;
let inFlightRefresh: Promise<string | undefined> | undefined;
let unauthorizedHandler: (() => void) | undefined;

/** Register (or clear) the source of the current Bearer access token. */
export function setAuthTokenGetter(getter: TokenGetter | undefined): void {
  tokenGetter = getter;
}

/**
 * Register (or clear) the way to obtain a *fresh* access token after the current
 * one is rejected. Only the OIDC flow can refresh; the admin-key cookie mode
 * registers nothing, so `refreshAuthToken` resolves undefined there.
 */
export function setTokenRefresher(refresher: TokenRefresher | undefined): void {
  tokenRefresher = refresher;
  inFlightRefresh = undefined;
}

/**
 * Obtain a fresh access token, or undefined if refresh isn't possible/failed.
 *
 * Returning to a backgrounded tab fires a refetch for every mounted query at
 * once (`refetchOnWindowFocus`), so a stale token produces a burst of parallel
 * 401s. They must not each trigger their own renewal — the in-flight promise is
 * shared so one renewal serves the whole burst.
 */
export function refreshAuthToken(): Promise<string | undefined> {
  if (!tokenRefresher) return Promise.resolve(undefined);
  if (!inFlightRefresh) {
    inFlightRefresh = tokenRefresher()
      .catch(() => undefined)
      .finally(() => { inFlightRefresh = undefined; });
  }
  return inFlightRefresh;
}

/** The current Bearer access token, or undefined (cookie/no-auth modes). */
export function getAuthToken(): string | undefined {
  return tokenGetter?.();
}

/** Register (or clear) the handler invoked when an API call returns 401. */
export function setUnauthorizedHandler(handler: (() => void) | undefined): void {
  unauthorizedHandler = handler;
}

/** Signal that an authenticated request was rejected (token expired/invalid). */
export function notifyUnauthorized(): void {
  unauthorizedHandler?.();
}
