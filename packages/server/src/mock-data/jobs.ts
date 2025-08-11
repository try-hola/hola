// Job tracking and management
import type {
  Job,
  GetJobResponse,
  SummaryJob,
  JobType
} from '@hola/shared';
import { stateManager } from './state-manager';

// Export functions for API handlers
export function getJobById(jobId: string): GetJobResponse | null {
  const job = stateManager.getJob(jobId);
  if (!job) {
    return null;
  }

  return {
    id: job.id,
    type: job.type,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    progress: job.progress,
    deploymentId: job.deploymentId,
  };
}

export function getAllJobs(): Job[] {
  return stateManager.getAllJobs().map(job => ({
    id: job.id,
    type: job.type,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    progress: job.progress,
    deploymentId: job.deploymentId,
  }));
}

export function getJobsByDeployment(deploymentId: string): Job[] {
  return stateManager.getJobsByDeployment(deploymentId).map(job => ({
    id: job.id,
    type: job.type,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    progress: job.progress,
    deploymentId: job.deploymentId,
  }));
}

export function getActiveJobs(): Job[] {
  return stateManager.getActiveJobs().map(job => ({
    id: job.id,
    type: job.type,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    progress: job.progress,
    deploymentId: job.deploymentId,
  }));
}

export function getRecentJobsForSummary(limit: number = 5): SummaryJob[] {
  const allJobs = stateManager.getAllJobs();
  const recentJobs = allJobs.slice(0, limit);

  return recentJobs.map(job => {
    // Get deployment name for display
    const deployment = job.deploymentId ? stateManager.getDeployment(job.deploymentId) : null;
    const appName = deployment?.name || 'Unknown App';

    return {
      id: job.id,
      deploymentId: job.deploymentId || '',
      type: job.type,
      app: appName,
      status: job.status,
      progress: job.progress,
      timestamp: formatTimestamp(job.startedAt),
    };
  });
}

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Now';
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

// Utility function to create a new job
export function createJob(params: {
  type: JobType;
  deploymentId?: string;
}): Job {
  const mockJob = stateManager.createJob(params);
  
  return {
    id: mockJob.id,
    type: mockJob.type,
    status: mockJob.status,
    startedAt: mockJob.startedAt,
    finishedAt: mockJob.finishedAt,
    progress: mockJob.progress,
    deploymentId: mockJob.deploymentId,
  };
}
