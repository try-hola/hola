// Centralized query keys shared by every server-state hook, mutation, and the
// SSE event handler. See specs/001-web-state-freshness/contracts/query-keys.md.

import type { GetDeploymentsRequest, JobStatus } from '@hola/shared';

export type JobsListKeyParams = {
  deploymentId?: string;
  status?: JobStatus;
  page?: number;
  limit?: number;
};

function normalizeParams<T extends Record<string, unknown>>(params: T): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value !== undefined) {
      normalized[key] = value;
    }
  }
  return normalized;
}

export const queryKeys = {
  summary: ['summary'] as const,

  deployments: {
    all: ['deployments'] as const,
    list: (params: GetDeploymentsRequest) =>
      ['deployments', 'list', normalizeParams(params)] as const,
    detail: (id: string) => ['deployments', 'detail', id] as const,
    config: (id: string) => ['deployments', 'config', id] as const,
    history: (id: string, page: number) =>
      ['deployments', 'history', id, page] as const,
  },

  jobs: {
    all: ['jobs'] as const,
    list: (params: JobsListKeyParams) => ['jobs', 'list', normalizeParams(params)] as const,
    detail: (id: string) => ['jobs', 'detail', id] as const,
  },
} as const;
