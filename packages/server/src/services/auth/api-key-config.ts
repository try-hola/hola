/**
 * Admin API key bootstrap (issue #53, MVP pt.1).
 *
 * Resolves the control-plane admin API key from `HOLA_API_KEY`, or generates and
 * persists one under the data root on first boot so a fresh production deployment
 * always has a usable administrator credential (no "auth enabled, zero keys" gap).
 */

import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

import { getHolaDataDir } from '../../config/paths';
import { getLogger } from '../../lib/logger';
import { ApiKeyAuthProvider, type Principal } from './auth-service';

const ADMIN_KEY_PATH = ['config', 'admin-api-key'];

/** Path of the persisted admin key file under the configured data root. */
export function adminApiKeyPath(): string {
  return join(getHolaDataDir(), ...ADMIN_KEY_PATH);
}

/**
 * Resolve the admin API key: `HOLA_API_KEY` if set, otherwise a persisted key,
 * generating and persisting a new one (mode 0600) on first boot.
 */
export function resolveAdminApiKey(): string {
  const logger = getLogger().child({ service: 'AuthConfig' });

  const fromEnv = process.env.HOLA_API_KEY?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const path = adminApiKeyPath();
  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf8').trim();
    if (existing) {
      return existing;
    }
  }

  const generated = randomBytes(24).toString('hex');
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, generated, { mode: 0o600 });
    // Log the location, not the secret. The operator retrieves it from the file.
    logger.warn('Generated a new admin API key for first-time setup', { path });
  } catch (error) {
    logger.error('Failed to persist admin API key; using an ephemeral key for this run', error as Error);
  }
  return generated;
}

/** Build an API-key provider that authorizes the admin key with full capabilities. */
export function createAdminApiKeyProvider(apiKey: string): ApiKeyAuthProvider {
  const admin: Partial<Principal> = {
    id: 'admin',
    type: 'user',
    name: 'Administrator',
    roles: ['admin'],
    capabilities: ['*'],
  };
  return new ApiKeyAuthProvider({ [apiKey]: admin });
}
