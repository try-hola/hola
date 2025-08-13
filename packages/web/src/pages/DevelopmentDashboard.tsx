import { useState, useEffect, useMemo } from 'react';
import { ApiClient } from '../utils/api';

interface DevelopmentConfig {
  mockData: {
    enabled: boolean;
    currentScenario: string;
    scenarios: Record<string, {
      name: string;
      description: string;
      customization: MockDataCustomization;
    }>;
    customization: MockDataCustomization;
  };
  devTools: {
    apiInspector: boolean;
    performanceProfiler: boolean;
    stateDebugger: boolean;
    networkEmulator: boolean;
    enableLogging: boolean;
  };
  network: {
    simulateSlowNetwork: boolean;
    simulateOffline: boolean;
    latencyMultiplier: number;
    errorRate: number;
  };
}

interface MockDataCustomization {
  jobProgressSpeed: 'slow' | 'normal' | 'fast';
  errorRate: number;
  latency: { min: number; max: number };
  deploymentCount: number;
  jobCount: number;
  notificationCount: number;
  enableFailures: boolean;
}

interface ApiCall {
  id: string;
  timestamp: number;
  method: string;
  path: string;
  duration: number;
  status: number;
  requestSize: number;
  responseSize: number;
  userAgent?: string;
  error?: string;
}

interface PerformanceMetrics {
  memoryUsage: {
    rss: string;
    heapTotal: string;
    heapUsed: string;
    external: string;
  } | null;
  uptime: number;
  apiCalls: {
    total: number;
    last24h: number;
    errors: number;
    averageResponseTime: number;
  };
  cacheStats: {
    size: number;
    hitRate: string;
    evictions: number;
  };
}

interface StateDebugInfo {
  jobs: unknown[];
  deployments: unknown[];
  notifications: unknown[];
  timers: number;
}

export default function DevelopmentDashboard() {
  const [config, setConfig] = useState<DevelopmentConfig | null>(null);
  const [scenarios, setScenarios] = useState<Array<{ name: string; description: string }>>([]);
  const [apiCalls, setApiCalls] = useState<ApiCall[]>([]);
  const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetrics | null>(null);
  const [stateInfo, setStateInfo] = useState<StateDebugInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'scenarios' | 'api-inspector' | 'performance' | 'state' | 'network'>('scenarios');

  const apiClient = useMemo(() => new ApiClient(), []);

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        
        // Load configuration and scenarios
        const [configData, scenariosData] = await Promise.all([
          apiClient.get<DevelopmentConfig>('/api/dev/config'),
          apiClient.get<Array<{ name: string; description: string }>>('/api/dev/scenarios'),
        ]);
        
        setConfig(configData);
        setScenarios(scenariosData);
      } catch (error) {
        console.error('Failed to load development dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  // Auto-refresh data based on active tab
  useEffect(() => {
    if (!config) return;

    const refreshData = async () => {
      try {
        switch (activeTab) {
          case 'api-inspector': {
            const callsData = await apiClient.get<ApiCall[]>('/api/dev/api-calls?limit=50');
            setApiCalls(callsData);
            break;
          }
          case 'performance': {
            const metricsData = await apiClient.get<PerformanceMetrics>('/api/dev/performance');
            setPerformanceMetrics(metricsData);
            break;
          }
          case 'state': {
            const stateData = await apiClient.get<StateDebugInfo>('/api/dev/state');
            setStateInfo(stateData);
            break;
          }
        }
      } catch (error) {
        console.error(`Failed to refresh ${activeTab} data:`, error);
      }
    };

    // Initial load
    refreshData();

    // Set up refresh interval
    const interval = setInterval(refreshData, 2000); // Refresh every 2 seconds
    return () => clearInterval(interval);
  }, [activeTab, config, apiClient]);

  // Apply scenario
  const applyScenario = async (scenarioName: string) => {
    try {
      await apiClient.post('/api/dev/scenarios/apply', { scenario: scenarioName });
      
      // Reload config
      const configData = await apiClient.get<DevelopmentConfig>('/api/dev/config');
      setConfig(configData);
    } catch (error) {
      console.error('Failed to apply scenario:', error);
    }
  };

  // Reset mock data
  const resetMockData = async () => {
    try {
      await apiClient.post('/api/dev/mock-data/reset', {});
      // Reload data after reset
      window.location.reload();
    } catch (error) {
      console.error('Failed to reset mock data:', error);
    }
  };

  // Clear API call history
  const clearApiCalls = async () => {
    try {
      await apiClient.delete('/api/dev/api-calls/clear');
      setApiCalls([]);
    } catch (error) {
      console.error('Failed to clear API calls:', error);
    }
  };

  // Run benchmark
  const runBenchmark = async (operation: string, iterations: number = 10) => {
    try {
      const result = await apiClient.post('/api/dev/benchmark', { operation, iterations }) as { summary?: { averageDuration?: number } };
      console.log('Benchmark result:', result);
      alert(`Benchmark completed! Average: ${result.summary?.averageDuration?.toFixed(2) || 'N/A'}ms`);
    } catch (error) {
      console.error('Failed to run benchmark:', error);
    }
  };

  // Format duration
  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  // Format timestamp
  const formatTimestamp = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading development dashboard...</div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg text-red-600">Failed to load development configuration</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      <h1 className="text-3xl font-bold text-text-strong mb-6">🔧 Development Dashboard</h1>
      
      <div className="mb-6">
        <p className="text-text-muted">
          Comprehensive development tools for managing mock data, monitoring API calls, 
          analyzing performance, and debugging application state.
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-border mb-6">
        <nav className="flex space-x-8">
          {[
            { key: 'scenarios', label: 'Mock Data & Scenarios', icon: '🎭' },
            { key: 'api-inspector', label: 'API Inspector', icon: '🔍' },
            { key: 'performance', label: 'Performance Monitor', icon: '📊' },
            { key: 'state', label: 'State Debugger', icon: '🐛' },
            { key: 'network', label: 'Network Emulator', icon: '🌐' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted hover:text-text-strong hover:border-border'
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'scenarios' && (
        <div className="space-y-6">
          <div className="bg-surface-1 rounded-lg border border-border p-6">
            <h2 className="text-xl font-semibold text-text-strong mb-4">Mock Data Scenarios</h2>
            <p className="text-text-muted mb-4">
              Current scenario: <span className="font-medium text-primary">{config.mockData.currentScenario}</span>
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {scenarios.map((scenario) => (
                <div 
                  key={scenario.name}
                  className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                    config.mockData.currentScenario === scenario.name
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-surface-2 hover:border-border/80 hover:bg-surface-2/80'
                  }`}
                  onClick={() => applyScenario(scenario.name)}
                >
                  <h3 className="font-medium text-text-strong">{scenario.name}</h3>
                  <p className="text-sm text-text-muted mt-1">{scenario.description}</p>
                </div>
              ))}
            </div>

            <div className="flex space-x-4">
              <button
                onClick={resetMockData}
                className="px-4 py-2 bg-warning text-white rounded-md hover:bg-warning/80 transition-colors"
              >
                🔄 Reset Mock Data
              </button>
            </div>
          </div>

          <div className="bg-surface-1 rounded-lg border border-border p-6">
            <h3 className="text-lg font-semibold text-text-strong mb-4">Current Configuration</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-text-muted">Job Progress Speed:</span>
                <div className="font-medium text-text-strong">{config.mockData.customization.jobProgressSpeed}</div>
              </div>
              <div>
                <span className="text-text-muted">Error Rate:</span>
                <div className="font-medium text-text-strong">{(config.mockData.customization.errorRate * 100).toFixed(1)}%</div>
              </div>
              <div>
                <span className="text-text-muted">Latency Range:</span>
                <div className="font-medium text-text-strong">
                  {config.mockData.customization.latency.min}-{config.mockData.customization.latency.max}ms
                </div>
              </div>
              <div>
                <span className="text-text-muted">Deployments:</span>
                <div className="font-medium text-text-strong">{config.mockData.customization.deploymentCount}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'api-inspector' && (
        <div className="space-y-6">
          <div className="bg-surface-1 rounded-lg border border-border p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-text-strong">API Call History</h2>
              <button
                onClick={clearApiCalls}
                className="px-4 py-2 bg-danger text-white rounded-md hover:bg-danger/80 transition-colors"
              >
                Clear History
              </button>
            </div>
            
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-surface-2">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-text-muted uppercase">Time</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-text-muted uppercase">Method</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-text-muted uppercase">Path</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-text-muted uppercase">Status</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-text-muted uppercase">Duration</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-text-muted uppercase">Size</th>
                  </tr>
                </thead>
                <tbody className="bg-surface-1 divide-y divide-border">
                  {apiCalls.map((call) => (
                    <tr key={call.id} className="hover:bg-surface-2/50 transition-colors">
                      <td className="px-3 py-2 text-sm text-text-muted">{formatTimestamp(call.timestamp)}</td>
                      <td className="px-3 py-2 text-sm">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          call.method === 'GET' ? 'bg-success/20 text-success' :
                          call.method === 'POST' ? 'bg-info/20 text-info' :
                          call.method === 'PUT' || call.method === 'PATCH' ? 'bg-warning/20 text-warning' :
                          'bg-danger/20 text-danger'
                        }`}>
                          {call.method}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-sm font-mono text-text-strong">{call.path}</td>
                      <td className="px-3 py-2 text-sm">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          call.status < 300 ? 'bg-success/20 text-success' :
                          call.status < 400 ? 'bg-warning/20 text-warning' :
                          'bg-danger/20 text-danger'
                        }`}>
                          {call.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-sm text-text-strong">{call.duration}ms</td>
                      <td className="px-3 py-2 text-sm text-text-strong">{call.requestSize + call.responseSize}B</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'performance' && (
        <div className="space-y-6">
          {performanceMetrics && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-surface-1 rounded-lg border border-border p-6">
                  <h3 className="text-lg font-semibold text-text-strong mb-2">System Uptime</h3>
                  <p className="text-2xl font-bold text-info">{formatDuration(performanceMetrics.uptime)}</p>
                </div>
                <div className="bg-surface-1 rounded-lg border border-border p-6">
                  <h3 className="text-lg font-semibold text-text-strong mb-2">API Calls</h3>
                  <p className="text-2xl font-bold text-success">{performanceMetrics.apiCalls.total}</p>
                  <p className="text-sm text-text-muted">{performanceMetrics.apiCalls.last24h} in last 24h</p>
                </div>
                <div className="bg-surface-1 rounded-lg border border-border p-6">
                  <h3 className="text-lg font-semibold text-text-strong mb-2">Error Rate</h3>
                  <p className="text-2xl font-bold text-danger">
                    {((performanceMetrics.apiCalls.errors / Math.max(performanceMetrics.apiCalls.total, 1)) * 100).toFixed(1)}%
                  </p>
                  <p className="text-sm text-text-muted">{performanceMetrics.apiCalls.errors} errors</p>
                </div>
                <div className="bg-surface-1 rounded-lg border border-border p-6">
                  <h3 className="text-lg font-semibold text-text-strong mb-2">Avg Response</h3>
                  <p className="text-2xl font-bold text-primary">{performanceMetrics.apiCalls.averageResponseTime}ms</p>
                </div>
              </div>

              {performanceMetrics.memoryUsage && (
                <div className="bg-surface-1 rounded-lg border border-border p-6">
                  <h3 className="text-lg font-semibold text-text-strong mb-4">Memory Usage</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <span className="text-text-muted">RSS:</span>
                      <div className="font-medium text-text-strong">{performanceMetrics.memoryUsage.rss}</div>
                    </div>
                    <div>
                      <span className="text-text-muted">Heap Total:</span>
                      <div className="font-medium text-text-strong">{performanceMetrics.memoryUsage.heapTotal}</div>
                    </div>
                    <div>
                      <span className="text-text-muted">Heap Used:</span>
                      <div className="font-medium text-text-strong">{performanceMetrics.memoryUsage.heapUsed}</div>
                    </div>
                    <div>
                      <span className="text-text-muted">External:</span>
                      <div className="font-medium text-text-strong">{performanceMetrics.memoryUsage.external}</div>
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-surface-1 rounded-lg border border-border p-6">
                <h3 className="text-lg font-semibold text-text-strong mb-4">Benchmarking Tools</h3>
                <div className="flex space-x-4">
                  <button
                    onClick={() => runBenchmark('mock-data-generation')}
                    className="px-4 py-2 bg-info text-white rounded-md hover:bg-info/80 transition-colors"
                  >
                    📊 Benchmark Mock Data
                  </button>
                  <button
                    onClick={() => runBenchmark('memory-allocation')}
                    className="px-4 py-2 bg-success text-white rounded-md hover:bg-success/80 transition-colors"
                  >
                    💾 Benchmark Memory
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'state' && (
        <div className="space-y-6">
          {stateInfo && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-surface-1 rounded-lg border border-border p-6">
                  <h3 className="text-lg font-semibold text-text-strong mb-2">Jobs</h3>
                  <p className="text-2xl font-bold text-info">{stateInfo.jobs.length}</p>
                  <p className="text-sm text-text-muted">active job records</p>
                </div>
                <div className="bg-surface-1 rounded-lg border border-border p-6">
                  <h3 className="text-lg font-semibold text-text-strong mb-2">Deployments</h3>
                  <p className="text-2xl font-bold text-success">{stateInfo.deployments.length}</p>
                  <p className="text-sm text-text-muted">deployment records</p>
                </div>
                <div className="bg-surface-1 rounded-lg border border-border p-6">
                  <h3 className="text-lg font-semibold text-text-strong mb-2">Notifications</h3>
                  <p className="text-2xl font-bold text-warning">{stateInfo.notifications.length}</p>
                  <p className="text-sm text-text-muted">notification records</p>
                </div>
              </div>

              <div className="bg-surface-1 rounded-lg border border-border p-6">
                <h3 className="text-lg font-semibold text-text-strong mb-4">State Details</h3>
                <div className="space-y-4">
                  <details className="border border-border rounded p-4 bg-surface-2">
                    <summary className="cursor-pointer font-medium text-text-strong">Jobs State ({stateInfo.jobs.length} items)</summary>
                    <pre className="mt-2 text-sm bg-surface-0 p-2 rounded overflow-x-auto text-text-strong">
                      {JSON.stringify(stateInfo.jobs, null, 2)}
                    </pre>
                  </details>
                  <details className="border border-border rounded p-4 bg-surface-2">
                    <summary className="cursor-pointer font-medium text-text-strong">Deployments State ({stateInfo.deployments.length} items)</summary>
                    <pre className="mt-2 text-sm bg-surface-0 p-2 rounded overflow-x-auto text-text-strong">
                      {JSON.stringify(stateInfo.deployments, null, 2)}
                    </pre>
                  </details>
                  <details className="border border-border rounded p-4 bg-surface-2">
                    <summary className="cursor-pointer font-medium text-text-strong">Notifications State ({stateInfo.notifications.length} items)</summary>
                    <pre className="mt-2 text-sm bg-surface-0 p-2 rounded overflow-x-auto text-text-strong">
                      {JSON.stringify(stateInfo.notifications, null, 2)}
                    </pre>
                  </details>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'network' && (
        <div className="space-y-6">
          <div className="bg-surface-1 rounded-lg border border-border p-6">
            <h2 className="text-xl font-semibold text-text-strong mb-4">Network Simulation</h2>
            <p className="text-text-muted mb-6">
              Simulate various network conditions to test application resilience and error handling.
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-lg font-medium text-text-strong mb-3">Current Settings</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-text-muted">Slow Network:</span>
                    <span className={config.network.simulateSlowNetwork ? 'text-warning' : 'text-success'}>
                      {config.network.simulateSlowNetwork ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Offline Mode:</span>
                    <span className={config.network.simulateOffline ? 'text-error' : 'text-success'}>
                      {config.network.simulateOffline ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Latency Multiplier:</span>
                    <span className="font-medium text-text-strong">{config.network.latencyMultiplier}x</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Network Error Rate:</span>
                    <span className="font-medium text-text-strong">{(config.network.errorRate * 100).toFixed(1)}%</span>
                  </div>
                </div>
              </div>
              
              <div>
                <h3 className="text-lg font-medium text-text-strong mb-3">Quick Actions</h3>
                <div className="space-y-2">
                  <button className="w-full px-4 py-2 bg-warning text-white rounded-md hover:bg-warning-hover">
                    🐌 Simulate Slow Network (30s)
                  </button>
                  <button className="w-full px-4 py-2 bg-error text-white rounded-md hover:bg-error-hover">
                    📵 Simulate Offline (15s)
                  </button>
                  <button className="w-full px-4 py-2 bg-info text-white rounded-md hover:bg-info-hover">
                    ⚡ Simulate High Latency (30s)
                  </button>
                  <button className="w-full px-4 py-2 bg-success text-white rounded-md hover:bg-success-hover">
                    ✅ Reset to Normal
                  </button>
                </div>
              </div>
            </div>
          </div>
          
          <div className="bg-warning-subtle border border-warning rounded-lg p-4">
            <h3 className="text-lg font-medium text-warning mb-2">⚠️ Implementation Note</h3>
            <p className="text-warning">
              Network simulation features are currently in development. The configuration displays current settings, 
              but active network condition simulation requires additional implementation.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
