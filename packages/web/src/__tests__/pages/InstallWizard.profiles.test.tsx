import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { CreateDeploymentFromDraftRequest, CreateDraftResponse, Draft } from '@hola/shared';
import { globalCache } from '../../utils/cache';

// #162: an app that declares optional Compose profiles must render them as
// checkboxes on the summary step (pre-checked per `default`), and the enabled
// set must flow through to the deployment create call. Exercised end to end
// against the real InstallWizard so the whole draft → render → toggle → install
// path is faithful.
const draftId = 'draft-profiles-test';

const PROFILES = [
  { key: 'elasticsearch', label: 'Elasticsearch advanced visibility', description: 'Heavier, opt-in.', default: false },
  { key: 'metrics', label: 'Metrics', default: true },
];

function makeDraft(overrides: Partial<Draft> = {}): Draft {
  return { draftId, appId: 'testapp', version: '1.0.0', systemOverrides: {}, appEnv: [], ports: [], files: [], profiles: PROFILES, ...overrides };
}

// Declare the request parameter: without it `vi.fn` infers a zero-argument
// function and every `create.mock.calls[n][0]` assertion below indexes an
// empty tuple.
const create = vi.fn(
  async (_req: CreateDeploymentFromDraftRequest) => ({ deploymentId: 'dep1', releaseId: 'r1', jobId: 'j1' })
);

const draftsApi = {
  create: vi.fn(async (): Promise<CreateDraftResponse> => ({
    draftId,
    app: { id: 'testapp', name: 'Test App', icon: '📦' },
    systemEnv: [],
    appEnv: [],
    defaults: { ports: [], volumes: [] },
    profiles: PROFILES,
  })),
  byId: vi.fn(async () => makeDraft()),
  update: vi.fn(async (_id: string, updates: Partial<Draft>) => ({ ok: true as const, draft: makeDraft(updates) })),
  remove: vi.fn(async () => ({ ok: true as const })),
  validate: vi.fn(async () => ({ ok: true, errors: [], warnings: [] })),
  preflight: vi.fn(async () => ({ ok: true, checks: [] })),
  finalize: vi.fn(async () => ({ spec: {}, checksum: 'x' })),
};

// Restore-on-install (spec 007): the wizard's new first step reads this
// route before a draft exists. No candidates in this fixture set.
const restoreCandidates = vi.fn(async (appId: string) => ({
  appId, lineages: [], defaultCandidateId: null, requiresExplicitChoice: false,
}));

vi.mock('../../utils/api-hybrid', () => ({
  api: {
    drafts: draftsApi,
    deployments: {
      create: (data: CreateDeploymentFromDraftRequest) => create(data),
      subdomainAvailable: vi.fn(async (subdomain: string) => ({ subdomain, host: `${subdomain}.local.hola`, available: true })),
    },
    restoreCandidates: (appId: string) => restoreCandidates(appId),
  },
}));

// Imported after the mock so InstallWizard picks up the mocked api-hybrid.
const { InstallWizard } = await import('../../pages/InstallWizard');

/** Render, then advance past the new Restore Data step (spec 007) — no
 *  candidates in these fixtures, so Next is immediately enabled there. Every
 *  assertion below predates this step and starts from "the draft now exists". */
async function renderWizard() {
  const utils = render(
    <MemoryRouter initialEntries={['/install/testapp']}>
      <Routes>
        <Route path="/install/:appId" element={<InstallWizard />} />
        <Route path="/deployments" element={<div>Deployments</div>} />
      </Routes>
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: /next/i }));
  return utils;
}

// Advance one step: click Next and wait for handleNext's pre-advance draft
// save to fire (a reliable per-transition signal that avoids matching the
// step heading, which the header row duplicates).
async function clickNext() {
  const before = draftsApi.update.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: /next/i }));
  await waitFor(() => expect(draftsApi.update.mock.calls.length).toBeGreaterThan(before));
}

beforeEach(() => {
  globalCache.clear();
  create.mockClear();
  draftsApi.create.mockClear();
  restoreCandidates.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('InstallWizard optional Compose profiles (#162)', () => {
  it('renders declared profiles on the summary step and sends the enabled set to create', async () => {
    await renderWizard();
    // Wait for the draft to resolve (step 0 heading is the app name).
    await waitFor(() => expect(draftsApi.create).toHaveBeenCalled());

    // Walk from Configuration (0) through to Summary (5): five Next clicks.
    await clickNext();
    await clickNext();
    await clickNext();
    await clickNext();
    await clickNext();
    await waitFor(() => expect(screen.getByText('Optional services')).toBeInTheDocument());

    // Both declared profiles render; `metrics` is pre-checked (default), the
    // heavier `elasticsearch` is not.
    const optional = screen.getByText('Optional services').closest('div')!;
    const metrics = within(optional).getByText('Metrics').closest('label')!;
    const es = within(optional).getByText('Elasticsearch advanced visibility').closest('label')!;
    expect(within(metrics).getByRole('checkbox')).toBeChecked();
    expect(within(es).getByRole('checkbox')).not.toBeChecked();

    // The operator opts into Elasticsearch too.
    fireEvent.click(within(es).getByRole('checkbox'));

    fireEvent.click(screen.getByRole('button', { name: /^install$/i }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    const arg = create.mock.calls[0]![0];
    // Both the default-on and the just-enabled profile are sent (order-independent).
    expect([...(arg.profiles ?? [])].sort()).toEqual(['elasticsearch', 'metrics']);
  });
});
