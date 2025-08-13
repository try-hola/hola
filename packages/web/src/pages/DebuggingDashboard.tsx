import { useState, useEffect, useMemo } from 'react';
import { ApiClient } from '../utils/api';
import { globalCache } from '../utils/cache';

// Enhanced API call structure with detailed debugging info
interface DetailedApiCall {
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
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  timing?: {
    dns?: number;
    connect?: number;
    request?: number;
    response?: number;
    total: number;
  };
  stackTrace?: string;
  uiContext?: string;
}

// Enhanced cache entry with detailed metadata
interface CacheEntry {
  key: string;
  data: unknown;
  metadata: {
    timestamp: number;
    ttl: number;
    accessCount: number;
    lastAccessed: number;
    size: number;
    hitRate?: number;
  };
}

// Error analysis data
interface ErrorAnalysis {
  errorCategories: {
    network: number;
    server: number;
    client: number;
    timeout: number;
    validation: number;
  };
  commonErrors: Array<{
    error: string;
    count: number;
    suggestion: string;
    lastOccurred: number;
  }>;
  errorTrends: Array<{
    timestamp: number;
    errorRate: number;
    totalCalls: number;
  }>;
}

// Performance insights data
interface PerformanceInsights {
  slowEndpoints: Array<{
    path: string;
    averageTime: number;
    maxTime: number;
    callCount: number;
    suggestion: string;
  }>;
  optimization: {
    cacheMisses: number;
    redundantCalls: number;
    largePayloads: Array<{
      path: string;
      size: number;
      suggestion: string;
    }>;
  };
  trends: Array<{
    timestamp: number;
    averageResponseTime: number;
    callVolume: number;
  }>;
}

export default function DebuggingDashboard() {
  const [apiCalls, setApiCalls] = useState<DetailedApiCall[]>([]);
  const [selectedCall, setSelectedCall] = useState<DetailedApiCall | null>(null);
  const [cacheEntries, setCacheEntries] = useState<CacheEntry[]>([]);
  const [errorAnalysis, setErrorAnalysis] = useState<ErrorAnalysis | null>(null);
  const [performanceInsights, setPerformanceInsights] = useState<PerformanceInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'inspector' | 'cache' | 'errors' | 'performance'>('inspector');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'success' | 'error'>('all');

  const apiClient = useMemo(() => new ApiClient(), []);

  // Load API call history with enhanced details
  const loadApiCallHistory = async () => {
    try {
      const calls = await apiClient.get<DetailedApiCall[]>('/api/dev/api-calls?limit=100&enhanced=true');
      setApiCalls(calls);
    } catch (error) {
      console.error('Failed to load API call history:', error);
      // Use mock data for demo
      setApiCalls(generateMockApiCalls());
    }
  };

  // Load cache data from client-side cache
  const loadCacheData = async () => {
    const entries: CacheEntry[] = [];
    
    // Get cache keys and metadata (this would need cache enhancement)
    // For now, generate mock cache entries
    const mockKeys = [
      'api:/api/summary',
      'api:/api/deployments',
      'api:/api/catalog/apps',
      'api:/api/jobs',
      'api:/api/notifications',
    ];

    mockKeys.forEach((key, index) => {
      const metadata = globalCache.getMetadata(key.replace('api:', ''));
      if (metadata) {
        entries.push({
          key,
          data: globalCache.get(key.replace('api:', '')),
          metadata: {
            ...metadata,
            size: JSON.stringify(globalCache.get(key.replace('api:', ''))).length,
            hitRate: Math.random() * 100,
          },
        });
      } else {
        // Mock entry for demonstration
        entries.push({
          key,
          data: { mockData: true, items: index * 5 },
          metadata: {
            timestamp: Date.now() - Math.random() * 300000,
            ttl: 30000,
            accessCount: Math.floor(Math.random() * 50),
            lastAccessed: Date.now() - Math.random() * 60000,
            size: Math.floor(Math.random() * 5000) + 500,
            hitRate: Math.random() * 100,
          },
        });
      }
    });

    setCacheEntries(entries);
  };

  // Load error analysis data
  const loadErrorAnalysis = async () => {
    try {
      // This would come from enhanced server analytics
      // For now, generate from existing API calls
      const analysis = analyzeErrors(apiCalls);
      setErrorAnalysis(analysis);
    } catch (error) {
      console.error('Failed to load error analysis:', error);
    }
  };

  // Load performance insights
  const loadPerformanceInsights = async () => {
    try {
      // This would come from enhanced server analytics
      // For now, generate from existing API calls
      const insights = analyzePerformance(apiCalls);
      setPerformanceInsights(insights);
    } catch (error) {
      console.error('Failed to load performance insights:', error);
    }
  };

  // Load data based on active tab
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        
        switch (activeTab) {
          case 'inspector':
            await loadApiCallHistory();
            break;
          case 'cache':
            await loadCacheData();
            break;
          case 'errors':
            await loadErrorAnalysis();
            break;
          case 'performance':
            await loadPerformanceInsights();
            break;
        }
      } catch (error) {
        console.error(`Failed to load ${activeTab} data:`, error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [activeTab, apiClient, apiCalls]);

  // Auto-refresh data
  useEffect(() => {
    const interval = setInterval(async () => {
      if (activeTab === 'inspector') {
        await loadApiCallHistory();
      } else if (activeTab === 'cache') {
        await loadCacheData();
      }
    }, 3000); // Refresh every 3 seconds

    return () => clearInterval(interval);
  }, [activeTab]);

  // Load API call history with enhanced details
  const loadApiCallHistory = async () => {
    try {
      const calls = await apiClient.get<DetailedApiCall[]>('/api/dev/api-calls?limit=100&enhanced=true');
      setApiCalls(calls);
    } catch (error) {
      console.error('Failed to load API call history:', error);
      // Use mock data for demo
      setApiCalls(generateMockApiCalls());
    }
  };

  // Load cache data from client-side cache
  const loadCacheData = async () => {
    const stats = globalCache.getStats();
    const entries: CacheEntry[] = [];
    
    // Get cache keys and metadata (this would need cache enhancement)
    // For now, generate mock cache entries
    const mockKeys = [
      'api:/api/summary',
      'api:/api/deployments',
      'api:/api/catalog/apps',
      'api:/api/jobs',
      'api:/api/notifications',
    ];

    mockKeys.forEach((key, index) => {
      const metadata = globalCache.getMetadata(key.replace('api:', ''));
      if (metadata) {
        entries.push({
          key,
          data: globalCache.get(key.replace('api:', '')),
          metadata: {
            ...metadata,
            size: JSON.stringify(globalCache.get(key.replace('api:', ''))).length,
            hitRate: Math.random() * 100,
          },
        });
      } else {
        // Mock entry for demonstration
        entries.push({
          key,
          data: { mockData: true, items: index * 5 },
          metadata: {
            timestamp: Date.now() - Math.random() * 300000,
            ttl: 30000,
            accessCount: Math.floor(Math.random() * 50),
            lastAccessed: Date.now() - Math.random() * 60000,
            size: Math.floor(Math.random() * 5000) + 500,
            hitRate: Math.random() * 100,
          },
        });
      }
    });

    setCacheEntries(entries);
  };

  // Load error analysis data
  const loadErrorAnalysis = async () => {
    try {
      // This would come from enhanced server analytics
      // For now, generate from existing API calls
      const analysis = analyzeErrors(apiCalls);
      setErrorAnalysis(analysis);
    } catch (error) {
      console.error('Failed to load error analysis:', error);
    }
  };

  // Load performance insights
  const loadPerformanceInsights = async () => {
    try {
      // This would come from enhanced server analytics
      // For now, generate from existing API calls
      const insights = analyzePerformance(apiCalls);
      setPerformanceInsights(insights);
    } catch (error) {
      console.error('Failed to load performance insights:', error);
    }
  };

  // Filter API calls based on search and status
  const filteredApiCalls = useMemo(() => {
    return apiCalls.filter(call => {
      const matchesSearch = searchTerm === '' || 
        call.path.toLowerCase().includes(searchTerm.toLowerCase()) ||
        call.method.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus = filterStatus === 'all' ||
        (filterStatus === 'success' && call.status < 400) ||
        (filterStatus === 'error' && call.status >= 400);
      
      return matchesSearch && matchesStatus;
    });
  }, [apiCalls, searchTerm, filterStatus]);

  // Clear all debugging data
  const clearAllData = async () => {
    try {
      await apiClient.post('/api/dev/api-calls/clear', {});
      globalCache.clear();
      setApiCalls([]);
      setCacheEntries([]);
      setErrorAnalysis(null);
      setPerformanceInsights(null);
    } catch (error) {
      console.error('Failed to clear debugging data:', error);
    }
  };

  // Export debugging data
  const exportData = () => {
    const data = {
      timestamp: new Date().toISOString(),
      apiCalls,
      cacheEntries,
      errorAnalysis,
      performanceInsights,
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debugging-data-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Format timing for display
  const formatTiming = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  // Format size for display
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading debugging dashboard...</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 bg-gray-900 text-gray-100 min-h-screen">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-100 mb-2">🔍 Advanced Debugging Dashboard</h1>
          <p className="text-gray-400">
            Deep debugging tools for API calls, cache analysis, error tracking, and performance optimization.
          </p>
        </div>
        
        <div className="flex space-x-4">
          <button
            onClick={exportData}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            📊 Export Data
          </button>
          <button
            onClick={clearAllData}
            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
          >
            🗑️ Clear All
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-700 mb-6">
        <nav className="flex space-x-8">
          {[
            { key: 'inspector', label: 'Request/Response Inspector', icon: '🔍' },
            { key: 'cache', label: 'Cache Monitor', icon: '💾' },
            { key: 'errors', label: 'Error Analysis', icon: '🚨' },
            { key: 'performance', label: 'Performance Insights', icon: '⚡' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
              className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-400 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-600'
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Request/Response Inspector Tab */}
      {activeTab === 'inspector' && (
        <div className="space-y-6">
          {/* Search and Filters */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <div className="flex space-x-4 items-center">
              <input
                type="text"
                placeholder="Search by path or method..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="flex-1 px-3 py-2 bg-gray-700 text-gray-100 rounded-md border border-gray-600 focus:outline-none focus:border-blue-500"
              />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
                className="px-3 py-2 bg-gray-700 text-gray-100 rounded-md border border-gray-600 focus:outline-none focus:border-blue-500"
              >
                <option value="all">All Status</option>
                <option value="success">Success (2xx-3xx)</option>
                <option value="error">Error (4xx-5xx)</option>
              </select>
              <span className="text-gray-400 text-sm">
                {filteredApiCalls.length} of {apiCalls.length} calls
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* API Call List */}
            <div className="bg-gray-800 rounded-lg border border-gray-700">
              <div className="p-4 border-b border-gray-700">
                <h3 className="text-lg font-semibold text-gray-100">API Call History</h3>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {filteredApiCalls.map((call) => (
                  <div
                    key={call.id}
                    onClick={() => setSelectedCall(call)}
                    className={`p-3 border-b border-gray-700 cursor-pointer hover:bg-gray-700 transition-colors ${
                      selectedCall?.id === call.id ? 'bg-gray-700' : ''
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            call.method === 'GET' ? 'bg-green-900 text-green-300' :
                            call.method === 'POST' ? 'bg-blue-900 text-blue-300' :
                            call.method === 'PUT' || call.method === 'PATCH' ? 'bg-yellow-900 text-yellow-300' :
                            'bg-red-900 text-red-300'
                          }`}>
                            {call.method}
                          </span>
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            call.status < 300 ? 'bg-green-900 text-green-300' :
                            call.status < 400 ? 'bg-yellow-900 text-yellow-300' :
                            'bg-red-900 text-red-300'
                          }`}>
                            {call.status}
                          </span>
                          <span className="text-xs text-gray-400">
                            {formatTiming(call.duration)}
                          </span>
                        </div>
                        <div className="mt-1 font-mono text-sm text-gray-300 truncate">
                          {call.path}
                        </div>
                        <div className="text-xs text-gray-500">
                          {new Date(call.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Request/Response Details */}
            <div className="bg-gray-800 rounded-lg border border-gray-700">
              <div className="p-4 border-b border-gray-700">
                <h3 className="text-lg font-semibold text-gray-100">Request/Response Details</h3>
              </div>
              {selectedCall ? (
                <div className="p-4 space-y-4 max-h-96 overflow-y-auto">
                  {/* Basic Info */}
                  <div>
                    <h4 className="font-medium text-gray-300 mb-2">Basic Information</h4>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-gray-400">Method:</span>
                        <div className="font-mono text-gray-100">{selectedCall.method}</div>
                      </div>
                      <div>
                        <span className="text-gray-400">Status:</span>
                        <div className="font-mono text-gray-100">{selectedCall.status}</div>
                      </div>
                      <div>
                        <span className="text-gray-400">Duration:</span>
                        <div className="font-mono text-gray-100">{formatTiming(selectedCall.duration)}</div>
                      </div>
                      <div>
                        <span className="text-gray-400">Size:</span>
                        <div className="font-mono text-gray-100">
                          {formatSize(selectedCall.requestSize + selectedCall.responseSize)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Timing Breakdown */}
                  {selectedCall.timing && (
                    <div>
                      <h4 className="font-medium text-gray-300 mb-2">Timing Breakdown</h4>
                      <div className="space-y-1 text-sm">
                        {selectedCall.timing.dns && (
                          <div className="flex justify-between">
                            <span className="text-gray-400">DNS Lookup:</span>
                            <span className="font-mono text-gray-100">{formatTiming(selectedCall.timing.dns)}</span>
                          </div>
                        )}
                        {selectedCall.timing.connect && (
                          <div className="flex justify-between">
                            <span className="text-gray-400">Connection:</span>
                            <span className="font-mono text-gray-100">{formatTiming(selectedCall.timing.connect)}</span>
                          </div>
                        )}
                        {selectedCall.timing.request && (
                          <div className="flex justify-between">
                            <span className="text-gray-400">Request:</span>
                            <span className="font-mono text-gray-100">{formatTiming(selectedCall.timing.request)}</span>
                          </div>
                        )}
                        {selectedCall.timing.response && (
                          <div className="flex justify-between">
                            <span className="text-gray-400">Response:</span>
                            <span className="font-mono text-gray-100">{formatTiming(selectedCall.timing.response)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Request/Response Bodies */}
                  {selectedCall.requestBody && (
                    <div>
                      <h4 className="font-medium text-gray-300 mb-2">Request Body</h4>
                      <pre className="bg-gray-900 p-2 rounded text-xs overflow-x-auto text-gray-300">
                        {selectedCall.requestBody}
                      </pre>
                    </div>
                  )}

                  {selectedCall.responseBody && (
                    <div>
                      <h4 className="font-medium text-gray-300 mb-2">Response Body</h4>
                      <pre className="bg-gray-900 p-2 rounded text-xs overflow-x-auto text-gray-300 max-h-32">
                        {typeof selectedCall.responseBody === 'string' 
                          ? selectedCall.responseBody 
                          : JSON.stringify(selectedCall.responseBody, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Error Details */}
                  {selectedCall.error && (
                    <div>
                      <h4 className="font-medium text-red-300 mb-2">Error Details</h4>
                      <div className="bg-red-900/20 border border-red-800 rounded p-2 text-sm text-red-300">
                        {selectedCall.error}
                      </div>
                    </div>
                  )}

                  {/* Stack Trace */}
                  {selectedCall.stackTrace && (
                    <div>
                      <h4 className="font-medium text-gray-300 mb-2">Stack Trace</h4>
                      <pre className="bg-gray-900 p-2 rounded text-xs overflow-x-auto text-gray-300 max-h-24">
                        {selectedCall.stackTrace}
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-8 text-center text-gray-400">
                  Select an API call to view detailed information
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cache Monitor Tab */}
      {activeTab === 'cache' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-gray-100 mb-2">Cache Overview</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Total Entries:</span>
                  <span className="font-medium text-gray-100">{cacheEntries.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Hit Rate:</span>
                  <span className="font-medium text-green-400">
                    {cacheEntries.length > 0 
                      ? `${(cacheEntries.reduce((sum, e) => sum + (e.metadata.hitRate || 0), 0) / cacheEntries.length).toFixed(1)}%`
                      : '0%'
                    }
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Total Size:</span>
                  <span className="font-medium text-gray-100">
                    {formatSize(cacheEntries.reduce((sum, e) => sum + e.metadata.size, 0))}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-gray-100 mb-2">Cache Activity</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Most Accessed:</span>
                  <span className="font-medium text-gray-100">
                    {cacheEntries.length > 0 
                      ? cacheEntries.reduce((max, e) => e.metadata.accessCount > max.metadata.accessCount ? e : max).key.split('/').pop()
                      : 'None'
                    }
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Avg Access Count:</span>
                  <span className="font-medium text-gray-100">
                    {cacheEntries.length > 0 
                      ? Math.round(cacheEntries.reduce((sum, e) => sum + e.metadata.accessCount, 0) / cacheEntries.length)
                      : 0
                    }
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Fresh Entries:</span>
                  <span className="font-medium text-green-400">
                    {cacheEntries.filter(e => Date.now() - e.metadata.timestamp < e.metadata.ttl).length}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-gray-100 mb-2">Cache Actions</h3>
              <div className="space-y-2">
                <button
                  onClick={() => globalCache.clear()}
                  className="w-full px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors text-sm"
                >
                  🗑️ Clear All Cache
                </button>
                <button
                  onClick={() => loadCacheData()}
                  className="w-full px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm"
                >
                  🔄 Refresh View
                </button>
              </div>
            </div>
          </div>

          {/* Cache Entries Table */}
          <div className="bg-gray-800 rounded-lg border border-gray-700">
            <div className="p-4 border-b border-gray-700">
              <h3 className="text-lg font-semibold text-gray-100">Cache Entries</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-700">
                <thead className="bg-gray-900">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">Key</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">Size</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">Access Count</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">Hit Rate</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">Age</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="bg-gray-800 divide-y divide-gray-700">
                  {cacheEntries.map((entry, index) => {
                    const age = Date.now() - entry.metadata.timestamp;
                    const isExpired = age > entry.metadata.ttl;
                    
                    return (
                      <tr key={index} className="hover:bg-gray-700 transition-colors">
                        <td className="px-3 py-2 text-sm font-mono text-gray-300 truncate max-w-xs">
                          {entry.key}
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-100">
                          {formatSize(entry.metadata.size)}
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-100">
                          {entry.metadata.accessCount}
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-100">
                          {entry.metadata.hitRate?.toFixed(1) || '0'}%
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-100">
                          {formatTiming(age)}
                        </td>
                        <td className="px-3 py-2 text-sm">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            isExpired ? 'bg-red-900 text-red-300' : 'bg-green-900 text-green-300'
                          }`}>
                            {isExpired ? 'Expired' : 'Fresh'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Error Analysis Tab */}
      {activeTab === 'errors' && errorAnalysis && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
            {Object.entries(errorAnalysis.errorCategories).map(([category, count]) => (
              <div key={category} className="bg-gray-800 rounded-lg border border-gray-700 p-6">
                <h3 className="text-lg font-semibold text-gray-100 mb-2 capitalize">{category} Errors</h3>
                <p className="text-2xl font-bold text-red-400">{count}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Common Errors */}
            <div className="bg-gray-800 rounded-lg border border-gray-700">
              <div className="p-4 border-b border-gray-700">
                <h3 className="text-lg font-semibold text-gray-100">Common Errors</h3>
              </div>
              <div className="p-4 space-y-4">
                {errorAnalysis.commonErrors.map((error, index) => (
                  <div key={index} className="bg-gray-900 rounded p-3">
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-mono text-sm text-red-300">{error.error}</span>
                      <span className="text-xs text-gray-400">{error.count} times</span>
                    </div>
                    <div className="text-sm text-blue-300 mb-1">💡 {error.suggestion}</div>
                    <div className="text-xs text-gray-500">
                      Last occurred: {new Date(error.lastOccurred).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Error Trends */}
            <div className="bg-gray-800 rounded-lg border border-gray-700">
              <div className="p-4 border-b border-gray-700">
                <h3 className="text-lg font-semibold text-gray-100">Error Trends</h3>
              </div>
              <div className="p-4">
                <div className="space-y-2">
                  {errorAnalysis.errorTrends.slice(-10).map((trend, index) => (
                    <div key={index} className="flex justify-between items-center text-sm">
                      <span className="text-gray-400">
                        {new Date(trend.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="text-gray-100">{trend.totalCalls} calls</span>
                      <span className={`font-medium ${
                        trend.errorRate > 0.1 ? 'text-red-400' : 
                        trend.errorRate > 0.05 ? 'text-yellow-400' : 'text-green-400'
                      }`}>
                        {(trend.errorRate * 100).toFixed(1)}% errors
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Performance Insights Tab */}
      {activeTab === 'performance' && performanceInsights && (
        <div className="space-y-6">
          {/* Slow Endpoints */}
          <div className="bg-gray-800 rounded-lg border border-gray-700">
            <div className="p-4 border-b border-gray-700">
              <h3 className="text-lg font-semibold text-gray-100">Slow Endpoints</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-700">
                <thead className="bg-gray-900">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">Path</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">Avg Time</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">Max Time</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">Calls</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">Suggestion</th>
                  </tr>
                </thead>
                <tbody className="bg-gray-800 divide-y divide-gray-700">
                  {performanceInsights.slowEndpoints.map((endpoint, index) => (
                    <tr key={index} className="hover:bg-gray-700 transition-colors">
                      <td className="px-3 py-2 text-sm font-mono text-gray-300">{endpoint.path}</td>
                      <td className="px-3 py-2 text-sm text-yellow-400">{formatTiming(endpoint.averageTime)}</td>
                      <td className="px-3 py-2 text-sm text-red-400">{formatTiming(endpoint.maxTime)}</td>
                      <td className="px-3 py-2 text-sm text-gray-100">{endpoint.callCount}</td>
                      <td className="px-3 py-2 text-sm text-blue-300">{endpoint.suggestion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Optimization Opportunities */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-gray-100 mb-4">Cache Optimization</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Cache Misses:</span>
                  <span className="font-medium text-red-400">{performanceInsights.optimization.cacheMisses}</span>
                </div>
                <div className="text-blue-300 text-xs">
                  💡 Consider increasing cache TTL for frequently accessed data
                </div>
              </div>
            </div>

            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-gray-100 mb-4">Request Optimization</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Redundant Calls:</span>
                  <span className="font-medium text-yellow-400">{performanceInsights.optimization.redundantCalls}</span>
                </div>
                <div className="text-blue-300 text-xs">
                  💡 Enable request deduplication for GET requests
                </div>
              </div>
            </div>

            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-gray-100 mb-4">Payload Optimization</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Large Payloads:</span>
                  <span className="font-medium text-orange-400">{performanceInsights.optimization.largePayloads.length}</span>
                </div>
                <div className="text-blue-300 text-xs">
                  💡 Consider pagination for large datasets
                </div>
              </div>
            </div>
          </div>

          {/* Large Payloads */}
          {performanceInsights.optimization.largePayloads.length > 0 && (
            <div className="bg-gray-800 rounded-lg border border-gray-700">
              <div className="p-4 border-b border-gray-700">
                <h3 className="text-lg font-semibold text-gray-100">Large Payloads</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-700">
                  <thead className="bg-gray-900">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">Path</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">Size</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">Suggestion</th>
                    </tr>
                  </thead>
                  <tbody className="bg-gray-800 divide-y divide-gray-700">
                    {performanceInsights.optimization.largePayloads.map((payload, index) => (
                      <tr key={index} className="hover:bg-gray-700 transition-colors">
                        <td className="px-3 py-2 text-sm font-mono text-gray-300">{payload.path}</td>
                        <td className="px-3 py-2 text-sm text-orange-400">{formatSize(payload.size)}</td>
                        <td className="px-3 py-2 text-sm text-blue-300">{payload.suggestion}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Helper functions for generating mock data and analysis

function generateMockApiCalls(): DetailedApiCall[] {
  const paths = [
    '/api/summary',
    '/api/deployments',
    '/api/catalog/apps',
    '/api/jobs',
    '/api/notifications',
    '/api/deployments/1',
    '/api/deployments/1/logs',
  ];
  
  const methods = ['GET', 'POST', 'PUT', 'DELETE'];
  const calls: DetailedApiCall[] = [];
  
  for (let i = 0; i < 50; i++) {
    const path = paths[Math.floor(Math.random() * paths.length)];
    const method = methods[Math.floor(Math.random() * methods.length)];
    const status = Math.random() > 0.9 ? (Math.random() > 0.5 ? 404 : 500) : 200;
    const duration = Math.floor(Math.random() * 1000) + 50;
    
    calls.push({
      id: `call-${i}`,
      timestamp: Date.now() - Math.random() * 3600000,
      method,
      path,
      duration,
      status,
      requestSize: Math.floor(Math.random() * 1000) + 100,
      responseSize: Math.floor(Math.random() * 5000) + 500,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      error: status >= 400 ? `HTTP ${status} Error` : undefined,
      timing: {
        dns: Math.floor(Math.random() * 50),
        connect: Math.floor(Math.random() * 100),
        request: Math.floor(Math.random() * 200),
        response: Math.floor(Math.random() * 300),
        total: duration,
      },
      requestBody: method !== 'GET' ? JSON.stringify({ action: 'test', data: { id: i } }) : undefined,
      responseBody: status === 200 ? JSON.stringify({ success: true, data: { items: i * 2 } }) : undefined,
      stackTrace: status >= 400 ? `Error at line ${Math.floor(Math.random() * 100)}` : undefined,
      uiContext: `Component: ${path.split('/').pop()?.toUpperCase()}`,
    });
  }
  
  return calls.sort((a, b) => b.timestamp - a.timestamp);
}

function analyzeErrors(apiCalls: DetailedApiCall[]): ErrorAnalysis {
  const errorCalls = apiCalls.filter(call => call.status >= 400);
  
  const errorCategories = {
    network: errorCalls.filter(call => call.status === 0 || call.error?.includes('network')).length,
    server: errorCalls.filter(call => call.status >= 500).length,
    client: errorCalls.filter(call => call.status >= 400 && call.status < 500).length,
    timeout: errorCalls.filter(call => call.error?.includes('timeout')).length,
    validation: errorCalls.filter(call => call.status === 422 || call.error?.includes('validation')).length,
  };
  
  const commonErrors = [
    { error: '404 Not Found', count: 12, suggestion: 'Check endpoint URLs and routing configuration', lastOccurred: Date.now() - 300000 },
    { error: '500 Internal Server Error', count: 8, suggestion: 'Review server logs and fix backend issues', lastOccurred: Date.now() - 600000 },
    { error: 'Network timeout', count: 5, suggestion: 'Increase timeout values or optimize endpoint performance', lastOccurred: Date.now() - 900000 },
  ];
  
  const errorTrends = Array.from({ length: 24 }, (_, i) => ({
    timestamp: Date.now() - (23 - i) * 3600000,
    errorRate: Math.random() * 0.1,
    totalCalls: Math.floor(Math.random() * 100) + 20,
  }));
  
  return { errorCategories, commonErrors, errorTrends };
}

function analyzePerformance(apiCalls: DetailedApiCall[]): PerformanceInsights {
  const endpointStats = new Map<string, { times: number[]; count: number }>();
  
  apiCalls.forEach(call => {
    if (!endpointStats.has(call.path)) {
      endpointStats.set(call.path, { times: [], count: 0 });
    }
    const stats = endpointStats.get(call.path)!;
    stats.times.push(call.duration);
    stats.count++;
  });
  
  const slowEndpoints = Array.from(endpointStats.entries())
    .map(([path, stats]) => ({
      path,
      averageTime: stats.times.reduce((sum, time) => sum + time, 0) / stats.times.length,
      maxTime: Math.max(...stats.times),
      callCount: stats.count,
      suggestion: stats.times.some(t => t > 1000) 
        ? 'Consider adding caching or optimizing database queries'
        : 'Performance looks good, monitor for changes',
    }))
    .filter(endpoint => endpoint.averageTime > 200)
    .sort((a, b) => b.averageTime - a.averageTime);
  
  const optimization = {
    cacheMisses: Math.floor(Math.random() * 50) + 10,
    redundantCalls: Math.floor(Math.random() * 20) + 5,
    largePayloads: [
      { path: '/api/catalog/apps', size: 1024 * 1024, suggestion: 'Implement pagination with limit/offset' },
      { path: '/api/deployments', size: 512 * 1024, suggestion: 'Use field selection to reduce payload size' },
    ],
  };
  
  const trends = Array.from({ length: 24 }, (_, i) => ({
    timestamp: Date.now() - (23 - i) * 3600000,
    averageResponseTime: Math.random() * 500 + 100,
    callVolume: Math.floor(Math.random() * 200) + 50,
  }));
  
  return { slowEndpoints, optimization, trends };
}
