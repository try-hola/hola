/**
 * Database-backed Config Service - Phase 2
 * 
 * Manages system and backup settings with validation and database persistence.
 * Replaces file-based storage with database repository pattern.
 */

import { type AppEnvVar } from '@hola/shared';
import { getLogger } from '../../lib/logger';
import type { HealthCheckable, ServiceHealth } from '../factory';
import type { DatabaseService } from './database';
import { DatabaseSettingsRepository, type SettingsRepository } from './repositories';

export interface SystemSettings {
  systemEnv: AppEnvVar[];
  docker?: { host?: string };
  tls?: { email?: string };
  notifications?: { smtpHost?: string; smtpUser?: string; smtpPassword?: string };
}

export interface BackupSettings {
  scheduleEnabled: boolean;
  scheduleTime: string;
  retentionDays: number;
}

export interface DatabaseConfigService extends HealthCheckable {
  // System settings
  getSystemSettings(): Promise<SystemSettings>;
  updateSystemSettings(updates: Partial<SystemSettings>): Promise<SystemSettings>;
  
  // Backup settings
  getBackupSettings(): Promise<BackupSettings>;
  updateBackupSettings(updates: Partial<BackupSettings>): Promise<BackupSettings>;
  
  // Validation
  validateSystemSettings(settings: Partial<SystemSettings>): Promise<string[]>;
  validateBackupSettings(settings: Partial<BackupSettings>): Promise<string[]>;
  
  // Initialization
  initialize(): Promise<void>;
}

/**
 * Database-backed config service implementation
 */
export class RealDatabaseConfigService implements DatabaseConfigService {
  private logger = getLogger().child({ service: 'DatabaseConfigService' });
  private database: DatabaseService;
  private repository: SettingsRepository;
  private initialized = false;

  constructor(database: DatabaseService) {
    this.database = database;
    this.repository = new DatabaseSettingsRepository(database);
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.info('Initializing database config service');

    try {
      // Ensure database is initialized first
      await this.database.initialize();

      this.initialized = true;
      this.logger.info('Database config service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize database config service', error as Error);
      throw error;
    }
  }

  async healthCheck(): Promise<ServiceHealth> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      // Test reading settings
      await this.getSystemSettings();
      await this.getBackupSettings();

      return {
        healthy: true,
        lastCheck: new Date(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Database config health check failed', error as Error);
      
      return {
        healthy: false,
        lastCheck: new Date(),
        error: errorMessage,
      };
    }
  }

  // System settings operations
  async getSystemSettings(): Promise<SystemSettings> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      const settings = await this.repository.getSystemSettings();
      this.logger.debug('System settings retrieved from database');
      return settings;
    } catch (error) {
      this.logger.error('Failed to get system settings from database', error as Error);
      throw error;
    }
  }

  async updateSystemSettings(updates: Partial<SystemSettings>): Promise<SystemSettings> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      const current = await this.getSystemSettings();
      
      // Merge updates with current settings
      const updated: SystemSettings = {
        ...current,
        ...updates,
        // Handle nested objects properly
        ...(updates.docker && { docker: { ...current.docker, ...updates.docker } }),
        ...(updates.tls && { tls: { ...current.tls, ...updates.tls } }),
        ...(updates.notifications && { 
          notifications: { ...current.notifications, ...updates.notifications } 
        }),
        // System env requires special handling to maintain array structure
        ...(updates.systemEnv && { systemEnv: updates.systemEnv }),
      };

      // Validate settings before saving
      const errors = await this.validateSystemSettings(updated);
      if (errors.length > 0) {
        throw new Error(`Validation failed: ${errors.join(', ')}`);
      }

      // Save through repository
      const result = await this.repository.updateSystemSettings(updated);

      this.logger.info('System settings updated in database');
      return result;
    } catch (error) {
      this.logger.error('Failed to update system settings in database', error as Error);
      throw error;
    }
  }

  // Backup settings operations
  async getBackupSettings(): Promise<BackupSettings> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      const settings = await this.repository.getBackupSettings();
      this.logger.debug('Backup settings retrieved from database');
      return settings;
    } catch (error) {
      this.logger.error('Failed to get backup settings from database', error as Error);
      throw error;
    }
  }

  async updateBackupSettings(updates: Partial<BackupSettings>): Promise<BackupSettings> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      const current = await this.getBackupSettings();
      const updated = { ...current, ...updates };

      // Validate settings before saving
      const errors = await this.validateBackupSettings(updated);
      if (errors.length > 0) {
        throw new Error(`Validation failed: ${errors.join(', ')}`);
      }

      // Save through repository
      const result = await this.repository.updateBackupSettings(updated);

      this.logger.info('Backup settings updated in database');
      return result;
    } catch (error) {
      this.logger.error('Failed to update backup settings in database', error as Error);
      throw error;
    }
  }

  // Validation methods (same as file-based implementation)
  async validateSystemSettings(settings: Partial<SystemSettings>): Promise<string[]> {
    const errors: string[] = [];

    // Validate system environment variables
    if (settings.systemEnv) {
      for (const envVar of settings.systemEnv) {
        if (!envVar.key || typeof envVar.key !== 'string') {
          errors.push('Environment variable key is required and must be a string');
        }
        if (envVar.key && !/^[A-Z][A-Z0-9_]*$/.test(envVar.key)) {
          errors.push(`Invalid environment variable key: ${envVar.key}. Must be uppercase with underscores.`);
        }
        if (typeof envVar.value !== 'string') {
          errors.push(`Environment variable ${envVar.key} value must be a string`);
        }
        if (typeof envVar.isSecret !== 'boolean') {
          errors.push(`Environment variable ${envVar.key} isSecret must be a boolean`);
        }
        if (envVar.description !== undefined && typeof envVar.description !== 'string') {
          errors.push(`Environment variable ${envVar.key} description must be a string`);
        }
      }
    }

    // Validate Docker settings
    if (settings.docker?.host) {
      if (typeof settings.docker.host !== 'string') {
        errors.push('Docker host must be a string');
      }
    }

    // Validate TLS settings
    if (settings.tls?.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(settings.tls.email)) {
        errors.push('TLS email must be a valid email address');
      }
    }

    // Validate notification settings
    if (settings.notifications) {
      const { smtpHost, smtpUser } = settings.notifications;
      if (smtpHost && typeof smtpHost !== 'string') {
        errors.push('SMTP host must be a string');
      }
      if (smtpUser && typeof smtpUser !== 'string') {
        errors.push('SMTP user must be a string');
      }
    }

    return errors;
  }

  async validateBackupSettings(settings: Partial<BackupSettings>): Promise<string[]> {
    const errors: string[] = [];

    if (settings.scheduleEnabled !== undefined && typeof settings.scheduleEnabled !== 'boolean') {
      errors.push('Schedule enabled must be a boolean');
    }

    if (settings.scheduleTime) {
      const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
      if (!timeRegex.test(settings.scheduleTime)) {
        errors.push('Schedule time must be in HH:MM format (24-hour)');
      }
    }

    if (settings.retentionDays !== undefined) {
      if (!Number.isInteger(settings.retentionDays) || settings.retentionDays < 1) {
        errors.push('Retention days must be a positive integer');
      }
    }

    return errors;
  }
}
