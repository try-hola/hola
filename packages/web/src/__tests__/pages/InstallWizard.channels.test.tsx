import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { CreateDraftRequest, CreateDraftResponse, Draft } from '@hola/shared';
import { globalCache } from '../../utils/cache';

// Spec 005 (beta channel UX), US1/US3/US4. Supersedes the old #428
// `<select>`-based channel picker tests with a `RadioGroup`, gated on
// enrolment (`usePrereleaseEnrolment`, backed by `/api/settings`) or an
// explicit `?channel=` (the entry point from the deployment detail page's
// "Try <c> in a separate copy" link and the catalog's per-channel install).
// Template: InstallWizard.grants.test.tsx / InstallWizard.profiles.test.tsx.
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

const create = vi.fn(async () => ({ deploymentId: 'dep1', releaseId: 'r1', jobId: 'j1' }));
const updateDeployment = vi.fn(async () => ({ ok: true as const }));
const subdomainAvailable = vi.fn(async (subdomain: string) => ({ subdomain, host: `${subdomain}.local.hola`, available: true }));

// The app's declared channels, for the Channel radio group — mutable per test.
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
      update: (id: string, data: unknown) => updateDeployment(id, data),
      subdomainAvailable: (subdomain: string) => subdomainAvailable(subdomain),
    },
  },
}));

// Imported after the mock so InstallWizard picks up the mocked api-hybrid.
const { InstallWizard } = await import('../../pages/InstallWizard');

// `usePrereleaseEnrolment` reads `/api/settings` directly via `global.fetch`
// (it is NOT routed through api-hybrid) — mutable per test.
let showPrerelease = false;
const originalFetch = global.fetch;

function mockSettingsFetch() {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/settings')) {
      return new Response(JSON.stringify({ channels: { showPrerelease } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not Found', { status: 404 });
  }) as unknown as typeof fetch;
}

function renderWizard(query = '') {
  return render(
    <MemoryRouter initialEntries={[`/install/demo${query}`]}>
      <Routes>
        <Route path="/install/:appId" element={<InstallWizard />} />
        <Route path="/deployments" element={<div>Deployments list</div>} />
        <Route path="/deployments/:id" element={<div>Deployment detail stub</div>} />
      </Routes>
    </MemoryRouter>
  );
}

async function clickNext() {
  const before = draftsApi.update.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: /next/i }));
  await waitFor(() => expect(draftsApi.update.mock.calls.length).toBeGreaterThan(before));
}

/** Walk from Configuration (0) through to Summary (5): five Next clicks. */
async function walkToSummary() {
  await clickNext();
  await clickNext();
  await clickNext();
  await clickNext();
  await clickNext();
  await waitFor(() => expect(screen.getByText('Summary & confirm')).toBeInTheDocument());
}

beforeEach(() => {
  globalCache.clear();
  channelByDraft.clear();
  catalogChannels = ['stable', 'rc'];
  showPrerelease = false;
  mockSettingsFetch();
  create.mockClear();
  updateDeployment.mockClear();
  subdomainAvailable.mockClear();
  draftsApi.create.mockClear();
  draftsApi.byId.mockClear();
  draftsApi.update.mockClear();
  draftsApi.remove.mockClear();
  catalogApi.appById.mockClear();
});

afterEach(() => {
  global.fetch = originalFetch;
  cleanup();
});

describe('InstallWizard channel radio (spec 005 US1)', () => {
  it('has no radiogroup when not enrolled and no ?channel=', async () => {
    renderWizard();
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalled());
    await walkToSummary();

    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('shows the radiogroup with Stable/pre-release options when enrolled with 2+ channels', async () => {
    showPrerelease = true;
    renderWizard();
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalled());
    await walkToSummary();

    const group = await screen.findByRole('radiogroup');
    expect(within(group).getByText('Stable (recommended)')).toBeInTheDocument();
    expect(within(group).getByText('rc — pre-release')).toBeInTheDocument();
  });

  it('is absent when enrolled but the app has only one channel', async () => {
    showPrerelease = true;
    catalogChannels = ['stable'];
    renderWizard();
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalled());
    await walkToSummary();

    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('shows the radiogroup with rc checked when opened with ?channel=rc while NOT enrolled', async () => {
    renderWizard('?channel=rc');
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalled());
    await walkToSummary();

    const group = await screen.findByRole('radiogroup');
    const rcRadio = within(group).getByDisplayValue('rc') as HTMLInputElement;
    expect(rcRadio.checked).toBe(true);
  });

  it('selecting a radio option deletes the current draft and creates a new one on the chosen channel', async () => {
    showPrerelease = true;
    renderWizard();
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalled());
    await walkToSummary();

    const oldDraftId = (await draftsApi.create.mock.results[0].value).draftId;
    const group = await screen.findByRole('radiogroup');
    fireEvent.click(within(group).getByDisplayValue('rc'));

    await waitFor(() => expect(draftsApi.remove).toHaveBeenCalledWith(oldDraftId));
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'demo', channel: 'rc' })
    ));
    // The radiogroup itself now reflects the new draft's channel.
    await waitFor(() => {
      const g = screen.getByRole('radiogroup');
      expect((within(g).getByDisplayValue('rc') as HTMLInputElement).checked).toBe(true);
    });
  });

  // The switch deletes the old draft before creating the new one, and
  // `useCreateDraft` clears `data` on failure — so a failed switch unmounts the
  // whole wizard body (radiogroup included) behind the error panel. The
  // panel's only affordance is Retry, which re-runs the mount path against the
  // wizard's `channel` state: if that stayed on the channel that just failed,
  // every retry fails the same way and the operator can never get back.
  it('a failed channel switch falls back to the previous channel so Retry can recover', async () => {
    showPrerelease = true;
    renderWizard();
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalled());
    await walkToSummary();

    draftsApi.create.mockRejectedValueOnce(new Error('catalog temporarily unavailable'));
    const group = screen.getByRole('radiogroup');
    fireEvent.click(within(group).getByDisplayValue('rc'));

    const retry = await screen.findByRole('button', { name: /try again/i });
    expect(retry).toBeInTheDocument();

    draftsApi.create.mockClear();
    fireEvent.click(retry);
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalled());
    expect((draftsApi.create.mock.calls[0][0] as CreateDraftRequest).channel).toBeUndefined();
  });

  it('shows the non-stable note for an implied channel with no explicit selection (FR-017)', async () => {
    // No `?channel=` — the pinned version's OWN channel implies `rc`, which
    // the draft reports back once it resolves (via the update-response
    // cache refresh, same as a real round trip).
    const id = 'draft-implied';
    draftsApi.create.mockResolvedValueOnce({
      draftId: id, app: { id: 'demo', name: 'Demo', icon: '📦' }, systemEnv: [], appEnv: [], defaults: { ports: [], volumes: [] },
    });
    channelByDraft.set(id, 'rc');

    renderWizard();
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalled());
    await walkToSummary();

    expect(screen.getByText(/follows the rc channel/)).toBeInTheDocument();
    expect(screen.getByText(/starts with empty data/)).toBeInTheDocument();
  });

  it('does not show the non-stable note for a plain stable install', async () => {
    renderWizard();
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalled());
    await walkToSummary();

    expect(screen.queryByText(/follows the .* channel/)).not.toBeInTheDocument();
  });
});

describe('InstallWizard opened via a channel link (spec 005 US3)', () => {
  it.each([false, true])('shows beta checked and the empty-data note when opened with ?channel=beta (enrolled=%s)', async (enrolled) => {
    showPrerelease = enrolled;
    catalogChannels = ['stable', 'beta'];
    renderWizard('?channel=beta');
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'demo', channel: 'beta' })
    ));
    await walkToSummary();

    const group = await screen.findByRole('radiogroup');
    const betaRadio = within(group).getByDisplayValue('beta') as HTMLInputElement;
    expect(betaRadio.checked).toBe(true);

    expect(screen.getByText(/follows the beta channel/)).toBeInTheDocument();
    expect(screen.getByText(/starts with empty data/)).toBeInTheDocument();
  });
});

describe('InstallWizard already-installed conflict (spec 005 US4)', () => {
  function conflictError(overrides: { existing?: { id: string; name: string; channel: string }; channelPublished?: boolean } = {}) {
    const existing = overrides.existing ?? { id: 'dep-1', name: 'gitea', channel: 'stable' };
    const channelPublished = overrides.channelPublished ?? true;
    return Object.assign(
      new Error("'gitea' is already installed as 'gitea' and follows 'stable'. This app is single-instance."),
      { code: 'CONFLICT', details: { code: 'ALREADY_INSTALLED', existing, channelPublished } },
    );
  }

  async function installAndHitConflict(query = '?channel=beta') {
    catalogChannels = ['stable', 'beta'];
    renderWizard(query);
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalled());
    await walkToSummary();
    fireEvent.click(screen.getByRole('button', { name: /^install$/i }));
  }

  it('renders the already-installed sentence and the Switch/Open/Install-separate actions', async () => {
    create.mockRejectedValueOnce(conflictError());
    await installAndHitConflict();

    await waitFor(() => expect(screen.getByText(/gitea is already installed and follows stable\./)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /switch gitea to beta instead/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open gitea/i })).toHaveAttribute('href', '/deployments/dep-1');
    expect(screen.getByRole('button', { name: /install a separate beta copy/i })).toBeInTheDocument();
  });

  it('Switch calls deployments.update, removes the draft (best-effort), and navigates to the existing deployment', async () => {
    create.mockRejectedValueOnce(conflictError());
    await installAndHitConflict();

    const lastDraftId = (await draftsApi.create.mock.results[draftsApi.create.mock.results.length - 1].value).draftId;
    const switchBtn = await screen.findByRole('button', { name: /switch gitea to beta instead/i });
    fireEvent.click(switchBtn);

    await waitFor(() => expect(updateDeployment).toHaveBeenCalledWith('dep-1', { channel: 'beta' }));
    await waitFor(() => expect(draftsApi.remove).toHaveBeenCalledWith(lastDraftId));
    await waitFor(() => expect(screen.getByText('Deployment detail stub')).toBeInTheDocument());
  });

  it('a failed Switch keeps the panel open and shows a local error', async () => {
    create.mockRejectedValueOnce(conflictError());
    updateDeployment.mockRejectedValueOnce(new Error('channel update failed'));
    await installAndHitConflict();

    const switchBtn = await screen.findByRole('button', { name: /switch gitea to beta instead/i });
    fireEvent.click(switchBtn);

    await waitFor(() => expect(screen.getByText('channel update failed')).toBeInTheDocument());
    // The panel is still open — Switch is still offered, no navigation happened.
    expect(screen.getByRole('button', { name: /switch gitea to beta instead/i })).toBeInTheDocument();
    expect(screen.queryByText('Deployment detail stub')).not.toBeInTheDocument();
  });

  it('Install a separate copy re-finalizes with allowMultiple: true when the channel is published', async () => {
    create.mockRejectedValueOnce(conflictError());
    await installAndHitConflict();

    const installSeparate = await screen.findByRole('button', { name: /install a separate beta copy/i });
    fireEvent.click(installSeparate);

    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    const secondCallArg = create.mock.calls[1][0] as { allowMultiple?: boolean };
    expect(secondCallArg.allowMultiple).toBe(true);
  });

  it('Install a separate copy is absent when the channel is unpublished', async () => {
    create.mockRejectedValueOnce(conflictError({ channelPublished: false }));
    await installAndHitConflict();

    await waitFor(() => expect(screen.getByText(/gitea is already installed and follows stable\./)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /install a separate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /install another copy/i })).not.toBeInTheDocument();
  });

  it('offers "Install another copy (operator override)" instead of Switch when the requested channel equals the existing one', async () => {
    create.mockRejectedValueOnce(conflictError({ existing: { id: 'dep-1', name: 'gitea', channel: 'beta' } }));
    await installAndHitConflict(); // requests beta; existing already follows beta

    await waitFor(() => expect(screen.getByText(/gitea is already installed and follows beta\./)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /switch gitea/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /install another copy \(operator override\)/i })).toBeInTheDocument();
  });

  it('none of the conflict messages contain literal CLI-flag text', async () => {
    create.mockRejectedValueOnce(conflictError());
    await installAndHitConflict();

    await waitFor(() => expect(screen.getByText(/gitea is already installed and follows stable\./)).toBeInTheDocument());
    const panelText = document.body.textContent ?? '';
    expect(panelText).not.toMatch(/--allow-multiple/);
    expect(panelText).not.toMatch(/--channel/);
    expect(panelText).not.toMatch(/install another(?! copy \(operator override\))/i);
  });
});
