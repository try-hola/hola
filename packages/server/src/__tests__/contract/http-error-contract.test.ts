/**
 * API contract tests — shared HTTP error-body contract (#17).
 *
 * Verifies that the route layer returns the shared error envelope
 * (`{ error: { code, message } }`) with an `x-request-id` header and the
 * correct status across deployment endpoints, and that unknown resources fail
 * uniformly. Runs against the in-process server with mock services (hermetic:
 * no ports, no external network, no background processes).
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { setupTestServer, teardownTestServer } from '../utils/bun-server';

const baseURL = 'http://localhost:3001';

/** Assert the shared error envelope + request-id header on a non-2xx response. */
async function expectErrorEnvelope(res: Response, status: number) {
  expect(res.status).toBe(status);
  expect(res.headers.get('x-request-id')).toBeTruthy();
  expect(res.headers.get('content-type') ?? '').toContain('application/json');
  const body = (await res.json()) as { error?: { code?: string; message?: string } };
  expect(body.error).toBeDefined();
  expect(typeof body.error!.code).toBe('string');
  expect(body.error!.code!.length).toBeGreaterThan(0);
  expect(typeof body.error!.message).toBe('string');
  expect(body.error!.message!.length).toBeGreaterThan(0);
}

describe('API contract: shared error envelope', () => {
  beforeAll(async () => {
    await setupTestServer(3001, { NODE_ENV: 'test' });
  });

  afterAll(async () => {
    await teardownTestServer();
  });

  const unknownId = 'does-not-exist';

  test('unknown deployment detail returns a 404 envelope', async () => {
    await expectErrorEnvelope(await fetch(`${baseURL}/api/deployments/${unknownId}`), 404);
  });

  test('unknown deployment fails uniformly across mutating routes', async () => {
    const cases: Array<{ method: string; path: string; body?: unknown }> = [
      { method: 'PATCH', path: `/api/deployments/${unknownId}`, body: { env: [] } },
      { method: 'POST', path: `/api/deployments/${unknownId}/actions`, body: { action: 'stop' } },
      { method: 'POST', path: `/api/deployments/${unknownId}/rollback`, body: {} },
      { method: 'GET', path: `/api/deployments/${unknownId}/history` },
      { method: 'DELETE', path: `/api/deployments/${unknownId}` },
    ];

    for (const c of cases) {
      const res = await fetch(`${baseURL}${c.path}`, {
        method: c.method,
        headers: { 'content-type': 'application/json' },
        body: c.body !== undefined ? JSON.stringify(c.body) : undefined,
      });
      // Every unknown-resource path returns the shared envelope with a 4xx status.
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      await expectErrorEnvelope(res, res.status);
    }
  });

  test('invalid deployment action returns a 400 envelope', async () => {
    const res = await fetch(`${baseURL}/api/deployments/${unknownId}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'not-a-real-action' }),
    });
    await expectErrorEnvelope(res, 400);
  });
});
