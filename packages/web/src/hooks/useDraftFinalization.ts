import React from 'react';
import { api } from '../utils/api-hybrid'; // Use hybrid API
import type { CreateDeploymentFromDraftResponse } from '@hola/shared';
import type { EnhancedError } from '../utils/error-enhanced';

// StrictMode-compatible hook for draft finalization
export function useDraftFinalization() {
  const [state, setState] = React.useState<{
    data: CreateDeploymentFromDraftResponse | null;
    loading: boolean;
    error: string | null;
    // The server's machine-readable failure code + payload (spec 004:
    // PROVIDER_EXISTS carries `{ code, contract, existing }` here), kept
    // alongside the display message so the wizard can offer a fix — e.g. a
    // link to the existing provider — for the failures that have one.
    errorDetails: unknown;
  }>({
    data: null,
    loading: false,
    error: null,
    errorDetails: null,
  });

  // Finalize the draft (stage immutable artifacts) and then create + start a
  // deployment from it. Finalize alone produces no running app — creating the
  // deployment is what enqueues the install job that runs `docker compose up`.
  const finalizeDraft = React.useCallback(async (draftId: string, opts?: { name?: string; allowMultiple?: boolean; profiles?: string[]; grants?: string[] }) => {
    setState(prev => ({ ...prev, loading: true, error: null, errorDetails: null }));

    try {
      await api.drafts.finalize(draftId);
      // #246: `name` sets the deployment's subdomain (<name>.<base>); `allowMultiple`
      // opts past the single-instance guard for a deliberate second install.
      // #162: `profiles` is the set of optional Compose profiles to enable.
      // ADR 0004: `grants` carries the operator's consent to the privileged
      // contract roles the app declares. The server refuses the install without
      // it, so this is the wizard's consent checkboxes made binding.
      const deployment = await api.deployments.create({ draftId, name: opts?.name, allowMultiple: opts?.allowMultiple, profiles: opts?.profiles, grants: opts?.grants });

      setState({
        data: deployment,
        loading: false,
        error: null,
        errorDetails: null,
      });

      return deployment;
    } catch (error) {
      const enhanced = error as Partial<EnhancedError>;
      setState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to install app',
        errorDetails: enhanced?.details ?? null,
      });
      throw error;
    }
  }, []); // Empty dependency array for StrictMode compatibility

  return {
    ...state,
    finalizeDraft,
  };
}
