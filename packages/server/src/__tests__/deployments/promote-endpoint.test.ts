/**
 * Promote (upgrade) endpoint — POST /api/deployments/:id/promote (#284 Phase 2).
 *
 * Hermetic route-layer tests against the in-process server with mock services.
 * The full upgrade orchestration (draft → env carry-forward → finalize → promote →
 * pgautoupgrade migration) is exercised end-to-end on a disposable VM; here we
 * pin the operator-facing contract: a seeded deployment with no newer catalog
 * version can't be promoted without an explicit target.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { setupTestServer, teardownTestServer } from '../utils/bun-server';

const baseURL = 'http://localhost:3002';

describe('POST /api/deployments/:id/promote', () => {
  beforeAll(async () => {
    await setupTestServer(3002, { NODE_ENV: 'test' });
  });

  afterAll(async () => {
    await teardownTestServer();
  });

  test('400 NO_TARGET_VERSION when the deployment has no newer version and none is given', async () => {
    // seed-nextcloud is a mock-seeded deployment with no `latestVersion`.
    const res = await fetch(`${baseURL}/api/deployments/seed-nextcloud/promote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('NO_TARGET_VERSION');
  });
});
