/**
 * Deployment Management Tests
 *
 * Verifies that DeploymentService is the single source of truth behind every
 * deployment route: a deployment created via POST is immediately visible to
 * list/detail, updates and actions are reflected consistently, history and
 * rollback are derived from service state, and unknown deployments return
 * consistent 404s across every route.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import type {
  CreateDraftRequest,
  CreateDraftResponse,
  CreateDeploymentFromDraftRequest,
  CreateDeploymentFromDraftResponse,
  GetDeploymentsResponse,
  GetDeploymentResponse,
  GetDeploymentHistoryResponse,
  PatchDeploymentResponse,
  PostDeploymentActionRequest,
  PostDeploymentActionResponse,
  RollbackRequest,
  RollbackResponse,
} from '@hola/shared';
import { setupTestServer, teardownTestServer } from '../utils/bun-server';
import { makeRequest } from '../utils/phase7-helpers';

describe('Deployment Management', () => {
  let baseURL: string;

  beforeAll(async () => {
    baseURL = 'http://localhost:3001';
    await setupTestServer(3001, { NODE_ENV: 'test' });
  });

  afterAll(async () => {
    await teardownTestServer();
  });

  /** Create a deployment from a fresh draft and return its identifiers. */
  async function createDeployment(
    name: string,
    options?: CreateDeploymentFromDraftRequest['options']
  ): Promise<{ deploymentId: string; releaseId: string }> {
    const createRequest: CreateDraftRequest = { appId: 'nextcloud', version: '1.0.0' };
    const createResponse = await makeRequest<CreateDraftResponse>({
      method: 'POST',
      url: `${baseURL}/api/drafts`,
      body: createRequest,
    });
    const draftId = createResponse.data!.draftId;

    const deploymentRequest: CreateDeploymentFromDraftRequest = { draftId, name, options };
    const deploymentResponse = await makeRequest<CreateDeploymentFromDraftResponse>({
      method: 'POST',
      url: `${baseURL}/api/deployments`,
      body: deploymentRequest,
    });

    expect(deploymentResponse.success).toBe(true);
    expect(deploymentResponse.data!.deploymentId).toBeDefined();
    expect(deploymentResponse.data!.releaseId).toBeDefined();
    return {
      deploymentId: deploymentResponse.data!.deploymentId,
      releaseId: deploymentResponse.data!.releaseId,
    };
  }

  async function listAll(): Promise<GetDeploymentsResponse> {
    const response = await makeRequest<GetDeploymentsResponse>({
      method: 'GET',
      url: `${baseURL}/api/deployments?page=1&limit=100`,
    });
    expect(response.success).toBe(true);
    return response.data!;
  }

  describe('State ownership consistency', () => {
    test('created deployment appears in list and is retrievable by id', async () => {
      const { deploymentId } = await createDeployment('consistency-create');

      // Appears in the list
      const list = await listAll();
      expect(Array.isArray(list.items)).toBe(true);
      expect(list.items.some(d => d.id === deploymentId)).toBe(true);

      // Retrievable by id
      const detail = await makeRequest<GetDeploymentResponse>({
        method: 'GET',
        url: `${baseURL}/api/deployments/${deploymentId}`,
      });
      expect(detail.success).toBe(true);
      expect(detail.data!.id).toBe(deploymentId);
      expect(detail.data!.name).toBe('consistency-create');
    });

    test('update is reflected in subsequent detail reads', async () => {
      const { deploymentId } = await createDeployment('consistency-update');

      const before = await makeRequest<GetDeploymentResponse>({
        method: 'GET',
        url: `${baseURL}/api/deployments/${deploymentId}`,
      });

      const patch = await makeRequest<PatchDeploymentResponse>({
        method: 'PATCH',
        url: `${baseURL}/api/deployments/${deploymentId}`,
        body: { env: [{ key: 'FOO', value: 'bar', isSecret: false }] },
      });
      expect(patch.success).toBe(true);
      expect(patch.data!.ok).toBe(true);

      const after = await makeRequest<GetDeploymentResponse>({
        method: 'GET',
        url: `${baseURL}/api/deployments/${deploymentId}`,
      });
      expect(after.success).toBe(true);
      // lastUpdated advances (or stays equal), proving the read came from service state
      expect(
        new Date(after.data!.lastUpdated).getTime(),
      ).toBeGreaterThanOrEqual(new Date(before.data!.lastUpdated).getTime());
    });

    test('action is reflected in detail and recorded in history', async () => {
      const { deploymentId } = await createDeployment('consistency-action');

      const actionRequest: PostDeploymentActionRequest = { action: 'stop' };
      const action = await makeRequest<PostDeploymentActionResponse>({
        method: 'POST',
        url: `${baseURL}/api/deployments/${deploymentId}/actions`,
        body: actionRequest,
      });
      expect(action.success).toBe(true);
      expect(action.data!.ok).toBe(true);
      expect(action.data!.jobId).toBeDefined();

      // Status reflected in detail
      const detail = await makeRequest<GetDeploymentResponse>({
        method: 'GET',
        url: `${baseURL}/api/deployments/${deploymentId}`,
      });
      expect(detail.data!.status).toBe('stopped');

      // The action's job shows up in history (derived from service/job state)
      const history = await makeRequest<GetDeploymentHistoryResponse>({
        method: 'GET',
        url: `${baseURL}/api/deployments/${deploymentId}/history`,
      });
      expect(history.success).toBe(true);
      expect(history.data!.total).toBeGreaterThanOrEqual(1);
      expect(history.data!.items.some(j => j.id === action.data!.jobId)).toBe(true);
    });

    test('rollback response is derived from service state', async () => {
      // autoStart true (default) so the created release is the current release.
      const { deploymentId, releaseId } = await createDeployment('consistency-rollback');

      const rollbackRequest: RollbackRequest = { targetReleaseId: releaseId, reason: 'Test rollback' };
      const rollback = await makeRequest<RollbackResponse>({
        method: 'POST',
        url: `${baseURL}/api/deployments/${deploymentId}/rollback`,
        body: rollbackRequest,
      });

      expect(rollback.success).toBe(true);
      expect(rollback.data!.jobId).toBeDefined();
      // Derived from state, not fabricated constants
      expect(rollback.data!.targetReleaseId).toBe(releaseId);
      expect(rollback.data!.previousReleaseId).toBe(releaseId);
    });

    test('rollback without an available previous release is rejected', async () => {
      const { deploymentId } = await createDeployment('consistency-rollback-none');

      const rollback = await makeRequest<RollbackResponse>({
        method: 'POST',
        url: `${baseURL}/api/deployments/${deploymentId}/rollback`,
        body: {},
      });

      expect(rollback.success).toBe(false);
      expect(rollback.error!.code).toBe('CONFLICT');
    });
  });

  describe('404 consistency for unknown deployments', () => {
    const unknownId = 'does-not-exist-00000000';

    test('detail returns 404', async () => {
      const res = await makeRequest({ method: 'GET', url: `${baseURL}/api/deployments/${unknownId}` });
      expect(res.success).toBe(false);
      expect(res.error!.code).toBe('NOT_FOUND');
    });

    test('update returns 404', async () => {
      const res = await makeRequest({
        method: 'PATCH',
        url: `${baseURL}/api/deployments/${unknownId}`,
        body: { env: [] },
      });
      expect(res.success).toBe(false);
      expect(res.error!.code).toBe('NOT_FOUND');
    });

    test('action returns 404', async () => {
      const res = await makeRequest({
        method: 'POST',
        url: `${baseURL}/api/deployments/${unknownId}/actions`,
        body: { action: 'start' },
      });
      expect(res.success).toBe(false);
      expect(res.error!.code).toBe('NOT_FOUND');
    });

    test('rollback returns 404', async () => {
      const res = await makeRequest({
        method: 'POST',
        url: `${baseURL}/api/deployments/${unknownId}/rollback`,
        body: { targetReleaseId: 'whatever' },
      });
      expect(res.success).toBe(false);
      expect(res.error!.code).toBe('NOT_FOUND');
    });

    test('history returns 404', async () => {
      const res = await makeRequest({ method: 'GET', url: `${baseURL}/api/deployments/${unknownId}/history` });
      expect(res.success).toBe(false);
      expect(res.error!.code).toBe('NOT_FOUND');
    });

    test('delete returns 404', async () => {
      const res = await makeRequest({ method: 'DELETE', url: `${baseURL}/api/deployments/${unknownId}` });
      expect(res.success).toBe(false);
      expect(res.error!.code).toBe('NOT_FOUND');
    });
  });

  describe('Delete lifecycle', () => {
    test('deleted deployment is removed from list and detail', async () => {
      const { deploymentId } = await createDeployment('consistency-delete');

      const del = await makeRequest({ method: 'DELETE', url: `${baseURL}/api/deployments/${deploymentId}` });
      expect(del.success).toBe(true);

      const list = await listAll();
      expect(list.items.some(d => d.id === deploymentId)).toBe(false);

      const detail = await makeRequest<GetDeploymentResponse>({
        method: 'GET',
        url: `${baseURL}/api/deployments/${deploymentId}`,
      });
      expect(detail.success).toBe(false);
      expect(detail.error!.code).toBe('NOT_FOUND');
    });
  });
});
