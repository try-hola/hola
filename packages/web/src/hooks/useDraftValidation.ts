import React from 'react';
import { api } from '../utils/api-hybrid'; // Use hybrid API
import type { ValidateDraftResponse, PreflightResponse } from '@hola/shared';

// StrictMode-compatible hook for draft validation and preflight checks
export function useDraftValidation() {
  const [validationState, setValidationState] = React.useState<{
    data: ValidateDraftResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  const [preflightState, setPreflightState] = React.useState<{
    data: PreflightResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  // Validate draft configuration
  const validateDraft = React.useCallback(async (draftId: string) => {
    setValidationState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const result = await api.drafts.validate(draftId) as ValidateDraftResponse;
      
      setValidationState({
        data: result,
        loading: false,
        error: null,
      });
      
      return result;
    } catch (error) {
      setValidationState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to validate draft',
      });
      throw error;
    }
  }, []); // Empty dependency array for StrictMode compatibility

  // Run preflight checks
  const runPreflight = React.useCallback(async (draftId: string) => {
    setPreflightState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const result = await api.drafts.preflight(draftId) as PreflightResponse;
      
      setPreflightState({
        data: result,
        loading: false,
        error: null,
      });
      
      return result;
    } catch (error) {
      setPreflightState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to run preflight checks',
      });
      throw error;
    }
  }, []); // Empty dependency array for StrictMode compatibility

  // Run both validation and preflight in sequence
  const runValidationAndPreflight = React.useCallback(async (draftId: string) => {
    const validationResult = await validateDraft(draftId);
    if (validationResult.ok) {
      const preflightResult = await runPreflight(draftId);
      return { validation: validationResult, preflight: preflightResult };
    }
    return { validation: validationResult, preflight: null };
  }, [validateDraft, runPreflight]);

  return {
    validation: validationState,
    preflight: preflightState,
    validateDraft,
    runPreflight,
    runValidationAndPreflight,
  };
}
