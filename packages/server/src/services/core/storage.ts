/**
 * Storage Service - Phase 1
 * 
 * Provides safe file system operations with atomic writes and directory management.
 * Handles the ~/.hola directory structure and provides safe file operations.
 */

import { promises as fs } from 'fs';
import { join, dirname, isAbsolute } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { getLogger } from '../../lib/logger';
import { getHolaDataDir } from '../../config/paths';
import type { HealthCheckable, ServiceHealth } from './types';

export interface StorageConfig {
  holaDir: string;
  tempDir: string;
  atomicWrites: boolean;
  createDirs: boolean;
}

export interface FileMetadata {
  path: string;
  size: number;
  modified: Date;
  created: Date;
  isDirectory: boolean;
}

export interface StorageService extends HealthCheckable {
  // Directory operations
  ensureDir(path: string): Promise<void>;
  listDir(path: string): Promise<string[]>;
  deleteDir(path: string, recursive?: boolean): Promise<void>;
  
  // File operations
  // `mode` (e.g. 0o600) restricts permissions for files holding secrets.
  writeFile(path: string, content: string | Buffer, mode?: number): Promise<void>;
  /** Append to a file (creating it + parent dirs if needed). Use for append-only
   *  files like logs, where rewriting the whole file would be O(size) and racy. */
  appendFile(path: string, content: string | Buffer): Promise<void>;
  readFile(path: string): Promise<Buffer>;
  readFileAsString(path: string, encoding?: BufferEncoding): Promise<string>;
  deleteFile(path: string): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  getMetadata(path: string): Promise<FileMetadata>;
  
  // Utility operations
  resolveHolaPath(...segments: string[]): string;
  resolveTempPath(filename?: string): string;
  initialize(): Promise<void>;
}

/**
 * Real storage service implementation
 */
export class RealStorageService implements StorageService {
  private logger = getLogger().child({ service: 'StorageService' });
  private config: StorageConfig;
  private initialized = false;

  constructor(config?: Partial<StorageConfig>) {
    this.config = {
      holaDir: getHolaDataDir(),
      tempDir: tmpdir(),
      atomicWrites: true,
      createDirs: true,
      ...config,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.info('Initializing storage service', {
      holaDir: this.config.holaDir,
      tempDir: this.config.tempDir,
    });

    try {
      // Create base directories
      await this.ensureDir(this.config.holaDir);
      await this.ensureDir(join(this.config.holaDir, 'config'));
      await this.ensureDir(join(this.config.holaDir, 'logs'));
      await this.ensureDir(join(this.config.holaDir, 'data'));
      await this.ensureDir(join(this.config.holaDir, 'backups'));
      await this.ensureDir(join(this.config.holaDir, 'temp'));

      this.initialized = true;
      this.logger.info('Storage service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize storage service', error as Error);
      throw error;
    }
  }

  async healthCheck(): Promise<ServiceHealth> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      // Test write operations
      const testPath = this.resolveTempPath('health-check.txt');
      const testContent = `health-check-${Date.now()}`;
      
      await this.writeFile(testPath, testContent);
      const readBack = await this.readFileAsString(testPath);
      await this.deleteFile(testPath);

      if (readBack !== testContent) {
        throw new Error('File content mismatch during health check');
      }

      return {
        healthy: true,
        lastCheck: new Date(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Storage health check failed', error as Error);
      
      return {
        healthy: false,
        lastCheck: new Date(),
        error: errorMessage,
      };
    }
  }

  // Directory operations
  async ensureDir(path: string): Promise<void> {
    path = this.resolveStoragePath(path);

    try {
      await fs.mkdir(path, { recursive: true });
      this.logger.debug('Directory ensured', { path });
    } catch (error) {
      this.logger.error('Failed to ensure directory', error as Error, { path });
      throw new Error(`Failed to create directory ${path}: ${error}`, { cause: error });
    }
  }

  async listDir(path: string): Promise<string[]> {
    path = this.resolveStoragePath(path);

    try {
      const items = await fs.readdir(path);
      this.logger.debug('Directory listed', { path, count: items.length });
      return items;
    } catch (error) {
      this.logger.error('Failed to list directory', error as Error, { path });
      throw new Error(`Failed to list directory ${path}: ${error}`, { cause: error });
    }
  }

  async deleteDir(path: string, recursive = false): Promise<void> {
    path = this.resolveStoragePath(path);

    try {
      if (recursive) {
        await fs.rm(path, { recursive: true });
      } else {
        await fs.rmdir(path);
      }
      this.logger.info('Directory deleted', { path, recursive });
    } catch (error) {
      this.logger.error('Failed to delete directory', error as Error, { path, recursive });
      throw new Error(`Failed to delete directory ${path}: ${error}`, { cause: error });
    }
  }

  // File operations
  async writeFile(path: string, content: string | Buffer, mode?: number): Promise<void> {
    path = this.resolveStoragePath(path);

    try {
      if (this.config.createDirs) {
        await this.ensureDir(dirname(path));
      }

      if (this.config.atomicWrites) {
        await this.writeFileAtomic(path, content, mode);
      } else {
        await fs.writeFile(path, content, mode !== undefined ? { mode } : undefined);
      }

      // Atomic writes set the mode on the temp file before rename; for the
      // non-atomic path the option above covers it. Re-assert for existing files
      // (writeFile's mode is ignored when the file already exists).
      if (mode !== undefined) {
        await fs.chmod(path, mode);
      }

      this.logger.debug('File written', {
        path,
        size: Buffer.isBuffer(content) ? content.length : content.length,
        atomic: this.config.atomicWrites,
      });
    } catch (error) {
      this.logger.error('Failed to write file', error as Error, { path });
      throw new Error(`Failed to write file ${path}: ${error}`, { cause: error });
    }
  }

  async appendFile(path: string, content: string | Buffer): Promise<void> {
    path = this.resolveStoragePath(path);

    try {
      if (this.config.createDirs) {
        await this.ensureDir(dirname(path));
      }
      await fs.appendFile(path, content);
      this.logger.debug('File appended', { path });
    } catch (error) {
      this.logger.error('Failed to append file', error as Error, { path });
      throw new Error(`Failed to append file ${path}: ${error}`, { cause: error });
    }
  }

  private async writeFileAtomic(path: string, content: string | Buffer, mode?: number): Promise<void> {
    const tempPath = `${path}.tmp.${randomUUID()}`;

    try {
      await fs.writeFile(tempPath, content, mode !== undefined ? { mode } : undefined);
      await fs.rename(tempPath, path);
    } catch (error) {
      // Clean up temp file on failure
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  async readFile(path: string): Promise<Buffer> {
    path = this.resolveStoragePath(path);

    try {
      const content = await fs.readFile(path);
      this.logger.debug('File read', { path, size: content.length });
      return content;
    } catch (error) {
      this.logger.error('Failed to read file', error as Error, { path });
      throw new Error(`Failed to read file ${path}: ${error}`, { cause: error });
    }
  }

  async readFileAsString(path: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
    const buffer = await this.readFile(path);
    return buffer.toString(encoding);
  }

  async deleteFile(path: string): Promise<void> {
    path = this.resolveStoragePath(path);

    try {
      await fs.unlink(path);
      this.logger.debug('File deleted', { path });
    } catch (error) {
      this.logger.error('Failed to delete file', error as Error, { path });
      throw new Error(`Failed to delete file ${path}: ${error}`, { cause: error });
    }
  }

  async fileExists(path: string): Promise<boolean> {
    path = this.resolveStoragePath(path);

    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  async getMetadata(path: string): Promise<FileMetadata> {
    path = this.resolveStoragePath(path);

    try {
      const stats = await fs.stat(path);
      return {
        path,
        size: stats.size,
        modified: stats.mtime,
        created: stats.ctime,
        isDirectory: stats.isDirectory(),
      };
    } catch (error) {
      this.logger.error('Failed to get file metadata', error as Error, { path });
      throw new Error(`Failed to get metadata for ${path}: ${error}`, { cause: error });
    }
  }

  // Utility operations
  private resolveStoragePath(path: string): string {
    return isAbsolute(path) ? path : this.resolveHolaPath(path);
  }

  resolveHolaPath(...segments: string[]): string {
    return join(this.config.holaDir, ...segments);
  }

  resolveTempPath(filename?: string): string {
    const tempFilename = filename || `temp-${randomUUID()}`;
    return join(this.config.holaDir, 'temp', tempFilename);
  }
}

/**
 * Mock storage service for testing/fallback
 */
export class MockStorageService implements StorageService {
  private logger = getLogger().child({ service: 'MockStorageService' });
  private files = new Map<string, Buffer>();
  private dirs = new Set<string>();

  async initialize(): Promise<void> {
    this.logger.info('Mock storage service initialized');
  }

  async healthCheck(): Promise<ServiceHealth> {
    return {
      healthy: true,
      lastCheck: new Date(),
    };
  }

  async ensureDir(path: string): Promise<void> {
    this.dirs.add(path);
    this.logger.debug('Mock directory ensured', { path });
  }

  async listDir(path: string): Promise<string[]> {
    const items: string[] = [];
    for (const dir of this.dirs) {
      if (dir.startsWith(path + '/')) {
        const relativePath = dir.substring(path.length + 1);
        const segments = relativePath.split('/');
        if (segments.length === 1) {
          items.push(segments[0]);
        }
      }
    }
    for (const [filePath] of this.files) {
      if (filePath.startsWith(path + '/')) {
        const relativePath = filePath.substring(path.length + 1);
        const segments = relativePath.split('/');
        if (segments.length === 1) {
          items.push(segments[0]);
        }
      }
    }
    return [...new Set(items)];
  }

  async deleteDir(path: string, recursive = false): Promise<void> {
    // Mock implementation
    this.logger.debug('Mock directory deleted', { path, recursive });
  }

  async writeFile(path: string, content: string | Buffer, mode?: number): Promise<void> {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
    this.files.set(path, buffer);
    this.logger.debug('Mock file written', { path, size: buffer.length, mode });
  }

  async appendFile(path: string, content: string | Buffer): Promise<void> {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const existing = this.files.get(path);
    this.files.set(path, existing ? Buffer.concat([existing, buffer]) : buffer);
  }

  async readFile(path: string): Promise<Buffer> {
    const content = this.files.get(path);
    if (!content) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  async readFileAsString(path: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
    const buffer = await this.readFile(path);
    return buffer.toString(encoding);
  }

  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
    this.logger.debug('Mock file deleted', { path });
  }

  async fileExists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async getMetadata(path: string): Promise<FileMetadata> {
    const content = this.files.get(path);
    if (!content) {
      throw new Error(`File not found: ${path}`);
    }
    
    const now = new Date();
    return {
      path,
      size: content.length,
      modified: now,
      created: now,
      isDirectory: false,
    };
  }

  resolveHolaPath(...segments: string[]): string {
    return join('/mock/.hola', ...segments);
  }

  resolveTempPath(filename?: string): string {
    return join('/mock/.hola/temp', filename || `temp-${randomUUID()}`);
  }
}
