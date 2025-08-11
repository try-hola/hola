import React from 'react';
import { api } from '../utils/api';
import type { FinalizeDraftResponse } from '@hola/shared';

// StrictMode-compatible hook for draft finalization
export function useDraftFinalization() {
  const [state, setState] = React.useState<{
    data: FinalizeDraftResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  // Finalize draft and create deployment
  const finalizeDraft = React.useCallback(async (draftId: string) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const result = await api.drafts.finalize(draftId) as FinalizeDraftResponse;
      
      setState({
        data: result,
        loading: false,
        error: null,
      });
      
      return result;
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to finalize draft',
      });
      throw error;
    }
  }, []); // Empty dependency array for StrictMode compatibility

  return {
    ...state,
    finalizeDraft,
  };
}
