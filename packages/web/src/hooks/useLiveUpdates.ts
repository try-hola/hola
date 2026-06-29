// EventSource factory type for dependency injection (imported from useSSE)
import type { EventSourceFactory } from './useSSE';
import * as React from 'react';
import { useSSE } from './useSSE';
import { usePoll } from './usePoll';
import { api } from '../utils/api-hybrid'; // Use hybrid API
import { globalCache } from '../utils/cache';
import type { 
  SSEEvent, 
  Job, 
  SystemStatus, 
  DeploymentStatus,
  GetSummaryResponse,
  DeploymentDetail 
} from '@hola/shared';

/**
 * Hook for live job progress updates using SSE with polling fallback.
 * Follows StrictMode-compatible patterns established in the project.
 */
export function useLiveJobUpdates(jobId?: string, options?: {
  eventSourceFactory?: EventSourceFactory;
}) {
  const [jobData, setJobData] = React.useState<{
    status: Job['status'] | null;
    progress?: number;
    finishedAt?: string;
  }>({
    status: null,
  });

  // SSE for real-time updates
  const handleSSEEvent = React.useCallback((event: SSEEvent) => {
    if (event.type === 'job_update' && event.data.jobId === jobId) {
      setJobData({
        status: event.data.status,
        progress: event.data.progress,
        finishedAt: event.data.finishedAt,
      });
      // Note: no cache write here — the only job cache key is the parameterized
      // list key (`jobs-<params>` in useJobsApi), which a single job update can't
      // target; the live UI is driven by the jobData state above.
    }
  }, [jobId]);

  // Use SSE for real-time updates
  const sseUrl = React.useMemo(() => {
    if (!jobId) return null;
    const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
    return `${baseUrl}/api/jobs/${jobId}/logs/stream`;
  }, [jobId]);

  const sseState = useSSE(sseUrl, handleSSEEvent, {
    eventTypes: ['job_update'],
    reconnect: true,
    reconnectDelay: 2000,
    maxReconnectDelay: 10000,
    eventSourceFactory: options?.eventSourceFactory,
  });

  // Polling fallback for job status
  const pollJobStatus = React.useCallback(async () => {
    if (!jobId) return null;
    
    try {
      const jobData = await api.jobs.byId(jobId) as Job;
      setJobData({
        status: jobData.status,
        progress: jobData.progress,
        finishedAt: jobData.finishedAt,
      });
      return jobData;
    } catch (error) {
      console.error('Failed to poll job status:', error);
      return null;
    }
  }, [jobId]);

  // Use polling as fallback when SSE is not connected
  const pollState = usePoll(pollJobStatus, {
    interval: 5000, // 5 seconds
    immediate: !sseState.isConnected && !!jobId,
    pauseOnBlur: true,
  });

  // Start/stop polling based on SSE connection
  React.useEffect(() => {
    if (sseState.isConnected) {
      pollState.stop();
    } else if (jobId) {
      pollState.start();
    }
  }, [sseState.isConnected, jobId, pollState]);

  return {
    ...jobData,
    isLive: sseState.isConnected,
    connectionState: sseState.connectionState,
    error: sseState.error || pollState.error,
  };
}

/**
 * Hook for live system status updates using SSE with polling fallback.
 */
export function useLiveSystemStatus() {
  const [systemStatus, setSystemStatus] = React.useState<SystemStatus | null>(null);
  const [lastUpdate, setLastUpdate] = React.useState<string | null>(null);

  // SSE for real-time system updates
  const handleSSEEvent = React.useCallback((event: SSEEvent) => {
    if (event.type === 'system_update') {
      setSystemStatus(prev => ({
        ...prev,
        ...event.data,
      } as SystemStatus));
      setLastUpdate(new Date().toISOString());
      // Note: no cache write here — useWorkingApi reads `dashboard-summary` as a
      // bare value (not the {data,timestamp} wrapper this used to write) and never
      // populates that key, so the write was a dead no-op; the live UI is driven by
      // the systemStatus state above.
    }
  }, []);

  // SSE URL for system updates (using a general system stream)
  const sseUrl = React.useMemo(() => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
    return `${baseUrl}/api/system/status/stream`;
  }, []);

  const sseState = useSSE(sseUrl, handleSSEEvent, {
    eventTypes: ['system_update'],
    reconnect: true,
    reconnectDelay: 5000,
    maxReconnectDelay: 30000,
  });

  // Polling fallback for system status
  const pollSystemStatus = React.useCallback(async () => {
    try {
      const status = await api.system.status() as SystemStatus;
      setSystemStatus(status);
      setLastUpdate(new Date().toISOString());
      return status;
    } catch (error) {
      console.error('Failed to poll system status:', error);
      return null;
    }
  }, []);

  const pollState = usePoll(pollSystemStatus, {
    interval: 30000, // 30 seconds
    immediate: !sseState.isConnected,
    pauseOnBlur: true,
  });

  // Start/stop polling based on SSE connection
  React.useEffect(() => {
    if (sseState.isConnected) {
      pollState.stop();
    } else {
      pollState.start();
    }
  }, [sseState.isConnected, pollState]);

  return {
    systemStatus,
    lastUpdate,
    isLive: sseState.isConnected,
    connectionState: sseState.connectionState,
    error: sseState.error || pollState.error,
  };
}

/**
 * Hook for live deployment status updates using SSE with polling fallback.
 */
export function useLiveDeploymentStatus(deploymentId?: string) {
  const [deploymentStatus, setDeploymentStatus] = React.useState<{
    status: DeploymentStatus | null;
    uptime?: string;
    lastUpdated?: string;
  }>({
    status: null,
  });

  // SSE for real-time deployment updates
  const handleSSEEvent = React.useCallback((event: SSEEvent) => {
    if (event.type === 'deployment_update' && event.data.deploymentId === deploymentId) {
      setDeploymentStatus({
        status: event.data.status,
        uptime: event.data.uptime,
        lastUpdated: event.data.lastUpdated,
      });
      
      // Refresh the cached deployment detail so the live status reaches it (the
      // reader, useDeploymentDetailApi, keys on `deployment-detail-<id>` — this
      // previously wrote `deployment-<id>`, which no reader reads, so the SSE
      // update never reached the cache).
      const cacheKey = `deployment-detail-${deploymentId}`;
      const cached = globalCache.get(cacheKey);
      if (cached && cached.data && typeof cached.data === 'object') {
        const deploymentData = cached.data as DeploymentDetail;
        globalCache.set(cacheKey, {
          ...cached,
          data: {
            ...deploymentData,
            status: event.data.status,
            uptime: event.data.uptime,
            lastUpdated: event.data.lastUpdated,
          },
          timestamp: Date.now(),
        });
      }
    }
  }, [deploymentId]);

  // Subscribe to the global event stream (#291) and filter for this deployment in
  // handleSSEEvent — the old per-deployment `/api/deployments/<id>/status/stream`
  // route never existed server-side (this always fell back to polling). A relative
  // URL resolves against the page origin (prod) / Vite proxy (dev).
  const sseUrl = React.useMemo(() => (deploymentId ? '/api/events' : null), [deploymentId]);

  const sseState = useSSE(sseUrl, handleSSEEvent, {
    eventTypes: ['deployment_update'],
    reconnect: true,
    reconnectDelay: 3000,
    maxReconnectDelay: 15000,
  });

  // Polling fallback for deployment status
  const pollDeploymentStatus = React.useCallback(async () => {
    if (!deploymentId) return null;
    
    try {
      const deployment = await api.deployments.byId(deploymentId) as DeploymentDetail;
      setDeploymentStatus({
        status: deployment.status,
        uptime: deployment.uptime,
        lastUpdated: deployment.lastUpdated,
      });
      return deployment;
    } catch (error) {
      console.error('Failed to poll deployment status:', error);
      return null;
    }
  }, [deploymentId]);

  const pollState = usePoll(pollDeploymentStatus, {
    interval: 10000, // 10 seconds
    immediate: !sseState.isConnected && !!deploymentId,
    pauseOnBlur: true,
  });

  // Start/stop polling based on SSE connection
  React.useEffect(() => {
    if (sseState.isConnected) {
      pollState.stop();
    } else if (deploymentId) {
      pollState.start();
    }
  }, [sseState.isConnected, deploymentId, pollState]);

  return {
    ...deploymentStatus,
    isLive: sseState.isConnected,
    connectionState: sseState.connectionState,
    error: sseState.error || pollState.error,
  };
}

/**
 * Comprehensive hook for dashboard live updates.
 * Combines all live data sources for the dashboard page.
 */
export function useLiveDashboard() {
  const systemStatus = useLiveSystemStatus();
  
  // Enhanced summary data with live updates
  const [summaryData, setSummaryData] = React.useState<GetSummaryResponse | null>(null);
  const [refreshTrigger, setRefreshTrigger] = React.useState(0);

  // Fetch initial summary data
  const fetchSummary = React.useCallback(async () => {
    try {
      const data = await api.summary() as GetSummaryResponse;
      setSummaryData(data);
      return data;
    } catch (error) {
      console.error('Failed to fetch summary:', error);
      return null;
    }
  }, []);

  // Initial load
  React.useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  // Refresh summary when system status changes significantly
  React.useEffect(() => {
    if (systemStatus.systemStatus && summaryData) {
      // Update summary data with live system status
      setSummaryData(prev => prev ? {
        ...prev,
        system: systemStatus.systemStatus!,
      } : null);
    }
  }, [systemStatus.systemStatus, summaryData]);

  // Periodic refresh for counts and job data
  const pollSummary = React.useCallback(async () => {
    const data = await fetchSummary();
    if (data) {
      setRefreshTrigger(prev => prev + 1);
    }
    return data;
  }, [fetchSummary]);

  const pollState = usePoll(pollSummary, {
    interval: 15000, // 15 seconds for counts and recent jobs
    immediate: false, // Manual control
    pauseOnBlur: true,
  });

  // Auto-start polling
  React.useEffect(() => {
    pollState.start();
    return () => pollState.stop();
  }, [pollState]);

  return {
    summaryData,
    systemStatus: systemStatus.systemStatus,
    systemLastUpdate: systemStatus.lastUpdate,
    isSystemLive: systemStatus.isLive,
    error: systemStatus.error,
    refresh: fetchSummary,
    refreshTrigger,
  };
}
