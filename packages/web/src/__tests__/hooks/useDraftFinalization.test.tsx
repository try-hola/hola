import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CreateDeploymentFromDraftRequest, FinalizeDraftResponse } from '@hola/shared';

// #246: finalizeDraft must pass the chosen instance name (→ subdomain) and the
// allow-multiple override through to the deployment create call.
// Declare the parameters: `vi.fn(async () => ...)` infers a zero-argument
// function, so calling these through the mocked api below was a type error and
// every `toHaveBeenCalledWith` assertion was checking an untyped call record.
const finalize = vi.fn(
  async (_draftId: string): Promise<FinalizeDraftResponse> => ({ spec: {}, checksum: 'x' })
);
const create = vi.fn(
  async (_req: CreateDeploymentFromDraftRequest) => ({ deploymentId: 'dep1', releaseId: 'r1', jobId: 'j1' })
);

vi.mock('../../utils/api-hybrid', () => ({
  api: {
    drafts: { finalize: (id: string) => finalize(id) },
    deployments: { create: (data: CreateDeploymentFromDraftRequest) => create(data) },
  },
}));

const { useDraftFinalization } = await import('../../hooks/useDraftFinalization');

beforeEach(() => {
  finalize.mockClear();
  create.mockClear();
});

describe('useDraftFinalization', () => {
  it('passes the name and allowMultiple override through to deployments.create', async () => {
    const { result } = renderHook(() => useDraftFinalization());

    await act(async () => {
      await result.current.finalizeDraft('draft-1', { name: 'Second Desk', allowMultiple: true });
    });

    expect(finalize).toHaveBeenCalledWith('draft-1');
    expect(create).toHaveBeenCalledWith({ draftId: 'draft-1', name: 'Second Desk', allowMultiple: true });
  });

  it('defaults to no name / no override for a plain install', async () => {
    const { result } = renderHook(() => useDraftFinalization());

    await act(async () => {
      await result.current.finalizeDraft('draft-1');
    });

    expect(create).toHaveBeenCalledWith({ draftId: 'draft-1', name: undefined, allowMultiple: undefined, profiles: undefined });
  });

  it('passes the enabled Compose profiles through to deployments.create (#162)', async () => {
    const { result } = renderHook(() => useDraftFinalization());

    await act(async () => {
      await result.current.finalizeDraft('draft-1', { profiles: ['elasticsearch'] });
    });

    expect(create).toHaveBeenCalledWith({ draftId: 'draft-1', name: undefined, allowMultiple: undefined, profiles: ['elasticsearch'] });
  });
});
