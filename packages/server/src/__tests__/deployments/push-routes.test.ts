/**
 * HTTP surface for the push endpoints (#409).
 *
 * `GET /api/deployments/:id/push-targets` and `POST …/push-hooks` sit under the
 * generic `/api/deployments/:id` matcher, so the main thing to prove at this
 * level is that they're routed at all (rather than swallowed by it), plus the
 * error mapping: unknown deployment → 404, missing `targetId` → 400.
 *
 * Payload semantics are covered against the real service in push-targets.test.ts;
 * the harness here runs the mock services, which declare no push targets.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

import { setupTestServer, teardownTestServer, TEST_BASE_URL } from '../utils/server';
import { makeRequest } from '../utils/phase7-helpers';
import type { GetDeploymentPushTargetsResponse } from '@hola/shared';

const SEEDED_DEPLOYMENT = 'seed-nextcloud';

describe('Push endpoints (#409)', () => {
  beforeAll(async () => {
    await setupTestServer();
  });

  afterAll(async () => {
    await teardownTestServer();
  });

  test('GET /push-targets is routed and returns a targets list', async () => {
    const res = await makeRequest<GetDeploymentPushTargetsResponse>({
      method: 'GET',
      url: `${TEST_BASE_URL}/api/deployments/${SEEDED_DEPLOYMENT}/push-targets`,
    });

    expect(res.success).toBe(true);
    expect(Array.isArray(res.data?.targets)).toBe(true);
  });

  test('GET /push-targets for an unknown deployment is a 404', async () => {
    const res = await makeRequest({
      method: 'GET',
      url: `${TEST_BASE_URL}/api/deployments/does-not-exist/push-targets`,
    });

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('NOT_FOUND');
  });

  test('POST /push-hooks without a targetId is rejected', async () => {
    const res = await makeRequest({
      method: 'POST',
      url: `${TEST_BASE_URL}/api/deployments/${SEEDED_DEPLOYMENT}/push-hooks`,
      body: {},
    });

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('VALIDATION_ERROR');
  });

  test('POST /push-hooks for a target the deployment does not declare is a 404', async () => {
    const res = await makeRequest({
      method: 'POST',
      url: `${TEST_BASE_URL}/api/deployments/${SEEDED_DEPLOYMENT}/push-hooks`,
      body: { targetId: 'library' },
    });

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('NOT_FOUND');
  });
});
