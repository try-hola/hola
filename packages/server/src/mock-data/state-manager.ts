// Stateful mock behavior management
import type { JobStatus, JobType, DeploymentStatus } from '@hola/shared';

// In-memory state that persists during the session
export class MockStateManager {
  private jobs = new Map<string, MockJob>();
  private deployments = new Map<string, MockDeployment>();
  private notifications = new Map<string, MockNotification>();
  private systemStatus = new Map<string, unknown>();
  private timers = new Map<string, NodeJS.Timeout>();

  // Job state management
  createJob(jobData: Partial<MockJob>): MockJob {
    const job: MockJob = {
      id: jobData.id || crypto.randomUUID(),
      type: jobData.type || 'install',
      status: 'queued',
      progress: 0,
      startedAt: new Date().toISOString(),
      deploymentId: jobData.deploymentId,
      ...jobData,
    };
    
    this.jobs.set(job.id, job);
    
    // Start job simulation if enabled
    if (Bun.env.MOCK_JOB_SIMULATION !== 'false') {
      this.simulateJobProgress(job.id);
    }
    
    return job;
  }

  getJob(jobId: string): MockJob | undefined {
    return this.jobs.get(jobId);
  }

  getAllJobs(): MockJob[] {
    return Array.from(this.jobs.values()).sort((a, b) => 
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

  getJobsByDeployment(deploymentId: string): MockJob[] {
    return this.getAllJobs().filter(job => job.deploymentId === deploymentId);
  }

  getActiveJobs(): MockJob[] {
    return this.getAllJobs().filter(job => ['queued', 'running'].includes(job.status));
  }

  updateJobStatus(jobId: string, status: JobStatus, progress?: number): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = status;
      if (progress !== undefined) {
        job.progress = progress;
      }
      if (status === 'completed' || status === 'failed') {
        job.finishedAt = new Date().toISOString();
        job.progress = status === 'completed' ? 100 : job.progress;
        
        // Clear timer if exists
        const timer = this.timers.get(jobId);
        if (timer) {
          clearInterval(timer);
          this.timers.delete(jobId);
        }
      }
    }
  }

  private simulateJobProgress(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    // Start the job
    this.updateJobStatus(jobId, 'running', 0);

    const progressInterval = Number(Bun.env.JOB_SIMULATION_SPEED) || 5; // seconds per 10%
    const timer = setInterval(() => {
      const currentJob = this.jobs.get(jobId);
      if (!currentJob || currentJob.status !== 'running') {
        clearInterval(timer);
        this.timers.delete(jobId);
        return;
      }

      const newProgress = Math.min(currentJob.progress + 10, 100);
      
      // Small chance of failure for testing
      const shouldFail = Math.random() < 0.05 && newProgress > 30; // 5% chance after 30%
      
      if (shouldFail) {
        this.updateJobStatus(jobId, 'failed', newProgress);
      } else if (newProgress >= 100) {
        this.updateJobStatus(jobId, 'completed', 100);
        
        // Update deployment status if applicable
        if (currentJob.deploymentId) {
          this.updateDeploymentAfterJob(currentJob.deploymentId, currentJob.type, 'completed');
        }
      } else {
        this.updateJobStatus(jobId, 'running', newProgress);
      }
    }, progressInterval * 1000);

    this.timers.set(jobId, timer);
  }

  // Deployment state management
  updateDeploymentStatus(deploymentId: string, status: DeploymentStatus): void {
    const deployment = this.deployments.get(deploymentId);
    if (deployment) {
      deployment.status = status;
      deployment.lastUpdated = this.getTimeAgo(new Date());
      
      // Update uptime for running deployments
      if (status === 'running' && !deployment.startedAt) {
        deployment.startedAt = new Date();
      } else if (status === 'stopped') {
        deployment.startedAt = undefined;
      }
    }
  }

  getDeployment(deploymentId: string): MockDeployment | undefined {
    return this.deployments.get(deploymentId);
  }

  setDeployment(deploymentId: string, deployment: MockDeployment): void {
    this.deployments.set(deploymentId, deployment);
  }

  getAllDeployments(): MockDeployment[] {
    return Array.from(this.deployments.values());
  }

  private updateDeploymentAfterJob(deploymentId: string, jobType: JobType, jobStatus: JobStatus): void {
    if (jobStatus !== 'completed') return;

    switch (jobType) {
      case 'install':
        this.updateDeploymentStatus(deploymentId, 'running');
        break;
      case 'start':
        this.updateDeploymentStatus(deploymentId, 'running');
        break;
      case 'stop':
        this.updateDeploymentStatus(deploymentId, 'stopped');
        break;
      case 'restart':
        this.updateDeploymentStatus(deploymentId, 'running');
        break;
      case 'update':
        this.updateDeploymentStatus(deploymentId, 'running');
        break;
    }
  }

  // Notification management
  addNotification(notification: Omit<MockNotification, 'id' | 'timestamp'>): MockNotification {
    const id = crypto.randomUUID();
    const newNotification: MockNotification = {
      id,
      timestamp: this.getTimeAgo(new Date()),
      ...notification,
    };
    
    this.notifications.set(id, newNotification);
    return newNotification;
  }

  getNotifications(): MockNotification[] {
    return Array.from(this.notifications.values()).sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  markNotificationRead(id: string): void {
    const notification = this.notifications.get(id);
    if (notification) {
      notification.read = true;
    }
  }

  markAllNotificationsRead(): void {
    for (const notification of this.notifications.values()) {
      notification.read = true;
    }
  }

  getUnreadNotificationCount(): number {
    return Array.from(this.notifications.values()).filter(n => !n.read).length;
  }

  // Utility methods
  private getTimeAgo(date: Date): string {
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

  getUptime(startedAt?: Date): string {
    if (!startedAt) return '0 days';
    
    const now = new Date();
    const diffMs = now.getTime() - startedAt.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (diffDays === 0) {
      return diffHours === 0 ? '0 days' : `${diffHours} hour${diffHours === 1 ? '' : 's'}`;
    }
    return `${diffDays} day${diffDays === 1 ? '' : 's'}`;
  }

  // Cleanup method for graceful shutdown
  cleanup(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }
}

// Type definitions for mock data
export type MockJob = {
  id: string;
  type: JobType;
  status: JobStatus;
  startedAt: string;
  finishedAt?: string;
  progress: number;
  deploymentId?: string;
};

export type MockDeployment = {
  id: string;
  name: string;
  app: string;
  icon: string;
  status: DeploymentStatus;
  uptime?: string;
  version?: string;
  resources?: { cpu: string; memory: string; disk?: string };
  ports: string[];
  lastUpdated: string;
  url?: string;
  startedAt?: Date;
};

export type MockNotification = {
  id: string;
  type: 'error' | 'success' | 'warning' | 'info' | 'update';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  priority: 'low' | 'medium' | 'high';
};

// Global state manager instance
export const stateManager = new MockStateManager();
