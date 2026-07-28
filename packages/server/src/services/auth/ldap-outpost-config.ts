/**
 * Persistence for the shared LDAP outpost's API token.
 *
 * The `authentik-ldap` container authenticates with a token that only exists once
 * Authentik is running and its outpost has been provisioned — so it cannot be in
 * `.env` at first boot, which is exactly why LDAP used to require a manual
 * click-through and would restart-loop on an empty token until someone did it.
 *
 * The server mints the token during platform-auth startup and writes it here,
 * under the data root the host shares with the container. install.sh reads it back
 * out after the stack is up and wires it into `.env`, so install and upgrade both
 * converge on a working outpost with no operator involvement.
 *
 * Mirrors the admin-API-key bootstrap (see api-key-config.ts): mode 0600, the
 * location is logged but never the secret.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import { getHolaDataDir } from '../../config/paths';
import { getLogger } from '../../lib/logger';

const LDAP_TOKEN_PATH = ['config', 'ldap-outpost-token'];

/** Path of the persisted LDAP outpost token under the configured data root. */
export function ldapOutpostTokenPath(): string {
  return join(getHolaDataDir(), ...LDAP_TOKEN_PATH);
}

/**
 * Persist the outpost token, returning whether it changed. Rewriting an identical
 * token is skipped so a routine restart doesn't churn the file that install.sh
 * diffs against `.env`.
 */
export function persistLdapOutpostToken(token: string): boolean {
  const logger = getLogger().child({ service: 'LdapOutpostConfig' });
  const path = ldapOutpostTokenPath();
  if (readLdapOutpostToken() === token) return false;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, token, { mode: 0o600 });
    logger.info('Persisted LDAP outpost token', { path });
    return true;
  } catch (error) {
    logger.error('Failed to persist the LDAP outpost token', error as Error);
    return false;
  }
}

/** The persisted outpost token, or undefined when it has never been provisioned. */
export function readLdapOutpostToken(): string | undefined {
  const path = ldapOutpostTokenPath();
  if (!existsSync(path)) return undefined;
  try {
    return readFileSync(path, 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}
