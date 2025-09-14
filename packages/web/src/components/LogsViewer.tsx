import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Activity, 
  AlertCircle, 
  CheckCircle, 
  Clock, 
  Copy, 
  Download, 
  Maximize2, 
  Pause, 
  Play, 
  RefreshCw, 
  Search, 
  Wifi, 
  WifiOff, 
  X, 
  XCircle 
} from 'lucide-react';
import { useLogsSSE } from '../hooks/useSSE';
import { api } from '../utils/api';
import type {
  LogEntry,
  LogLevel,
  Job,
  JobStatus
} from '@hola/shared';

interface LogsViewerProps {
  deploymentId?: string;
  jobId?: string;
  title?: string;
  className?: string;
  maxHeight?: string;
  showJobStatus?: boolean;
}

const mockLogs: LogEntry[] = [
  {
    timestamp: '2024-01-15T14:30:15.123Z',
    service: 'nextcloud',
    level: 'info',
    message: 'Starting Nextcloud instance'
  },
  {
    timestamp: '2024-01-15T14:30:16.456Z',
    service: 'postgres',
    level: 'info',
    message: 'Database connection established'
  },
  {
    timestamp: '2024-01-15T14:30:17.789Z',
    service: 'nextcloud',
    level: 'info',
    message: 'Application ready on port 80'
  },
  {
    timestamp: '2024-01-15T14:32:45.012Z',
    service: 'nextcloud',
    level: 'info',
    message: 'User login: admin'
  },
  {
    timestamp: '2024-01-15T14:35:12.345Z',
    service: 'nextcloud',
    level: 'warn',
    message: 'High memory usage detected: 85% of allocated memory in use'
  },
  {
    timestamp: '2024-01-15T14:40:01.678Z',
    service: 'nextcloud',
    level: 'info',
    message: 'Cron job executed successfully'
  },
  {
    timestamp: '2024-01-15T14:42:33.901Z',
    service: 'postgres',
    level: 'error',
    message: 'Connection timeout from nextcloud service'
  },
  {
    timestamp: '2024-01-15T14:42:34.234Z',
    service: 'postgres',
    level: 'info',
    message: 'Connection restored'
  },
];

const getLevelColor = (level: LogLevel) => {
  switch (level) {
    case 'error':
      return 'text-danger';
    case 'warn':
      return 'text-warning';
    case 'info':
      return 'text-info';
    case 'debug':
      return 'text-text-muted';
    default:
      return 'text-text-strong';
  }
};

const formatTimestamp = (timestamp: string) => {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }) + '.' + new Date(timestamp).getMilliseconds().toString().padStart(3, '0');
};

const getJobStatusIcon = (status: JobStatus) => {
  switch (status) {
    case 'running':
      return <Activity className="w-4 h-4 text-info animate-pulse" />;
    case 'completed':
      return <CheckCircle className="w-4 h-4 text-success" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-danger" />;
    case 'queued':
      return <Clock className="w-4 h-4 text-text-muted" />;
    default:
      return <Clock className="w-4 h-4 text-text-muted" />;
  }
};

const getJobStatusColor = (status: JobStatus) => {
  switch (status) {
    case 'running':
      return 'text-info';
    case 'completed':
      return 'text-success';
    case 'failed':
      return 'text-danger';
    case 'queued':
      return 'text-text-muted';
    default:
      return 'text-text-muted';
  }
};

export const LogsViewer: React.FC<LogsViewerProps> = ({
  deploymentId,
  jobId,
  title = 'Logs',
  className = '',
  maxHeight = 'max-h-96',
  showJobStatus = false
}) => {
  // Use SSE for real-time logs
  const { 
    logs: sseLogsData, 
    connectionState, 
    error: sseError, 
    isConnected,
    clearLogs: clearSSELogs 
  } = useLogsSSE(deploymentId, jobId);

  // Local state for managing logs and UI
  const [allLogs, setAllLogs] = useState<LogEntry[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [isStreaming, setIsStreaming] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedService, setSelectedService] = useState('all');
  const [selectedLevel, setSelectedLevel] = useState('all');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // Merge SSE logs with existing logs
  React.useEffect(() => {
    if (sseLogsData.length > 0) {
      setAllLogs(prev => {
        // Create a map to avoid duplicates (based on timestamp + message)
        const existingSet = new Set(prev.map(log => `${log.timestamp}-${log.message}`));
        const newLogs = sseLogsData.filter(log => 
          !existingSet.has(`${log.timestamp}-${log.message}`)
        ).map(log => ({
          ...log,
          level: log.level as LogLevel // Ensure proper typing
        }));
        return [...prev, ...newLogs];
      });
    }
  }, [sseLogsData]);

  // Set error from SSE
  React.useEffect(() => {
    if (sseError) {
      setError(sseError);
    }
  }, [sseError]);

  // Load initial logs and job data
  const loadInitialData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Load initial logs if not using SSE or SSE is not connected
      if (!isConnected && (jobId || deploymentId)) {
        const logsPromise = jobId 
          ? api.jobs.logs(jobId) as Promise<{ items: LogEntry[] }>
          : deploymentId 
            ? api.deployments.logs(deploymentId) as Promise<{ items: LogEntry[] }>
            : Promise.resolve({ items: [] });
            
        const logsData = await logsPromise;
        setAllLogs(logsData.items || []);
      }
      
      // Load job data if jobId is provided
      if (jobId) {
        const jobData = await api.jobs.byId(jobId) as Job;
        setJob(jobData);
      }
    } catch (err) {
      console.error('Failed to load initial data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
      // Fallback to mock data for development
      setAllLogs(mockLogs);
    } finally {
      setLoading(false);
    }
  }, [jobId, deploymentId, isConnected]);

  // Load initial data on mount
  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Auto-scroll to bottom when new logs arrive and streaming is enabled
  useEffect(() => {
    if (isStreaming && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [allLogs, isStreaming]);

  // Connection status indicator
  const getConnectionIcon = () => {
    switch (connectionState) {
      case 'connected':
        return <Wifi className="w-4 h-4 text-success" />;
      case 'connecting':
        return <Activity className="w-4 h-4 text-warning animate-pulse" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-danger" />;
      default:
        return <WifiOff className="w-4 h-4 text-text-muted" />;
    }
  };

  const getConnectionStatus = () => {
    switch (connectionState) {
      case 'connected':
        return 'Live';
      case 'connecting':
        return 'Connecting';
      case 'error':
        return 'Error';
      default:
        return 'Offline';
    }
  };

  const services = Array.from(new Set(allLogs.map(log => log.service)));
  const levels: LogLevel[] = ['info', 'warn', 'error', 'debug'];

  const filteredLogs = allLogs.filter(log => {
    const matchesSearch = searchTerm === '' || 
      log.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.service.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesService = selectedService === 'all' || log.service === selectedService;
    const matchesLevel = selectedLevel === 'all' || log.level === selectedLevel;
    
    return matchesSearch && matchesService && matchesLevel;
  });

  const copyLogs = () => {
    const logText = filteredLogs.map(log => 
      `[${formatTimestamp(log.timestamp)}] ${log.service.toUpperCase()} ${log.level.toUpperCase()}: ${log.message}`
    ).join('\n');
    
    navigator.clipboard.writeText(logText);
  };

  const downloadLogs = () => {
    const logText = filteredLogs.map(log => 
      `[${formatTimestamp(log.timestamp)}] ${log.service.toUpperCase()} ${log.level.toUpperCase()}: ${log.message}`
    ).join('\n');
    
    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deploymentId || jobId || 'logs'}-${new Date().toISOString().split('T')[0]}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const clearLogs = () => {
    setAllLogs([]);
    clearSSELogs();
  };

  const LogsContent = () => (
    <div className={`bg-surface-1 rounded-lg border border-border ${className}`}>
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <h3 className="font-medium">{title}</h3>
            {showJobStatus && job && (
              <div className="flex items-center space-x-2">
                {getJobStatusIcon(job.status)}
                <span className={`text-sm font-medium ${getJobStatusColor(job.status)}`}>
                  {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
                </span>
                {job.progress !== undefined && (
                  <span className="text-sm text-text-muted">
                    ({job.progress}%)
                  </span>
                )}
              </div>
            )}
            <div className="flex items-center space-x-2">
              <div className="flex items-center space-x-1">
                {getConnectionIcon()}
                <span className="text-sm text-text-muted">
                  {getConnectionStatus()}
                </span>
              </div>
              <span className="text-text-muted">•</span>
              <span className="text-sm text-text-muted">
                {filteredLogs.length} entries
              </span>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsStreaming(!isStreaming)}
              className="p-2 bg-surface-2 hover:bg-surface-0 rounded transition-colors"
              title={isStreaming ? 'Pause streaming' : 'Resume streaming'}
            >
              {isStreaming 
                ? <Pause className="w-4 h-4" />
                : <Play className="w-4 h-4" />}
            </button>
            
            <button
              onClick={copyLogs}
              className="p-2 bg-surface-2 hover:bg-surface-0 rounded transition-colors"
              title="Copy logs"
            >
              <Copy className="w-4 h-4" />
            </button>
            
            <button
              onClick={downloadLogs}
              className="p-2 bg-surface-2 hover:bg-surface-0 rounded transition-colors"
              title="Download logs"
            >
              <Download className="w-4 h-4" />
            </button>
            
            <button
              onClick={clearLogs}
              className="p-2 bg-surface-2 hover:bg-surface-0 rounded transition-colors text-danger"
              title="Clear logs"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            
            {!isFullscreen && (
              <button
                onClick={() => setIsFullscreen(true)}
                className="p-2 bg-surface-2 hover:bg-surface-0 rounded transition-colors"
                title="Fullscreen"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-4 p-3 bg-danger/10 border border-danger/20 rounded text-danger text-sm">
            {error}
            {connectionState === 'error' && (
              <div className="mt-2 text-xs">
                Connection failed. Logs will be updated when connection is restored.
              </div>
            )}
          </div>
        )}

        {/* Job Progress Bar */}
        {showJobStatus && job && job.status === 'running' && job.progress !== undefined && (
          <div className="mb-4 p-3 bg-surface-2 rounded">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="font-medium">Job Progress</span>
              <span className="text-text-muted">{job.progress}%</span>
            </div>
            <div className="w-full bg-surface-0 rounded-full h-2">
              <div 
                className="bg-info h-2 rounded-full transition-all duration-300"
                style={{ width: `${job.progress}%` }}
              ></div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search logs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 bg-surface-0 border border-border rounded text-sm placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 w-64"
            />
          </div>
          
          <select
            value={selectedService}
            onChange={(e) => setSelectedService(e.target.value)}
            className="px-3 py-2 bg-surface-0 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="all">All Services</option>
            {services.map(service => (
              <option key={service} value={service}>{service}</option>
            ))}
          </select>
          
          <select
            value={selectedLevel}
            onChange={(e) => setSelectedLevel(e.target.value)}
            className="px-3 py-2 bg-surface-0 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="all">All Levels</option>
            {levels.map(level => (
              <option key={level} value={level} className={getLevelColor(level)}>
                {level.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Logs Content */}
      <div 
        ref={logsContainerRef}
        className={`font-mono text-sm bg-surface-0 overflow-y-auto ${isFullscreen ? 'h-[calc(100vh-200px)]' : maxHeight}`}
      >
        <div className="p-4 space-y-1">
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
              <p className="text-text-muted mt-2">Loading logs...</p>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-8 text-text-muted">
              {searchTerm || selectedService !== 'all' || selectedLevel !== 'all' 
                ? 'No logs match the current filters'
                : 'No logs available'
              }
            </div>
          ) : (
            filteredLogs.map((log, index) => (
              <div key={index} className="flex items-start space-x-3 hover:bg-surface-1/50 px-2 py-1 rounded group">
                <span className="text-text-muted text-xs flex-shrink-0 w-20">
                  {formatTimestamp(log.timestamp)}
                </span>
                <span className="text-primary text-xs flex-shrink-0 w-16 uppercase">
                  {log.service}
                </span>
                <span className={`text-xs flex-shrink-0 w-12 uppercase font-medium ${getLevelColor(log.level)}`}>
                  {log.level}
                </span>
                <span className="text-text-strong flex-grow min-w-0 break-words">
                  {log.message}
                </span>
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 bg-surface-0 z-50 flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-medium">{title} - Fullscreen</h2>
          <button
            onClick={() => setIsFullscreen(false)}
            className="p-2 bg-surface-2 hover:bg-surface-1 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 p-4">
          <LogsContent />
        </div>
      </div>
    );
  }

  return <LogsContent />;
};