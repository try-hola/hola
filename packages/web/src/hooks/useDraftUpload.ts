import React from 'react';
import { api } from '../utils/api-hybrid'; // Use hybrid API
import type { UploadDraftFileResponse, DeleteDraftFileResponse } from '@hola/shared';

// StrictMode-compatible hook for draft file uploads
export function useDraftUpload() {
  const [uploadState, setUploadState] = React.useState<{
    loading: boolean;
    error: string | null;
    progress?: number;
  }>({
    loading: false,
    error: null,
  });

  // Upload file to draft
  const uploadFile = React.useCallback(async (
    draftId: string, 
    file: File, 
    kind: 'composeOverride' | 'additionalFile' = 'additionalFile'
  ) => {
    setUploadState({ loading: true, error: null, progress: 0 });
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('kind', kind);
      
      const result = await api.drafts.uploadFile(draftId, formData) as UploadDraftFileResponse;
      
      setUploadState({
        loading: false,
        error: null,
        progress: 100,
      });
      
      return result;
    } catch (error) {
      setUploadState({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to upload file',
        progress: undefined,
      });
      throw error;
    }
  }, []); // Empty dependency array for StrictMode compatibility

  // Delete uploaded file from draft
  const deleteFile = React.useCallback(async (draftId: string, uploadId: string) => {
    setUploadState({ loading: true, error: null });
    
    try {
      const result = await api.drafts.deleteFile(draftId, uploadId) as DeleteDraftFileResponse;
      
      setUploadState({
        loading: false,
        error: null,
      });
      
      return result;
    } catch (error) {
      setUploadState({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to delete file',
      });
      throw error;
    }
  }, []); // Empty dependency array for StrictMode compatibility

  // Upload compose override specifically
  const uploadComposeOverride = React.useCallback(async (draftId: string, content: string) => {
    const blob = new Blob([content], { type: 'text/yaml' });
    const file = new File([blob], 'docker-compose.override.yml', { type: 'text/yaml' });
    
    return uploadFile(draftId, file, 'composeOverride');
  }, [uploadFile]);

  return {
    ...uploadState,
    uploadFile,
    deleteFile,
    uploadComposeOverride,
  };
}
