/**
 * Contract-scoped tokens (ADR 0004 §6, #418 Phase 3).
 *
 * A brokered contract inverts the usual direction: the *provider app* calls the
 * server. Backrest has to say "I'm about to run restic" so the server can run
 * every accepting app's `pg_dump` first. That call needs a credential, and the
 * admin API key is exactly the wrong one — it would hand a catalog container the
 * ability to install, delete and reconfigure everything on the host in order to
 * let it announce a backup.
 *
 * So each provider deployment gets its own token carrying one capability per
 * contract it provides (`contract:backup`), and nothing else. The middleware maps
 * `/api/contracts/backup/*` to that capability; every other route rejects the
 * token, including reads of other apps' data. The token is minted when the
 * deployment is created with a consented grant, injected into its containers as
 * `HOLA_CONTRACT_TOKEN`, and revoked when the deployment is deleted — so the
 * credential's lifetime is exactly the install's.
 *
 * Tokens are stored hashed (SHA-256). The server only ever needs to *recognize* a
 * token presented back to it, never to re-read one, so there is no reason to keep
 * the plaintext where a leaked backup of the data dir would expose it. The
 * plaintext exists once, at mint time, on its way into the app's compose env.
 */

import { createHash, randomBytes } from 'crypto';

import { getLogger } from '../../lib/logger';
import type { StorageService } from '../core/storage';
import type { HealthCheckable, ServiceHealth } from '../core/types';
import { parseContractRef } from '@hola/shared/contracts';
import type { AuthProvider, AuthResult, Principal } from './auth-service';

const STORE_PATH = 'config/contract-tokens.json';
const FILE_MODE = 0o600;

/** Capability granted by a contract ref: `backup@1` → `contract:backup`. */
export function contractCapability(ref: string): string | undefined {
  const def = parseContractRef(ref);
  return def ? `contract:${def.id}` : undefined;
}

interface StoredToken {
  /** SHA-256 of the token; the plaintext is never persisted. */
  hash: string;
  deploymentId: string;
  /** Contract refs this deployment provides, as consented at install. */
  contracts: string[];
  createdAt: string;
}

interface TokenFile {
  tokens: StoredToken[];
}

export interface ContractTokenService extends HealthCheckable {
  /**
   * Mint (or re-mint) the token for a provider deployment. Idempotent per
   * deployment: an existing token is replaced, so a re-deploy that changes the
   * consented contract set can't leave the old, wider capability valid.
   * Returns the plaintext exactly once.
   */
  mint(deploymentId: string, contracts: string[]): Promise<string>;
  /** Drop a deployment's token. Safe to call when there is none. */
  revoke(deploymentId: string): Promise<void>;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export class RealContractTokenService implements ContractTokenService {
  private logger = getLogger().child({ service: 'ContractTokenService' });

  constructor(private storage: StorageService) {}

  async healthCheck(): Promise<ServiceHealth> {
    try {
      await this.load();
      return { healthy: true, lastCheck: new Date() };
    } catch (error) {
      return { healthy: false, lastCheck: new Date(), error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async load(): Promise<TokenFile> {
    if (!(await this.storage.fileExists(STORE_PATH))) return { tokens: [] };
    try {
      const parsed = JSON.parse(await this.storage.readFileAsString(STORE_PATH)) as TokenFile;
      if (!parsed || !Array.isArray(parsed.tokens)) return { tokens: [] };
      return parsed;
    } catch (error) {
      // A corrupt store must not lock the platform out of its own API; it means
      // provider apps re-authenticate as unknown until their next deploy re-mints.
      this.logger.warn('Failed to read contract tokens; treating as empty', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { tokens: [] };
    }
  }

  private async save(file: TokenFile): Promise<void> {
    await this.storage.writeFile(STORE_PATH, JSON.stringify(file, null, 2), FILE_MODE);
  }

  async mint(deploymentId: string, contracts: string[]): Promise<string> {
    const token = `hct_${randomBytes(24).toString('hex')}`;
    const file = await this.load();
    const others = file.tokens.filter(t => t.deploymentId !== deploymentId);
    others.push({ hash: sha256(token), deploymentId, contracts, createdAt: new Date().toISOString() });
    await this.save({ tokens: others });
    // The id and the scope, never the token.
    this.logger.info('Minted contract token', { deploymentId, contracts });
    return token;
  }

  async revoke(deploymentId: string): Promise<void> {
    const file = await this.load();
    const remaining = file.tokens.filter(t => t.deploymentId !== deploymentId);
    if (remaining.length === file.tokens.length) return;
    await this.save({ tokens: remaining });
    this.logger.info('Revoked contract token', { deploymentId });
  }

  // ---- Authentication ------------------------------------------------------

  /** Resolve a presented token to its principal. Backs the auth provider below. */
  async authenticateToken(token: string): Promise<AuthResult> {
    if (!token.startsWith('hct_')) return { success: false, error: 'Not a contract token' };

    const file = await this.load();
    const hash = sha256(token);
    const stored = file.tokens.find(t => t.hash === hash);
    if (!stored) return { success: false, error: 'Invalid contract token' };

    // One capability per contract provided, and nothing else — no `write:*`, no
    // wildcard. An unknown ref contributes nothing rather than being trusted.
    const capabilities = stored.contracts
      .map(contractCapability)
      .filter((c): c is string => c !== undefined);

    const principal: Principal = {
      id: `contract:${stored.deploymentId}`,
      type: 'service',
      name: `Contract provider ${stored.deploymentId}`,
      roles: [],
      capabilities,
      metadata: { deploymentId: stored.deploymentId, contracts: stored.contracts },
    };
    return { success: true, principal };
  }

}

/**
 * Adapter registering the token store as an auth provider. Separate from the
 * service because the two interfaces disagree on what `healthCheck` returns —
 * and because keeping the store and the authentication surface distinct makes it
 * obvious that nothing else in the server can widen what a token can do.
 */
export function createContractTokenAuthProvider(service: RealContractTokenService): AuthProvider {
  return {
    name: 'contract-token',
    authenticate: (token: string) => service.authenticateToken(token),
    // Deliberately no `*` handling: a contract token can never be a wildcard, so
    // the only way it passes is by naming the exact capability it was minted for.
    hasCapability: (principal: Principal, capability: string) => principal.capabilities.includes(capability),
  };
}
