import React, { useState, useEffect, useCallback } from 'react';
import { Activity, CheckCircle, XCircle, Clock, AlertTriangle, RefreshCw } from 'lucide-react';
import { JobStatus } from './JobStatus';
import type { Job, SummaryJob } from '@hola/shared';

interface JobTrackerProps {
  deploymentId?: string;
  maxJobs?: number;
  autoRefresh?: boolean;
  refreshInterval?: number;
  onJobClick?: (job: Job | SummaryJob) => void;
  className?: string;
}

// Mock job data for development
const mockJobs: Job[] = [
  {
    id: 'job-1',
    type: 'install',
    status: 'running',
    startedAt: new Date(Date.now() - 300000).toISOString(), // 5 minutes ago
    progress: 65,
    deploymentId: 'nextcloud-prod'
  },
  {
    id: 'job-2',
    type: 'backup',
    status: 'completed',
    startedAt: new Date(Date.now() - 900000).toISOString(), // 15 minutes ago
    finishedAt: new Date(Date.now() - 600000).toISOString(), // 10 minutes ago
    progress: 100,
    deploymentId: 'homeassistant-main'
  },
  {
    id: 'job-3',
    type: 'update',
    status: 'failed',
    startedAt: new Date(Date.now() - 1800000).toISOString(), // 30 minutes ago
    finishedAt: new Date(Date.now() - 1500000).toISOString(), // 25 minutes ago
    deploymentId: 'plex-media'
  }
];

export const JobTracker: React.FC<JobTrackerProps> = ({
  deploymentId,
  maxJobs = 5,
  autoRefresh = true,
  refreshInterval = 30000, // 30 seconds
  onJobClick,
  className = ''
}) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load jobs
  const loadJobs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // TODO: Replace with actual API call
      if (deploymentId) {
        // Load jobs for specific deployment
        // const response = await fetch(`${API.base}/deployments/${deploymentId}/jobs`);
        // if (!response.ok) throw new Error('Failed to load deployment jobs');
        // const data = await response.json();
        
        // For now, filter mock data
        const filteredJobs = mockJobs.filter(job => job.deploymentId === deploymentId);
        setJobs(filteredJobs.slice(0, maxJobs));
      } else {
        // Load recent jobs across all deployments
        // const response = await fetch(`${API.base}/jobs?limit=${maxJobs}`);
        // if (!response.ok) throw new Error('Failed to load jobs');
        // const data = await response.json();
        
        // For now, use mock data
        setJobs(mockJobs.slice(0, maxJobs));
      }
    } catch (err) {
      console.error('Failed to load jobs:', err);
      setError(err instanceof Error ? err.message : 'Failed to load jobs');
      // Fallback to mock data for development
      setJobs(mockJobs.slice(0, maxJobs));
    } finally {
      setLoading(false);
    }
  }, [deploymentId, maxJobs]);

  // Auto-refresh jobs
  useEffect(() => {
    loadJobs();

    if (autoRefresh) {
      const interval = setInterval(loadJobs, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [loadJobs, autoRefresh, refreshInterval]);

  // Filter running jobs for priority display
  const runningJobs = jobs.filter(job => job.status === 'running');
  const otherJobs = jobs.filter(job => job.status !== 'running');
  
  // Show running jobs first, then others
  const prioritizedJobs = [...runningJobs, ...otherJobs];

  const handleJobClick = (job: Job) => {
    if (onJobClick) {
      onJobClick(job);
    }
  };

  const getJobSummary = () => {
    const running = jobs.filter(job => job.status === 'running').length;
    const failed = jobs.filter(job => job.status === 'failed').length;
    const completed = jobs.filter(job => job.status === 'completed').length;
    
    return { running, failed, completed, total: jobs.length };
  };

  const summary = getJobSummary();

  if (loading && jobs.length === 0) {
    return (
      <div className={`bg-surface-1 rounded-lg border border-border ${className}`}>
        <div className="p-4">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto"></div>
          <p className="text-text-muted text-sm text-center mt-2">Loading jobs...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-surface-1 rounded-lg border border-border ${className}`}>
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium">
              {deploymentId ? 'Deployment Jobs' : 'Recent Jobs'}
            </h3>
            <div className="flex items-center space-x-4 text-sm text-text-muted mt-1">
              {summary.running > 0 && (
                <span className="flex items-center space-x-1">
                  <Activity className="w-3 h-3 text-info" />
                  <span>{summary.running} running</span>
                </span>
              )}
              {summary.failed > 0 && (
                <span className="flex items-center space-x-1">
                  <XCircle className="w-3 h-3 text-danger" />
                  <span>{summary.failed} failed</span>
                </span>
              )}
              {summary.completed > 0 && (
                <span className="flex items-center space-x-1">
                  <CheckCircle className="w-3 h-3 text-success" />
                  <span>{summary.completed} completed</span>
                </span>
              )}
              {summary.total === 0 && (
                <span>No jobs found</span>
              )}
            </div>
          </div>
          
          <button
            onClick={loadJobs}
            disabled={loading}
            className="p-2 bg-surface-2 hover:bg-surface-0 rounded transition-colors disabled:opacity-50"
            title="Refresh jobs"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-4 bg-danger/10 border-b border-danger/20">
          <div className="flex items-center space-x-2 text-danger text-sm">
            <AlertTriangle className="w-4 h-4" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Jobs List */}
      <div className="divide-y divide-border">
        {prioritizedJobs.length === 0 ? (
          <div className="p-6 text-center">
            <Clock className="w-8 h-8 text-text-muted mx-auto mb-2" />
            <p className="text-text-muted text-sm">
              {deploymentId ? 'No jobs found for this deployment' : 'No recent jobs'}
            </p>
          </div>
        ) : (
          prioritizedJobs.map((job) => (
            <JobStatus
              key={job.id}
              job={job}
              size="sm"
              showProgress={true}
              showDetails={true}
              onClick={() => handleJobClick(job)}
            />
          ))
        )}
      </div>
    </div>
  );
};
