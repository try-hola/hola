import React from 'react';

import type { GetContractsResponse, ContractRollup } from '@hola/shared';
import { api } from '../utils/api-hybrid';

/**
 * Capability contract rollup (ADR 0004 Phase 4): who provides and who accepts each
 * contract, across every install.
 *
 * One request for the whole table rather than a per-contract endpoint — the answer
 * is derived from the installed set, so splitting it would mean re-deriving the
 * same manifests once per contract, and a page asking "is anything covered?" wants
 * the uncovered apps in the same breath.
 */
export function useContractsApi() {
  const [state, setState] = React.useState<{
    data: GetContractsResponse | null;
    loading: boolean;
    error: string | null;
  }>({ data: null, loading: true, error: null });

  const fetchData = React.useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const data = (await api.contracts.list()) as GetContractsResponse;
      setState({ data, loading: false, error: null });
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load capability contracts',
      });
    }
  }, []);

  React.useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return { ...state, refetch: fetchData };
}

/** The rollup for one contract ref, or undefined when this server doesn't know it. */
export function contractByRef(
  data: GetContractsResponse | null,
  ref: string,
): ContractRollup | undefined {
  return data?.items.find(item => item.ref === ref);
}
