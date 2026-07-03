/**
 * Catalog Source Service — Slice 2 (multi-catalog)
 *
 * Manages the list of catalog sources (the Homebrew-tap / `helm repo add` model).
 * A source is just a catalog.json (the SAME schema as the public catalog) hosted
 * elsewhere, optionally with a stored credential for private package pulls.
 * Instance-level and admin-gated — Hola has no per-user tenancy.
 *
 * The built-in `hola` source is NOT persisted: it's synthesized at read time from
 * `catalogConfig.catalogUrl` so the env var stays authoritative and can't go
 * stale. Only user-added custom sources live in config/catalog-sources.json.
 */

import { getLogger } from '../../lib/logger';
import { catalogConfig } from '../../config/catalog';
import type { HealthCheckable, ServiceHealth } from './types';
import type { StorageService } from './storage';
import type { CatalogSourceRecord, AddCatalogSourceRequest } from '@hola/shared';

/** Reserved source ids that a custom source may not use. */
export const RESERVED_SOURCE_IDS = new Set(['hola', 'ref', '(ref)']);

const STORE_PATH = 'config/catalog-sources.json';

interface SourceFile {
  sources: CatalogSourceRecord[];
}

export interface CatalogSourceService extends HealthCheckable {
  /** All sources: the synthesized built-in `hola` source first, then custom ones. */
  list(): Promise<CatalogSourceRecord[]>;
  /** Only the enabled sources (what the catalog aggregator fans out over). */
  listEnabled(): Promise<CatalogSourceRecord[]>;
  add(req: AddCatalogSourceRequest): Promise<CatalogSourceRecord>;
  remove(id: string): Promise<void>;
  /** A single source by id (built-in or custom), or undefined. */
  get(id: string): Promise<CatalogSourceRecord | undefined>;
}

/** The built-in public catalog, synthesized from the env-configured URL. */
export function builtinHolaSource(): CatalogSourceRecord {
  return {
    id: 'hola',
    name: 'Hola (public catalog)',
    type: 'index-url',
    url: catalogConfig.catalogUrl ?? '',
    trust: 'verified',
    enabled: true,
  };
}

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export class RealCatalogSourceService implements CatalogSourceService {
  private logger = getLogger().child({ service: 'CatalogSourceService' });

  constructor(private storage: StorageService) {}

  async healthCheck(): Promise<ServiceHealth> {
    try {
      await this.loadCustom();
      return { healthy: true, lastCheck: new Date() };
    } catch (error) {
      return { healthy: false, lastCheck: new Date(), error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async loadCustom(): Promise<CatalogSourceRecord[]> {
    if (!(await this.storage.fileExists(STORE_PATH))) return [];
    try {
      const parsed = JSON.parse(await this.storage.readFileAsString(STORE_PATH)) as SourceFile;
      return Array.isArray(parsed?.sources) ? parsed.sources : [];
    } catch (error) {
      this.logger.warn('Failed to read catalog sources; treating as empty', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private async saveCustom(sources: CatalogSourceRecord[]): Promise<void> {
    await this.storage.writeFile(STORE_PATH, JSON.stringify({ sources } satisfies SourceFile, null, 2));
  }

  async list(): Promise<CatalogSourceRecord[]> {
    return [builtinHolaSource(), ...(await this.loadCustom())];
  }

  async listEnabled(): Promise<CatalogSourceRecord[]> {
    return (await this.list()).filter(s => s.enabled && s.url);
  }

  async get(id: string): Promise<CatalogSourceRecord | undefined> {
    return (await this.list()).find(s => s.id === id);
  }

  async add(req: AddCatalogSourceRequest): Promise<CatalogSourceRecord> {
    const id = (req.id || '').trim();
    if (!id) throw new Error('SOURCE_ID_REQUIRED');
    if (RESERVED_SOURCE_IDS.has(id)) throw new Error('SOURCE_ID_RESERVED');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error('SOURCE_ID_INVALID');
    if (!req.url || !isHttpUrl(req.url)) throw new Error('SOURCE_URL_INVALID');
    if (req.auth && (!req.auth.registry || !req.auth.credentialRef)) throw new Error('SOURCE_AUTH_INVALID');

    const custom = await this.loadCustom();
    if (custom.some(s => s.id === id)) throw new Error('SOURCE_ID_EXISTS');

    const record: CatalogSourceRecord = {
      id,
      name: (req.name || '').trim() || id,
      type: 'index-url',
      url: req.url.trim(),
      auth: req.auth,
      trust: 'custom',
      enabled: req.enabled ?? true,
    };
    custom.push(record);
    await this.saveCustom(custom);
    this.logger.info('Catalog source added', { id, url: record.url, hasAuth: Boolean(record.auth) });
    return record;
  }

  async remove(id: string): Promise<void> {
    if (RESERVED_SOURCE_IDS.has(id)) throw new Error('SOURCE_ID_RESERVED');
    const custom = await this.loadCustom();
    const next = custom.filter(s => s.id !== id);
    if (next.length === custom.length) throw new Error('SOURCE_NOT_FOUND');
    await this.saveCustom(next);
    this.logger.info('Catalog source removed', { id });
  }
}

/** In-memory source store for tests/dev. Always includes the built-in `hola`. */
export class MockCatalogSourceService implements CatalogSourceService {
  private custom: CatalogSourceRecord[] = [];

  async healthCheck(): Promise<ServiceHealth> {
    return { healthy: true, lastCheck: new Date() };
  }
  async list(): Promise<CatalogSourceRecord[]> {
    return [builtinHolaSource(), ...this.custom];
  }
  async listEnabled(): Promise<CatalogSourceRecord[]> {
    return (await this.list()).filter(s => s.enabled && s.url);
  }
  async get(id: string): Promise<CatalogSourceRecord | undefined> {
    return (await this.list()).find(s => s.id === id);
  }
  async add(req: AddCatalogSourceRequest): Promise<CatalogSourceRecord> {
    const id = (req.id || '').trim();
    if (RESERVED_SOURCE_IDS.has(id)) throw new Error('SOURCE_ID_RESERVED');
    if (this.custom.some(s => s.id === id)) throw new Error('SOURCE_ID_EXISTS');
    const record: CatalogSourceRecord = {
      id, name: req.name || id, type: 'index-url', url: req.url,
      auth: req.auth, trust: 'custom', enabled: req.enabled ?? true,
    };
    this.custom.push(record);
    return record;
  }
  async remove(id: string): Promise<void> {
    if (RESERVED_SOURCE_IDS.has(id)) throw new Error('SOURCE_ID_RESERVED');
    const next = this.custom.filter(s => s.id !== id);
    if (next.length === this.custom.length) throw new Error('SOURCE_NOT_FOUND');
    this.custom = next;
  }
}
