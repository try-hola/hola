// Factory for the app's TanStack Query client. See specs/001-web-state-freshness/research.md (R2).

import { QueryClient } from "@tanstack/react-query";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Short but non-zero: the SSE stream (useGlobalQueryEvents) is the primary
        // freshness driver via targeted invalidation/patching, so queries don't need
        // to refetch aggressively. All queries inherit this default; individual hooks
        // can override staleTime if they need it.
        staleTime: 5000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: 1,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

export const queryClient = createQueryClient();
