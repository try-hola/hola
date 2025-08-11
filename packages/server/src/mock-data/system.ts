// System status and information
import type {
  GetSummaryResponse,
  GetSystemStatusResponse,
  SystemStatus
} from '@hola/shared';
import { stateManager } from './state-manager';
import { getRecentJobsForSummary, getActiveJobs } from './jobs';

// System status data extracted from Dashboard component
export const systemStatus: SystemStatus = {
  docker: { ok: true, version: '24.0.7' },
  disk: { 
    freeBytes: 50 * 1024 * 1024 * 1024, // 50GB free 
    totalBytes: 100 * 1024 * 1024 * 1024 // 100GB total
  },
  version: { hola: '1.0.0', compose: '2.23.3' },
  oras: { ok: true, version: '1.1.0' },
  authentik: { ok: true },
};

// Function to get system status with dynamic disk usage
export function getSystemStatus(): GetSystemStatusResponse {
  // Simulate some disk usage changes over time
  const baseTime = Date.now();
  const variation = Math.sin(baseTime / (1000 * 60 * 60)) * 0.1; // Hourly variation
  const freeBytes = Math.floor(systemStatus.disk.freeBytes * (1 + variation));
  
  return {
    ...systemStatus,
    disk: {
      freeBytes: Math.max(freeBytes, 5 * 1024 * 1024 * 1024), // Minimum 5GB free
      totalBytes: systemStatus.disk.totalBytes,
    },
  };
}

// Function to get dashboard summary
export function getSummary(): GetSummaryResponse {
  const allDeployments = stateManager.getAllDeployments();
  const activeJobs = getActiveJobs();
  const recentJobs = getRecentJobsForSummary(4);
  
  // Calculate alerts based on system status
  let alertsCount = 0;
  const currentSystemStatus = getSystemStatus();
  
  // Check disk space (alert if less than 20% free)
  const diskUsagePercent = ((currentSystemStatus.disk.totalBytes - currentSystemStatus.disk.freeBytes) / currentSystemStatus.disk.totalBytes) * 100;
  if (diskUsagePercent > 80) {
    alertsCount++;
  }
  
  // Check for failed jobs in recent history
  const failedJobs = recentJobs.filter(job => job.status === 'failed');
  if (failedJobs.length > 0) {
    alertsCount += failedJobs.length;
  }
  
  // Check for docker issues
  if (!currentSystemStatus.docker.ok) {
    alertsCount++;
  }

  return {
    deploymentsCount: allDeployments.length,
    activeJobsCount: activeJobs.length,
    alertsCount,
    recentJobs,
    system: currentSystemStatus,
  };
}

// Function to simulate system health changes
export function updateSystemHealth(): void {
  // This could be called periodically to simulate system changes
  // For now, we'll just ensure Docker status varies occasionally
  if (Math.random() < 0.02) { // 2% chance per call
    systemStatus.docker.ok = !systemStatus.docker.ok;
    console.log(`[mock-system] Docker status changed to: ${systemStatus.docker.ok ? 'healthy' : 'unhealthy'}`);
  }
  
  // Simulate ORAS occasional issues
  if (systemStatus.oras && Math.random() < 0.01) { // 1% chance per call
    systemStatus.oras.ok = !systemStatus.oras.ok;
    console.log(`[mock-system] ORAS status changed to: ${systemStatus.oras.ok ? 'healthy' : 'unhealthy'}`);
  }
}
