/**
 * Registry Credential Service — Slice 1 (multi-catalog)
 *
 * Stores registry credentials (e.g. a GHCR PAT with read:packages) used to pull
 * private OCI packages and their runtime images. Instance-level and admin-gated:
 * there is no per-user tenancy in Hola, so a single curated set lives on disk.
 *
 * The secret token is persisted server-side only (config/registry-credentials.json,
 * mode 0o600, matching the inline-secret pattern used by system-settings.json) and
 * is NEVER returned to clients or written to logs. Clients see only the id, registry,
 * and username needed to pick a credential; `resolve(id)` hands the full secret to
 * the pull path (bundles + docker) and nowhere else.
 */

import { randomUUID } from 'crypto';
import { getLogger } from '../../lib/logger';
import type { HealthCheckable, ServiceHealth } from './types';
import type { StorageService } from './storage';
import type { PullCredentials } from './bundles';
import type {
  RegistryCredentialRecord,
  AddRegistryCredentialRequest,
} from '@hola/shared';

/** On-disk credential record. The token is base64-encoded, never logged. */
interface StoredCredential {
  id: string;
  registry: string;
  username: string;
  /** base64(token). Kept off logs; decoded only in resolve(). */
  passwordB64: string;
}

interface CredentialFile {
  credentials: StoredCredential[];
}

export interface RegistryCredentialService extends HealthCheckable {
  add(req: AddRegistryCredentialRequest): Promise<RegistryCredentialRecord>;
  list(): Promise<RegistryCredentialRecord[]>;
  remove(id: string): Promise<void>;
  /** Full credential (incl. secret) for the pull path. Undefined if unknown. */
  resolve(id: string): Promise<PullCredentials | undefined>;
}

const STORE_PATH = 'config/registry-credentials.json';
const FILE_MODE = 0o600;

function redact(c: StoredCredential): RegistryCredentialRecord {
  return { id: c.id, registry: c.registry, username: c.username };
}

export class RealRegistryCredentialService implements RegistryCredentialService {
  private logger = getLogger().child({ service: 'RegistryCredentialService' });

  constructor(private storage: StorageService) {}

  async healthCheck(): Promise<ServiceHealth> {
    try {
      await this.load();
      return { healthy: true, lastCheck: new Date() };
    } catch (error) {
      return { healthy: false, lastCheck: new Date(), error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async load(): Promise<CredentialFile> {
    if (!(await this.storage.fileExists(STORE_PATH))) {
      return { credentials: [] };
    }
    try {
      const raw = await this.storage.readFileAsString(STORE_PATH);
      const parsed = JSON.parse(raw) as CredentialFile;
      if (!parsed || !Array.isArray(parsed.credentials)) return { credentials: [] };
      return parsed;
    } catch (error) {
      this.logger.warn('Failed to read registry credentials; treating as empty', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { credentials: [] };
    }
  }

  private async save(file: CredentialFile): Promise<void> {
    // 0o600 so the token file is owner-only, like the deployment .env files.
    await this.storage.writeFile(STORE_PATH, JSON.stringify(file, null, 2), FILE_MODE);
  }

  async add(req: AddRegistryCredentialRequest): Promise<RegistryCredentialRecord> {
    const registry = (req.registry || '').trim();
    const username = (req.username || '').trim();
    if (!registry) throw new Error('REGISTRY_REQUIRED');
    if (!username) throw new Error('USERNAME_REQUIRED');
    if (!req.password) throw new Error('PASSWORD_REQUIRED');

    const file = await this.load();
    const id = (req.id || '').trim() || `cred_${randomUUID().slice(0, 8)}`;
    if (file.credentials.some(c => c.id === id)) {
      throw new Error('CREDENTIAL_ID_EXISTS');
    }
    const record: StoredCredential = {
      id,
      registry,
      username,
      passwordB64: Buffer.from(req.password, 'utf8').toString('base64'),
    };
    file.credentials.push(record);
    await this.save(file);
    // Log the id/registry only — never the token.
    this.logger.info('Registry credential added', { id, registry });
    return redact(record);
  }

  async list(): Promise<RegistryCredentialRecord[]> {
    const file = await this.load();
    return file.credentials.map(redact);
  }

  async remove(id: string): Promise<void> {
    const file = await this.load();
    const next = file.credentials.filter(c => c.id !== id);
    if (next.length === file.credentials.length) throw new Error('CREDENTIAL_NOT_FOUND');
    await this.save({ credentials: next });
    this.logger.info('Registry credential removed', { id });
  }

  async resolve(id: string): Promise<PullCredentials | undefined> {
    const file = await this.load();
    const c = file.credentials.find(x => x.id === id);
    if (!c) return undefined;
    return {
      registry: c.registry,
      username: c.username,
      password: Buffer.from(c.passwordB64, 'base64').toString('utf8'),
    };
  }
}

/** In-memory credential store for tests/dev (no disk, no real secrets). */
export class MockRegistryCredentialService implements RegistryCredentialService {
  private creds = new Map<string, StoredCredential>();

  async healthCheck(): Promise<ServiceHealth> {
    return { healthy: true, lastCheck: new Date() };
  }

  async add(req: AddRegistryCredentialRequest): Promise<RegistryCredentialRecord> {
    const id = (req.id || '').trim() || `cred_${randomUUID().slice(0, 8)}`;
    if (this.creds.has(id)) throw new Error('CREDENTIAL_ID_EXISTS');
    const record: StoredCredential = {
      id,
      registry: req.registry,
      username: req.username,
      passwordB64: Buffer.from(req.password ?? '', 'utf8').toString('base64'),
    };
    this.creds.set(id, record);
    return redact(record);
  }

  async list(): Promise<RegistryCredentialRecord[]> {
    return [...this.creds.values()].map(redact);
  }

  async remove(id: string): Promise<void> {
    if (!this.creds.delete(id)) throw new Error('CREDENTIAL_NOT_FOUND');
  }

  async resolve(id: string): Promise<PullCredentials | undefined> {
    const c = this.creds.get(id);
    if (!c) return undefined;
    return {
      registry: c.registry,
      username: c.username,
      password: Buffer.from(c.passwordB64, 'base64').toString('utf8'),
    };
  }
}
