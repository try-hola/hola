/**
 * Config Service - Phase 1
 * 
 * Manages system and backup settings with validation and persistence.
 * Built on top of StorageService for file operations.
 */

import { type AppEnvVar } from '@hola/shared';
import { getLogger } from '../../lib/logger';
import type { HealthCheckable, ServiceHealth } from './types';
import type { StorageService } from './storage';

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

export interface ConfigService extends HealthCheckable {
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
 * Real config service implementation
 */
export class RealConfigService implements ConfigService {
  private logger = getLogger().child({ service: 'ConfigService' });
  private storage: StorageService;
  private systemSettingsPath: string;
  private backupSettingsPath: string;
  private initialized = false;

  // Default settings
  private defaultSystemSettings: SystemSettings = {
    systemEnv: [
      { key: 'DOMAIN', value: 'localhost', isSecret: false, description: 'Base domain' },
      { key: 'SMTP_PASSWORD', value: '', isSecret: true, description: 'SMTP password' },
    ],
    docker: { host: '/var/run/docker.sock' },
    tls: { email: '' },
    notifications: { smtpHost: '', smtpUser: '', smtpPassword: '' },
  };

  private defaultBackupSettings: BackupSettings = {
    scheduleEnabled: true,
    scheduleTime: '02:00',
    retentionDays: 7,
  };

  constructor(storage: StorageService) {
    this.storage = storage;
    this.systemSettingsPath = storage.resolveHolaPath('config', 'system-settings.json');
    this.backupSettingsPath = storage.resolveHolaPath('config', 'backup-settings.json');
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.info('Initializing config service');

    try {
      // Ensure storage is initialized
      await this.storage.initialize();

      // Create default config files if they don't exist
      await this.ensureDefaultSettings();

      this.initialized = true;
      this.logger.info('Config service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize config service', error as Error);
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
      this.logger.error('Config health check failed', error as Error);
      
      return {
        healthy: false,
        lastCheck: new Date(),
        error: errorMessage,
      };
    }
  }

  private async ensureDefaultSettings(): Promise<void> {
    // Create system settings if they don't exist
    if (!(await this.storage.fileExists(this.systemSettingsPath))) {
      await this.storage.writeFile(
        this.systemSettingsPath,
        JSON.stringify(this.defaultSystemSettings, null, 2)
      );
      this.logger.info('Created default system settings');
    }

    // Create backup settings if they don't exist
    if (!(await this.storage.fileExists(this.backupSettingsPath))) {
      await this.storage.writeFile(
        this.backupSettingsPath,
        JSON.stringify(this.defaultBackupSettings, null, 2)
      );
      this.logger.info('Created default backup settings');
    }
  }

  // System settings operations
  async getSystemSettings(): Promise<SystemSettings> {
    try {
      const content = await this.storage.readFileAsString(this.systemSettingsPath);
      const settings = JSON.parse(content) as SystemSettings;
      
      this.logger.debug('System settings loaded');
      return settings;
    } catch (error) {
      this.logger.error('Failed to load system settings', error as Error);
      
      // Return defaults if file is corrupted
      this.logger.warn('Returning default system settings due to error');
      return { ...this.defaultSystemSettings };
    }
  }

  async updateSystemSettings(updates: Partial<SystemSettings>): Promise<SystemSettings> {
    try {
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

      // Save updated settings
      await this.storage.writeFile(
        this.systemSettingsPath,
        JSON.stringify(updated, null, 2)
      );

      this.logger.info('System settings updated');
      return updated;
    } catch (error) {
      this.logger.error('Failed to update system settings', error as Error);
      throw error;
    }
  }

  // Backup settings operations
  async getBackupSettings(): Promise<BackupSettings> {
    try {
      const content = await this.storage.readFileAsString(this.backupSettingsPath);
      const settings = JSON.parse(content) as BackupSettings;
      
      this.logger.debug('Backup settings loaded');
      return settings;
    } catch (error) {
      this.logger.error('Failed to load backup settings', error as Error);
      
      // Return defaults if file is corrupted
      this.logger.warn('Returning default backup settings due to error');
      return { ...this.defaultBackupSettings };
    }
  }

  async updateBackupSettings(updates: Partial<BackupSettings>): Promise<BackupSettings> {
    try {
      const current = await this.getBackupSettings();
      const updated = { ...current, ...updates };

      // Validate settings before saving
      const errors = await this.validateBackupSettings(updated);
      if (errors.length > 0) {
        throw new Error(`Validation failed: ${errors.join(', ')}`);
      }

      // Save updated settings
      await this.storage.writeFile(
        this.backupSettingsPath,
        JSON.stringify(updated, null, 2)
      );

      this.logger.info('Backup settings updated');
      return updated;
    } catch (error) {
      this.logger.error('Failed to update backup settings', error as Error);
      throw error;
    }
  }

  // Validation methods
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

/**
 * Mock config service for testing/fallback
 */
export class MockConfigService implements ConfigService {
  private logger = getLogger().child({ service: 'MockConfigService' });
  
  private systemSettings: SystemSettings = {
    systemEnv: [
      { key: 'DOMAIN', value: 'localhost', isSecret: false, description: 'Base domain' },
      { key: 'SMTP_PASSWORD', value: '', isSecret: true, description: 'SMTP password' },
    ],
    docker: { host: '/var/run/docker.sock' },
    tls: { email: '' },
    notifications: { smtpHost: '', smtpUser: '', smtpPassword: '' },
  };

  private backupSettings: BackupSettings = {
    scheduleEnabled: true,
    scheduleTime: '02:00',
    retentionDays: 7,
  };

  async initialize(): Promise<void> {
    this.logger.info('Mock config service initialized');
  }

  async healthCheck(): Promise<ServiceHealth> {
    return {
      healthy: true,
      lastCheck: new Date(),
    };
  }

  async getSystemSettings(): Promise<SystemSettings> {
    return { ...this.systemSettings };
  }

  async updateSystemSettings(updates: Partial<SystemSettings>): Promise<SystemSettings> {
    this.systemSettings = {
      ...this.systemSettings,
      ...updates,
      ...(updates.docker && { docker: { ...this.systemSettings.docker, ...updates.docker } }),
      ...(updates.tls && { tls: { ...this.systemSettings.tls, ...updates.tls } }),
      ...(updates.notifications && { 
        notifications: { ...this.systemSettings.notifications, ...updates.notifications } 
      }),
      ...(updates.systemEnv && { systemEnv: updates.systemEnv }),
    };
    
    this.logger.debug('Mock system settings updated');
    return { ...this.systemSettings };
  }

  async getBackupSettings(): Promise<BackupSettings> {
    return { ...this.backupSettings };
  }

  async updateBackupSettings(updates: Partial<BackupSettings>): Promise<BackupSettings> {
    this.backupSettings = { ...this.backupSettings, ...updates };
    this.logger.debug('Mock backup settings updated');
    return { ...this.backupSettings };
  }

  async validateSystemSettings(settings: Partial<SystemSettings>): Promise<string[]> {
    // Mock validation always passes
    void settings; // Acknowledge parameter
    return [];
  }

  async validateBackupSettings(settings: Partial<BackupSettings>): Promise<string[]> {
    // Mock validation always passes  
    void settings; // Acknowledge parameter
    return [];
  }
}
