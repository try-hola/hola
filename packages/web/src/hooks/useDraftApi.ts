import React from 'react';
import { api } from '../utils/api';
import { globalCache } from '../utils/cache';
import type { 
  CreateDraftRequest, 
  CreateDraftResponse, 
  GetDraftResponse, 
  PatchDraftRequest, 
  PatchDraftResponse 
} from '@hola/shared';

// StrictMode-compatible hook for draft creation
export function useCreateDraft() {
  const [state, setState] = React.useState<{
    data: CreateDraftResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  const createDraft = React.useCallback(async (request: CreateDraftRequest) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const result = await api.drafts.create(request) as CreateDraftResponse;
      
      // Cache the result for immediate retrieval
      const cacheKey = `draft-${result.draftId}`;
      globalCache.set(cacheKey, { data: result, timestamp: Date.now() });
      
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
        error: error instanceof Error ? error.message : 'Failed to create draft',
      });
      throw error;
    }
  }, []); // Empty dependency array for StrictMode compatibility

  return {
    ...state,
    createDraft,
  };
}

// StrictMode-compatible hook for draft fetching and updates
export function useDraftApi(draftId: string | null) {
  const [state, setState] = React.useState<{
    data: GetDraftResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  // Generate stable cache key
  const cacheKey = React.useMemo(() => {
    return draftId ? `draft-${draftId}` : null;
  }, [draftId]);

  // Fetch draft data
  const fetchDraft = React.useCallback(async () => {
    if (!draftId || !cacheKey) return;
    
    const cached = globalCache.get(cacheKey);
    const now = Date.now();
    
    // Check cache (30 second TTL for draft data)
    if (cached && (now - cached.timestamp) < 30000) {
      setState({
        data: cached.data as GetDraftResponse,
        loading: false,
        error: null,
      });
      return;
    }
    
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const result = await api.drafts.byId(draftId) as GetDraftResponse;
      
      // Cache the result
      globalCache.set(cacheKey, { data: result, timestamp: now });
      
      setState({
        data: result,
        loading: false,
        error: null,
      });
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch draft',
      });
    }
  }, [draftId, cacheKey]); // Include primitive params for refetch when they change

  React.useEffect(() => {
    fetchDraft();
  }, [fetchDraft]);

  // Update draft data
  const updateDraft = React.useCallback(async (updates: PatchDraftRequest) => {
    if (!draftId || !cacheKey) return;
    
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const result = await api.drafts.update(draftId, updates) as PatchDraftResponse;
      
      // Update cache with new draft data
      globalCache.set(cacheKey, { data: result.draft, timestamp: Date.now() });
      
      setState({
        data: result.draft,
        loading: false,
        error: null,
      });
      
      return result.draft;
    } catch (error) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to update draft',
      }));
      throw error;
    }
  }, [draftId, cacheKey]); // Include primitive params

  return {
    ...state,
    fetchDraft,
    updateDraft,
  };
}
