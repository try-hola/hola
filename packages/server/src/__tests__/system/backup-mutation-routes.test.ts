/**
 * The backup API tells the truth about what this host can do (F12).
 *
 * The exposure this covers: `POST /api/backups` answered 200 with a freshly
 * minted `jobId` and `backupId`, and `DELETE /api/backups/:id` answered
 * `{ ok: true }` — neither having called a service, enqueued a job, written an
 * archive or deleted anything. There is no platform backup engine to call:
 * backups are performed by a provider app through the `backup@1` contract,
 * which is provider-initiated by design (ADR 0004 — the server never commands
 * an app), so these verbs had no implementation to reach and never will in
 * this shape. The `jobId` made it worse than a bare lie: it named a job that
 * `GET /api/jobs/:id` has never heard of, so an operator's automation would
 * poll a 404 forever while believing a backup was running.
 *
 * Both mutations are therefore GONE, following the precedent set when spec 008
 * deleted the equally fictitious `POST /api/backups/:id/restore` (#504): the
 * route, its request/response types and its client affordances removed
 * together. The reads stay, because they are already honest — the list is
 * genuinely empty and an id genuinely cannot resolve — and they are asserted
 * here alongside the removals so this fix cannot take them with it.
 *
 * Driven through `route()` with a crafted `authContext`, for the reason
 * `secret-read-authorization.test.ts` gives: the test environment disables
 * auth, so an HTTP-level request can only ever present the wildcard system
 * principal. Here that matters in the other direction — the point is that even
 * a principal holding `write:backups` gets nothing, so the absence cannot be
 * mistaken for an authorization failure.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

import { API, CAPABILITIES } from '@hola/shared';
import { setupTestServer, teardownTestServer, TEST_BASE_URL } from '../utils/server';
import { route } from '../../server';
import type { Principal } from '../../services/auth/auth-service';

/**
 * A principal holding every backup capability this host issues — the strongest
 * caller these routes could ever have had.
 */
const BACKUP_WRITER: Principal = {
  id: 'operator-1',
  type: 'user',
  name: 'Operator',
  roles: ['admin'],
  capabilities: [CAPABILITIES.READ_BACKUPS, CAPABILITIES.WRITE_BACKUPS],
};

async function call(path: string, method: string, body?: unknown): Promise<Response> {
  const req = new Request(`${TEST_BASE_URL}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  (req as Request & { authContext?: unknown }).authContext = {
    isAuthenticated: true,
    principal: BACKUP_WRITER,
  };
  return route(new URL(req.url), req);
}

describe('backup mutation routes (F12)', () => {
  beforeAll(async () => {
    await setupTestServer();
  });

  afterAll(async () => {
    await teardownTestServer();
  });

  test('POST /api/backups does not exist, and mints no ids', async () => {
    const res = await call(API.backups.base, 'POST', { appId: 'nextcloud' });
    expect(res.status).toBe(404);

    // Not just "not 200": the response must carry no identifier at all. A
    // fabricated `jobId` is the specific harm — a caller polling
    // `GET /api/jobs/<it>` gets a 404 forever while believing work is running.
    const text = await res.text();
    expect(text).not.toContain('jobId');
    expect(text).not.toContain('backupId');
  });

  test('DELETE /api/backups/:id does not exist, and claims no deletion', async () => {
    const res = await call(API.backups.byId('backup-1'), 'DELETE');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('"ok":true');
  });

  // The honest halves. These pass both before and after the removal, on
  // purpose: the fix must not take the working reads with it.
  test('GET /api/backups still answers with a genuinely empty page', async () => {
    const res = await call(API.backups.base, 'GET');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ items: [], total: 0 });
  });

  test('GET /api/backups/:id still 404s, because no id can resolve', async () => {
    const res = await call(API.backups.byId('backup-1'), 'GET');
    expect(res.status).toBe(404);
  });

  // The same compile-time guard spec 008 used for the restore pair: a typed
  // client method is what makes a dead route reachable, so the types must not
  // survive the routes. The runtime half only proves no same-named VALUE is
  // exported; the load-bearing half is the `@ts-expect-error`s, checked by
  // `bun run typecheck` — one that stops erroring, because a type came back,
  // fails the build.
  test('the backup mutation types no longer exist as exports', async () => {
    const shared = await import('@hola/shared');
    expect('CreateBackupRequest' in shared).toBe(false);
    expect('CreateBackupResponse' in shared).toBe(false);
    expect('DeleteBackupResponse' in shared).toBe(false);

    // @ts-expect-error CreateBackupRequest no longer exists (F12).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    type _CreateRequestGone = import('@hola/shared').CreateBackupRequest;
    // @ts-expect-error CreateBackupResponse no longer exists (F12).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    type _CreateResponseGone = import('@hola/shared').CreateBackupResponse;
    // @ts-expect-error DeleteBackupResponse no longer exists (F12).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    type _DeleteResponseGone = import('@hola/shared').DeleteBackupResponse;
  });

  // The API reference is generated from `API_ENDPOINTS`; a documented route the
  // server refuses is how a caller ends up writing automation against it.
  // Imported by path because `@hola/shared` publishes no `./docs` subpath —
  // adding one to the package's public surface for a test's convenience would
  // be a bigger change than the assertion is worth.
  test('the API explorer documents no backup mutation', async () => {
    const { API_ENDPOINTS } = await import('../../../../shared/src/docs/api-explorer');
    const mutations = API_ENDPOINTS.filter(
      (e) => e.path.startsWith('/api/backups') && e.method !== 'GET',
    );
    expect(mutations).toEqual([]);
  });
});
