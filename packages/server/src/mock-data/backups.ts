// Backups mock data
import type {
  BackupItem,
  GetBackupsResponse,
  CreateBackupResponse,
  GetBackupResponse,
  RestoreBackupResponse,
  DeleteBackupResponse,
  BackupStatus
} from '@hola/shared';
import { stateManager } from './state-manager';
import { createJob } from './jobs';

// Initial backup data
const backupsData: BackupItem[] = [
  {
    id: 'backup-1',
    app: 'Nextcloud',
    appId: 'nextcloud-prod',
    icon: '☁️',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    sizeBytes: 2_400_000_000, // 2.4GB
    status: 'completed',
    type: 'automatic',
  },
  {
    id: 'backup-2',
    app: 'Home Assistant',
    appId: 'homeassistant-main',
    icon: '🏠',
    timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), // 12 hours ago
    sizeBytes: 145_000_000, // 145MB
    status: 'completed',
    type: 'automatic',
  },
  {
    id: 'backup-3',
    app: 'Bitwarden',
    appId: 'bitwarden-vault',
    icon: '🔐',
    timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
    sizeBytes: 52_000_000, // 52MB
    status: 'completed',
    type: 'manual',
  },
  {
    id: 'backup-4',
    app: 'Plex Media Server',
    appId: 'plex-media',
    icon: '🎬',
    timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
    sizeBytes: 856_000_000, // 856MB
    status: 'failed',
    type: 'automatic',
  },
  {
    id: 'backup-5',
    app: 'Grafana',
    appId: 'grafana-monitoring',
    icon: '📊',
    timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 1 week ago
    sizeBytes: 89_000_000, // 89MB
    status: 'completed',
    type: 'manual',
  },
];

// Backup file details for detailed backup view
const backupFilesData: Record<string, Array<{ path: string; sizeBytes: number }>> = {
  'backup-1': [
    { path: 'nextcloud-data.tar.gz', sizeBytes: 2_100_000_000 },
    { path: 'nextcloud-db.sql.gz', sizeBytes: 250_000_000 },
    { path: 'nextcloud-config.tar.gz', sizeBytes: 50_000_000 },
  ],
  'backup-2': [
    { path: 'homeassistant-config.tar.gz', sizeBytes: 120_000_000 },
    { path: 'homeassistant-db.sqlite.gz', sizeBytes: 25_000_000 },
  ],
  'backup-3': [
    { path: 'bitwarden-data.tar.gz', sizeBytes: 45_000_000 },
    { path: 'bitwarden-db.sqlite.gz', sizeBytes: 7_000_000 },
  ],
  'backup-4': [
    { path: 'plex-partial.tar.gz', sizeBytes: 856_000_000 },
  ],
  'backup-5': [
    { path: 'grafana-data.tar.gz', sizeBytes: 75_000_000 },
    { path: 'grafana-db.sqlite.gz', sizeBytes: 14_000_000 },
  ],
};

function applyFilters(
  backups: BackupItem[],
  filters: {
    appId?: string;
    status?: BackupStatus;
  }
): BackupItem[] {
  return backups.filter(backup => {
    // App filter
    if (filters.appId && backup.appId !== filters.appId) {
      return false;
    }

    // Status filter
    if (filters.status && backup.status !== filters.status) {
      return false;
    }

    return true;
  });
}

function paginateResults<T>(items: T[], page: number, limit: number): {
  items: T[];
  page: number;
  limit: number;
  total: number;
} {
  const total = items.length;
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  const paginatedItems = items.slice(startIndex, endIndex);

  return {
    items: paginatedItems,
    page,
    limit,
    total,
  };
}

// Export functions for API handlers
export function getBackups(params: {
  page?: number;
  limit?: number;
  appId?: string;
  status?: BackupStatus;
}): GetBackupsResponse {
  const { page = 1, limit = 10, appId, status } = params;
  
  const filteredBackups = applyFilters(backupsData, { appId, status });
  
  // Sort by timestamp (newest first)
  filteredBackups.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  
  return paginateResults(filteredBackups, page, limit);
}

export function getBackupById(backupId: string): GetBackupResponse | null {
  const backup = backupsData.find(b => b.id === backupId);
  if (!backup) {
    return null;
  }

  const files = backupFilesData[backupId] || [];

  return {
    ...backup,
    files,
  };
}

export function createBackup(params: { appId?: string }): CreateBackupResponse {
  const { appId } = params;
  
  // Create backup job
  const job = createJob({
    type: 'backup',
    deploymentId: appId,
  });

  // Generate backup ID
  const backupId = crypto.randomUUID();

  // In a real system, the backup would be created when the job completes
  // For now, we'll add it immediately as 'running' status
  const deployment = appId ? stateManager.getDeployment(appId) : null;
  const newBackup: BackupItem = {
    id: backupId,
    app: deployment?.name || 'System Backup',
    appId,
    icon: deployment?.icon || '💾',
    timestamp: new Date().toISOString(),
    sizeBytes: 0, // Will be updated when backup completes
    status: 'running',
    type: 'manual',
  };

  backupsData.unshift(newBackup); // Add to beginning of array

  return {
    jobId: job.id,
    backupId,
  };
}

export function restoreBackup(
  backupId: string,
  params: { targetDeploymentId?: string }
): RestoreBackupResponse | null {
  const backup = backupsData.find(b => b.id === backupId);
  if (!backup || backup.status !== 'completed') {
    return null;
  }

  const targetDeploymentId = params.targetDeploymentId || backup.appId;
  
  // Create restore job
  const job = createJob({
    type: 'restore',
    deploymentId: targetDeploymentId,
  });

  return {
    jobId: job.id,
  };
}

export function deleteBackup(backupId: string): DeleteBackupResponse | null {
  const backupIndex = backupsData.findIndex(b => b.id === backupId);
  if (backupIndex === -1) {
    return null;
  }

  // Remove backup from data
  backupsData.splice(backupIndex, 1);
  
  // Remove file details
  delete backupFilesData[backupId];

  return { ok: true };
}

// Utility function to update backup status (for job completion simulation)
export function updateBackupStatus(backupId: string, status: BackupStatus, sizeBytes?: number): void {
  const backup = backupsData.find(b => b.id === backupId);
  if (backup) {
    backup.status = status;
    if (sizeBytes !== undefined) {
      backup.sizeBytes = sizeBytes;
    }
  }
}

// Function to simulate automatic backups
export function scheduleAutomaticBackups(): void {
  // This would be called by a scheduler in a real system
  // For demo purposes, we'll create a random automatic backup occasionally
  if (Math.random() < 0.1) { // 10% chance when called
    const deployments = stateManager.getAllDeployments();
    const runningDeployments = deployments.filter(d => d.status === 'running');
    
    if (runningDeployments.length > 0) {
      const randomDeployment = runningDeployments[Math.floor(Math.random() * runningDeployments.length)];
      
      console.log(`[mock-backups] Creating automatic backup for ${randomDeployment.name}`);
      createBackup({ appId: randomDeployment.id });
    }
  }
}
