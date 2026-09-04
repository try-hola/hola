import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GetDeploymentResponse, GetDeploymentConfigResponse, SSEEvent, SSEConnectionState } from '@hola/shared';
import { globalCache } from '../../utils/cache';
import { handleGlobalEvent, useGlobalQueryEvents } from '../../state/useGlobalQueryEvents';

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

vi.mock('../../utils/api-hybrid', () => ({
  api: {
    deployments: deploymentsApi,
    catalog: catalogApi,
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

// #428: release channels — Channel/Instance facts and the update dialog's
// channel-aware target line. The "Details" facts card only renders on the
// Overview tab (renderTabContent's default), so these use their own render
// helper rather than `renderDetail`'s `?tab=configuration` entry.
describe('DeploymentDetail release channels (#428)', () => {
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

  afterEach(() => {
    deploymentsApi.byId.mockResolvedValue(deployment); // restore the module default
  });

  it('shows the Channel fact, defaulting to stable when absent', async () => {
    deploymentsApi.byId.mockResolvedValue({ ...deployment });
    renderOverview();
    await waitFor(() => expect(screen.getByText('Channel')).toBeInTheDocument());
    expect(screen.getByText('stable')).toBeInTheDocument();
    expect(screen.queryByText('Instance')).not.toBeInTheDocument();
  });

  it('shows Channel: rc and Instance: rc copy of <app> for instanceReason "channel"', async () => {
    deploymentsApi.byId.mockResolvedValue({ ...deployment, channel: 'rc', instanceReason: 'channel' });
    renderOverview();
    await waitFor(() => expect(screen.getByText('Channel')).toBeInTheDocument());
    expect(screen.getByText('rc')).toBeInTheDocument();
    expect(screen.getByText('Instance')).toBeInTheDocument();
    expect(screen.getByText(`rc copy of ${deployment.app}`)).toBeInTheDocument();
  });

  it('shows "additional copy (operator override)" for instanceReason "operator-override"', async () => {
    deploymentsApi.byId.mockResolvedValue({ ...deployment, channel: 'rc', instanceReason: 'operator-override' });
    renderOverview();
    await waitFor(() => expect(screen.getByText('Instance')).toBeInTheDocument());
    expect(screen.getByText('additional copy (operator override)')).toBeInTheDocument();
  });

  it('appends the target channel to the upgrade dialog title when non-stable', async () => {
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
    const openBtn = await screen.findByRole('button', { name: /upgrade to 1\.1\.0-rc\.2/i });
    fireEvent.click(openBtn);
    await waitFor(() => expect(screen.getByText(/Upgrade My App to 1\.1\.0-rc\.2 \(rc\)\?/)).toBeInTheDocument());
  });

  it('the Channel select renders the app\'s declared channels and PATCHes on change', async () => {
    deploymentsApi.byId.mockResolvedValue({ ...deployment, channel: 'stable' });
    deploymentsApi.update.mockResolvedValueOnce({ ok: true as const });
    renderDetail();

    const select = await screen.findByDisplayValue('stable');
    // The second arg is the catalog source; DeploymentDetail has none to pass
    // (the deployment API doesn't surface it), so the default `hola` applies.
    await waitFor(() => expect(catalogApi.appById).toHaveBeenCalledWith('myapp', undefined));
    // Both catalog-declared channels are offered.
    expect(within(select as HTMLSelectElement).getByRole('option', { name: 'rc' })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'rc' } });
    await waitFor(() => expect(deploymentsApi.update).toHaveBeenCalledWith(deploymentId, { channel: 'rc' }));
  });

  it('a channel change invalidates the detail/list/update-check queries (refetches byId)', async () => {
    deploymentsApi.byId.mockResolvedValue({ ...deployment, channel: 'stable' });
    deploymentsApi.update.mockResolvedValueOnce({ ok: true as const });
    renderDetail();

    const select = await screen.findByDisplayValue('stable');
    const callsBefore = deploymentsApi.byId.mock.calls.length;
    fireEvent.change(select, { target: { value: 'rc' } });
    await waitFor(() => expect(deploymentsApi.update).toHaveBeenCalled());
    // `onSuccess` invalidates the detail query, which refetches while mounted.
    await waitFor(() => expect(deploymentsApi.byId.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it('shows a returned warning as a transient notice', async () => {
    deploymentsApi.byId.mockResolvedValue({ ...deployment, channel: 'stable' });
    deploymentsApi.update.mockResolvedValueOnce({
      ok: true as const,
      warnings: ["Another single-instance copy of 'myapp' already follows channel 'rc'."],
    });
    renderDetail();

    const select = await screen.findByDisplayValue('stable');
    fireEvent.change(select, { target: { value: 'rc' } });
    await waitFor(() => expect(screen.getByText(/already follows channel 'rc'/)).toBeInTheDocument());
  });
});
