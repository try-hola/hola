import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { CreateDraftResponse, RefNotAllowedDetails } from '@hola/shared';
import { globalCache } from '../../utils/cache';

/**
 * Installing from a custom catalog source whose registry isn't allowlisted fails
 * with REF_NOT_ALLOWED (403). The operator's fix — granting that source the
 * registry — is one PATCH away, so the wizard offers it as a button instead of
 * printing a message and leaving them to find Settings (which, before the edit
 * form existed, couldn't even do it without deleting and re-adding the source).
 */
const draftId = 'draft-refnotallowed';

const DETAILS: RefNotAllowedDetails = {
  ref: 'ghcr.io/pofallon/hola-get2know-cms:0.1.13',
  suggestedGlob: 'ghcr.io/pofallon/*',
  allowed: ['ghcr.io/try-hola/*'],
};

/** The 403 as the API layer surfaces it: message for display, code/details to act on. */
function refNotAllowedError() {
  return Object.assign(new Error(`REF_NOT_ALLOWED: ${DETAILS.ref} is not covered by the registry allowlist (ghcr.io/try-hola/*).`), {
    code: 'REF_NOT_ALLOWED',
    details: DETAILS,
    statusCode: 403,
  });
}

const okDraft = (): CreateDraftResponse => ({
  draftId,
  app: { id: 'get2know-cms', name: 'get2know CMS', icon: '📝' },
  systemEnv: [],
  appEnv: [],
  defaults: { ports: [], volumes: [] },
});

const draftsApi = {
  create: vi.fn(async (): Promise<CreateDraftResponse> => { throw refNotAllowedError(); }),
  byId: vi.fn(async () => ({ draftId, appId: 'get2know-cms', version: '0.1.13', systemOverrides: {}, appEnv: [], ports: [] })),
  update: vi.fn(async () => ({ ok: true as const })),
  remove: vi.fn(async () => ({ ok: true as const })),
};

const catalogSources = {
  list: vi.fn(async () => ({
    items: [
      { id: 'hola', name: 'hola', type: 'index-url' as const, url: '', trust: 'verified' as const, enabled: true },
      // Already carries one consent — the fix must ADD to it, not replace it.
      { id: 'pofallon', name: 'pofallon', type: 'index-url' as const, url: 'https://example.test/catalog.json', trust: 'custom' as const, enabled: true, allowRegistries: ['ghcr.io/other/*'] },
    ],
  })),
  update: vi.fn(async () => ({ id: 'pofallon', name: 'pofallon', type: 'index-url' as const, url: 'https://example.test/catalog.json', trust: 'custom' as const, enabled: true })),
};

vi.mock('../../utils/api-hybrid', () => ({
  api: {
    drafts: draftsApi,
    catalogSources,
    deployments: {
      create: vi.fn(),
      subdomainAvailable: vi.fn(async (subdomain: string) => ({ subdomain, host: `${subdomain}.local.hola`, available: true })),
    },
  },
}));

const { InstallWizard } = await import('../../pages/InstallWizard');

function renderWizard(search = '?source=pofallon') {
  return render(
    <MemoryRouter initialEntries={[`/install/get2know-cms${search}`]}>
      <Routes>
        <Route path="/install/:appId" element={<InstallWizard />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  globalCache.clear();
  vi.clearAllMocks();
  draftsApi.create.mockImplementation(async () => { throw refNotAllowedError(); });
});

afterEach(() => cleanup());

describe('InstallWizard REF_NOT_ALLOWED recovery', () => {
  it('offers the exact fix and applies it as an additional grant, then retries the install', async () => {
    renderWizard();

    await waitFor(() => expect(screen.getByText('Registry not allowed')).toBeInTheDocument());
    // The suggestion names the registry to be granted — not the raw ref.
    const allow = await screen.findByRole('button', { name: /allow ghcr\.io\/pofallon\/\* for/i });

    // The next attempt succeeds, as it would once the source is patched.
    draftsApi.create.mockImplementation(async () => okDraft());
    fireEvent.click(allow);

    await waitFor(() => expect(catalogSources.update).toHaveBeenCalled());
    const [sourceId, patch] = catalogSources.update.mock.calls[0] as [string, { allowRegistries: string[] }];
    expect(sourceId).toBe('pofallon');
    // Merged with the source's existing consent — patching must never revoke it.
    expect([...patch.allowRegistries].sort()).toEqual(['ghcr.io/other/*', 'ghcr.io/pofallon/*']);

    // The install resumes on its own: no reload, no re-navigating the catalog.
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Registry not allowed')).not.toBeInTheDocument());
  });

  it('does not offer to patch a source that has none to patch (install-by-ref)', async () => {
    // `/install/ref?ref=…` has no stored source record, so the only remedy is the
    // server-wide baseline — say so instead of dangling an unusable button.
    renderWizard('?ref=ghcr.io/pofallon/hola-get2know-cms:0.1.13');

    await waitFor(() => expect(screen.getByText('Registry not allowed')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /allow .* for/i })).not.toBeInTheDocument();
    expect(screen.getByText(/HOLA_REGISTRY_ALLOWLIST/)).toBeInTheDocument();
    expect(catalogSources.update).not.toHaveBeenCalled();
  });

  it('falls back to the plain message when the server sends no usable details', async () => {
    // An older server sends the same code with no payload. Offering to grant
    // `undefined` would be worse than saying nothing.
    draftsApi.create.mockImplementation(async () => {
      throw Object.assign(new Error('REF_NOT_ALLOWED: blocked'), { code: 'REF_NOT_ALLOWED', statusCode: 403 });
    });
    renderWizard();

    await waitFor(() => expect(screen.getByText('REF_NOT_ALLOWED: blocked')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /allow/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Registry not allowed')).not.toBeInTheDocument();
  });

  it('does not hammer the server: a failed draft is attempted once until the operator retries', async () => {
    renderWizard();

    await waitFor(() => expect(screen.getByText('Registry not allowed')).toBeInTheDocument());
    // Settle: the effect re-runs on every render, so a missing guard shows up here.
    await new Promise(r => setTimeout(r, 50));
    expect(draftsApi.create).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalledTimes(2));
  });
});
