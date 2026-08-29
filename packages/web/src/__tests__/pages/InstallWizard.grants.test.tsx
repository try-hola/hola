import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { CreateDraftResponse, Draft } from '@hola/shared';
import { globalCache } from '../../utils/cache';

// ADR 0004: an app that declares a privileged capability contract role (a backup
// app performs `backup@1`, which needs read access to every OTHER app's data)
// must surface that for explicit consent, block Next until it's given, and send
// the consent to the server as `grants` — which is what actually authorizes the
// mount. Unlike the `security` block's advisory checkboxes, this consent is
// binding: without it the server refuses the install outright, so a wizard that
// forgot to ask would dead-end the operator on an error no UI could resolve.
const draftId = 'draft-grants-test';

function makeDraft(overrides: Partial<Draft> = {}): Draft {
  return { draftId, appId: 'backrest', version: '1.0.0', systemOverrides: {}, appEnv: [], ports: [], ...overrides };
}

const create = vi.fn(async () => ({ deploymentId: 'dep1', releaseId: 'r1', jobId: 'j1' }));

const draftsApi = {
  create: vi.fn(async (): Promise<CreateDraftResponse> => ({
    draftId,
    app: { id: 'backrest', name: 'Backrest', icon: '📦' },
    systemEnv: [],
    appEnv: [],
    defaults: { ports: [], volumes: [] },
    provides: ['backup@1'],
  })),
  byId: vi.fn(async () => makeDraft()),
  update: vi.fn(async (_id: string, updates: Partial<Draft>) => ({ ok: true as const, draft: makeDraft(updates) })),
  remove: vi.fn(async () => ({ ok: true as const })),
  validate: vi.fn(async () => ({ ok: true, errors: [], warnings: [] })),
  preflight: vi.fn(async () => ({ ok: true, checks: [] })),
  finalize: vi.fn(async () => ({ spec: {}, checksum: 'x' })),
};

vi.mock('../../utils/api-hybrid', () => ({
  api: {
    drafts: draftsApi,
    deployments: {
      create: (data: unknown) => create(data),
      subdomainAvailable: vi.fn(async (subdomain: string) => ({ subdomain, host: `${subdomain}.local.hola`, available: true })),
    },
  },
}));

// Imported after the mock so InstallWizard picks up the mocked api-hybrid.
const { InstallWizard } = await import('../../pages/InstallWizard');

function renderWizard() {
  return render(
    <MemoryRouter initialEntries={['/install/backrest']}>
      <Routes>
        <Route path="/install/:appId" element={<InstallWizard />} />
        <Route path="/deployments" element={<div>Deployments</div>} />
      </Routes>
    </MemoryRouter>
  );
}

/** Advance one step, using the pre-advance draft save as the transition signal. */
async function clickNext() {
  const before = draftsApi.update.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: /next/i }));
  await waitFor(() => expect(draftsApi.update.mock.calls.length).toBeGreaterThan(before));
}

beforeEach(() => {
  globalCache.clear();
  create.mockClear();
  draftsApi.create.mockClear();
  draftsApi.update.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('InstallWizard privileged contract grants (ADR 0004)', () => {
  it('blocks Next until the declared grant is consented to, then sends it to create', async () => {
    renderWizard();
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalled());

    // The grant is named in the operator's terms, not as a bare contract id.
    const row = await screen.findByText(/read the data of every installed app/i);
    const label = row.closest('label')!;
    const checkbox = label.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).not.toBeChecked();

    // Unconsented, the wizard won't advance — better a disabled button than a
    // 400 five steps later.
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();

    fireEvent.click(checkbox);
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled();

    // Configuration (0) → Summary (5).
    await clickNext();
    await clickNext();
    await clickNext();
    await clickNext();
    await clickNext();

    fireEvent.click(screen.getByRole('button', { name: /^install$/i }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    const arg = create.mock.calls[0][0] as { grants?: string[] };
    expect(arg.grants).toEqual(['backup@1']);
  });

  it('shows no consent step for an app that declares no privileged role', async () => {
    draftsApi.create.mockResolvedValueOnce({
      draftId,
      app: { id: 'uptime-kuma', name: 'Uptime Kuma', icon: '📦' },
      systemEnv: [],
      appEnv: [],
      defaults: { ports: [], volumes: [] },
    });

    renderWizard();
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalled());

    expect(screen.queryByText(/requests access to other apps/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled();
  });
});
