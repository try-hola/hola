import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { GetDeploymentResponse, GetDeploymentConfigResponse } from '@hola/shared';
import { globalCache } from '../../utils/cache';

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

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={[`/deployments/${deploymentId}?tab=configuration`]}>
      <Routes>
        <Route path="/deployments/:deploymentId" element={<DeploymentDetail />} />
      </Routes>
    </MemoryRouter>
  );
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
