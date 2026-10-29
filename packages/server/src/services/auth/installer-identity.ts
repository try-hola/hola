/**
 * Who installed a deployment — the identity behind `${HOLA_USER_EMAIL}` and
 * `${HOLA_USER_USERNAME}`.
 *
 * Captured at create time from the authenticated principal, because the deploy
 * job runs async with no request context. Two routes, and only two:
 *
 * - `principal` — a person-type principal: an OIDC (SSO) dashboard user. `username` is the Authentik
 *   username (`preferred_username`), which is exactly what forward-auth hands an
 *   app as `X-authentik-username` — so an app can seed its own admin account
 *   under the name the gate will later present for the same person.
 * - `named-admin` — the admin API key (CLI, or the dashboard's admin-key login)
 *   carries no person. Holding that key already means full control of the host,
 *   so attributing its installs to the host's configured named admin
 *   (`HOLA_ADMIN_EMAIL`) grants nothing new. The identity is the one
 *   `ensureBootstrapAdmin` resolved from Authentik, not the configured or
 *   email-derived username: that user is located BY EMAIL, so an existing account
 *   may carry a different username, and seeding an app admin under the configured
 *   name could hand it to whichever other Authentik user owns that name. Until
 *   provisioning has resolved it (Authentik still booting, no admin configured)
 *   there is no fallback and both tokens resolve empty — the fail-closed answer.
 *
 * Every other principal (contract-scoped tokens and service keys, which are
 * `type: 'service'`) gets nothing.
 */
import type { Principal } from './auth-service';

export interface InstalledBy {
  email?: string;
  name?: string;
  username?: string;
  via?: 'principal' | 'named-admin';
}

export interface NamedAdminIdentity {
  username: string;
  email: string;
  name?: string;
}

/** Marks the admin-key principal so the named-admin fallback can recognise it. */
export const ADMIN_KEY_PROVIDER = 'admin-key';

let namedAdmin: NamedAdminIdentity | undefined;

/** Record the named admin as Authentik resolved it (startup provisioning). */
export function setNamedAdminIdentity(identity: NamedAdminIdentity | undefined): void {
  namedAdmin = identity;
}

export function resolveInstalledBy(principal: Principal | null | undefined): InstalledBy | undefined {
  if (!principal) return undefined;
  if (principal.metadata?.provider === ADMIN_KEY_PROVIDER) {
    if (!namedAdmin) return undefined;
    return {
      email: namedAdmin.email,
      name: namedAdmin.name ?? namedAdmin.username,
      username: namedAdmin.username,
      via: 'named-admin',
    };
  }
  if (principal.type !== 'user' || (!principal.email && !principal.username)) return undefined;
  return {
    ...(principal.email ? { email: principal.email } : {}),
    name: principal.name,
    ...(principal.username ? { username: principal.username } : {}),
    via: 'principal',
  };
}
