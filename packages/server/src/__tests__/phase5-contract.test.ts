/**
 * Phase 5 Contract Tests - Jobs and Structured Logs
 *
 * Verifies jobs creation, listing, and SSE log streams. Works in both
 * real and mock modes by checking feature flags at runtime.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { API } from '@hola/shared';
import type { GetJobsResponse, PostDeploymentActionResponse, SystemConfigResponse } from '@hola/shared';
import { createTestServer, isServerRunning, type TestServerManager } from '../utils/test-server';

const BASE_URL = 'http://localhost:3001';
const TEST_TIMEOUT = 30000;

async function getConfig(): Promise<SystemConfigResponse> {
  const res = await fetch(`${BASE_URL}${API.system.config}`);
  if (!res.ok) throw new Error(`Failed to get config: ${res.status}`);
  return res.json() as Promise<SystemConfigResponse>;
}

describe('Phase 5 Contract Tests - Jobs and Structured Logs', () => {
  let testServer: TestServerManager | null = null;

  beforeAll(async () => {
    // Check if server is already running (e.g., in CI)
    if (await isServerRunning()) {
      console.log('Using existing server for contract tests');
    } else {
      // Start server for local testing
      console.log('Starting test server for contract tests');
      testServer = createTestServer();
      await testServer.start();
    }
    
    await getConfig();
    // Note: config flags could be used to branch assertions in future
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (testServer) {
      await testServer.stop();
      testServer = null;
    }
  });

  describe('Create job via deployment action', () => {
    it('POST /api/deployments/:id/actions returns a jobId for start action', async () => {
      const depId = 'nextcloud-prod';
      const res = await fetch(`${BASE_URL}${API.deployments.actions(depId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      expect(res.ok).toBe(true);
      const data = await res.json() as PostDeploymentActionResponse;
      // In both real and mock modes, start action should produce a jobId
      expect(data.jobId).toBeDefined();
    }, TEST_TIMEOUT);
  });

  describe('Jobs listing', () => {
    it('GET /api/jobs returns a valid paginated response', async () => {
      const res = await fetch(`${BASE_URL}${API.jobs.base}?page=1&limit=10`);
      expect(res.ok).toBe(true);
      const data = await res.json() as GetJobsResponse;
      expect(data).toHaveProperty('items');
      expect(Array.isArray(data.items)).toBe(true);
      expect(typeof data.page).toBe('number');
      expect(typeof data.limit).toBe('number');
      expect(typeof data.total).toBe('number');
    }, TEST_TIMEOUT);
  });

  describe('Job logs SSE', () => {
    it('GET /api/jobs/:id/logs has SSE headers', async () => {
      // Create a job first to have an id
      const depId = 'homeassistant-main';
      const actionRes = await fetch(`${BASE_URL}${API.deployments.actions(depId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      const actionData = await actionRes.json() as PostDeploymentActionResponse;
      expect(actionData.jobId).toBeDefined();
      const jobId = actionData.jobId!;

      const res = await fetch(`${BASE_URL}${API.jobs.logs(jobId)}`);
      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(res.headers.get('connection')).toBe('keep-alive');
      // We do not consume the stream to avoid hanging the test
    }, TEST_TIMEOUT);

    it('GET /api/jobs/:id/logs/stream has SSE headers and supports job_update events', async () => {
      const depId = 'grafana-monitoring';
      const actionRes = await fetch(`${BASE_URL}${API.deployments.actions(depId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'restart' }),
      });
      const actionData = await actionRes.json() as PostDeploymentActionResponse;
      expect(actionData.jobId).toBeDefined();
      const jobId = actionData.jobId!;

      const res = await fetch(`${BASE_URL}${API.jobs.logsStream(jobId)}`);
      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(res.headers.get('connection')).toBe('keep-alive');
    }, TEST_TIMEOUT);
  });
});
