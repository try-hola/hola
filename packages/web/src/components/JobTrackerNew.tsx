import React from 'react';
import { Activity, CheckCircle, XCircle, Clock, AlertTriangle, RefreshCw } from 'lucide-react';
import { JobStatus } from './JobStatus';
import { useJobsApi } from '../hooks/useJobsApi';
import type { Job, SummaryJob } from '@hola/shared';

interface JobTrackerProps {
  deploymentId?: string;
  maxJobs?: number;
  autoRefresh?: boolean;
  refreshInterval?: number;
  onJobClick?: (job: Job | SummaryJob) => void;
  className?: string;
}

export const JobTracker: React.FC<JobTrackerProps> = ({
  deploymentId,
  maxJobs = 5,
  autoRefresh = true,
  refreshInterval = 5000,
  onJobClick,
  className = ''
}) => {
  // Use the jobs API hook with appropriate parameters
  const { data, loading, error, refetch } = useJobsApi({
    deploymentId,
    limit: maxJobs,
    autoRefresh,
    refreshInterval,
  });

  const jobs = data?.items || [];

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
            onClick={refetch}
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
