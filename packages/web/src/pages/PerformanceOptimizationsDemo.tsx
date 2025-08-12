import React from 'react';
import { useEnhancedDeploymentsApi } from '../hooks/useEnhancedApi';
import { useBackgroundRefresh } from '../hooks/useBackgroundRefresh';
import { globalCache } from '../utils/cache';
import { api } from '../utils/api';
import { API } from '@hola/shared';

// Simple className utility
const cn = (...classes: (string | undefined | false)[]): string => {
  return classes.filter(Boolean).join(' ');
};

/**
 * Demo page showcasing Phase 3.1 Performance Optimizations
 * - Enhanced Request Deduplication
 * - Intelligent Caching with LRU eviction
 * - Optimistic Updates with automatic rollback
 * - Background Refresh with smart policies
 */
export default function PerformanceOptimizationsDemo() {
  const [statusFilter, setStatusFilter] = React.useState('');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [page, setPage] = React.useState(1);
  
  // Use enhanced deployments hook with all performance optimizations
  const {
    data,
    loading,
    error,
    performAction,
    refetch,
    forceRefresh,
    getCacheInfo,
    rollbackPendingUpdates,
    pendingUpdatesCount,
  } = useEnhancedDeploymentsApi(statusFilter, searchQuery, page);

  // Background refresh system
  const backgroundRefresh = useBackgroundRefresh({
    interval: 10000, // 10 seconds for demo
    pauseWhenHidden: true,
    pauseWhenOffline: true,
  });

  const [refreshStatus, setRefreshStatus] = React.useState(backgroundRefresh.getStatus());
  const [cacheStats, setCacheStats] = React.useState(globalCache.getStats());
  const [cacheInfo, setCacheInfo] = React.useState(getCacheInfo());
  const [isPerformingCacheOp, setIsPerformingCacheOp] = React.useState(false);

  // Update stats more frequently to show real-time changes
  React.useEffect(() => {
    const interval = setInterval(() => {
      setRefreshStatus(backgroundRefresh.getStatus());
      setCacheStats(globalCache.getStats());
      setCacheInfo(getCacheInfo());
    }, 500); // Update every 500ms for more responsive feedback

    return () => clearInterval(interval);
  }, [backgroundRefresh, getCacheInfo]);

  // Start background refresh on mount
  React.useEffect(() => {
    backgroundRefresh.start();
    return () => backgroundRefresh.stop();
  }, [backgroundRefresh]);

  // Demo actions for testing optimistic updates
  const handleOptimisticAction = async (deploymentId: string, action: 'start' | 'stop' | 'restart') => {
    try {
      await performAction(deploymentId, action);
    } catch (error) {
      console.error('Action failed:', error);
    }
  };

  // Demo cache warming - warm the actual cache keys being used
  const warmCache = async () => {
    setIsPerformingCacheOp(true);
    try {
      console.log('🔥 Starting cache warming...');
      
      // Warm the current deployments cache
      const deploymentsKey = cacheInfo.cacheKey;
      await globalCache.warmCache(deploymentsKey, async () => {
        const params = { page, limit: 10 };
        if (statusFilter) Object.assign(params, { status: statusFilter });
        if (searchQuery) Object.assign(params, { q: searchQuery });
        return api.deployments.list(params);
      });

      // Also warm the summary cache
      await globalCache.warmCache('api:' + API.summary, async () => {
        return api.summary();
      });

      // Warm some common deployment detail caches
      if (data?.items) {
        for (const deployment of data.items.slice(0, 3)) { // Warm first 3 deployments
          await globalCache.warmCache(`api:${API.deployments.byId(deployment.id)}`, async () => {
            return api.deployments.byId(deployment.id);
          });
        }
      }

      console.log('✅ Cache warming completed!');
      
      // Force stats update
      setCacheStats(globalCache.getStats());
    } catch (error) {
      console.error('❌ Cache warming failed:', error);
    } finally {
      setIsPerformingCacheOp(false);
    }
  };

  // Force cache clear for demonstration
  const clearAllCache = () => {
    setIsPerformingCacheOp(true);
    console.log('🗑️ Clearing all caches...');
    globalCache.clear();
    api.cache.clear();
    setCacheStats(globalCache.getStats());
    refetch();
    console.log('✅ All caches cleared!');
    setIsPerformingCacheOp(false);
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text-strong mb-4">Phase 3.1: Performance Optimizations Demo</h1>
        <p className="text-text-muted">
          This page demonstrates the advanced performance optimizations implemented in Phase 3.1.
          Watch how the cache statistics, optimistic updates, and background refresh work in real-time.
        </p>
      </div>
      
      {/* Performance Stats Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {/* Cache Statistics */}
        <div className="bg-surface-1 border border-border p-6 rounded-lg">
          <h3 className="text-lg font-semibold text-text-strong mb-4">🚀 Cache Statistics</h3>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-text-muted">Cache Size:</span>
              <span className="text-text-strong font-mono">{cacheStats.size}/{cacheStats.maxSize}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Hit Rate:</span>
              <span className="text-accent-primary font-semibold font-mono">{cacheStats.hitRate}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Cache Hits:</span>
              <span className="text-text-strong font-mono">{cacheStats.hits}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Cache Misses:</span>
              <span className="text-text-strong font-mono">{cacheStats.misses}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Evictions:</span>
              <span className="text-text-strong font-mono">{cacheStats.evictions}</span>
            </div>
          </div>
        </div>

        {/* Background Refresh Status */}
        <div className="bg-surface-1 border border-border p-6 rounded-lg">
          <h3 className="text-lg font-semibold text-text-strong mb-4">🔄 Background Refresh</h3>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-text-muted">Status:</span>
              <span className={`font-semibold ${refreshStatus.isRunning ? 'text-accent-primary' : 'text-text-danger'}`}>
                {refreshStatus.isRunning ? 'Running' : 'Stopped'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Page Visible:</span>
              <span className={refreshStatus.isVisible ? 'text-accent-primary' : 'text-text-danger'}>
                {refreshStatus.isVisible ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Online:</span>
              <span className={refreshStatus.isOnline ? 'text-accent-primary' : 'text-text-danger'}>
                {refreshStatus.isOnline ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Active Jobs:</span>
              <span className="text-text-strong font-mono">{refreshStatus.enabledJobs}</span>
            </div>
          </div>
        </div>

        {/* Optimistic Updates */}
        <div className="bg-surface-1 border border-border p-6 rounded-lg">
          <h3 className="text-lg font-semibold text-text-strong mb-4">⚡ Optimistic Updates</h3>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-text-muted">Pending Updates:</span>
              <span className={`font-semibold font-mono ${pendingUpdatesCount > 0 ? 'text-orange-500' : 'text-accent-primary'}`}>
                {pendingUpdatesCount}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Cache Key:</span>
              <span className="text-xs text-text-muted font-mono truncate">{cacheInfo.cacheKey.split('-').pop()}</span>
            </div>
            {pendingUpdatesCount > 0 && (
              <button
                onClick={rollbackPendingUpdates}
                className="mt-2 px-3 py-1 bg-text-danger text-white rounded text-sm hover:opacity-80 transition-opacity"
              >
                Rollback All
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Demo Controls */}
      <div className="bg-surface-1 border border-border p-6 rounded-lg mb-8">
        <h3 className="text-lg font-semibold text-text-strong mb-4">🎮 Performance Demo Controls</h3>
        <p className="text-text-muted text-sm mb-4">
          Test the performance optimizations with these controls. Watch how the cache statistics change!
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div>
            <button
              onClick={warmCache}
              disabled={isPerformingCacheOp}
              className={cn(
                "w-full px-4 py-2 rounded transition-colors",
                isPerformingCacheOp
                  ? "bg-bg-surface text-text-muted cursor-not-allowed"
                  : "bg-primary-main text-white hover:bg-primary-hover"
              )}
            >
              {isPerformingCacheOp ? "⏳ Warming..." : "🔥 Warm Cache"}
            </button>
            <p className="text-xs text-text-muted mt-1">Preload data into cache</p>
          </div>
          <div>
            <button
              onClick={clearAllCache}
              disabled={isPerformingCacheOp}
              className={cn(
                "w-full px-4 py-2 rounded transition-colors",
                isPerformingCacheOp
                  ? "bg-bg-surface text-text-muted cursor-not-allowed"
                  : "bg-text-danger text-white hover:opacity-80"
              )}
            >
              {isPerformingCacheOp ? "⏳ Clearing..." : "🗑️ Clear All Cache"}
            </button>
            <p className="text-xs text-text-muted mt-1">Reset cache and force fresh API calls</p>
          </div>
          <div>
            <button
              onClick={forceRefresh}
              className="w-full px-4 py-2 bg-accent-primary text-white rounded hover:opacity-80 transition-colors"
            >
              🔄 Force Refresh
            </button>
            <p className="text-xs text-text-muted mt-1">Bypass cache and reload data</p>
          </div>
          <div>
            <button
              onClick={() => backgroundRefresh.triggerByPriority('high')}
              className="w-full px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 transition-colors"
            >
              📈 Priority Refresh
            </button>
            <p className="text-xs text-text-muted mt-1">Trigger high-priority background refresh</p>
          </div>
        </div>
        
        {/* Cache Testing Controls */}
        <div className="mt-4 p-4 bg-surface-0 rounded border">
          <h4 className="text-sm font-semibold text-text-strong mb-3">🧪 Cache Hit Testing</h4>
          <p className="text-xs text-text-muted mb-3">
            Use these buttons to generate cache hits. Each button makes the same API call twice.
          </p>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={async () => {
                console.log('Testing cache hits with summary endpoint...');
                await api.summary(); // First call - cache miss
                await api.summary(); // Second call - cache hit!
              }}
              className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
            >
              Test Summary Cache
            </button>
            <button
              onClick={async () => {
                console.log('Testing cache hits with deployments...');
                const params = { page: 1, limit: 5 };
                await api.deployments.list(params); // First call - cache miss
                await api.deployments.list(params); // Second call - cache hit!
              }}
              className="px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600"
            >
              Test Deployments Cache
            </button>
            <button
              onClick={async () => {
                console.log('Testing cache hits with catalog...');
                await api.catalog.apps(); // First call - cache miss
                await api.catalog.apps(); // Second call - cache hit!
              }}
              className="px-3 py-1 bg-orange-500 text-white rounded text-sm hover:bg-orange-600"
            >
              Test Catalog Cache
            </button>
          </div>
        </div>
      </div>

      {/* Filters for testing cache behavior */}
      <div className="bg-surface-1 border border-border p-6 rounded-lg mb-8">
        <h3 className="text-lg font-semibold text-text-strong mb-4">🎛️ Filters (Test Cache Keys)</h3>
        <p className="text-text-muted text-sm mb-4">
          Change these filters to see how different cache keys are created and managed.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-strong mb-2">Status Filter</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full p-2 border border-border rounded bg-surface-0 text-text-strong"
            >
              <option value="">All Statuses</option>
              <option value="running">Running</option>
              <option value="stopped">Stopped</option>
              <option value="error">Error</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-strong mb-2">Search Query</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search deployments..."
              className="w-full p-2 border border-border rounded bg-surface-0 text-text-strong placeholder-text-muted"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-strong mb-2">Page</label>
            <input
              type="number"
              min="1"
              value={page}
              onChange={(e) => setPage(Number(e.target.value))}
              className="w-full p-2 border border-border rounded bg-surface-0 text-text-strong"
            />
          </div>
        </div>
      </div>

      {/* Deployments List with Optimistic Actions */}
      <div className="bg-surface-1 border border-border rounded-lg">
        <div className="p-6 border-b border-border">
          <h3 className="text-lg font-semibold text-text-strong">🚀 Live Deployments (With Optimistic Updates)</h3>
          <p className="text-text-muted text-sm mt-1">
            Click the action buttons to see optimistic updates in action. The UI updates immediately while the request is processed.
          </p>
          {loading && <p className="text-text-muted mt-2">⏳ Loading...</p>}
          {error && <p className="text-text-danger mt-2">❌ Error: {error}</p>}
        </div>
        
        {data?.items && (
          <div className="p-6">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 text-text-strong">Name</th>
                    <th className="text-left py-3 text-text-strong">Status</th>
                    <th className="text-left py-3 text-text-strong">Resources</th>
                    <th className="text-left py-3 text-text-strong">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((deployment) => (
                    <tr key={deployment.id} className="border-b border-border">
                      <td className="py-3">
                        <div>
                          <div className="font-medium text-text-strong flex items-center gap-2">
                            <span>{deployment.icon}</span>
                            {deployment.name}
                          </div>
                          <div className="text-sm text-text-muted">{deployment.id}</div>
                        </div>
                      </td>
                      <td className="py-3">
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            deployment.status === 'running' ? 'bg-accent-primary/10 text-accent-primary' :
                            deployment.status === 'stopped' ? 'bg-surface-2 text-text-muted' :
                            deployment.status === 'installing' ? 'bg-orange-100 text-orange-800' :
                            deployment.status === 'updating' ? 'bg-blue-100 text-blue-800' :
                            'bg-red-100 text-red-800'
                          }`}
                        >
                          {deployment.status}
                        </span>
                      </td>
                      <td className="py-3">
                        <div className="text-sm text-text-muted">
                          <div>CPU: {deployment.resources?.cpu || 'N/A'}</div>
                          <div>RAM: {deployment.resources?.memory || 'N/A'}</div>
                        </div>
                      </td>
                      <td className="py-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleOptimisticAction(deployment.id, 'start')}
                            disabled={deployment.status === 'running' || deployment.status === 'installing'}
                            className="px-3 py-1 bg-accent-primary text-white rounded text-sm hover:opacity-80 disabled:opacity-50 transition-opacity"
                          >
                            ▶️ Start
                          </button>
                          <button
                            onClick={() => handleOptimisticAction(deployment.id, 'stop')}
                            disabled={deployment.status === 'stopped'}
                            className="px-3 py-1 bg-text-danger text-white rounded text-sm hover:opacity-80 disabled:opacity-50 transition-opacity"
                          >
                            ⏹️ Stop
                          </button>
                          <button
                            onClick={() => handleOptimisticAction(deployment.id, 'restart')}
                            disabled={deployment.status === 'installing' || deployment.status === 'updating'}
                            className="px-3 py-1 bg-primary-main text-white rounded text-sm hover:bg-primary-hover disabled:opacity-50 transition-colors"
                          >
                            🔄 Restart
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {data.total && (
              <div className="mt-6 flex justify-between items-center">
                <div className="text-sm text-text-muted">
                  Showing {(page - 1) * 10 + 1} to {Math.min(page * 10, data.total)} of {data.total} results
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(page - 1)}
                    disabled={page === 1}
                    className="px-3 py-1 bg-surface-2 text-text-strong rounded disabled:opacity-50 hover:bg-surface-3 transition-colors"
                  >
                    Previous
                  </button>
                  <span className="px-3 py-1 text-text-strong">Page {page}</span>
                  <button
                    onClick={() => setPage(page + 1)}
                    disabled={page * 10 >= data.total}
                    className="px-3 py-1 bg-surface-2 text-text-strong rounded disabled:opacity-50 hover:bg-surface-3 transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Performance Insights */}
      <div className="mt-8 bg-primary-main/5 border border-primary-main/20 p-6 rounded-lg">
        <h3 className="text-lg font-semibold text-text-strong mb-4">💡 Performance Insights</h3>
        <div className="space-y-3 text-sm text-text-muted">
          <div className="flex items-start gap-3">
            <span className="text-primary-main">📊</span>
            <p><strong className="text-text-strong">Request Deduplication:</strong> Identical API requests are automatically deduplicated to prevent unnecessary network calls. Try clicking buttons quickly!</p>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-primary-main">🧠</span>
            <p><strong className="text-text-strong">Intelligent Caching:</strong> Data is cached with appropriate TTL based on content type. LRU eviction prevents memory bloat. Watch the hit rate improve!</p>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-primary-main">⚡</span>
            <p><strong className="text-text-strong">Optimistic Updates:</strong> UI updates immediately when you click action buttons, with automatic rollback if the server request fails.</p>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-primary-main">🔄</span>
            <p><strong className="text-text-strong">Background Refresh:</strong> Data refreshes automatically based on priority, pausing when the page is hidden or you're offline.</p>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-primary-main">🔑</span>
            <p><strong className="text-text-strong">Smart Cache Keys:</strong> Cache keys include filter parameters to ensure correct data isolation. Change filters to see new cache entries!</p>
          </div>
        </div>
      </div>
    </div>
  );
}
