// Hook for handling errors in components - Part of Phase 3.2 Enhanced Error Handling
import React from 'react';
import type { EnhancedError } from '../utils/error-enhanced';
import { createEnhancedError } from '../utils/error-enhanced';

// Hook for handling errors in components
export function useErrorHandler() {
  const [error, setError] = React.useState<EnhancedError | null>(null);

  const handleError = React.useCallback((error: Error | EnhancedError) => {
    const enhancedError = 'type' in error ? error : createEnhancedError(error);
    setError(enhancedError);
  }, []);

  const clearError = React.useCallback(() => {
    setError(null);
  }, []);

  const retryWithClear = React.useCallback(async (retryFn: () => Promise<void>) => {
    try {
      clearError();
      await retryFn();
    } catch (err) {
      // For retry flows we want to surface the original error message directly
      // to the user instead of the generic user-friendly classification so
      // tests and UX can reflect the immediate failure reason.
      const original = err as Error;
      const enhanced = 'type' in original ? original : createEnhancedError(original);
      // Override the userMessage with the original error string to make retry
      // feedback explicit (leaves technicalMessage intact for diagnostics).
      (enhanced as EnhancedError).userMessage = original.message;
      setError(enhanced as EnhancedError);
    }
  }, [clearError]);

  return {
    error,
    hasError: error !== null,
    handleError,
    clearError,
    retryWithClear,
  };
}
