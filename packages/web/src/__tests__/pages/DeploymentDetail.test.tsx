import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GetDeploymentResponse, GetDeploymentConfigResponse, SSEEvent, SSEConnectionState } from '@hola/shared';
import { globalCache } from '../../utils/cache';
import { handleGlobalEvent, useGlobalQueryEvents } from '../../state/useGlobalQueryEvents';
import { mockFetch, createMockResponse } from '../../setupTests';

// `useGlobalQueryEvents` (mounted alongside `DeploymentDetail` below so T018 can
// exercise the real deletion→redirect chain) drives itself off `useSSE`. Mock it
// the same way `state/__tests__/useGlobalQueryEvents.test.ts` does: capture the
// `onEvent` callback so a test can hand it a simulated SSE event directly.
let capturedOnEvent: ((event: SSEEvent) => void) | null = null;

vi.mock('../../hooks/useSSE', () => ({
  useSSE: (_url: string, onEvent: (event: SSEEvent) => void) => {
    capturedOnEvent = onEvent;
    return {
      connectionState: 'connected' as SSEConnectionState,
      lastEvent: null,
      error: null,
      reconnectAttempt: 0,
      events: [],
      connect: () => {},
      disconnect: () => {},
      isConnected: true,
    };
  },
}));

// De-stubbed Configuration tab (declarative-drifting-tiger PR 5): the tab used
// to render hardcoded Nextcloud-flavored placeholder rows regardless of which
// deployment was open. It should now render the real per-deployment config
// from GET /api/deployments/:id/config via ParamField, and Save should call
// the real PATCH with the edited rows.

const deploymentId = 'myapp-abc123';

const deployment: GetDeploymentResponse = {
  id: deploymentId,
  name: 'My App',
  app: 'myapp',
  icon: '📦',
  status: 'running',
  version: '1.0.0',
  resources: { cpu: '5%', memory: '64MB' },
  ports: [],
  lastUpdated: new Date().toISOString(),
};

const config: GetDeploymentConfigResponse = {
  appEnv: [
    {
      key: 'MAX_CONNECTIONS',
      value: '10',
      isSecret: false,
      type: 'integer',
      min: 1,
      max: 100,
      label: 'Max connections',
    },
    { key: 'ADMIN_USER', value: 'admin', isSecret: false },
  ],
  systemOverrides: { CUSTOM_DOMAIN: 'app.example.com' },
};

const deploymentsApi = {
  byId: vi.fn(async () => deployment),
  config: vi.fn(async () => config),
  update: vi.fn(async () => ({ ok: true as const })),
  history: vi.fn(async () => ({ items: [], page: 1, limit: 10, total: 0 })),
  action: vi.fn(),
  promote: vi.fn(),
  remove: vi.fn(),
  updateCheck: vi.fn(),
};

// #428: DeploymentDetail's Channel select reads the app's declared channels.
const catalogApi = {
  appById: vi.fn(async () => ({
    id: 'myapp', name: 'My App', description: '', icon: '📦', category: 'apps',
    rating: 0, downloads: 0, tags: [], featured: false, source: 'hola', trust: 'verified' as const,
    channels: ['stable', 'rc'],
  })),
};

const contractsApi = {
  list: vi.fn(async () => ({ items: [] })),
};

vi.mock('../../utils/api-hybrid', () => ({
  api: {
    deployments: deploymentsApi,
    catalog: catalogApi,
    contracts: contractsApi,
  },
}));

// Imported after the mock so DeploymentDetail picks up the mocked api-hybrid.
const { DeploymentDetail } = await import('../../pages/DeploymentDetail');

// Mounted alongside `DeploymentDetail` so the real deletion→redirect chain
// (SSE event -> useGlobalQueryEvents -> handleGlobalEvent -> notifyDeploymentDeleted
// -> the page's subscribeDeploymentDeleted callback) can be exercised end to end,
// same as production (both are mounted under AppShell there).
function GlobalEventsMount() {
  useGlobalQueryEvents();
  return null;
}

// The list route the page redirects to on deletion-while-viewing (T018);
// surfaces `location.state.notice` so tests can assert its content.
function DeploymentsListSentinel() {
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;
  return (
    <div>
      Deployments List
      {notice && <div data-testid="notice">{notice}</div>}
    </div>
  );
}

// Accepts an existing `QueryClient` (T009/T018 need to call `handleGlobalEvent`
// against the SAME client the mounted component reads from) and always returns
// the one actually used, alongside the render result. A `/deployments` route
// with a sentinel is included so tests can assert a redirect landed there.
function renderDetail(queryClient: QueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <GlobalEventsMount />
      <MemoryRouter initialEntries={[`/deployments/${deploymentId}?tab=configuration`]}>
        <Routes>
          <Route path="/deployments/:deploymentId" element={<DeploymentDetail />} />
          <Route path="/deployments" element={<DeploymentsListSentinel />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { ...utils, queryClient };
}

beforeEach(() => {
  globalCache.clear();
  deploymentsApi.byId.mockClear();
  deploymentsApi.config.mockClear();
  deploymentsApi.update.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('DeploymentDetail Configuration tab', () => {
  it('renders the real per-deployment config (read-only view), not hardcoded placeholder rows', async () => {
    renderDetail();

    // Read-only view renders label + value as text, not form inputs.
    await waitFor(() => expect(screen.getByText('Max connections')).toBeInTheDocument());
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('ADMIN_USER')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();

    // The old Nextcloud-flavored placeholder data must be gone.
    expect(screen.queryByText('POSTGRES_DB')).not.toBeInTheDocument();
    expect(screen.queryByText('NEXTCLOUD_ADMIN_PASSWORD')).not.toBeInTheDocument();

    // Real system overrides render too (an arbitrary operator-set map, not the
    // old fixed platform-wide var list).
    expect(screen.getByText('CUSTOM_DOMAIN')).toBeInTheDocument();
    expect(screen.getByText('app.example.com')).toBeInTheDocument();
  });

  it('saves edited values via the real PATCH endpoint', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText('ADMIN_USER')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /edit configuration/i }));

    const adminInput = await screen.findByDisplayValue('admin');
    fireEvent.change(adminInput, { target: { value: 'root' } });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(deploymentsApi.update).toHaveBeenCalledTimes(1));
    const [calledId, payload] = deploymentsApi.update.mock.calls[0];
    expect(calledId).toBe(deploymentId);
    expect(payload.env.find((e: { key: string }) => e.key === 'ADMIN_USER').value).toBe('root');
    // A pure edit (nothing deleted) sends no removeEnvKeys — merge-by-key leaves
    // every omitted var untouched, so there's nothing to delete.
    expect(payload.removeEnvKeys).toBeUndefined();
  });

  it('sends removeEnvKeys for a var deleted from the working copy (merge-by-key, #332)', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText('ADMIN_USER')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /edit configuration/i }));

    // ADMIN_USER is a specless (custom) row, so it has a remove button. Delete it.
    const removeBtn = await screen.findByRole('button', { name: /remove custom variable/i });
    fireEvent.click(removeBtn);

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(deploymentsApi.update).toHaveBeenCalledTimes(1));
    const [, payload] = deploymentsApi.update.mock.calls[0];
    // The deletion is stated explicitly now, not expressed by omission.
    expect(payload.removeEnvKeys).toEqual(['ADMIN_USER']);
    expect(payload.env.some((e: { key: string }) => e.key === 'ADMIN_USER')).toBe(false);
    // The var still in the form is upserted (and untouched vars survive server-side).
    expect(payload.env.some((e: { key: string }) => e.key === 'MAX_CONNECTIONS')).toBe(true);
  });

  it('blocks saving an out-of-range typed value client-side without calling the API', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText('Max connections')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /edit configuration/i }));

    const maxConnInput = await screen.findByDisplayValue('10');
    fireEvent.change(maxConnInput, { target: { value: '9999' } });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(screen.getByText(/must be between/i)).toBeInTheDocument());
    expect(deploymentsApi.update).not.toHaveBeenCalled();
  });

  it('collapses autoDetected (compose-harvested, unlabeled) rows behind an Advanced toggle', async () => {
    deploymentsApi.config.mockResolvedValueOnce({
      appEnv: [
        ...config.appEnv,
        { key: 'GITEA__server__HTTP_PORT', value: '3000', isSecret: false, autoDetected: true },
      ],
      systemOverrides: config.systemOverrides,
    });
    renderDetail();

    await waitFor(() => expect(screen.getByText('ADMIN_USER')).toBeInTheDocument());
    // Hidden until the operator expands Advanced.
    expect(screen.queryByText('GITEA__server__HTTP_PORT')).not.toBeInTheDocument();
    expect(screen.getByText('Advanced (1)')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Advanced (1)'));
    expect(screen.getByText('GITEA__server__HTTP_PORT')).toBeInTheDocument();
  });
});

describe('DeploymentDetail live updates (T009)', () => {
  it('re-renders the new status from a deployment_update event patched onto the same QueryClient the page reads from, with no page remount', async () => {
    const { queryClient } = renderDetail();

    await waitFor(() => expect(screen.getByText('Running')).toBeInTheDocument());

    // An identifier that would be a *different* DOM node after a remount —
    // used below to confirm this is the same component instance, just re-rendered.
    const appNameEl = screen.getByText('My App');

    // `handleGlobalEvent`'s `deployment_update` branch both (a) patches the
    // cached detail directly via `setQueryData` and (b) invalidates the whole
    // `deployments` family, which — since this detail query is actively
    // mounted — triggers a background revalidation refetch (the
    // "server-confirmed" model per the 2026-07-06 clarification). Have that
    // refetch agree with the new status so the settled UI state is
    // deterministic regardless of which of the two mechanisms wins the race.
    deploymentsApi.byId.mockResolvedValueOnce({
      ...deployment,
      status: 'stopped',
      uptime: '0s',
    });

    act(() => {
      handleGlobalEvent(queryClient, {
        type: 'deployment_update',
        data: {
          deploymentId,
          status: 'stopped',
          uptime: '0s',
          lastUpdated: new Date(Date.now() + 1000).toISOString(),
        },
      });
    });

    await waitFor(() => expect(screen.getByText('Stopped')).toBeInTheDocument());
    expect(screen.queryByText('Running')).not.toBeInTheDocument();
    // Same component instance, not a remount.
    expect(screen.getByText('My App')).toBe(appNameEl);
  });
});

describe('DeploymentDetail deletion-while-viewing redirect (T018)', () => {
  beforeEach(() => {
    capturedOnEvent = null;
  });

  it('navigates to the deployments list and carries a "removed" notice when the viewed deployment is deleted elsewhere', async () => {
    renderDetail();

    await waitFor(() => expect(screen.getByText('Running')).toBeInTheDocument());
    expect(capturedOnEvent).not.toBeNull();

    // Simulate the global `/api/events` stream delivering a `deployment_deleted`
    // for THIS deployment — the same path the real SSE connection drives via
    // `useGlobalQueryEvents` -> `handleGlobalEvent` -> `notifyDeploymentDeleted`
    // -> the page's own `subscribeDeploymentDeleted` callback.
    act(() => {
      capturedOnEvent!({ type: 'deployment_deleted', data: { deploymentId } });
    });

    await waitFor(() => expect(screen.getByText('Deployments List')).toBeInTheDocument());
    expect(screen.getByTestId('notice')).toHaveTextContent('My App was removed');
  });

  it('ignores a deployment_deleted event for a different id (stays on the detail page)', async () => {
    renderDetail();

    await waitFor(() => expect(screen.getByText('Running')).toBeInTheDocument());
    expect(capturedOnEvent).not.toBeNull();

    act(() => {
      capturedOnEvent!({ type: 'deployment_deleted', data: { deploymentId: 'some-other-deployment' } });
    });

    // Give any (incorrect) navigation a chance to happen, then assert it didn't.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('Deployments List')).not.toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
  });
});

// #299: the deployment detail page pulls the richer, on-demand update check and
// the upgrade dialog states what kind of update it is (safe bump vs. guided
// multi-step) instead of a bare confirmation. Appended last so the byId/promote
// impl overrides below don't leak into the earlier describes.
describe('DeploymentDetail richer update check (#299)', () => {
  const updatable: GetDeploymentResponse = {
    ...deployment,
    version: '1.0.0',
    updateAvailable: true,
    latestVersion: '2.0.0',
  };

  beforeEach(() => {
    deploymentsApi.byId.mockResolvedValue(updatable);
    deploymentsApi.promote.mockResolvedValue({ deploymentId, releaseId: 'r1', jobId: 'j1' });
    deploymentsApi.updateCheck.mockReset();
  });

  it('surfaces a guided (waypoint) upgrade and promotes to the next safe version', async () => {
    deploymentsApi.updateCheck.mockResolvedValue({
      installedVersion: '1.0.0',
      latestVersion: '2.0.0',
      updateAvailable: true,
      breaking: true,
      preUpgradeBackup: 'required',
      upgradeNotesUrl: 'https://notes.example/v2',
      path: { ok: false, code: 'waypoint-required', suggestedVersion: '1.5.0', message: 'Must pass through 1.5.0 first.' },
    });
    renderDetail();

    // Open the upgrade dialog from the header action ("Upgrade to 2.0.0").
    const openBtn = await screen.findByRole('button', { name: /upgrade to 2\.0\.0/i });
    fireEvent.click(openBtn);

    // Once the on-demand check resolves, the dialog states what kind of upgrade
    // this is — guided (waypoint) + breaking — instead of a bare confirmation.
    await waitFor(() => expect(screen.getByText('Guided upgrade')).toBeInTheDocument());
    expect(screen.getByText('Must pass through 1.5.0 first.')).toBeInTheDocument();
    expect(screen.getByText(/Breaking change/i)).toBeInTheDocument();
    const notes = screen.getByRole('link', { name: /review the upgrade notes/i });
    expect(notes).toHaveAttribute('href', 'https://notes.example/v2');

    // The confirm button targets the next safe waypoint version, not latest.
    const confirm = await screen.findByRole('button', { name: /^upgrade to 1\.5\.0$/i });
    fireEvent.click(confirm);
    await waitFor(() => expect(deploymentsApi.promote).toHaveBeenCalledWith(deploymentId, { version: '1.5.0' }));
  });

  it('a clean bump shows no warnings and promotes straight to latest', async () => {
    deploymentsApi.updateCheck.mockResolvedValue({
      installedVersion: '1.0.0',
      latestVersion: '2.0.0',
      updateAvailable: true,
      preUpgradeBackup: 'recommended',
      path: { ok: true },
    });
    renderDetail();

    const openBtn = await screen.findByRole('button', { name: /upgrade to 2\.0\.0/i });
    fireEvent.click(openBtn);

    // The dialog resolves the check (recommended-backup copy appears) but shows
    // neither a guided-upgrade nor a breaking warning.
    await waitFor(() => expect(screen.getByText(/pre-upgrade snapshot is recommended/i)).toBeInTheDocument());
    expect(screen.queryByText('Guided upgrade')).not.toBeInTheDocument();
    expect(screen.queryByText(/Breaking change/i)).not.toBeInTheDocument();

    // Scope to the dialog: the header action shares the "Upgrade to 2.0.0" label.
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: /^upgrade to 2\.0\.0$/i });
    fireEvent.click(confirm);
    // Straight-to-latest: promote with no explicit version.
    await waitFor(() => expect(deploymentsApi.promote).toHaveBeenCalledWith(deploymentId, undefined));
  });

  it('never calls update-check when no update is available', async () => {
    deploymentsApi.byId.mockResolvedValue(deployment); // updateAvailable unset
    renderDetail();
    await waitFor(() => expect(screen.getByText('My App')).toBeInTheDocument());
    // Give the (disabled) query a chance to (not) fire.
    await new Promise((r) => setTimeout(r, 0));
    expect(deploymentsApi.updateCheck).not.toHaveBeenCalled();
  });
});

// Spec 005 (beta-channel-ux): the Channel block replaces the old #428/#433
// Channel/Instance facts and the Configuration-tab "Release channel" select
// with Join/Leave actions, a shared ChannelPill, sibling sentences and a
// separate-copy link, gated on `usePrereleaseEnrolment()`. The "Details" facts
// card and the new Channel block only render on the Overview tab
// (renderTabContent's default), so most of these use their own render helper
// rather than `renderDetail`'s `?tab=configuration` entry.
describe('DeploymentDetail release channels (spec 005)', () => {
  function renderOverview() {
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <GlobalEventsMount />
        <MemoryRouter initialEntries={[`/deployments/${deploymentId}`]}>
          <Routes>
            <Route path="/deployments/:deploymentId" element={<DeploymentDetail />} />
            <Route path="/deployments" element={<DeploymentsListSentinel />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  // `usePrereleaseEnrolment()` reads through `useSettingsApi()`, which hits
  // real `fetch` (not the `api-hybrid` mock used for deployments/catalog/
  // contracts above) — mirrors the `mockFetch`-stubbing convention already
  // used by Catalog.test.tsx / Deployments.test.tsx for `/api/settings`.
  let enrolledForTest = false;
  function setEnrolled(value: boolean) {
    enrolledForTest = value;
  }

  beforeEach(() => {
    enrolledForTest = false;
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/settings')) {
        return createMockResponse({ channels: { showPrerelease: enrolledForTest } });
      }
      return createMockResponse({});
    });
  });

  afterEach(() => {
    deploymentsApi.byId.mockResolvedValue(deployment); // restore the module default
    // Restore the generic default so later describes (which never touch real
    // fetch anyway, but shouldn't inherit this describe's enrolment stub).
    mockFetch.mockImplementation(async () => createMockResponse({}));
  });

  // --- Channel block text: the four (followed, running-build) states + the
  // unknown-build edge case. `pillFor`'s exact logic (ChannelPill.test.tsx) is
  // the source of truth for which pill (if any) each state shows.
  describe('Follows/Running facts and the pill (FR-006, FR-010)', () => {
    it('stable track, stable build: no pill', async () => {
      deploymentsApi.byId.mockResolvedValue({ ...deployment, channel: 'stable', versionChannel: 'stable' });
      renderOverview();
      await waitFor(() => expect(screen.getByText('Follows: stable')).toBeInTheDocument());
      expect(screen.getByText('Running 1.0.0, a stable build')).toBeInTheDocument();
      expect(screen.queryByTitle(/Follows the .* channel/)).not.toBeInTheDocument();
      expect(screen.queryByTitle(/Running a .* build/)).not.toBeInTheDocument();
    });

    it('beta(rc) track, stable build: follows-pill, Leave offered, no downgrade text', async () => {
      deploymentsApi.byId.mockResolvedValue({ ...deployment, channel: 'rc', versionChannel: 'stable' });
      renderOverview();
      await waitFor(() => expect(screen.getByText('Follows: rc')).toBeInTheDocument());
      expect(screen.getByText('Running 1.0.0, a stable build')).toBeInTheDocument();
      const pill = screen.getByTitle('Follows the rc channel');
      expect(pill).toHaveTextContent('rc');
      expect(screen.getByRole('button', { name: 'Leave rc' })).toBeInTheDocument();
    });

    it('rc track, rc build: build-pill', async () => {
      deploymentsApi.byId.mockResolvedValue({
        ...deployment, version: '1.1.0-rc.1', channel: 'rc', versionChannel: 'rc',
      });
      renderOverview();
      await waitFor(() => expect(screen.getByText('Follows: rc')).toBeInTheDocument());
      expect(screen.getByText('Running 1.1.0-rc.1, a rc build')).toBeInTheDocument();
      expect(screen.getByTitle('Running a rc build')).toHaveTextContent('rc');
    });

    it('stable track, rc build (leaving rc): build-pill, no Leave (already stable)', async () => {
      deploymentsApi.byId.mockResolvedValue({
        ...deployment, version: '1.1.0-rc.1', channel: 'stable', versionChannel: 'rc',
      });
      renderOverview();
      await waitFor(() => expect(screen.getByText('Follows: stable')).toBeInTheDocument());
      expect(screen.getByText('Running 1.1.0-rc.1, a rc build')).toBeInTheDocument();
      expect(screen.getByTitle('Running a rc build')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Leave/ })).not.toBeInTheDocument();
    });

    it('unknown build channel: version alone, pill falls back to the followed channel', async () => {
      deploymentsApi.byId.mockResolvedValue({ ...deployment, channel: 'rc', versionChannel: undefined });
      renderOverview();
      await waitFor(() => expect(screen.getByText('Follows: rc')).toBeInTheDocument());
      expect(screen.getByText('Running 1.0.0')).toBeInTheDocument();
      expect(screen.queryByText(/Running 1\.0\.0,/)).not.toBeInTheDocument();
      expect(screen.getByTitle('Follows the rc channel')).toHaveTextContent('rc');
    });
  });

  // --- US1 (T018): enrolment off never hides an EXISTING non-stable copy's
  // pill/Leave/channel-block; it only gates discovery (Join, the separate-copy
  // link). These must keep passing through every later rewrite in this file.
  describe('not enrolled (US1): existing pill/Leave survive, discovery stays hidden', () => {
    it('a copy following rc keeps its pill and Leave action with enrolment off', async () => {
      setEnrolled(false);
      catalogApi.appById.mockResolvedValueOnce({
        id: 'myapp', name: 'My App', description: '', icon: '📦', category: 'apps',
        rating: 0, downloads: 0, tags: [], featured: false, source: 'hola', trust: 'verified' as const,
        channels: ['stable', 'rc', 'beta'],
      });
      deploymentsApi.byId.mockResolvedValue({ ...deployment, channel: 'rc', versionChannel: 'rc' });
      renderOverview();

      await waitFor(() => expect(screen.getByText('Follows: rc')).toBeInTheDocument());
      expect(screen.getByTitle('Running a rc build')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Leave rc' })).toBeInTheDocument();

      // Discovery stays hidden: no Join for the OTHER published channel, no
      // separate-copy link, regardless of enrolment.
      expect(screen.queryByRole('button', { name: 'Join beta' })).not.toBeInTheDocument();
      expect(screen.queryByText(/Try beta in a separate copy/)).not.toBeInTheDocument();
    });
  });

  // --- US2 (T025): Join/Leave gating, confirm-dialog copy, the PATCH call and
  // query invalidation, and the warning surfacing through TransientNotice.
  describe('Join / Leave a channel (US2)', () => {
    it('Join is offered per published non-stable channel not already followed, only when enrolled', async () => {
      setEnrolled(true);
      deploymentsApi.byId.mockResolvedValue({ ...deployment, channel: 'stable', versionChannel: 'stable' });
      renderOverview();
      await waitFor(() => expect(screen.getByText('Follows: stable')).toBeInTheDocument());
      // Enrolment resolves through its own async settings fetch, independent of
      // the deployment fetch that gates "Follows: stable" above — wait for it.
      expect(await screen.findByRole('button', { name: 'Join rc' })).toBeInTheDocument();
      // `stable` is never a Join target (it's the floor).
      expect(screen.queryByRole('button', { name: 'Join stable' })).not.toBeInTheDocument();
    });

    it('Join is absent when not enrolled, even though the channel is published', async () => {
      setEnrolled(false);
      deploymentsApi.byId.mockResolvedValue({ ...deployment, channel: 'stable', versionChannel: 'stable' });
      renderOverview();
      await waitFor(() => expect(screen.getByText('Follows: stable')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: 'Join rc' })).not.toBeInTheDocument();
    });

    it('Leave is offered regardless of enrolment when the copy follows a non-stable channel', async () => {
      setEnrolled(false);
      deploymentsApi.byId.mockResolvedValue({ ...deployment, channel: 'rc', versionChannel: 'rc' });
      renderOverview();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Leave rc' })).toBeInTheDocument());
    });

    it('Join opens a confirm dialog with the exact copy, and confirming PATCHes the channel', async () => {
      setEnrolled(true);
      deploymentsApi.byId.mockResolvedValue({ ...deployment, channel: 'stable', versionChannel: 'stable' });
      deploymentsApi.update.mockResolvedValueOnce({ ok: true as const });
      renderOverview();

      fireEvent.click(await screen.findByRole('button', { name: 'Join rc' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(
        'This copy will receive rc releases as well as stable ones. You can leave the channel at any time.'
      )).toBeInTheDocument();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Join rc' }));
      await waitFor(() => expect(deploymentsApi.update).toHaveBeenCalledWith(deploymentId, { channel: 'rc' }));
    });

    it('Leave dialog states the running build stays put when it is not eligible on stable', async () => {
      deploymentsApi.byId.mockResolvedValue({
        ...deployment, version: '1.3.0-rc.1', channel: 'rc', versionChannel: 'rc',
      });
      deploymentsApi.update.mockResolvedValueOnce({ ok: true as const });
      renderOverview();

      fireEvent.click(await screen.findByRole('button', { name: 'Leave rc' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(
        'This copy will receive only stable releases. Stays on 1.3.0-rc.1 until a stable release at or above it is published.'
      )).toBeInTheDocument();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Leave rc' }));
      await waitFor(() => expect(deploymentsApi.update).toHaveBeenCalledWith(deploymentId, { channel: 'stable' }));
    });

    it('Leave dialog has no "stays on" sentence when the running build is already stable', async () => {
      deploymentsApi.byId.mockResolvedValue({ ...deployment, channel: 'rc', versionChannel: 'stable' });
      renderOverview();
      fireEvent.click(await screen.findByRole('button', { name: 'Leave rc' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('This copy will receive only stable releases.')).toBeInTheDocument();
      expect(within(dialog).queryByText(/Stays on/)).not.toBeInTheDocument();
    });

    it('Leave dialog states the generic "stays on" note when the running build channel is unknown', async () => {
      deploymentsApi.byId.mockResolvedValue({ ...deployment, channel: 'rc', versionChannel: undefined });
      renderOverview();
      fireEvent.click(await screen.findByRole('button', { name: 'Leave rc' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(
        'This copy will receive only stable releases. Stays on 1.0.0 until a stable release at or above it is published.'
      )).toBeInTheDocument();
    });

    it('confirming invalidates the detail query (refetches byId)', async () => {
      deploymentsApi.byId.mockResolvedValue({ ...deployment, channel: 'rc', versionChannel: 'rc' });
      deploymentsApi.update.mockResolvedValueOnce({ ok: true as const });
      renderOverview();

      fireEvent.click(await screen.findByRole('button', { name: 'Leave rc' }));
      const dialog = await screen.findByRole('dialog');
      const callsBefore = deploymentsApi.byId.mock.calls.length;
      fireEvent.click(within(dialog).getByRole('button', { name: 'Leave rc' }));
      await waitFor(() => expect(deploymentsApi.update).toHaveBeenCalled());
      await waitFor(() => expect(deploymentsApi.byId.mock.calls.length).toBeGreaterThan(callsBefore));
    });

    it('shows a returned warning as a transient notice', async () => {
      setEnrolled(true);
      deploymentsApi.byId.mockResolvedValue({ ...deployment, channel: 'stable', versionChannel: 'stable' });
      deploymentsApi.update.mockResolvedValueOnce({
        ok: true as const,
        warnings: ["Another single-instance copy of 'myapp' already follows channel 'rc'."],
      });
      renderOverview();

      fireEvent.click(await screen.findByRole('button', { name: 'Join rc' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Join rc' }));
      await waitFor(() => expect(screen.getByText(/already follows channel 'rc'/)).toBeInTheDocument());
    });
  });

  // --- US3 (T027/T029): sibling sentences, the operator-override note, and
  // the separate-copy link.
  describe('siblings and the separate-copy link (US3)', () => {
    it('offers "Try rc in a separate copy" only when enrolled', async () => {
      setEnrolled(true);
      deploymentsApi.byId.mockResolvedValue({ ...deployment, channel: 'stable' });
      renderOverview();
      const link = await screen.findByRole('link', { name: /Try rc in a separate copy/ });
      expect(link).toHaveAttribute('href', '/catalog/myapp/install?channel=rc');
    });

    it('the separate-copy link is absent when not enrolled', async () => {
      setEnrolled(false);
      deploymentsApi.byId.mockResolvedValue({ ...deployment, channel: 'stable' });
      renderOverview();
      await waitFor(() => expect(screen.getByText('Follows: stable')).toBeInTheDocument());
      expect(screen.queryByText(/Try rc in a separate copy/)).not.toBeInTheDocument();
    });

    it('renders a sentence per sibling', async () => {
      deploymentsApi.byId.mockResolvedValue({
        ...deployment,
        channel: 'stable',
        siblings: [{ id: 'gitea-2', name: 'gitea-beta', channel: 'rc' }],
      });
      renderOverview();
      expect(await screen.findByText('gitea-beta (rc) is also installed')).toBeInTheDocument();
    });

    it('renders one sentence per sibling for two siblings', async () => {
      deploymentsApi.byId.mockResolvedValue({
        ...deployment,
        channel: 'stable',
        siblings: [
          { id: 'gitea-2', name: 'gitea-beta', channel: 'rc' },
          { id: 'gitea-3', name: 'gitea-canary', channel: 'canary' },
        ],
      });
      renderOverview();
      expect(await screen.findByText('gitea-beta (rc) is also installed')).toBeInTheDocument();
      expect(screen.getByText('gitea-canary (canary) is also installed')).toBeInTheDocument();
    });

    it('shows a muted operator-override note alongside the sibling sentence', async () => {
      deploymentsApi.byId.mockResolvedValue({
        ...deployment,
        channel: 'rc',
        instanceReason: 'operator-override',
        siblings: [{ id: 'gitea-1', name: 'gitea', channel: 'rc' }],
      });
      renderOverview();
      expect(await screen.findByText('gitea (rc) is also installed')).toBeInTheDocument();
      expect(screen.getByText('installed with operator override')).toBeInTheDocument();
    });

    it('shows no override note for instanceReason "channel", and never the phrase "permitted by channel"', async () => {
      deploymentsApi.byId.mockResolvedValue({
        ...deployment,
        channel: 'stable',
        instanceReason: 'channel',
        siblings: [{ id: 'gitea-2', name: 'gitea-beta', channel: 'rc' }],
      });
      renderOverview();
      expect(await screen.findByText('gitea-beta (rc) is also installed')).toBeInTheDocument();
      expect(screen.queryByText('installed with operator override')).not.toBeInTheDocument();
      expect(screen.queryByText(/permitted by channel/)).not.toBeInTheDocument();
    });
  });

  // --- Header upgrade button + confirm label channel suffix (FR-009).
  describe('header upgrade button + confirm label channel suffix', () => {
    it('appends the target channel to the header button, confirm label and dialog title when non-stable', async () => {
      deploymentsApi.byId.mockResolvedValue({
        ...deployment,
        channel: 'rc',
        updateAvailable: true,
        latestVersion: '1.1.0-rc.2',
        latestVersionChannel: 'rc',
      });
      deploymentsApi.updateCheck.mockResolvedValue({
        installedVersion: '1.0.0',
        latestVersion: '1.1.0-rc.2',
        latestVersionChannel: 'rc',
        updateAvailable: true,
        path: { ok: true },
      });
      renderDetail();

      // Header button carries the suffix too, not just the dialog title.
      const openBtn = await screen.findByRole('button', { name: /upgrade to 1\.1\.0-rc\.2 \(rc\)/i });
      fireEvent.click(openBtn);

      await waitFor(() => expect(screen.getByText(/Upgrade My App to 1\.1\.0-rc\.2 \(rc\)\?/)).toBeInTheDocument());
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByRole('button', { name: 'Upgrade to 1.1.0-rc.2 (rc)' })).toBeInTheDocument();
    });
  });

  // --- The old #428/#433 UI is gone: the Channel/Instance Details facts and
  // the Configuration-tab "Release channel" select.
  it('no longer shows the old Instance fact, Channel Details fact, or the Configuration-tab Release channel card', async () => {
    deploymentsApi.byId.mockResolvedValue({
      ...deployment,
      channel: 'rc',
      instanceReason: 'channel',
      siblings: [{ id: 'gitea-1', name: 'gitea', channel: 'stable' }],
    });
    renderDetail(); // ?tab=configuration
    await waitFor(() => expect(screen.getByText('Current Configuration')).toBeInTheDocument());
    expect(screen.queryByText('Release channel')).not.toBeInTheDocument();
    expect(screen.queryByText(/permitted by channel/)).not.toBeInTheDocument();
    expect(screen.queryByText(/instance of myapp/)).not.toBeInTheDocument();
    // The Details "Channel" fact label (distinct from the Channel *block*'s
    // "Follows:" line) is gone too — only the Overview tab ever showed it, and
    // this render is on Configuration, so assert on the Overview facts card
    // structure via a follow-up render.
  });

  it('the Details facts card no longer has a bare "Channel" fact label', async () => {
    deploymentsApi.byId.mockResolvedValue({ ...deployment, channel: 'rc' });
    renderOverview();
    await waitFor(() => expect(screen.getByText('App')).toBeInTheDocument()); // Details card rendered
    // The Channel block uses "Follows: rc", never a bare "Channel" label.
    expect(screen.queryByText('Channel')).not.toBeInTheDocument();
  });
});

describe('DeploymentDetail backup coverage + grants (spec 004)', () => {
  function renderBackupsTab() {
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/deployments/${deploymentId}?tab=backups`]}>
          <Routes>
            <Route path="/deployments/:deploymentId" element={<DeploymentDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  beforeEach(() => {
    globalCache.clear();
    contractsApi.list.mockClear();
  });

  it('renders "Partially covered" with the unquiesced service named, for a partial coverage judgement', async () => {
    deploymentsApi.byId.mockResolvedValueOnce({
      ...deployment,
      contracts: {
        accepts: ['backup@1'],
        hooks: ['backup@1'],
        coverage: {
          'backup@1': {
            state: 'partial',
            targeted: 1,
            recognised: 2,
            participations: [{ id: 'default', service: 'postiz-postgres' }],
            databases: ['postiz-postgres', 'temporal-postgres'],
          },
        },
      },
    });
    renderBackupsTab();

    expect(await screen.findByText('Partially covered · 1 of 2')).toBeInTheDocument();
    const service = screen.getByText('temporal-postgres');
    expect(service.tagName).toBe('CODE');
    expect(service.closest('p')).toHaveTextContent('temporal-postgres has no pre-backup hook.');
  });

  it('names every unquiesced service, joined with "and" and a plural verb', async () => {
    deploymentsApi.byId.mockResolvedValueOnce({
      ...deployment,
      contracts: {
        accepts: ['backup@1'],
        hooks: ['backup@1'],
        coverage: {
          'backup@1': {
            state: 'partial',
            targeted: 1,
            recognised: 3,
            participations: [{ id: 'default', service: 'postiz-postgres' }],
            databases: ['postiz-postgres', 'temporal-postgres', 'cache-db'],
          },
        },
      },
    });
    renderBackupsTab();

    expect(await screen.findByText('temporal-postgres')).toHaveProperty('tagName', 'CODE');
    expect(screen.getByText('cache-db').tagName).toBe('CODE');
    expect(screen.getByText('cache-db').closest('p')).toHaveTextContent(
      'temporal-postgres and cache-db have no pre-backup hook.',
    );
  });

  it('falls back to "Quiesced" from `hooks` when `coverage` is absent (older server)', async () => {
    deploymentsApi.byId.mockResolvedValueOnce({
      ...deployment,
      contracts: { accepts: ['backup@1'], hooks: ['backup@1'] },
    });
    renderBackupsTab();

    expect(await screen.findByText('Quiesced')).toBeInTheDocument();
  });

  it('shows a Grants fact naming the container-logs grant when granted', async () => {
    deploymentsApi.byId.mockResolvedValueOnce({
      ...deployment,
      contracts: { provides: ['container-logs@1'], granted: ['container-logs@1'] },
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/deployments/${deploymentId}?tab=overview`]}>
          <Routes>
            <Route path="/deployments/:deploymentId" element={<DeploymentDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByText('Grants')).toBeInTheDocument();
    expect(screen.getByText('Read the logs of every container on this host')).toBeInTheDocument();
  });

  it('shows no Grants fact when nothing is granted', async () => {
    deploymentsApi.byId.mockResolvedValueOnce({ ...deployment });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/deployments/${deploymentId}?tab=overview`]}>
          <Routes>
            <Route path="/deployments/:deploymentId" element={<DeploymentDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await screen.findByText('App'); // details card has rendered
    expect(screen.queryByText('Grants')).not.toBeInTheDocument();
  });
});

// #446: the remove confirmation is the shared `ConfirmDialog` with `danger`,
// not a hand-rolled modal — same copy, same handlers, same busy/error states.
describe('DeploymentDetail remove confirmation (#446)', () => {
  beforeEach(() => {
    deploymentsApi.byId.mockResolvedValue(deployment);
    deploymentsApi.remove.mockReset();
  });

  it('opens a danger-styled dialog with the removal copy and removes on confirm', async () => {
    deploymentsApi.remove.mockResolvedValue({ ok: true });
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /^remove$/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Remove My App?')).toBeInTheDocument();
    expect(
      within(dialog).getByText(/This permanently removes the deployment: it stops and deletes the containers/),
    ).toBeInTheDocument();

    // The destructive confirm carries ConfirmDialog's `danger` styling.
    const confirm = within(dialog).getByRole('button', { name: 'Remove' });
    expect(confirm).toHaveClass('bg-danger');

    fireEvent.click(confirm);
    await waitFor(() => expect(deploymentsApi.remove).toHaveBeenCalledWith(deploymentId));
    // Removal navigates back to the list route.
    await waitFor(() => expect(screen.getByText('Deployments List')).toBeInTheDocument());
  });

  it('keeps the dialog open and shows the failure inline when removal fails', async () => {
    deploymentsApi.remove.mockRejectedValue(new Error('teardown failed'));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /^remove$/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    expect(await within(dialog).findByText('teardown failed')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes without removing when Cancel is clicked', async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: /^remove$/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(deploymentsApi.remove).not.toHaveBeenCalled();
  });
});
