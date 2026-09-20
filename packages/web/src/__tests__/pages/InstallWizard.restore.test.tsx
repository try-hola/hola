import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { CreateDraftRequest, CreateDraftResponse, Draft, ListRestoreCandidatesResponse } from '@hola/shared';
import { globalCache } from '../../utils/cache';

// Restore-on-install (spec 007). Covers quickstart.md scenarios 44-48 (mode
// "W"): the restore step renders first, changing the choice re-creates the
// draft, carried values render as ordinary appEnv rows, the summary
// acknowledgement appears, and "no candidates" still lets Next proceed.
// Template: InstallWizard.channels.test.tsx.

let draftCounter = 0;
const draftsByChoice = new Map<string, Draft>();

const draftsApi = {
  create: vi.fn(async (req: CreateDraftRequest): Promise<CreateDraftResponse> => {
    draftCounter += 1;
    const draftId = `draft-${draftCounter}`;
    const carried = req.restoreFrom?.candidateId === 'demo-source' && req.restoreFrom.carryEnv;
    const appEnv = carried
      ? [{ key: 'ADMIN_PASSWORD', value: 'carried-secret-value', isSecret: true, label: 'Admin password' }]
      : [{ key: 'ADMIN_PASSWORD', value: '', isSecret: true, label: 'Admin password', generate: { kind: 'hex' as const, length: 4 } }];
    const draft: Draft = { draftId, appId: 'demo', version: '1.0.0', systemOverrides: {}, appEnv, ports: [] };
    draftsByChoice.set(draftId, draft);
    return { draftId, app: { id: 'demo', name: 'Demo', icon: '📦' }, systemEnv: [], appEnv, defaults: { ports: [], volumes: [] } };
  }),
  byId: vi.fn(async (id: string): Promise<Draft> => draftsByChoice.get(id)!),
  update: vi.fn(async (id: string, updates: Partial<Draft>) => ({ ok: true as const, draft: { ...draftsByChoice.get(id)!, ...updates } })),
  remove: vi.fn(async () => ({ ok: true as const })),
  validate: vi.fn(async () => ({ ok: true, errors: [], warnings: [] })),
  preflight: vi.fn(async () => ({ ok: true, checks: [] })),
  finalize: vi.fn(async () => ({ spec: {}, checksum: 'x' })),
};

const create = vi.fn(async () => ({ deploymentId: 'dep1', releaseId: 'r1', jobId: 'j1' }));

// One lineage, one candidate, WITH a carried environment record.
const DEFAULT_CANDIDATES_RESPONSE: ListRestoreCandidatesResponse = {
  appId: 'demo',
  lineages: [{
    lineageId: 'demo-source',
    candidates: [{
      deploymentId: 'demo-source',
      lineageId: 'demo-source',
      app: 'demo',
      name: 'Demo (original)',
      subdomain: 'demo',
      host: 'demo.local.hola',
      appVersion: '1.0.0',
      channel: 'stable',
      carriesEnv: true,
      capturedAt: '2026-01-01T00:00:00.000Z',
      hasIdentityRecord: true,
      skew: { kind: 'ok' },
      requiredAcknowledgements: [],
      warnings: [],
    }],
  }],
  defaultCandidateId: 'demo-source',
  requiresExplicitChoice: false,
};
// Mutable per test — reset to a deep copy of the default in `beforeEach`.
let restoreCandidatesResponse: ListRestoreCandidatesResponse = DEFAULT_CANDIDATES_RESPONSE;
const restoreCandidates = vi.fn(async (...__args: [string, (string | undefined)?, (string | undefined)?, (string | undefined)?]) => {
  void __args;
  return restoreCandidatesResponse;
});

vi.mock('../../utils/api-hybrid', () => ({
  api: {
    drafts: draftsApi,
    deployments: {
      create: (data: unknown) => create(data),
      subdomainAvailable: vi.fn(async (subdomain: string) => ({ subdomain, host: `${subdomain}.local.hola`, available: true })),
    },
    restoreCandidates: (appId: string, version?: string, source?: string, channel?: string) => restoreCandidates(appId, version, source, channel),
  },
}));

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

/** Advance one step past Configuration or later, using the pre-advance draft
 *  save as the transition signal. */
async function clickNext() {
  const before = draftsApi.update.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: /next/i }));
  await waitFor(() => expect(draftsApi.update.mock.calls.length).toBeGreaterThan(before));
}

/** Leave the restore step specifically — there's no draft yet to save, so the
 *  transition signal is the draft CREATE call it triggers instead. */
async function leaveRestoreStep() {
  const before = draftsApi.create.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: /next/i }));
  await waitFor(() => expect(draftsApi.create.mock.calls.length).toBeGreaterThan(before));
}

beforeEach(() => {
  globalCache.clear();
  draftCounter = 0;
  draftsByChoice.clear();
  create.mockClear();
  draftsApi.create.mockClear();
  draftsApi.update.mockClear();
  draftsApi.remove.mockClear();
  restoreCandidates.mockClear();
  restoreCandidatesResponse = structuredClone(DEFAULT_CANDIDATES_RESPONSE);
});

afterEach(() => {
  cleanup();
});

describe('InstallWizard restore-on-install (spec 007)', () => {
  // ---- scenario 44: the restore step renders at index 0, before Configuration ----
  it('scenario 44: renders the restore step first, and no draft exists yet', async () => {
    renderWizard();

    await waitFor(() => expect(screen.getByText(/Step 1 — Restore Data/)).toBeInTheDocument());
    // No draft created yet — the choice must be made first (research R1).
    expect(draftsApi.create).not.toHaveBeenCalled();
    // The candidate is offered by name.
    expect(await screen.findByText(/Demo \(original\)/)).toBeInTheDocument();
  });

  // ---- scenario 48: with no candidates, the step says so and Next is enabled ----
  it('scenario 48: with no candidates, the step explains that and Next is enabled', async () => {
    restoreCandidatesResponse = { appId: 'demo', lineages: [], defaultCandidateId: null, requiresExplicitChoice: false };
    renderWizard();

    await waitFor(() => expect(screen.getByText(/No existing copies of demo were found/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled();
  });

  // ---- scenario 46: carried values render as ordinary appEnv rows ----
  it('scenario 46: choosing a candidate carries its configuration into ordinary appEnv rows', async () => {
    renderWizard();
    await waitFor(() => expect(screen.getByText(/Demo \(original\)/)).toBeInTheDocument());

    // The candidate + carry-env are the defaults (FR-005 default selection,
    // CLI/wizard default-on-when-available) — proceed straight to Configuration.
    await leaveRestoreStep();

    expect(draftsApi.create).toHaveBeenCalledWith(
      expect.objectContaining({ restoreFrom: { candidateId: 'demo-source', carryEnv: true } }),
    );

    // Rendered through the SAME labeled input every other secret uses — no
    // separate "restored value" widget.
    const input = await screen.findByLabelText(/Admin password/i) as HTMLInputElement;
    expect(input.value).toBe('carried-secret-value');
  });

  // ---- scenario 47: the summary step's unconditional restore acknowledgement ----
  it('scenario 47: the summary step names data AND credentials, and that jobs/webhooks may fire', async () => {
    renderWizard();
    await waitFor(() => expect(screen.getByText(/Demo \(original\)/)).toBeInTheDocument());
    await leaveRestoreStep(); // restore -> env, creates the draft

    await clickNext(); // env -> compose
    await clickNext(); // compose -> files
    await clickNext(); // files -> advanced
    await clickNext(); // advanced -> validate
    await clickNext(); // validate -> summary

    await waitFor(() => expect(screen.getByText('Summary & confirm')).toBeInTheDocument());
    expect(screen.getByText(/restores data/i)).toBeInTheDocument();
    expect(screen.getByText(/and credentials/i)).toBeInTheDocument();
    expect(screen.getByText(/jobs, ?\s*webhooks or integrations/i)).toBeInTheDocument();
  });

  // ---- scenario 45: changing the choice deletes + re-creates the draft ----
  it('scenario 45: changing the restore choice after a draft exists deletes and re-creates it', async () => {
    renderWizard();
    await waitFor(() => expect(screen.getByText(/Demo \(original\)/)).toBeInTheDocument());
    await leaveRestoreStep(); // commits the default choice, creates draft 1

    expect(draftsApi.create).toHaveBeenCalledTimes(1);
    const firstDraftId = (await draftsApi.create.mock.results[0]!.value).draftId;

    // Back to the restore step, deselect the candidate ("Start fresh").
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    const freshRadio = await screen.findByRole('radio', { name: /Start fresh/i });
    fireEvent.click(freshRadio);
    await leaveRestoreStep();

    await waitFor(() => expect(draftsApi.remove).toHaveBeenCalledWith(firstDraftId));
    expect(draftsApi.create).toHaveBeenCalledTimes(2);
    const secondCall = draftsApi.create.mock.calls[1]![0] as CreateDraftRequest;
    expect(secondCall.restoreFrom).toBeUndefined();
  });

  // ---- review: the step must judge skew against the version it will install ----
  it('reads candidates against the version/source/channel the draft will be created with', async () => {
    renderWizard('?source=pofallon&channel=rc');
    await waitFor(() => expect(restoreCandidates).toHaveBeenCalled());

    // Without a target version every candidate's skew comes back `unknown`,
    // which would demand `restore-version-unknown` from every operator and
    // hide RESTORE_SOURCE_NEWER / RESTORE_UPGRADE_PATH until create time.
    // `source`/`channel` ride along so the route resolves the SAME concrete
    // version `createDraft` will.
    expect(restoreCandidates).toHaveBeenCalledWith('demo', 'latest', 'pofallon', 'rc');
  });

  // ---- review: a refused re-create must not strand Retry on the bad choice ----
  it('falls back to the previous restore choice when re-creating the draft is refused', async () => {
    renderWizard();
    await waitFor(() => expect(screen.getByText(/Demo \(original\)/)).toBeInTheDocument());
    await leaveRestoreStep(); // commits the default choice, creates draft 1

    // Go back and switch to "Start fresh", but make the re-create fail — the
    // old draft is already deleted by then, so `draftId` goes falsy and the
    // wizard body unmounts behind the error panel. Retry re-runs the mount
    // path, which reads the restore choice: it must be the one that worked.
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    fireEvent.click(await screen.findByRole('radio', { name: /Start fresh/i }));
    draftsApi.create.mockRejectedValueOnce(new Error('RESTORE_CANDIDATE_GONE'));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(draftsApi.remove).toHaveBeenCalled());
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalledTimes(2));

    // Retry: the third create carries the choice that last worked, not the
    // refused one, so the operator is not stuck on a permanently-failing retry.
    fireEvent.click(await screen.findByRole('button', { name: /try again/i }));
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalledTimes(3));
    const retryCall = draftsApi.create.mock.calls[2]![0] as CreateDraftRequest;
    expect(retryCall.restoreFrom).toEqual({ candidateId: 'demo-source', carryEnv: true });
  });
});
