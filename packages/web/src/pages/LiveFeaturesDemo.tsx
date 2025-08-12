import React from 'react';
import { useLiveJobUpdates, useLiveSystemStatus, useLiveDashboard } from '../hooks/useLiveUpdates';
import { useLogsSSE } from '../hooks/useSSE';
import { LogsViewer } from '../components/LogsViewer';

/**
 * Test page demonstrating the real-time features implementation for 2.1.1 and 2.1.2
 * This shows:
 * - Server-Sent Events (SSE) for real-time logs
 * - Live job progress updates
 * - Live system status monitoring
 * - Live deployment status updates
 */
export const LiveFeaturesDemo: React.FC = () => {
  const [selectedJobId, setSelectedJobId] = React.useState<string>('test-job-1');
  const [selectedDeploymentId, setSelectedDeploymentId] = React.useState<string>('nextcloud');

  // Live updates demonstration
  const dashboardData = useLiveDashboard();
  const systemStatus = useLiveSystemStatus();
  const jobUpdates = useLiveJobUpdates(selectedJobId);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">Real-Time Features Demo</h1>
        <p className="text-text-muted mb-6">
          Demonstrating 2.1.1 (SSE) and 2.1.2 (Live Updates) implementation with StrictMode-compatible hooks
        </p>
      </div>

      {/* Live System Status */}
      <div className="bg-surface-1 rounded-lg border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Live System Status</h2>
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${systemStatus.isLive ? 'bg-success animate-pulse' : 'bg-text-muted'}`}></div>
            <span className="text-sm text-text-muted">
              {systemStatus.isLive ? 'Live Updates' : 'Offline'}
            </span>
          </div>
        </div>
        
        {systemStatus.error && (
          <div className="mb-4 p-3 bg-danger/10 border border-danger/20 rounded text-danger text-sm">
            {systemStatus.error}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-3 bg-surface-0 rounded">
            <div className="text-sm text-text-muted">Docker</div>
            <div className={`font-medium ${systemStatus.systemStatus?.docker.ok ? 'text-success' : 'text-danger'}`}>
              {systemStatus.systemStatus?.docker.ok ? 'Running' : 'Error'}
            </div>
            {systemStatus.systemStatus?.docker.version && (
              <div className="text-xs text-text-muted">{systemStatus.systemStatus.docker.version}</div>
            )}
          </div>
          
          <div className="p-3 bg-surface-0 rounded">
            <div className="text-sm text-text-muted">Disk Space</div>
            <div className="font-medium">
              {systemStatus.systemStatus?.disk ? 
                `${((systemStatus.systemStatus.disk.freeBytes / systemStatus.systemStatus.disk.totalBytes) * 100).toFixed(1)}% free` : 
                'Unknown'
              }
            </div>
            {systemStatus.systemStatus?.disk && (
              <div className="text-xs text-text-muted">
                {Math.round(systemStatus.systemStatus.disk.freeBytes / 1e9)}GB / {Math.round(systemStatus.systemStatus.disk.totalBytes / 1e9)}GB
              </div>
            )}
          </div>

          <div className="p-3 bg-surface-0 rounded">
            <div className="text-sm text-text-muted">Authentik</div>
            <div className={`font-medium ${systemStatus.systemStatus?.authentik?.ok ? 'text-success' : 'text-warning'}`}>
              {systemStatus.systemStatus?.authentik?.ok ? 'Connected' : 'Disconnected'}
            </div>
          </div>

          <div className="p-3 bg-surface-0 rounded">
            <div className="text-sm text-text-muted">Last Update</div>
            <div className="font-medium text-xs">
              {systemStatus.lastUpdate ? new Date(systemStatus.lastUpdate).toLocaleTimeString() : 'Never'}
            </div>
          </div>
        </div>
      </div>

      {/* Live Job Updates */}
      <div className="bg-surface-1 rounded-lg border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Live Job Updates</h2>
          <div className="flex items-center space-x-4">
            <select 
              value={selectedJobId} 
              onChange={(e) => setSelectedJobId(e.target.value)}
              className="px-3 py-1 bg-surface-0 border border-border rounded text-sm"
            >
              <option value="test-job-1">test-job-1 (Install)</option>
              <option value="test-job-2">test-job-2 (Update)</option>
              <option value="test-job-3">test-job-3 (Backup)</option>
            </select>
            <div className="flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${jobUpdates.isLive ? 'bg-success animate-pulse' : 'bg-text-muted'}`}></div>
              <span className="text-sm text-text-muted">
                {jobUpdates.isLive ? 'Live Updates' : 'Offline'}
              </span>
            </div>
          </div>
        </div>

        {jobUpdates.error && (
          <div className="mb-4 p-3 bg-danger/10 border border-danger/20 rounded text-danger text-sm">
            {jobUpdates.error}
          </div>
        )}

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="p-3 bg-surface-0 rounded">
            <div className="text-sm text-text-muted">Status</div>
            <div className={`font-medium ${
              jobUpdates.status === 'completed' ? 'text-success' :
              jobUpdates.status === 'failed' ? 'text-danger' :
              jobUpdates.status === 'running' ? 'text-info' :
              'text-text-muted'
            }`}>
              {jobUpdates.status || 'Unknown'}
            </div>
          </div>
          
          <div className="p-3 bg-surface-0 rounded">
            <div className="text-sm text-text-muted">Progress</div>
            <div className="font-medium">
              {jobUpdates.progress !== undefined ? `${jobUpdates.progress}%` : 'N/A'}
            </div>
            {jobUpdates.progress !== undefined && (
              <div className="w-full bg-surface-2 rounded-full h-1 mt-1">
                <div 
                  className="bg-info h-1 rounded-full transition-all duration-300"
                  style={{ width: `${jobUpdates.progress}%` }}
                ></div>
              </div>
            )}
          </div>

          <div className="p-3 bg-surface-0 rounded">
            <div className="text-sm text-text-muted">Finished</div>
            <div className="font-medium text-xs">
              {jobUpdates.finishedAt ? new Date(jobUpdates.finishedAt).toLocaleTimeString() : 'N/A'}
            </div>
          </div>
        </div>
      </div>

      {/* Real-Time Logs with SSE */}
      <div className="bg-surface-1 rounded-lg border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Real-Time Logs (SSE)</h2>
          <select 
            value={selectedDeploymentId} 
            onChange={(e) => setSelectedDeploymentId(e.target.value)}
            className="px-3 py-1 bg-surface-0 border border-border rounded text-sm"
          >
            <option value="nextcloud">Nextcloud Deployment</option>
            <option value="homeassistant">Home Assistant Deployment</option>
            <option value="plex">Plex Deployment</option>
          </select>
        </div>

        <LogsViewer
          deploymentId={selectedDeploymentId}
          title={`${selectedDeploymentId} Real-Time Logs`}
          maxHeight="max-h-80"
          showJobStatus={false}
        />
      </div>

      {/* Job Logs with SSE */}
      <div className="bg-surface-1 rounded-lg border border-border p-6">
        <h2 className="text-xl font-semibold mb-4">Job Logs with Progress Updates (SSE)</h2>
        
        <LogsViewer
          jobId={selectedJobId}
          title={`Job ${selectedJobId} Logs & Progress`}
          maxHeight="max-h-80"
          showJobStatus={true}
        />
      </div>

      {/* Live Dashboard Summary */}
      <div className="bg-surface-1 rounded-lg border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Live Dashboard Summary</h2>
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${dashboardData.isSystemLive ? 'bg-success animate-pulse' : 'bg-text-muted'}`}></div>
            <span className="text-sm text-text-muted">
              {dashboardData.isSystemLive ? 'Live Updates' : 'Offline'}
            </span>
          </div>
        </div>

        {dashboardData.error && (
          <div className="mb-4 p-3 bg-danger/10 border border-danger/20 rounded text-danger text-sm">
            {dashboardData.error}
          </div>
        )}

        {dashboardData.summaryData && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 bg-surface-0 rounded">
              <div className="text-sm text-text-muted">Deployments</div>
              <div className="text-2xl font-bold">{dashboardData.summaryData.deploymentsCount}</div>
            </div>
            
            <div className="p-3 bg-surface-0 rounded">
              <div className="text-sm text-text-muted">Active Jobs</div>
              <div className="text-2xl font-bold text-info">{dashboardData.summaryData.activeJobsCount}</div>
            </div>
            
            <div className="p-3 bg-surface-0 rounded">
              <div className="text-sm text-text-muted">Alerts</div>
              <div className="text-2xl font-bold text-warning">{dashboardData.summaryData.alertsCount}</div>
            </div>

            <div className="p-3 bg-surface-0 rounded">
              <div className="text-sm text-text-muted">Refresh Count</div>
              <div className="text-2xl font-bold">{dashboardData.refreshTrigger}</div>
            </div>
          </div>
        )}
      </div>

      {/* Implementation Notes */}
      <div className="bg-surface-1 rounded-lg border border-border p-6">
        <h2 className="text-xl font-semibold mb-4">Implementation Summary</h2>
        <div className="space-y-3 text-sm">
          <div>
            <strong>✅ 2.1.1 Server-Sent Events (SSE):</strong>
            <ul className="ml-4 mt-1 space-y-1 text-text-muted">
              <li>• <code>useSSE</code> hook with auto-reconnection and heartbeat monitoring</li>
              <li>• <code>useLogsSSE</code> specialized hook for real-time logs</li>
              <li>• SSE endpoints: <code>/logs/stream</code> for deployments and jobs</li>
              <li>• Graceful fallback to polling when SSE unavailable</li>
            </ul>
          </div>
          
          <div>
            <strong>✅ 2.1.2 Live Updates:</strong>
            <ul className="ml-4 mt-1 space-y-1 text-text-muted">
              <li>• <code>useLiveJobUpdates</code> for real-time job progress</li>
              <li>• <code>useLiveSystemStatus</code> for system health monitoring</li>
              <li>• <code>useLiveDashboard</code> for comprehensive dashboard updates</li>
              <li>• StrictMode-compatible hooks following established patterns</li>
            </ul>
          </div>

          <div>
            <strong>Key Features:</strong>
            <ul className="ml-4 mt-1 space-y-1 text-text-muted">
              <li>• Real-time logs streaming with proper event typing</li>
              <li>• Live job progress updates with completion notifications</li>
              <li>• System status monitoring with connection state indicators</li>
              <li>• Global cache integration for performance optimization</li>
              <li>• Comprehensive error handling and fallback mechanisms</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
