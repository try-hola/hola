import { useState, useEffect, useCallback, useRef } from 'react';

// Options for the polling hook
export interface UsePollOptions {
  // Polling interval in milliseconds
  interval: number;
  
  // Whether to start polling immediately
  immediate?: boolean;
  
  // Whether to stop polling when the window/tab is not visible
  pauseOnBlur?: boolean;
  
  // Maximum number of consecutive errors before stopping
  maxErrors?: number;
  
  // Error backoff configuration
  errorBackoff?: {
    enabled?: boolean;
    baseDelay?: number;
    maxDelay?: number;
  };
}

// State for the polling hook
export interface PollState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  isPolling: boolean;
  errorCount: number;
}

// Calculate backoff delay for errors
function calculateBackoffDelay(
  errorCount: number,
  baseDelay: number = 1000,
  maxDelay: number = 30000
): number {
  const delay = Math.min(baseDelay * Math.pow(2, errorCount - 1), maxDelay);
  return delay;
}

// Hook for polling data with configurable intervals and error handling
export function usePoll<T>(
  fetcher: () => Promise<T>,
  options: UsePollOptions
): PollState<T> & {
  start: () => void;
  stop: () => void;
  refetch: () => Promise<void>;
  reset: () => void;
} {
  const {
    interval,
    immediate = true,
    pauseOnBlur = true,
    maxErrors = 5,
    errorBackoff = { enabled: true, baseDelay: 1000, maxDelay: 30000 },
  } = options;

  const [state, setState] = useState<PollState<T>>({
    data: null,
    loading: false,
    error: null,
    isPolling: false,
    errorCount: 0,
  });

  const mountedRef = useRef(true);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isPollingRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Single fetch operation
  const fetchData = useCallback(async (): Promise<boolean> => {
    if (!mountedRef.current) return false;

    setState(prev => ({ ...prev, loading: true }));

    try {
      const data = await fetcher();

      if (!mountedRef.current) return false;

      setState(prev => ({
        ...prev,
        data,
        loading: false,
        error: null,
        errorCount: 0,
      }));

      return true;
    } catch (error) {
      if (!mountedRef.current) return false;

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      setState(prev => ({
        ...prev,
        loading: false,
        error: errorMessage,
        errorCount: prev.errorCount + 1,
      }));

      return false;
    }
  }, [fetcher]);

  // Schedule next poll
  const scheduleNext = useCallback((delay?: number) => {
    if (!mountedRef.current || !isPollingRef.current) return;

    const nextDelay = delay || interval;

    timeoutRef.current = setTimeout(async () => {
      if (!mountedRef.current || !isPollingRef.current) return;

      const success = await fetchData();

      // If we hit max errors, stop polling
      if (!success && state.errorCount + 1 >= maxErrors) {
        isPollingRef.current = false;
        setState(prev => ({ ...prev, isPolling: false }));
        return;
      }

      // Calculate next delay based on error state
      let nextInterval = interval;
      if (!success && errorBackoff.enabled) {
        nextInterval = calculateBackoffDelay(
          state.errorCount + 1,
          errorBackoff.baseDelay,
          errorBackoff.maxDelay
        );
      }

      scheduleNext(nextInterval);
    }, nextDelay);
  }, [interval, fetchData, state.errorCount, maxErrors, errorBackoff]);

  // Start polling
  const start = useCallback(() => {
    if (isPollingRef.current) return;

    isPollingRef.current = true;
    setState(prev => ({ ...prev, isPolling: true, errorCount: 0 }));

    // Do initial fetch then schedule polling
    fetchData().then(() => {
      scheduleNext();
    });
  }, [fetchData, scheduleNext]);

  // Stop polling
  const stop = useCallback(() => {
    isPollingRef.current = false;
    setState(prev => ({ ...prev, isPolling: false }));
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // Manual refetch (doesn't affect polling state)
  const refetch = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  // Reset all state
  const reset = useCallback(() => {
    stop();
    setState({
      data: null,
      loading: false,
      error: null,
      isPolling: false,
      errorCount: 0,
    });
  }, [stop]);

  // Auto-start polling on mount if immediate is true
  useEffect(() => {
    if (immediate) {
      start();
    }

    return () => {
      stop();
    };
  }, [immediate, start, stop]);

  // Handle pause on blur
  useEffect(() => {
    if (!pauseOnBlur) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Page is hidden, stop polling but keep isPolling state
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      } else {
        // Page is visible again, resume polling if it was active
        if (isPollingRef.current) {
          scheduleNext();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [pauseOnBlur, scheduleNext]);

  return {
    ...state,
    start,
    stop,
    refetch,
    reset,
  };
}

// Simplified polling hook with common defaults
export function useSimplePoll<T>(
  fetcher: () => Promise<T>,
  interval: number = 30000 // 30 seconds default
): PollState<T> & { start: () => void; stop: () => void } {
  const poll = usePoll(fetcher, { interval });
  
  return {
    data: poll.data,
    loading: poll.loading,
    error: poll.error,
    isPolling: poll.isPolling,
    errorCount: poll.errorCount,
    start: poll.start,
    stop: poll.stop,
  };
}
