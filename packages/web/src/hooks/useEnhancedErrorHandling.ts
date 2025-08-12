// Enhanced API hooks with Phase 3.2 error handling improvements
// Provides better retry mechanisms, offline support, and user-friendly error handling

import React from 'react';
import { api } from '../utils/api';
import { globalCache } from '../utils/cache';
import { 
  NetworkStatus, 
  type EnhancedError, 
  type RetryConfig, 
  DEFAULT_RETRY_CONFIGS,
  calculateRetryDelay,
  createEnhancedError 
} from '../utils/error-enhanced';
import type { GetSummaryResponse } from '@hola/shared';

// Enhanced API hook state with offline support
interface EnhancedApiState<T> {
  data: T | null;
  loading: boolean;
  error: EnhancedError | null;
  retrying: boolean;
  retryCount: number;
  isOffline: boolean;
  lastSuccessTimestamp: number | null;
}

// Configuration for enhanced API hooks
interface EnhancedApiConfig {
  enableRetry?: boolean;
  retryConfig?: Partial<RetryConfig>;
  enableOfflineSupport?: boolean;
  staleWhileRevalidate?: boolean; // Show stale data while fetching fresh data
  backgroundRefresh?: boolean;
}

// Enhanced version of useWorkingApi with better error handling
export function useWorkingApiEnhanced(config: EnhancedApiConfig = {}) {
  const {
    enableRetry = true,
    retryConfig = {},
    enableOfflineSupport = true,
    staleWhileRevalidate = true,
    backgroundRefresh = false,
  } = config;

  const [state, setState] = React.useState<EnhancedApiState<GetSummaryResponse>>({
    data: null,
    loading: false,
    error: null,
    retrying: false,
    retryCount: 0,
    isOffline: false,
    lastSuccessTimestamp: null,
  });

  // Enhanced fetch with retry logic
  const fetchDataWithRetry = React.useCallback(async (isRetry = false) => {
    const cacheKey = 'dashboard-summary';
    
    // Check cache first for stale-while-revalidate
    if (staleWhileRevalidate && !isRetry) {
      const cached = globalCache.get<GetSummaryResponse>(cacheKey);
      if (cached !== null) {
        setState(prev => ({
          ...prev,
          data: cached,
          loading: true, // Keep loading while we fetch fresh data
          error: null,
        }));
      }
    }

    // Don't make requests while offline
    if (enableOfflineSupport && !NetworkStatus.isOnline()) {
      setState(prev => ({
        ...prev,
        loading: false,
        isOffline: true,
      }));
      return;
    }

    if (!isRetry) {
      setState(prev => ({ 
        ...prev, 
        loading: true, 
        error: null,
        retrying: false,
        retryCount: 0,
      }));
    } else {
      setState(prev => ({ 
        ...prev, 
        retrying: true,
      }));
    }

    try {
      const result = await api.summary() as GetSummaryResponse;
      
      setState(prev => ({
        ...prev,
        data: result,
        loading: false,
        error: null,
        retrying: false,
        retryCount: 0,
        lastSuccessTimestamp: Date.now(),
      }));
    } catch (error) {
      const enhancedError = error instanceof Error && 'type' in error 
        ? error as EnhancedError
        : createEnhancedError(error as Error);

      setState(prev => ({
        ...prev,
        loading: false,
        retrying: false,
        error: enhancedError,
      }));

      // Attempt retry if enabled and error is retryable
      if (enableRetry && enhancedError.retryable) {
        const errorRetryConfig = DEFAULT_RETRY_CONFIGS[enhancedError.type];
        if (errorRetryConfig) {
          const finalRetryConfig = { ...errorRetryConfig, ...retryConfig };
          
          setState(prev => {
            const newRetryCount = prev.retryCount + 1;
            
            if (newRetryCount < finalRetryConfig.maxAttempts) {
              // Schedule retry
              const delay = calculateRetryDelay(newRetryCount, finalRetryConfig);
              setTimeout(() => {
                fetchDataWithRetry(true);
              }, delay);

              return {
                ...prev,
                retryCount: newRetryCount,
                retrying: true,
              };
            }
            
            return prev;
          });
        }
      }
    }
  }, [enableRetry, retryConfig, staleWhileRevalidate, enableOfflineSupport]);

  // Network status monitoring
  React.useEffect(() => {
    if (!enableOfflineSupport) return;

    const cleanup = NetworkStatus.addListener((online) => {
      setState(prev => ({ ...prev, isOffline: !online }));
      
      // If we come back online and have an error, try fetching again
      if (online) {
        setState(current => {
          if (current.error) {
            fetchDataWithRetry();
          }
          return current;
        });
      }
    });

    // Set initial offline state
    setState(prev => ({ ...prev, isOffline: !NetworkStatus.isOnline() }));

    return cleanup;
  }, [enableOfflineSupport, fetchDataWithRetry]);

  // Manual retry function
  const retry = React.useCallback(async () => {
    setState(prev => ({ ...prev, retryCount: 0 }));
    await fetchDataWithRetry(false);
  }, [fetchDataWithRetry]);

  // Initial fetch
  React.useEffect(() => {
    fetchDataWithRetry();
  }, [fetchDataWithRetry]);

  // Background refresh
  React.useEffect(() => {
    if (!backgroundRefresh) return;

    const interval = setInterval(() => {
      // Only refresh in background if no error and not currently loading
      if (!state.error && !state.loading && !state.retrying) {
        fetchDataWithRetry();
      }
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [backgroundRefresh, state.error, state.loading, state.retrying, fetchDataWithRetry]);

  return {
    ...state,
    refetch: fetchDataWithRetry,
    retry,
    // Helper properties
    hasStaleData: state.data !== null && state.loading,
    canRetry: state.error?.retryable && enableRetry,
    isRetryInProgress: state.retrying,
  };
}

// Enhanced generic API hook
export function useEnhancedApi<T>(
  apiCall: () => Promise<T>,
  dependencies: React.DependencyList = [],
  config: EnhancedApiConfig = {}
) {
  const {
    enableRetry = true,
    retryConfig = {},
    enableOfflineSupport = true,
  } = config;

  const [state, setState] = React.useState<EnhancedApiState<T>>({
    data: null,
    loading: false,
    error: null,
    retrying: false,
    retryCount: 0,
    isOffline: false,
    lastSuccessTimestamp: null,
  });

  // Create a stable reference to the API call
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableApiCall = React.useCallback(() => apiCall(), [apiCall, ...dependencies]);

  const fetchData = React.useCallback(async (isRetry = false) => {
    // Don't make requests while offline
    if (enableOfflineSupport && !NetworkStatus.isOnline()) {
      setState(prev => ({
        ...prev,
        loading: false,
        isOffline: true,
      }));
      return;
    }

    if (!isRetry) {
      setState(prev => ({ 
        ...prev, 
        loading: true, 
        error: null,
        retrying: false,
        retryCount: 0,
      }));
    } else {
      setState(prev => ({ 
        ...prev, 
        retrying: true,
      }));
    }

    try {
      const result = await stableApiCall();
      
      setState(prev => ({
        ...prev,
        data: result,
        loading: false,
        error: null,
        retrying: false,
        retryCount: 0,
        lastSuccessTimestamp: Date.now(),
      }));
    } catch (error) {
      const enhancedError = error instanceof Error && 'type' in error 
        ? error as EnhancedError
        : createEnhancedError(error as Error);

      setState(prev => ({
        ...prev,
        loading: false,
        retrying: false,
        error: enhancedError,
      }));

      // Attempt retry if enabled and error is retryable
      if (enableRetry && enhancedError.retryable) {
        const errorRetryConfig = DEFAULT_RETRY_CONFIGS[enhancedError.type];
        if (errorRetryConfig) {
          const finalRetryConfig = { ...errorRetryConfig, ...retryConfig };
          
          setState(prev => {
            const newRetryCount = prev.retryCount + 1;
            
            if (newRetryCount < finalRetryConfig.maxAttempts) {
              const delay = calculateRetryDelay(newRetryCount, finalRetryConfig);
              setTimeout(() => {
                fetchData(true);
              }, delay);

              return {
                ...prev,
                retryCount: newRetryCount,
                retrying: true,
              };
            }
            
            return prev;
          });
        }
      }
    }
  }, [stableApiCall, enableRetry, retryConfig, enableOfflineSupport]);

  // Network status monitoring
  React.useEffect(() => {
    if (!enableOfflineSupport) return;

    const cleanup = NetworkStatus.addListener((online) => {
      setState(prev => ({ ...prev, isOffline: !online }));
      
      if (online) {
        setState(current => {
          if (current.error) {
            fetchData();
          }
          return current;
        });
      }
    });

    setState(prev => ({ ...prev, isOffline: !NetworkStatus.isOnline() }));
    return cleanup;
  }, [enableOfflineSupport, fetchData]);

  const retry = React.useCallback(async () => {
    setState(prev => ({ ...prev, retryCount: 0 }));
    await fetchData(false);
  }, [fetchData]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    ...state,
    refetch: fetchData,
    retry,
    hasStaleData: state.data !== null && state.loading,
    canRetry: state.error?.retryable && enableRetry,
    isRetryInProgress: state.retrying,
  };
}

// Enhanced offline-aware fetch wrapper
export function useOfflineAwareFetch() {
  const [isOffline, setIsOffline] = React.useState(!NetworkStatus.isOnline());

  React.useEffect(() => {
    const cleanup = NetworkStatus.addListener(setIsOffline);
    return cleanup;
  }, []);

  const fetchWithOfflineSupport = React.useCallback(async <T>(
    fetchFn: () => Promise<T>,
    fallbackData?: T
  ): Promise<T> => {
    if (isOffline) {
      if (fallbackData !== undefined) {
        return fallbackData;
      }
      throw createEnhancedError(new Error('No internet connection'));
    }

    return fetchFn();
  }, [isOffline]);

  return {
    isOffline,
    fetchWithOfflineSupport,
  };
}
