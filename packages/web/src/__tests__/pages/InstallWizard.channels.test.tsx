import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { CreateDraftRequest, CreateDraftResponse, Draft } from '@hola/shared';
import { globalCache } from '../../utils/cache';

// #428: `?channel=` reaches draft creation, and the resulting followed
// channel (from the draft) is shown back in the summary when non-stable.
// Template: InstallWizard.profiles.test.tsx.
//
// `channelByDraft` tracks each draft's channel by id so the `update` mock
// (called on every wizard step transition, via `handleNext`'s pre-advance
// save) echoes the SAME channel back rather than a hardcoded one — otherwise
// clicking through the wizard would silently overwrite a `stable` draft's
// channel with a leftover value from a differently-channeled draft.
const channelByDraft = new Map<string, string>();

function makeDraft(id: string, version: string): Draft {
  return {
    draftId: id,
    appId: 'demo',
    version,
    channel: channelByDraft.get(id),
    systemOverrides: {},
    appEnv: [],
    ports: [],
  };
}

const draftsApi = {
  create: vi.fn(async (req: CreateDraftRequest): Promise<CreateDraftResponse> => {
    const id = req.channel ? `draft-${req.channel}` : 'draft-stable';
    channelByDraft.set(id, req.channel ?? 'stable');
    return { draftId: id, app: { id: 'demo', name: 'Demo', icon: '📦' }, systemEnv: [], appEnv: [], defaults: { ports: [], volumes: [] } };
  }),
  byId: vi.fn(async (id: string): Promise<Draft> => makeDraft(id, channelByDraft.get(id) === 'stable' ? '1.0.0' : '1.3.0-rc.1')),
  update: vi.fn(async (id: string, updates: Partial<Draft>) => ({
    ok: true as const,
    draft: { ...makeDraft(id, channelByDraft.get(id) === 'stable' ? '1.0.0' : '1.3.0-rc.1'), ...updates },
  })),
  remove: vi.fn(async () => ({ ok: true as const })),
  validate: vi.fn(async () => ({ ok: true, errors: [], warnings: [] })),
  preflight: vi.fn(async () => ({ ok: true, checks: [] })),
  finalize: vi.fn(async () => ({ spec: {}, checksum: 'x' })),
};

const create = vi.fn(async () => ({ deploymentId: 'dep1', releaseId: 'r1', jobId: 'j1', channel: 'rc' }));

// The app's declared channels (#428), for the Channel select — mutable per
// test so "one channel" vs. "two channels" can both be exercised.
let catalogChannels: string[] = ['stable', 'rc'];
const catalogApi = {
  appById: vi.fn(async (id: string) => ({
    id, name: 'Demo', description: '', icon: '📦', category: 'apps', rating: 0, downloads: 0,
    tags: [], featured: false, source: 'hola', trust: 'verified' as const, channels: catalogChannels,
  })),
};

vi.mock('../../utils/api-hybrid', () => ({
  api: {
    drafts: draftsApi,
    catalog: catalogApi,
    deployments: {
      create: (data: unknown) => create(data),
      subdomainAvailable: vi.fn(async (subdomain: string) => ({ subdomain, host: `${subdomain}.local.hola`, available: true })),
    },
  },
}));

// Imported after the mock so InstallWizard picks up the mocked api-hybrid.
const { InstallWizard } = await import('../../pages/InstallWizard');

function renderWizard(query = '') {
  return render(
    <MemoryRouter initialEntries={[`/install/demo${query}`]}>
      <Routes>
        <Route path="/install/:appId" element={<InstallWizard />} />
        <Route path="/deployments" element={<div>Deployments</div>} />
      </Routes>
    </MemoryRouter>
  );
}

async function clickNext() {
  const before = draftsApi.update.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: /next/i }));
  await waitFor(() => expect(draftsApi.update.mock.calls.length).toBeGreaterThan(before));
}

beforeEach(() => {
  globalCache.clear();
  channelByDraft.clear();
  catalogChannels = ['stable', 'rc'];
  create.mockClear();
  draftsApi.create.mockClear();
  draftsApi.byId.mockClear();
  draftsApi.update.mockClear();
  draftsApi.remove.mockClear();
  catalogApi.appById.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('InstallWizard release channels (#428)', () => {
  it('forwards ?channel= to draft creation', async () => {
    renderWizard('?channel=rc');
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'demo', channel: 'rc' })
    ));
  });

  it('shows "Following channel" on the summary step when the resolved channel is non-stable', async () => {
    renderWizard('?channel=rc');
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalled());

    // Walk from Configuration (0) through to Summary (5): five Next clicks.
    await clickNext();
    await clickNext();
    await clickNext();
    await clickNext();
    await clickNext();
    await waitFor(() => expect(screen.getByText('Summary & confirm')).toBeInTheDocument());

    // Scoped to the "Following channel" line itself: the Channel select (also
    // on this step) renders an `<option value="rc">rc</option>`, so a bare
    // `getByText('rc')` would match twice.
    const line = screen.getByText('Following channel:').closest('div');
    expect(line?.textContent).toContain('rc');
    // The channel info note replaces the blunt "additional instance" warning.
    expect(screen.getByText(/follows the rc channel and starts with empty data/)).toBeInTheDocument();
  });

  it('does not show "Following channel" for a plain stable install', async () => {
    renderWizard();
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalled());

    await clickNext();
    await clickNext();
    await clickNext();
    await clickNext();
    await clickNext();
    await waitFor(() => expect(screen.getByText('Summary & confirm')).toBeInTheDocument());

    expect(screen.queryByText('Following channel:')).not.toBeInTheDocument();
  });

  // --- Channel select (T036) --------------------------------------------

  async function walkToSummary() {
    await clickNext();
    await clickNext();
    await clickNext();
    await clickNext();
    await clickNext();
    await waitFor(() => expect(screen.getByText('Summary & confirm')).toBeInTheDocument());
  }

  it('the Channel select is absent when the app has only one channel', async () => {
    catalogChannels = ['stable'];
    renderWizard();
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalled());
    await walkToSummary();
    expect(screen.queryByText('Channel')).not.toBeInTheDocument();
  });

  it('the Channel select is present for two channels and defaults to stable', async () => {
    renderWizard();
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalled());
    await walkToSummary();

    expect(screen.getByText('Channel')).toBeInTheDocument();
    const select = screen.getByDisplayValue('stable') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
  });

  it('changing the select deletes the current draft and creates a new one on the chosen channel', async () => {
    renderWizard();
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalled());
    await walkToSummary();

    const oldDraftId = (await draftsApi.create.mock.results[0].value).draftId;
    const select = screen.getByDisplayValue('stable');
    fireEvent.change(select, { target: { value: 'rc' } });

    await waitFor(() => expect(draftsApi.remove).toHaveBeenCalledWith(oldDraftId));
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'demo', channel: 'rc' })
    ));
    // The select itself now reflects the new draft's channel.
    await waitFor(() => expect(screen.getByDisplayValue('rc')).toBeInTheDocument());
  });

  // The switch deletes the old draft before creating the new one, and
  // `useCreateDraft` clears `data` on failure — so a failed switch unmounts the
  // whole wizard body (Channel select included) behind the error panel. The
  // panel's only affordance is Retry, which re-runs the mount path against the
  // wizard's `channel` state: if that stayed on the channel that just failed,
  // every retry fails the same way and the operator can never get back.
  it('a failed channel switch falls back to the previous channel so Retry can recover', async () => {
    renderWizard();
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalled());
    await walkToSummary();

    draftsApi.create.mockRejectedValueOnce(new Error('catalog temporarily unavailable'));
    fireEvent.change(screen.getByDisplayValue('stable'), { target: { value: 'rc' } });

    const retry = await screen.findByRole('button', { name: /try again/i });
    expect(screen.queryByDisplayValue('rc')).toBeNull();

    draftsApi.create.mockClear();
    fireEvent.click(retry);
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalled());
    expect((draftsApi.create.mock.calls[0][0] as CreateDraftRequest).channel).toBeUndefined();
  });
});
