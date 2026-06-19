/**
 * Repository Layer - Phase 2
 * 
 * Database-backed repositories for persistent data storage.
 * Provides abstraction over database operations with type safety.
 */

import { getLogger } from '../../lib/logger';
import type { DatabaseService } from './database';
import type { SystemSettings, BackupSettings } from './config';

// Base repository interface
export interface Repository<T, ID = string | number> {
  findById(id: ID): Promise<T | null>;
  findAll(): Promise<T[]>;
  create(entity: Omit<T, 'id' | 'createdAt' | 'updatedAt'>): Promise<T>;
  update(id: ID, updates: Partial<T>): Promise<T>;
  delete(id: ID): Promise<void>;
}

// Settings repository interfaces
export interface SettingsRow {
  id: number;
  type: 'system' | 'backup';
  data: string; // JSON string
  created_at: string;
  updated_at: string;
}

export interface SettingsRepository {
  getSystemSettings(): Promise<SystemSettings>;
  updateSystemSettings(settings: SystemSettings): Promise<SystemSettings>;
  getBackupSettings(): Promise<BackupSettings>;
  updateBackupSettings(settings: BackupSettings): Promise<BackupSettings>;
}

// Job repository interfaces (for Phase 5)
export interface JobRow {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  payload: string; // JSON string
  result?: string; // JSON string
  error?: string;
  progress: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  cancelled_at?: string;
}

export interface JobEntity {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  progress: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
}

export interface JobRepository extends Repository<JobEntity, string> {
  findByStatus(status: JobEntity['status']): Promise<JobEntity[]>;
  findByType(type: string): Promise<JobEntity[]>;
  updateStatus(id: string, status: JobEntity['status']): Promise<void>;
  updateProgress(id: string, progress: number): Promise<void>;
}

// Catalog repository interfaces (for Phase 6)
export interface CatalogAppRow {
  id: string;
  name: string;
  description?: string;
  version: string;
  tags?: string; // JSON array
  category?: string;
  icon_url?: string;
  manifest_data: string; // JSON manifest
  bundle_url?: string;
  indexed_at: string;
}

export interface CatalogAppEntity {
  id: string;
  name: string;
  description?: string;
  version: string;
  tags: string[];
  category?: string;
  iconUrl?: string;
  manifestData: Record<string, unknown>;
  bundleUrl?: string;
  indexedAt: Date;
}

export interface CatalogRepository extends Repository<CatalogAppEntity, string> {
  search(query: string, limit?: number): Promise<CatalogAppEntity[]>;
  findByCategory(category: string): Promise<CatalogAppEntity[]>;
  findByName(name: string): Promise<CatalogAppEntity[]>;
}

/**
 * Settings Repository Implementation
 */
export class DatabaseSettingsRepository implements SettingsRepository {
  private logger = getLogger().child({ service: 'DatabaseSettingsRepository' });
  private db: DatabaseService;

  // Default settings (no placeholder system variables).
  private defaultSystemSettings: SystemSettings = {
    systemEnv: [],
    docker: { host: '/var/run/docker.sock' },
    tls: { email: '' },
    notifications: { smtpHost: '', smtpUser: '', smtpPassword: '' },
  };

  private defaultBackupSettings: BackupSettings = {
    scheduleEnabled: true,
    scheduleTime: '02:00',
    retentionDays: 7,
  };

  constructor(database: DatabaseService) {
    this.db = database;
  }

  async getSystemSettings(): Promise<SystemSettings> {
    try {
      const row = await this.db.get<SettingsRow>(
        'SELECT * FROM settings WHERE type = ?',
        ['system']
      );

      if (!row) {
        // Create default settings if none exist
        return await this.updateSystemSettings(this.defaultSystemSettings);
      }

      const settings = JSON.parse(row.data) as SystemSettings;
      this.logger.debug('System settings retrieved from database');
      return settings;
    } catch (error) {
      this.logger.error('Failed to get system settings from database', error as Error);
      
      // Return defaults on error
      this.logger.warn('Returning default system settings due to database error');
      return { ...this.defaultSystemSettings };
    }
  }

  async updateSystemSettings(settings: SystemSettings): Promise<SystemSettings> {
    try {
      const data = JSON.stringify(settings);
      const now = new Date().toISOString();

      await this.db.run(`
        INSERT OR REPLACE INTO settings (type, data, updated_at)
        VALUES (?, ?, ?)
      `, ['system', data, now]);

      this.logger.info('System settings updated in database');
      return settings;
    } catch (error) {
      this.logger.error('Failed to update system settings in database', error as Error);
      throw error;
    }
  }

  async getBackupSettings(): Promise<BackupSettings> {
    try {
      const row = await this.db.get<SettingsRow>(
        'SELECT * FROM settings WHERE type = ?',
        ['backup']
      );

      if (!row) {
        // Create default settings if none exist
        return await this.updateBackupSettings(this.defaultBackupSettings);
      }

      const settings = JSON.parse(row.data) as BackupSettings;
      this.logger.debug('Backup settings retrieved from database');
      return settings;
    } catch (error) {
      this.logger.error('Failed to get backup settings from database', error as Error);
      
      // Return defaults on error
      this.logger.warn('Returning default backup settings due to database error');
      return { ...this.defaultBackupSettings };
    }
  }

  async updateBackupSettings(settings: BackupSettings): Promise<BackupSettings> {
    try {
      const data = JSON.stringify(settings);
      const now = new Date().toISOString();

      await this.db.run(`
        INSERT OR REPLACE INTO settings (type, data, updated_at)
        VALUES (?, ?, ?)
      `, ['backup', data, now]);

      this.logger.info('Backup settings updated in database');
      return settings;
    } catch (error) {
      this.logger.error('Failed to update backup settings in database', error as Error);
      throw error;
    }
  }
}

/**
 * Job Repository Implementation (for Phase 5)
 */
export class DatabaseJobRepository implements JobRepository {
  private logger = getLogger().child({ service: 'DatabaseJobRepository' });
  private db: DatabaseService;

  constructor(database: DatabaseService) {
    this.db = database;
  }

  async findById(id: string): Promise<JobEntity | null> {
    try {
      const row = await this.db.get<JobRow>(
        'SELECT * FROM jobs WHERE id = ?',
        [id]
      );

      return row ? this.rowToEntity(row) : null;
    } catch (error) {
      this.logger.error('Failed to find job by id', error as Error, { id });
      throw error;
    }
  }

  async findAll(): Promise<JobEntity[]> {
    try {
      const result = await this.db.query<JobRow>(
        'SELECT * FROM jobs ORDER BY created_at DESC'
      );

      return result.rows.map(row => this.rowToEntity(row));
    } catch (error) {
      this.logger.error('Failed to find all jobs', error as Error);
      throw error;
    }
  }

  async create(entity: Omit<JobEntity, 'id' | 'createdAt' | 'updatedAt'>): Promise<JobEntity> {
    try {
      const id = `job_${Date.now()}_${Math.random().toString(36).substring(2)}`;
      const now = new Date().toISOString();

      await this.db.run(`
        INSERT INTO jobs (id, type, status, payload, result, error, progress, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        id,
        entity.type,
        entity.status,
        JSON.stringify(entity.payload),
        entity.result ? JSON.stringify(entity.result) : null,
        entity.error || null,
        entity.progress,
        now,
      ]);

      const created = await this.findById(id);
      if (!created) {
        throw new Error('Failed to retrieve created job');
      }

      this.logger.info('Job created in database', { id, type: entity.type });
      return created;
    } catch (error) {
      this.logger.error('Failed to create job in database', error as Error);
      throw error;
    }
  }

  async update(id: string, updates: Partial<JobEntity>): Promise<JobEntity> {
    try {
      const setClauses: string[] = [];
      const params: (string | number)[] = [];

      if (updates.status !== undefined) {
        setClauses.push('status = ?');
        params.push(updates.status);
      }

      if (updates.payload !== undefined) {
        setClauses.push('payload = ?');
        params.push(JSON.stringify(updates.payload));
      }

      if (updates.result !== undefined) {
        setClauses.push('result = ?');
        params.push(JSON.stringify(updates.result));
      }

      if (updates.error !== undefined) {
        setClauses.push('error = ?');
        params.push(updates.error);
      }

      if (updates.progress !== undefined) {
        setClauses.push('progress = ?');
        params.push(updates.progress);
      }

      if (updates.startedAt !== undefined) {
        setClauses.push('started_at = ?');
        params.push(updates.startedAt.toISOString());
      }

      if (updates.completedAt !== undefined) {
        setClauses.push('completed_at = ?');
        params.push(updates.completedAt.toISOString());
      }

      if (updates.cancelledAt !== undefined) {
        setClauses.push('cancelled_at = ?');
        params.push(updates.cancelledAt.toISOString());
      }

      if (setClauses.length === 0) {
        // No updates to apply
        const existing = await this.findById(id);
        if (!existing) {
          throw new Error(`Job not found: ${id}`);
        }
        return existing;
      }

      params.push(id); // for WHERE clause

      await this.db.run(`
        UPDATE jobs
        SET ${setClauses.join(', ')}
        WHERE id = ?
      `, params);

      const updated = await this.findById(id);
      if (!updated) {
        throw new Error(`Job not found after update: ${id}`);
      }

      this.logger.debug('Job updated in database', { id });
      return updated;
    } catch (error) {
      this.logger.error('Failed to update job in database', error as Error, { id });
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.db.run('DELETE FROM jobs WHERE id = ?', [id]);
      this.logger.info('Job deleted from database', { id });
    } catch (error) {
      this.logger.error('Failed to delete job from database', error as Error, { id });
      throw error;
    }
  }

  async findByStatus(status: JobEntity['status']): Promise<JobEntity[]> {
    try {
      const result = await this.db.query<JobRow>(
        'SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC',
        [status]
      );

      return result.rows.map(row => this.rowToEntity(row));
    } catch (error) {
      this.logger.error('Failed to find jobs by status', error as Error, { status });
      throw error;
    }
  }

  async findByType(type: string): Promise<JobEntity[]> {
    try {
      const result = await this.db.query<JobRow>(
        'SELECT * FROM jobs WHERE type = ? ORDER BY created_at DESC',
        [type]
      );

      return result.rows.map(row => this.rowToEntity(row));
    } catch (error) {
      this.logger.error('Failed to find jobs by type', error as Error, { type });
      throw error;
    }
  }

  async updateStatus(id: string, status: JobEntity['status']): Promise<void> {
    try {
      const updates: Partial<JobEntity> = { status };
      
      if (status === 'running') {
        updates.startedAt = new Date();
      } else if (status === 'completed' || status === 'failed') {
        updates.completedAt = new Date();
      } else if (status === 'cancelled') {
        updates.cancelledAt = new Date();
      }

      await this.update(id, updates);
      this.logger.debug('Job status updated', { id, status });
    } catch (error) {
      this.logger.error('Failed to update job status', error as Error, { id, status });
      throw error;
    }
  }

  async updateProgress(id: string, progress: number): Promise<void> {
    try {
      await this.update(id, { progress });
      this.logger.debug('Job progress updated', { id, progress });
    } catch (error) {
      this.logger.error('Failed to update job progress', error as Error, { id, progress });
      throw error;
    }
  }

  private rowToEntity(row: JobRow): JobEntity {
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      payload: JSON.parse(row.payload),
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error || undefined,
      progress: row.progress,
      createdAt: new Date(row.created_at),
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      cancelledAt: row.cancelled_at ? new Date(row.cancelled_at) : undefined,
    };
  }
}

/**
 * Catalog Repository Implementation (for Phase 6)
 */
export class DatabaseCatalogRepository implements CatalogRepository {
  private logger = getLogger().child({ service: 'DatabaseCatalogRepository' });
  private db: DatabaseService;

  constructor(database: DatabaseService) {
    this.db = database;
  }

  async findById(id: string): Promise<CatalogAppEntity | null> {
    try {
      const row = await this.db.get<CatalogAppRow>(
        'SELECT * FROM catalog_apps WHERE id = ?',
        [id]
      );

      return row ? this.rowToEntity(row) : null;
    } catch (error) {
      this.logger.error('Failed to find catalog app by id', error as Error, { id });
      throw error;
    }
  }

  async findAll(): Promise<CatalogAppEntity[]> {
    try {
      const result = await this.db.query<CatalogAppRow>(
        'SELECT * FROM catalog_apps ORDER BY name'
      );

      return result.rows.map(row => this.rowToEntity(row));
    } catch (error) {
      this.logger.error('Failed to find all catalog apps', error as Error);
      throw error;
    }
  }

  async create(entity: Omit<CatalogAppEntity, 'id' | 'createdAt' | 'updatedAt'>): Promise<CatalogAppEntity> {
    try {
      const id = entity.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const now = new Date().toISOString();

      await this.db.run(`
        INSERT OR REPLACE INTO catalog_apps 
        (id, name, description, version, tags, category, icon_url, manifest_data, bundle_url, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        id,
        entity.name,
        entity.description || null,
        entity.version,
        JSON.stringify(entity.tags),
        entity.category || null,
        entity.iconUrl || null,
        JSON.stringify(entity.manifestData),
        entity.bundleUrl || null,
        now,
      ]);

      const created = await this.findById(id);
      if (!created) {
        throw new Error('Failed to retrieve created catalog app');
      }

      this.logger.info('Catalog app created in database', { id, name: entity.name });
      return created;
    } catch (error) {
      this.logger.error('Failed to create catalog app in database', error as Error);
      throw error;
    }
  }

  async update(id: string, updates: Partial<CatalogAppEntity>): Promise<CatalogAppEntity> {
    try {
      const setClauses: string[] = [];
      const params: (string | null)[] = [];

      if (updates.name !== undefined) {
        setClauses.push('name = ?');
        params.push(updates.name);
      }

      if (updates.description !== undefined) {
        setClauses.push('description = ?');
        params.push(updates.description || null);
      }

      if (updates.version !== undefined) {
        setClauses.push('version = ?');
        params.push(updates.version);
      }

      if (updates.tags !== undefined) {
        setClauses.push('tags = ?');
        params.push(JSON.stringify(updates.tags));
      }

      if (updates.category !== undefined) {
        setClauses.push('category = ?');
        params.push(updates.category || null);
      }

      if (updates.iconUrl !== undefined) {
        setClauses.push('icon_url = ?');
        params.push(updates.iconUrl || null);
      }

      if (updates.manifestData !== undefined) {
        setClauses.push('manifest_data = ?');
        params.push(JSON.stringify(updates.manifestData));
      }

      if (updates.bundleUrl !== undefined) {
        setClauses.push('bundle_url = ?');
        params.push(updates.bundleUrl || null);
      }

      if (setClauses.length === 0) {
        // No updates to apply
        const existing = await this.findById(id);
        if (!existing) {
          throw new Error(`Catalog app not found: ${id}`);
        }
        return existing;
      }

      setClauses.push('indexed_at = ?');
      params.push(new Date().toISOString());
      params.push(id); // for WHERE clause

      await this.db.run(`
        UPDATE catalog_apps
        SET ${setClauses.join(', ')}
        WHERE id = ?
      `, params);

      const updated = await this.findById(id);
      if (!updated) {
        throw new Error(`Catalog app not found after update: ${id}`);
      }

      this.logger.debug('Catalog app updated in database', { id });
      return updated;
    } catch (error) {
      this.logger.error('Failed to update catalog app in database', error as Error, { id });
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.db.run('DELETE FROM catalog_apps WHERE id = ?', [id]);
      this.logger.info('Catalog app deleted from database', { id });
    } catch (error) {
      this.logger.error('Failed to delete catalog app from database', error as Error, { id });
      throw error;
    }
  }

  async search(query: string, limit = 50): Promise<CatalogAppEntity[]> {
    try {
      const result = await this.db.query<CatalogAppRow>(`
        SELECT catalog_apps.* FROM catalog_apps
        JOIN catalog_search ON catalog_apps.rowid = catalog_search.rowid
        WHERE catalog_search MATCH ?
        ORDER BY rank
        LIMIT ?
      `, [query, limit]);

      return result.rows.map(row => this.rowToEntity(row));
    } catch (error) {
      this.logger.error('Failed to search catalog apps', error as Error, { query });
      throw error;
    }
  }

  async findByCategory(category: string): Promise<CatalogAppEntity[]> {
    try {
      const result = await this.db.query<CatalogAppRow>(
        'SELECT * FROM catalog_apps WHERE category = ? ORDER BY name',
        [category]
      );

      return result.rows.map(row => this.rowToEntity(row));
    } catch (error) {
      this.logger.error('Failed to find catalog apps by category', error as Error, { category });
      throw error;
    }
  }

  async findByName(name: string): Promise<CatalogAppEntity[]> {
    try {
      const result = await this.db.query<CatalogAppRow>(
        'SELECT * FROM catalog_apps WHERE name LIKE ? ORDER BY name',
        [`%${name}%`]
      );

      return result.rows.map(row => this.rowToEntity(row));
    } catch (error) {
      this.logger.error('Failed to find catalog apps by name', error as Error, { name });
      throw error;
    }
  }

  private rowToEntity(row: CatalogAppRow): CatalogAppEntity {
    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      version: row.version,
      tags: row.tags ? JSON.parse(row.tags) : [],
      category: row.category || undefined,
      iconUrl: row.icon_url || undefined,
      manifestData: JSON.parse(row.manifest_data),
      bundleUrl: row.bundle_url || undefined,
      indexedAt: new Date(row.indexed_at),
    };
  }
}
