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

let tokenGetter: TokenGetter | undefined;
let unauthorizedHandler: (() => void) | undefined;

/** Register (or clear) the source of the current Bearer access token. */
export function setAuthTokenGetter(getter: TokenGetter | undefined): void {
  tokenGetter = getter;
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
