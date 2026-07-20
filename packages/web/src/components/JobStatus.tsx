import React from 'react';
import { 
  Activity, 
  CheckCircle, 
  XCircle, 
  Clock
} from 'lucide-react';
import type { Job, JobStatus as JobStatusType, JobType } from '@hola/shared';

interface JobStatusProps {
  job: Job;
  showProgress?: boolean;
  showDetails?: boolean;
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
}

const getJobStatusIcon = (status: JobStatusType, size: string = 'md') => {
  const sizeClass = size === 'sm' ? 'w-3 h-3' : size === 'lg' ? 'w-5 h-5' : 'w-4 h-4';
  
  switch (status) {
    case 'running':
      return <Activity className={`${sizeClass} text-info animate-pulse`} />;
    case 'completed':
      return <CheckCircle className={`${sizeClass} text-success`} />;
    case 'failed':
      return <XCircle className={`${sizeClass} text-danger`} />;
    case 'queued':
      return <Clock className={`${sizeClass} text-text-muted`} />;
    default:
      return <Clock className={`${sizeClass} text-text-muted`} />;
  }
};

const getJobStatusStyle = (status: JobStatusType): string => {
  switch (status) {
    case 'completed':
      return 'text-success bg-success/10 border-success/20';
    case 'running':
      return 'text-info bg-info/10 border-info/20';
    case 'failed':
      return 'text-danger bg-danger/10 border-danger/20';
    case 'queued':
      return 'text-warning bg-warning/10 border-warning/20';
    default:
      return 'text-text-muted bg-surface-2 border-border';
  }
};

const getJobTypeLabel = (type: JobType): string => {
  switch (type) {
    case 'install':
      return 'Installing';
    case 'update':
      return 'Updating';
    case 'backup':
      return 'Backing up';
    case 'restore':
      return 'Restoring';
    case 'start':
      return 'Starting';
    case 'stop':
      return 'Stopping';
    case 'restart':
      return 'Restarting';
    default:
      return 'Processing';
  }
};

const formatDuration = (startedAt: string, finishedAt?: string): string => {
  const start = new Date(startedAt);
  const end = finishedAt ? new Date(finishedAt) : new Date();
  const duration = Math.floor((end.getTime() - start.getTime()) / 1000);
  
  if (duration < 60) {
    return `${duration}s`;
  } else if (duration < 3600) {
    return `${Math.floor(duration / 60)}m ${duration % 60}s`;
  } else {
    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
};

const formatRelativeTime = (timestamp: string): string => {
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) {
    return 'Just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  } else {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  }
};

export const JobStatus: React.FC<JobStatusProps> = ({
  job,
  showProgress = true,
  showDetails = true,
  size = 'md',
  onClick
}) => {
  const containerClasses = `
    ${onClick ? 'cursor-pointer hover:bg-surface-1/50 transition-colors' : ''}
    ${size === 'sm' ? 'p-2' : size === 'lg' ? 'p-4' : 'p-3'}
  `;

  const textSizeClasses = size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-base' : 'text-sm';

  return (
    <div className={containerClasses} onClick={onClick}>
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          {getJobStatusIcon(job.status, size)}
          <div className="min-w-0 flex-1">
            <div className="flex items-center space-x-2 min-w-0">
              {/* Label by WHAT the job acts on (the app/deployment), with the
                  action as secondary — so a finished install doesn't keep reading
                  "Starting". Falls back to the action label when unjoined. */}
              <span className={`font-medium truncate ${textSizeClasses}`}>
                {job.deploymentName || job.app || getJobTypeLabel(job.type)}
              </span>
              {(job.deploymentName || job.app) && (
                <span className={`text-text-muted whitespace-nowrap ${size === 'lg' ? 'text-sm' : 'text-xs'}`}>
                  {getJobTypeLabel(job.type)}
                </span>
              )}
            </div>
            {showDetails && (
              <div className={`flex items-center space-x-2 mt-1 ${size === 'lg' ? 'text-sm' : 'text-xs'} text-text-muted`}>
                <span>Started {formatRelativeTime(job.startedAt)}</span>
                {job.finishedAt && (
                  <>
                    <span>•</span>
                    <span>Duration: {formatDuration(job.startedAt, job.finishedAt)}</span>
                  </>
                )}
              </div>
            )}
            {/* Why it failed. The server records this on every failed job; without
                it a failure is just a red pill and the operator has to go digging
                in the logs for something the UI already knows. */}
            {showDetails && job.status === 'failed' && job.error && (
              <div className={`mt-1 break-words text-danger ${size === 'lg' ? 'text-sm' : 'text-xs'}`} title={job.error}>
                {job.error}
              </div>
            )}
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <span className={`px-2 py-1 text-xs rounded border capitalize ${getJobStatusStyle(job.status)}`}>
            {job.status}
          </span>
          {showProgress && job.progress !== undefined && job.status === 'running' && (
            <span className={`text-text-muted ${size === 'lg' ? 'text-sm' : 'text-xs'}`}>
              {job.progress}%
            </span>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      {showProgress && job.status === 'running' && job.progress !== undefined && (
        <div className="mt-3">
          <div className="w-full bg-surface-0 rounded-full h-2">
            <div 
              className="bg-info h-2 rounded-full transition-all duration-300"
              style={{ width: `${job.progress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
