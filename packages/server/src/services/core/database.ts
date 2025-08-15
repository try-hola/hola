/**
 * Database Service - Phase 2
 * 
 * Provides SQLite database operations with migrations, transactions, and repository pattern.
 * Built for the Hola application's data persistence needs.
 */

import { Database } from 'bun:sqlite';
import { getLogger } from '../../lib/logger';
import type { HealthCheckable, ServiceHealth } from '../factory';
import type { StorageService } from './storage';

// SQLite parameter type
type SQLiteParam = string | number | boolean | null | Uint8Array;

export interface DatabaseConfig {
  filename: string;
  enableWAL: boolean;
  enableForeignKeys: boolean;
  busyTimeout: number;
  maxConnections: number;
}

export interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
}

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
  lastInsertRowId?: number;
}

export interface TransactionOptions {
  immediate?: boolean;
  exclusive?: boolean;
}

export interface DatabaseService extends HealthCheckable {
  // Connection management
  initialize(): Promise<void>;
  close(): Promise<void>;
  
  // Query operations
  query<T = Record<string, unknown>>(sql: string, params?: SQLiteParam[]): Promise<QueryResult<T>>;
  run(sql: string, params?: SQLiteParam[]): Promise<{ lastInsertRowId: number; changes: number }>;
  get<T = Record<string, unknown>>(sql: string, params?: SQLiteParam[]): Promise<T | null>;
  
  // Transaction operations
  transaction<T>(callback: (tx: DatabaseTransaction) => Promise<T>, options?: TransactionOptions): Promise<T>;
  
  // Migration operations
  migrate(): Promise<void>;
  getMigrationVersion(): Promise<number>;
  rollback(targetVersion?: number): Promise<void>;
  
  // Utility operations
  getTableNames(): Promise<string[]>;
  getTableInfo(tableName: string): Promise<TableInfo[]>;
  vacuum(): Promise<void>;
}

export interface DatabaseTransaction {
  query<T = Record<string, unknown>>(sql: string, params?: SQLiteParam[]): Promise<QueryResult<T>>;
  run(sql: string, params?: SQLiteParam[]): Promise<{ lastInsertRowId: number; changes: number }>;
  get<T = Record<string, unknown>>(sql: string, params?: SQLiteParam[]): Promise<T | null>;
}

export interface TableInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

/**
 * Real database service implementation using bun:sqlite
 */
export class RealDatabaseService implements DatabaseService {
  private logger = getLogger().child({ service: 'DatabaseService' });
  private storage: StorageService;
  private config: DatabaseConfig;
  private db: Database | null = null;
  private initialized = false;

  constructor(storage: StorageService, config?: Partial<DatabaseConfig>) {
    this.storage = storage;
    
    this.config = {
      filename: 'hola.db',
      enableWAL: true,
      enableForeignKeys: true,
      busyTimeout: 30000,
      maxConnections: 10,
      ...config,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.info('Initializing database service', {
      filename: this.config.filename,
      enableWAL: this.config.enableWAL,
      enableForeignKeys: this.config.enableForeignKeys,
    });

    try {
      // Ensure storage is initialized
      await this.storage.initialize();

      // Create database file path
      const dbPath = this.storage.resolveHolaPath('data', this.config.filename);
      
      // Ensure the data directory exists
      await this.storage.ensureDir(this.storage.resolveHolaPath('data'));
      
      // Initialize SQLite database
      this.db = new Database(dbPath);
      
      // Configure database options
      if (this.config.enableWAL) {
        this.db.run('PRAGMA journal_mode = WAL');
      }
      
      if (this.config.enableForeignKeys) {
        this.db.run('PRAGMA foreign_keys = ON');
      }
      
      this.db.run(`PRAGMA busy_timeout = ${this.config.busyTimeout}`);
      this.db.run('PRAGMA synchronous = NORMAL');
      
      // Run migrations
      await this.migrate();

      this.initialized = true;
      this.logger.info('Database service initialized successfully', {
        path: dbPath,
        version: await this.getMigrationVersion(),
      });
    } catch (error) {
      this.logger.error('Failed to initialize database service', error as Error);
      if (this.db) {
        this.db.close();
        this.db = null;
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
      this.logger.info('Database service closed');
    }
  }

  async healthCheck(): Promise<ServiceHealth> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      if (!this.db) {
        throw new Error('Database not initialized');
      }

      // Test basic query
      const result = await this.query('SELECT 1 as test');
      if (result.rows.length !== 1 || result.rows[0].test !== 1) {
        throw new Error('Database test query failed');
      }

      // Check migration version
      await this.getMigrationVersion();

      return {
        healthy: true,
        lastCheck: new Date(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Database health check failed', error as Error);
      
      return {
        healthy: false,
        lastCheck: new Date(),
        error: errorMessage,
      };
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new Error('Database service not initialized');
    }
  }

  // Query operations
  async query<T = Record<string, unknown>>(sql: string, params?: SQLiteParam[]): Promise<QueryResult<T>> {
    this.ensureInitialized();
    
    try {
      const stmt = this.db!.query(sql);
      const rows = stmt.all(...(params || [])) as T[];
      
      this.logger.debug('Query executed', { 
        sql: sql.substring(0, 100) + (sql.length > 100 ? '...' : ''),
        rowCount: rows.length,
      });
      
      return {
        rows,
        rowCount: rows.length,
      };
    } catch (error) {
      this.logger.error('Query failed', error as Error, { sql, params });
      throw error;
    }
  }

  async run(sql: string, params?: SQLiteParam[]): Promise<{ lastInsertRowId: number; changes: number }> {
    if (!this.db) {
      throw new Error('Database not available');
    }
    
    try {
      const stmt = this.db!.prepare(sql);
      const result = stmt.run(...(params || []));
      
      this.logger.debug('Statement executed', { 
        sql: sql.substring(0, 100) + (sql.length > 100 ? '...' : ''),
        changes: result.changes,
        lastInsertRowId: result.lastInsertRowid,
      });
      
      return {
        lastInsertRowId: Number(result.lastInsertRowid),
        changes: result.changes,
      };
    } catch (error) {
      this.logger.error('Statement execution failed', error as Error, { sql, params });
      throw error;
    }
  }

  async get<T = Record<string, unknown>>(sql: string, params?: SQLiteParam[]): Promise<T | null> {
    if (!this.db) {
      throw new Error('Database not available');
    }
    
    try {
      const stmt = this.db!.query(sql);
      const row = stmt.get(...(params || [])) as T | null;
      
      this.logger.debug('Single row query executed', { 
        sql: sql.substring(0, 100) + (sql.length > 100 ? '...' : ''),
        found: row !== null,
      });
      
      return row;
    } catch (error) {
      this.logger.error('Single row query failed', error as Error, { sql, params });
      throw error;
    }
  }

  // Transaction operations
  async transaction<T>(
    callback: (tx: DatabaseTransaction) => Promise<T>, 
    options?: TransactionOptions
  ): Promise<T> {
    if (!this.db) {
      throw new Error('Database not available for transaction');
    }
    
    const txType = options?.exclusive ? 'EXCLUSIVE' : options?.immediate ? 'IMMEDIATE' : 'DEFERRED';
    
    try {
      await this.run(`BEGIN ${txType} TRANSACTION`);
      
      const transaction: DatabaseTransaction = {
        query: <U = Record<string, unknown>>(sql: string, params?: SQLiteParam[]) => this.query<U>(sql, params),
        run: (sql: string, params?: SQLiteParam[]) => this.run(sql, params),
        get: <U = Record<string, unknown>>(sql: string, params?: SQLiteParam[]) => this.get<U>(sql, params),
      };
      
      const result = await callback(transaction);
      await this.run('COMMIT');
      
      this.logger.debug('Transaction committed', { type: txType });
      return result;
    } catch (error) {
      try {
        await this.run('ROLLBACK');
        this.logger.debug('Transaction rolled back due to error');
      } catch (rollbackError) {
        this.logger.error('Failed to rollback transaction', rollbackError as Error);
      }
      
      this.logger.error('Transaction failed', error as Error, { type: txType });
      throw error;
    }
  }

  // Migration operations
  async migrate(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not available for migrations');
    }
    
    // Create migrations table if it doesn't exist
    await this.run(`
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    const currentVersion = await this.getMigrationVersion();
    const migrations = this.getMigrations();
    const pendingMigrations = migrations.filter(m => m.version > currentVersion);
    
    if (pendingMigrations.length === 0) {
      this.logger.info('No pending migrations');
      return;
    }
    
    this.logger.info('Running migrations', { 
      currentVersion, 
      pendingCount: pendingMigrations.length,
      targetVersion: Math.max(...pendingMigrations.map(m => m.version)),
    });
    
    for (const migration of pendingMigrations) {
      await this.transaction(async (tx) => {
        this.logger.info('Applying migration', { 
          version: migration.version, 
          name: migration.name 
        });
        
        // Parse SQL statements properly (handles triggers with semicolons inside)
        const statements = this.parseSQLStatements(migration.up);
        for (const statement of statements) {
          if (statement.trim()) {
            await tx.run(statement.trim());
          }
        }
        
        // Record migration
        await tx.run(
          'INSERT INTO migrations (version, name) VALUES (?, ?)',
          [migration.version, migration.name]
        );
      });
      
      this.logger.info('Migration applied successfully', { 
        version: migration.version, 
        name: migration.name 
      });
    }
    
    const newVersion = await this.getMigrationVersion();
    this.logger.info('Migrations completed', { 
      fromVersion: currentVersion, 
      toVersion: newVersion 
    });
  }

  async getMigrationVersion(): Promise<number> {
    try {
      const result = await this.get<{ version: number }>(
        'SELECT version FROM migrations ORDER BY version DESC LIMIT 1'
      );
      return result?.version || 0;
    } catch {
      // If migrations table doesn't exist, version is 0
      return 0;
    }
  }

  async rollback(targetVersion?: number): Promise<void> {
    this.ensureInitialized();
    
    const currentVersion = await this.getMigrationVersion();
    const target = targetVersion ?? Math.max(0, currentVersion - 1);
    
    if (target >= currentVersion) {
      this.logger.info('No rollback needed', { currentVersion, targetVersion: target });
      return;
    }
    
    const migrations = this.getMigrations();
    const rollbackMigrations = migrations
      .filter(m => m.version > target && m.version <= currentVersion)
      .sort((a, b) => b.version - a.version); // Reverse order for rollback
    
    this.logger.info('Rolling back migrations', { 
      currentVersion, 
      targetVersion: target,
      rollbackCount: rollbackMigrations.length,
    });
    
    for (const migration of rollbackMigrations) {
      await this.transaction(async (tx) => {
        this.logger.info('Rolling back migration', { 
          version: migration.version, 
          name: migration.name 
        });
        
        // Run rollback SQL
        const statements = migration.down.split(';').filter(s => s.trim());
        for (const statement of statements) {
          if (statement.trim()) {
            await tx.run(statement.trim());
          }
        }
        
        // Remove migration record
        await tx.run('DELETE FROM migrations WHERE version = ?', [migration.version]);
      });
      
      this.logger.info('Migration rolled back successfully', { 
        version: migration.version, 
        name: migration.name 
      });
    }
    
    const newVersion = await this.getMigrationVersion();
    this.logger.info('Rollback completed', { 
      fromVersion: currentVersion, 
      toVersion: newVersion 
    });
  }

  // Utility operations
  async getTableNames(): Promise<string[]> {
    const result = await this.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    return result.rows.map(row => row.name);
  }

  async getTableInfo(tableName: string): Promise<TableInfo[]> {
    const result = await this.query<TableInfo>(`PRAGMA table_info(${tableName})`);
    return result.rows;
  }

  async vacuum(): Promise<void> {
    this.ensureInitialized();
    await this.run('VACUUM');
    this.logger.info('Database vacuumed');
  }

  /**
   * Parse SQL statements properly, handling triggers and other complex constructs
   */
  private parseSQLStatements(sql: string): string[] {
    const statements: string[] = [];
    let current = '';
    let inTrigger = false;
    let triggerDepth = 0;
    
    const lines = sql.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip comments and empty lines
      if (trimmed.startsWith('--') || trimmed === '') {
        continue;
      }
      
      current += line + '\n';
      
      // Check for trigger start
      if (trimmed.toUpperCase().includes('CREATE TRIGGER')) {
        inTrigger = true;
        triggerDepth = 0;
      }
      
      // Track BEGIN/END depth in triggers
      if (inTrigger) {
        if (trimmed.toUpperCase().includes('BEGIN')) {
          triggerDepth++;
        }
        if (trimmed.toUpperCase().includes('END')) {
          triggerDepth--;
          if (triggerDepth <= 0) {
            inTrigger = false;
          }
        }
      }
      
      // End statement on semicolon (unless we're inside a trigger)
      if (trimmed.endsWith(';') && !inTrigger) {
        statements.push(current.trim());
        current = '';
      }
    }
    
    // Add any remaining content
    if (current.trim()) {
      statements.push(current.trim());
    }
    
    return statements.filter(s => s && !s.match(/^\s*$/));
  }

  /**
   * Get all available migrations
   */
  private getMigrations(): Migration[] {
    return [
      {
        version: 1,
        name: 'initial_schema',
        up: `
          -- Settings table for system and backup configuration
          CREATE TABLE settings (
            id INTEGER PRIMARY KEY,
            type TEXT NOT NULL CHECK (type IN ('system', 'backup')),
            data TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
          
          CREATE UNIQUE INDEX idx_settings_type ON settings(type);
          
          -- Jobs table for background task management
          CREATE TABLE jobs (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
            payload TEXT NOT NULL,
            result TEXT,
            error TEXT,
            progress INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            started_at DATETIME,
            completed_at DATETIME,
            cancelled_at DATETIME
          );
          
          CREATE INDEX idx_jobs_status ON jobs(status);
          CREATE INDEX idx_jobs_type ON jobs(type);
          CREATE INDEX idx_jobs_created_at ON jobs(created_at);
          
          -- Catalog table for application search index
          CREATE TABLE catalog_apps (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            version TEXT NOT NULL,
            tags TEXT, -- JSON array
            category TEXT,
            icon_url TEXT,
            manifest_data TEXT NOT NULL, -- JSON manifest
            bundle_url TEXT,
            indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
          
          CREATE INDEX idx_catalog_name ON catalog_apps(name);
          CREATE INDEX idx_catalog_category ON catalog_apps(category);
          CREATE VIRTUAL TABLE catalog_search USING fts5(
            name, description, tags, category,
            content='catalog_apps',
            content_rowid='rowid'
          );
          
          -- Triggers to keep FTS table in sync
          CREATE TRIGGER catalog_insert AFTER INSERT ON catalog_apps BEGIN
            INSERT INTO catalog_search(rowid, name, description, tags, category)
            VALUES (new.rowid, new.name, new.description, new.tags, new.category);
          END;
          
          CREATE TRIGGER catalog_delete AFTER DELETE ON catalog_apps BEGIN
            INSERT INTO catalog_search(catalog_search, rowid, name, description, tags, category)
            VALUES ('delete', old.rowid, old.name, old.description, old.tags, old.category);
          END;
          
          CREATE TRIGGER catalog_update AFTER UPDATE ON catalog_apps BEGIN
            INSERT INTO catalog_search(catalog_search, rowid, name, description, tags, category)
            VALUES ('delete', old.rowid, old.name, old.description, old.tags, old.category);
            INSERT INTO catalog_search(rowid, name, description, tags, category)
            VALUES (new.rowid, new.name, new.description, new.tags, new.category);
          END;
        `,
        down: `
          DROP TRIGGER IF EXISTS catalog_update;
          DROP TRIGGER IF EXISTS catalog_delete;
          DROP TRIGGER IF EXISTS catalog_insert;
          DROP TABLE IF EXISTS catalog_search;
          DROP TABLE IF EXISTS catalog_apps;
          DROP TABLE IF EXISTS jobs;
          DROP TABLE IF EXISTS settings;
        `,
      },
    ];
  }
}

/**
 * Mock database service for testing/fallback
 */
export class MockDatabaseService implements DatabaseService {
  private logger = getLogger().child({ service: 'MockDatabaseService' });
  private data = new Map<string, Record<string, unknown>[]>();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    
    // Initialize mock tables
    this.data.set('settings', []);
    this.data.set('jobs', []);
    this.data.set('catalog_apps', []);
    this.data.set('migrations', [{ version: 1, name: 'initial_schema' }]);
    
    this.initialized = true;
    this.logger.info('Mock database service initialized');
  }

  async close(): Promise<void> {
    this.data.clear();
    this.initialized = false;
    this.logger.info('Mock database service closed');
  }

  async healthCheck(): Promise<ServiceHealth> {
    return {
      healthy: true,
      lastCheck: new Date(),
    };
  }

  async query<T = Record<string, unknown>>(sql: string, _params?: SQLiteParam[]): Promise<QueryResult<T>> {
    // Simple mock implementation - just return empty results
    this.logger.debug('Mock query executed', { sql: sql.substring(0, 50) });
    return { rows: [], rowCount: 0 };
  }

  async run(sql: string, _params?: SQLiteParam[]): Promise<{ lastInsertRowId: number; changes: number }> {
    this.logger.debug('Mock statement executed', { sql: sql.substring(0, 50) });
    return { lastInsertRowId: Date.now(), changes: 1 };
  }

  async get<T = Record<string, unknown>>(sql: string, _params?: SQLiteParam[]): Promise<T | null> {
    this.logger.debug('Mock single row query executed', { sql: sql.substring(0, 50) });
    return null;
  }

  async transaction<T>(callback: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
    const mockTx: DatabaseTransaction = {
      query: <U = Record<string, unknown>>(sql: string, params?: SQLiteParam[]) => this.query<U>(sql, params),
      run: (sql: string, params?: SQLiteParam[]) => this.run(sql, params),
      get: <U = Record<string, unknown>>(sql: string, params?: SQLiteParam[]) => this.get<U>(sql, params),
    };
    
    return await callback(mockTx);
  }

  async migrate(): Promise<void> {
    this.logger.info('Mock migrations completed');
  }

  async getMigrationVersion(): Promise<number> {
    return 1;
  }

  async rollback(targetVersion?: number): Promise<void> {
    this.logger.info('Mock rollback completed', { targetVersion });
  }

  async getTableNames(): Promise<string[]> {
    return ['settings', 'jobs', 'catalog_apps', 'migrations'];
  }

  async getTableInfo(_tableName: string): Promise<TableInfo[]> {
    return [];
  }

  async vacuum(): Promise<void> {
    this.logger.info('Mock database vacuumed');
  }
}
