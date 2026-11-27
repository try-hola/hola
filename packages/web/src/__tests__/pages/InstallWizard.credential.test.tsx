import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type {
  CreateDeploymentFromDraftRequest,
  CreateDraftRequest,
  CreateDraftResponse,
  Draft,
} from '@hola/shared';
import { globalCache } from '../../utils/cache';

// A catalog install whose runtime image is private names a stored registry
// credential. The wizard already read `?cred=` for install-by-ref; this pins
// that the catalog path forwards it to draft creation too (it used to drop it,
// so the finalized manifest carried no credential and `compose pull` failed
// with a registry auth error). Template: InstallWizard.channels.test.tsx.

const draftsApi = {
  create: vi.fn(async (_req: CreateDraftRequest): Promise<CreateDraftResponse> => ({
    draftId: 'draft-1',
    app: { id: 'demo', name: 'Demo', icon: '📦' },
    systemEnv: [],
    appEnv: [],
    defaults: { ports: [], volumes: [] },
  })),
  byId: vi.fn(async (id: string): Promise<Draft> => ({
    draftId: id, appId: 'demo', version: '1.0.0', systemOverrides: {}, appEnv: [], ports: [], files: [],
  })),
  update: vi.fn(async () => ({ ok: true as const })),
  remove: vi.fn(async () => ({ ok: true as const })),
  validate: vi.fn(async () => ({ ok: true, errors: [], warnings: [] })),
  preflight: vi.fn(async () => ({ ok: true, checks: [] })),
  finalize: vi.fn(async () => ({ spec: {}, checksum: 'x' })),
};

const catalogApi = {
  appById: vi.fn(async (id: string) => ({
    id, name: 'Demo', description: '', icon: '📦', category: 'apps', rating: 0, downloads: 0,
    tags: [], featured: false, source: 'acme', trust: 'custom' as const, channels: ['stable'],
  })),
};

// No restore candidates, so the wizard goes straight to creating the draft.
const restoreCandidates = vi.fn(async (appId: string) => ({
  appId, lineages: [], defaultCandidateId: null, requiresExplicitChoice: false,
}));

vi.mock('../../utils/api-hybrid', () => ({
  api: {
    drafts: draftsApi,
    catalog: catalogApi,
    deployments: {
      create: vi.fn(async (_req: CreateDeploymentFromDraftRequest) => ({ deploymentId: 'dep1', releaseId: 'r1', jobId: 'j1' })),
      subdomainAvailable: vi.fn(async (subdomain: string) => ({ subdomain, host: `${subdomain}.local.hola`, available: true })),
    },
    restoreCandidates: (appId: string) => restoreCandidates(appId),
  },
}));

const { InstallWizard } = await import('../../pages/InstallWizard');

// `usePrereleaseEnrolment` reads `/api/settings` via `global.fetch`, outside
// api-hybrid — stub it (not enrolled) as the channels tests do.
const originalFetch = global.fetch;
function mockSettingsFetch() {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes('/api/settings')) {
      return new Response(JSON.stringify({ channels: { showPrerelease: false } }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not Found', { status: 404 });
  }) as unknown as typeof fetch;
}

/** Render, then leave the Restore Data step (no candidates, so Next is enabled
 *  at once) — that transition is what creates the draft. */
async function renderWizard(query: string) {
  render(
    <MemoryRouter initialEntries={[`/install/demo${query}`]}>
      <Routes>
        <Route path="/install/:appId" element={<InstallWizard />} />
        <Route path="/deployments" element={<div>Deployments</div>} />
      </Routes>
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: /next/i }));
}

beforeEach(() => {
  globalCache.clear();
  draftsApi.create.mockClear();
  mockSettingsFetch();
});

afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

describe('InstallWizard registry credential on a catalog install', () => {
  it('forwards ?cred= to draft creation alongside the source', async () => {
    await renderWizard('?source=acme&cred=acme-ghcr');
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalled());
    expect(draftsApi.create.mock.calls[0]![0]).toMatchObject({
      appId: 'demo', source: 'acme', credentialRef: 'acme-ghcr',
    });
  });

  it('sends no credential when ?cred= is absent', async () => {
    await renderWizard('?source=acme');
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalled());
    const req = draftsApi.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(req.credentialRef).toBeUndefined();
  });
});
