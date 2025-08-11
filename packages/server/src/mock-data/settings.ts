// Settings mock data
import type {
  GetSettingsResponse,
  PatchSettingsResponse,
  GetBackupSettingsResponse,
  PatchBackupSettingsResponse,
  SystemEnvVar
} from '@hola/shared';

// System environment variables
const systemEnvVars: SystemEnvVar[] = [
  { key: 'DOMAIN', value: 'localhost', isSecret: false, description: 'Base domain for all services' },
  { key: 'SMTP_HOST', value: 'smtp.gmail.com', isSecret: false, description: 'SMTP server hostname' },
  { key: 'SMTP_PORT', value: '587', isSecret: false, description: 'SMTP server port' },
  { key: 'SMTP_USER', value: 'user@gmail.com', isSecret: false, description: 'SMTP username' },
  { key: 'SMTP_PASSWORD', value: '', isSecret: true, description: 'SMTP password for email notifications' },
  { key: 'TLS_EMAIL', value: '', isSecret: false, description: 'Email for Let\'s Encrypt certificates' },
  { key: 'ADMIN_API_KEY', value: '', isSecret: true, description: 'API key for administrative access' },
  { key: 'BACKUP_ENCRYPTION_KEY', value: '', isSecret: true, description: 'Key for encrypting backup files' },
];

// Docker settings
let dockerSettings = {
  host: '/var/run/docker.sock',
};

// TLS settings
let tlsSettings = {
  email: '',
};

// Notification settings
let notificationSettings = {
  smtpHost: 'smtp.gmail.com',
  smtpUser: 'user@gmail.com',
  smtpPassword: '', // Password is redacted in responses
};

// Backup schedule settings
let backupSettings = {
  scheduleEnabled: true,
  scheduleTime: '02:00', // 2:00 AM
  retentionDays: 7,
};

// Helper function to redact sensitive values for responses
function redactSecrets(envVars: SystemEnvVar[]): SystemEnvVar[] {
  return envVars.map(envVar => ({
    ...envVar,
    value: envVar.isSecret && envVar.value ? '••••••••' : envVar.value,
  }));
}

// Export functions for API handlers
export function getSettings(): GetSettingsResponse {
  return {
    systemEnv: redactSecrets(systemEnvVars),
    docker: { ...dockerSettings },
    tls: { ...tlsSettings },
    notifications: {
      ...notificationSettings,
      smtpPassword: notificationSettings.smtpPassword ? '••••••••' : '',
    },
  };
}

export function updateSettings(updates: Partial<GetSettingsResponse>): PatchSettingsResponse {
  // Update system environment variables
  if (updates.systemEnv) {
    for (const updatedVar of updates.systemEnv) {
      const existingVar = systemEnvVars.find(v => v.key === updatedVar.key);
      if (existingVar) {
        // Only update if value is not redacted (not just dots)
        if (updatedVar.value && !updatedVar.value.match(/^•+$/)) {
          existingVar.value = updatedVar.value;
        }
        // Update other properties
        if (updatedVar.description !== undefined) {
          existingVar.description = updatedVar.description;
        }
      } else {
        // Add new environment variable
        systemEnvVars.push(updatedVar);
      }
    }
  }

  // Update Docker settings
  if (updates.docker) {
    dockerSettings = { ...dockerSettings, ...updates.docker };
  }

  // Update TLS settings
  if (updates.tls) {
    tlsSettings = { ...tlsSettings, ...updates.tls };
  }

  // Update notification settings
  if (updates.notifications) {
    const { smtpPassword, ...otherNotificationUpdates } = updates.notifications;
    notificationSettings = { ...notificationSettings, ...otherNotificationUpdates };
    
    // Only update password if it's not redacted
    if (smtpPassword && !smtpPassword.match(/^•+$/)) {
      notificationSettings.smtpPassword = smtpPassword;
    }
  }

  // Return updated settings (with secrets redacted)
  return getSettings();
}

export function getBackupSettings(): GetBackupSettingsResponse {
  return { ...backupSettings };
}

export function updateBackupSettings(updates: Partial<GetBackupSettingsResponse>): PatchBackupSettingsResponse {
  backupSettings = { ...backupSettings, ...updates };
  return { ...backupSettings };
}

// Utility functions
export function getSystemEnvVar(key: string): string | undefined {
  const envVar = systemEnvVars.find(v => v.key === key);
  return envVar?.value;
}

export function setSystemEnvVar(key: string, value: string, isSecret: boolean = false, description?: string): void {
  const existingVar = systemEnvVars.find(v => v.key === key);
  if (existingVar) {
    existingVar.value = value;
    existingVar.isSecret = isSecret;
    if (description) {
      existingVar.description = description;
    }
  } else {
    systemEnvVars.push({ key, value, isSecret, description });
  }
}

export function removeSystemEnvVar(key: string): boolean {
  const index = systemEnvVars.findIndex(v => v.key === key);
  if (index !== -1) {
    systemEnvVars.splice(index, 1);
    return true;
  }
  return false;
}

// Function to validate settings
export function validateSettings(settings: Partial<GetSettingsResponse>): {
  isValid: boolean;
  errors: Array<{ field: string; message: string }>;
} {
  const errors: Array<{ field: string; message: string }> = [];

  // Validate TLS email if provided
  if (settings.tls?.email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(settings.tls.email)) {
      errors.push({ field: 'tls.email', message: 'Invalid email format' });
    }
  }

  // Validate SMTP settings if provided
  if (settings.notifications?.smtpHost && !settings.notifications.smtpHost.trim()) {
    errors.push({ field: 'notifications.smtpHost', message: 'SMTP host cannot be empty' });
  }

  if (settings.notifications?.smtpUser) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(settings.notifications.smtpUser)) {
      errors.push({ field: 'notifications.smtpUser', message: 'Invalid email format' });
    }
  }

  // Validate Docker host path if provided
  if (settings.docker?.host && !settings.docker.host.trim()) {
    errors.push({ field: 'docker.host', message: 'Docker host cannot be empty' });
  }

  // Validate system environment variables
  if (settings.systemEnv) {
    for (const envVar of settings.systemEnv) {
      if (!envVar.key || !envVar.key.trim()) {
        errors.push({ field: `systemEnv.${envVar.key}`, message: 'Environment variable key cannot be empty' });
      }
      
      // Check for duplicate keys
      const duplicates = settings.systemEnv.filter(v => v.key === envVar.key);
      if (duplicates.length > 1) {
        errors.push({ field: `systemEnv.${envVar.key}`, message: 'Duplicate environment variable key' });
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// Function to get settings that should be applied to new deployments
export function getSystemEnvironmentForDeployment(): Record<string, string> {
  const envMap: Record<string, string> = {};
  
  for (const envVar of systemEnvVars) {
    if (envVar.value) {
      envMap[envVar.key] = envVar.value;
    }
  }
  
  return envMap;
}
