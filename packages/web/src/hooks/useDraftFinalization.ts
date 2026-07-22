import React from 'react';
import { api } from '../utils/api-hybrid'; // Use hybrid API
import type { CreateDeploymentFromDraftResponse } from '@hola/shared';

// StrictMode-compatible hook for draft finalization
export function useDraftFinalization() {
  const [state, setState] = React.useState<{
    data: CreateDeploymentFromDraftResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  // Finalize the draft (stage immutable artifacts) and then create + start a
  // deployment from it. Finalize alone produces no running app — creating the
  // deployment is what enqueues the install job that runs `docker compose up`.
  const finalizeDraft = React.useCallback(async (draftId: string, opts?: { name?: string; allowMultiple?: boolean; profiles?: string[] }) => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      await api.drafts.finalize(draftId);
      // #246: `name` sets the deployment's subdomain (<name>.<base>); `allowMultiple`
      // opts past the single-instance guard for a deliberate second install.
      // #162: `profiles` is the set of optional Compose profiles to enable.
      const deployment = await api.deployments.create({ draftId, name: opts?.name, allowMultiple: opts?.allowMultiple, profiles: opts?.profiles });

      setState({
        data: deployment,
        loading: false,
        error: null,
      });

      return deployment;
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to install app',
      });
      throw error;
    }
  }, []); // Empty dependency array for StrictMode compatibility

  return {
    ...state,
    finalizeDraft,
  };
}
