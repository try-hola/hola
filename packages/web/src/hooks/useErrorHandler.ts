// Hook for handling errors in components - Part of Phase 3.2 Enhanced Error Handling
import React from 'react';
import type { EnhancedError } from '../utils/error-enhanced';
import { createEnhancedError } from '../utils/error-enhanced';

// Hook for handling errors in components
export function useErrorHandler() {
  const [error, setError] = React.useState<EnhancedError | null>(null);

  const handleError = React.useCallback((error: Error | EnhancedError) => {
    const base = 'type' in error ? error : createEnhancedError(error);
    // Prefer the original message for UI display in component-level handling
    const withPreferredMessage: EnhancedError = Object.assign({}, base, {
      userMessage: (error as Error).message || base.userMessage,
    });
    setError(withPreferredMessage);
  }, []);

  const clearError = React.useCallback(() => {
    setError(null);
  }, []);

  const retryWithClear = React.useCallback(async (retryFn: () => Promise<void>) => {
    try {
      clearError();
      await retryFn();
    } catch (err) {
      handleError(err as Error);
    }
  }, [clearError, handleError]);

  return {
    error,
    hasError: error !== null,
    handleError,
    clearError,
    retryWithClear,
  };
}
