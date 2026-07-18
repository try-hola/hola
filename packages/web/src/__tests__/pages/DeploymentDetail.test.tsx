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
};

vi.mock('../../utils/api-hybrid', () => ({
  api: {
    deployments: deploymentsApi,
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

describe('DeploymentDetail Connect card (#356)', () => {
  const connectDeployment: GetDeploymentResponse = { ...deployment, url: 'https://remo.example.com' };
  const connectConfig: GetDeploymentConfigResponse = {
    appEnv: [{ key: 'REMO_WEB_API_TOKEN', value: 'secret-token-xyz', isSecret: true, label: 'Adoption API Token' }],
    systemOverrides: {},
    connect: { keyEnv: 'REMO_WEB_API_TOKEN', label: 'Adopt this instance', help: 'REMO_API_TOKEN={code} remo web adopt {url}' },
  };

  beforeEach(() => {
    deploymentsApi.byId.mockResolvedValue(connectDeployment);
    deploymentsApi.config.mockResolvedValue(connectConfig);
  });
  afterEach(() => {
    // Restore the module-level mocks so other suites see the defaults.
    deploymentsApi.byId.mockImplementation(async () => deployment);
    deploymentsApi.config.mockImplementation(async () => config);
  });

  function renderOverview() {
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/deployments/${deploymentId}?tab=overview`]}>
          <Routes>
            <Route path="/deployments/:deploymentId" element={<DeploymentDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it('shows the URL, a revealable code, and help with {url}/{code} filled', async () => {
    renderOverview();

    // Scope assertions to the Connect card (the URL also appears in the header).
    await waitFor(() => expect(screen.getByText('Adopt this instance')).toBeInTheDocument());
    const card = within(screen.getByText('Adopt this instance').parentElement as HTMLElement);
    expect(card.getByText('https://remo.example.com')).toBeInTheDocument();

    // The code is masked until revealed (not in the card as plaintext yet).
    expect(card.queryByText('secret-token-xyz')).not.toBeInTheDocument();

    // Reveal exposes the code, and the help line fills {code}/{url}.
    fireEvent.click(card.getByRole('button', { name: /reveal code/i }));
    expect(card.getByText('secret-token-xyz')).toBeInTheDocument();
    expect(card.getByText(/remo web adopt https:\/\/remo\.example\.com/)).toBeInTheDocument();
  });
});
