/**
 * End-to-end recovery smoke test — mock mode (#18).
 *
 * Drives the full supported product workflow through the public HTTP API with
 * mock services (fast, hermetic, runs in the default `bun test`):
 *
 *   catalog → draft → configure → validate → preflight → finalize →
 *   deployment create → list / detail / history
 *
 * The goal is a single high-signal path proving one app can be installed and
 * remains consistently manageable across the list/detail/history surfaces from
 * one state source — not a re-test of each unit. The conditional real-service
 * variant (restart recovery + real Docker) lives in
 * integration/smoke-workflow.it.ts.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import type {
  GetCatalogAppsResponse,
  CreateDraftResponse,
  PatchDraftResponse,
  ValidateDraftResponse,
  EnhancedPreflightResponse,
  FinalizeDraftResponse,
  CreateDeploymentFromDraftResponse,
  GetDeploymentsResponse,
  GetDeploymentResponse,
  GetDeploymentHistoryResponse,
} from '@hola/shared';
import { setupTestServer, teardownTestServer } from '../utils/bun-server';
import { makeRequest } from '../utils/phase7-helpers';

const baseURL = 'http://localhost:3001';

describe('Smoke: full install workflow (mock mode)', () => {
  beforeAll(async () => {
    await setupTestServer(3001, { NODE_ENV: 'test' });
  });

  afterAll(async () => {
    await teardownTestServer();
  });

  test('catalog → draft → validate → preflight → finalize → deploy → list/detail/history', async () => {
    // 1. Catalog: pick an app to install.
    const catalog = await makeRequest<GetCatalogAppsResponse>({
      method: 'GET',
      url: `${baseURL}/api/catalog/apps?page=1&limit=10`,
    });
    expect(catalog.success).toBe(true);
    const appId = catalog.data!.items[0]?.id ?? 'nextcloud';

    // 2. Draft: create from the catalog app.
    const draft = await makeRequest<CreateDraftResponse>({
      method: 'POST',
      url: `${baseURL}/api/drafts`,
      body: { appId, version: '1.0.0' },
    });
    expect(draft.success).toBe(true);
    const draftId = draft.data!.draftId;

    // 3. Configure: set an app env var.
    const patch = await makeRequest<PatchDraftResponse>({
      method: 'PATCH',
      url: `${baseURL}/api/drafts/${draftId}`,
      body: { appEnv: [{ key: 'LOG_LEVEL', value: 'info', isSecret: false }] },
    });
    expect(patch.success).toBe(true);
    expect(patch.data!.ok).toBe(true);

    // 4. Validate.
    const validate = await makeRequest<ValidateDraftResponse>({
      method: 'POST',
      url: `${baseURL}/api/drafts/${draftId}/validate`,
    });
    expect(validate.success).toBe(true);
    expect(validate.data!.ok).toBe(true);

    // 5. Preflight.
    const preflight = await makeRequest<EnhancedPreflightResponse>({
      method: 'POST',
      url: `${baseURL}/api/drafts/${draftId}/preflight`,
    });
    expect(preflight.success).toBe(true);
    expect(preflight.data!.ok).toBe(true);

    // 6. Finalize: immutable spec + checksum.
    const finalize = await makeRequest<FinalizeDraftResponse>({
      method: 'POST',
      url: `${baseURL}/api/drafts/${draftId}/finalize`,
    });
    expect(finalize.success).toBe(true);
    expect(typeof finalize.data!.checksum).toBe('string');
    expect(finalize.data!.checksum.length).toBeGreaterThan(0);

    // 7. Deployment: create from the finalized draft.
    const deployment = await makeRequest<CreateDeploymentFromDraftResponse>({
      method: 'POST',
      url: `${baseURL}/api/deployments`,
      body: { draftId, name: 'smoke-app' },
    });
    expect(deployment.success).toBe(true);
    const deploymentId = deployment.data!.deploymentId;
    expect(deploymentId).toBeDefined();
    expect(deployment.data!.releaseId).toBeDefined();

    // 8. Detail: the deployment is retrievable and named as requested.
    const detail = await makeRequest<GetDeploymentResponse>({
      method: 'GET',
      url: `${baseURL}/api/deployments/${deploymentId}`,
    });
    expect(detail.success).toBe(true);
    expect(detail.data!.id).toBe(deploymentId);
    expect(detail.data!.name).toBe('smoke-app');

    // 9. List: the same record is present with a consistent status (one source).
    const list = await makeRequest<GetDeploymentsResponse>({
      method: 'GET',
      url: `${baseURL}/api/deployments?page=1&limit=100`,
    });
    expect(list.success).toBe(true);
    const listed = list.data!.items.find((d) => d.id === deploymentId);
    expect(listed).toBeDefined();
    expect(listed!.status).toBe(detail.data!.status);

    // 10. History: the deployment has at least its creation/release recorded.
    const history = await makeRequest<GetDeploymentHistoryResponse>({
      method: 'GET',
      url: `${baseURL}/api/deployments/${deploymentId}/history`,
    });
    expect(history.success).toBe(true);
    expect(history.data!.total).toBeGreaterThanOrEqual(1);
  });

  test('a created deployment can be stopped and the state is reflected consistently', async () => {
    // Create via the same path, then exercise a lifecycle action end-to-end.
    const draft = await makeRequest<CreateDraftResponse>({
      method: 'POST',
      url: `${baseURL}/api/drafts`,
      body: { appId: 'nextcloud', version: '1.0.0' },
    });
    const draftId = draft.data!.draftId;
    await makeRequest({ method: 'POST', url: `${baseURL}/api/drafts/${draftId}/finalize` });

    const deployment = await makeRequest<CreateDeploymentFromDraftResponse>({
      method: 'POST',
      url: `${baseURL}/api/deployments`,
      body: { draftId, name: 'smoke-stop' },
    });
    const deploymentId = deployment.data!.deploymentId;

    const action = await makeRequest<{ ok: boolean; jobId?: string }>({
      method: 'POST',
      url: `${baseURL}/api/deployments/${deploymentId}/actions`,
      body: { action: 'stop' },
    });
    expect(action.success).toBe(true);

    const detail = await makeRequest<GetDeploymentResponse>({
      method: 'GET',
      url: `${baseURL}/api/deployments/${deploymentId}`,
    });
    expect(detail.data!.status).toBe('stopped');
  });
});
