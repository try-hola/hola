/**
 * Every brokered-contract route threads the calling token's deployment id into
 * the service (#501).
 *
 * The service-level half of the fix is covered in `contract-broker-caller.test.ts`;
 * this is the half a service test cannot see. The bug was not in one method — it
 * was that no route handler passed the caller at all, so a handler that forgets
 * to now would reproduce it for its own route while every other route stayed
 * fixed. The table below is therefore the whole broker surface, enumerated: each
 * row is driven through the real router and must land the principal's
 * `deploymentId` in the service call.
 *
 * Driven through `route()` rather than `fetch`: the auth middleware substitutes a
 * wildcard SYSTEM principal whenever auth is disabled, which the test
 * environment always is, so an HTTP-level request could never present a contract
 * principal. The middleware's own behaviour (which capability each of these
 * paths demands, and that a contract token is refused everywhere else) is
 * covered in `middleware/auth` tests.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';

import { API } from '@hola/shared';
import { setupTestServer, teardownTestServer, TEST_BASE_URL } from '../utils/server';
import { getServices } from '../../services/simple-factory';
import type { Principal } from '../../services/auth/auth-service';

type Router = (url: URL, req: Request) => Promise<Response>;

/** Calls recorded by the doubles below: the method name and its first argument. */
let calls: Array<{ method: string; caller: unknown; rest: unknown[] }>;

const PROVIDER_ID = 'backrest-1a2b3c4d';

/** A request carrying the authContext the auth middleware would have attached. */
function contractRequest(method: string, path: string, deploymentId: string | undefined, body?: unknown): Request {
  const principal: Principal = {
    id: `contract:${deploymentId ?? 'none'}`,
    type: 'service',
    name: 'Contract provider',
    roles: [],
    capabilities: ['contract:backup', 'contract:restore'],
    ...(deploymentId === undefined ? {} : { metadata: { deploymentId, contracts: ['backup@1', 'restore@1'] } }),
  };
  const req = new Request(`${TEST_BASE_URL}${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
  (req as Request & { authContext?: { isAuthenticated: boolean; principal: Principal } }).authContext = {
    isAuthenticated: true,
    principal,
  };
  return req;
}

/**
 * The broker surface, one row per route. `drive` performs the call; `method` is
 * the service method that must receive the caller id.
 */
const ROUTES: Array<{ name: string; method: string; drive: (route: Router, deploymentId?: string) => Promise<Response> }> = [
  {
    name: 'POST /api/contracts/backup/prepare',
    method: 'prepareContractBackup',
    drive: (route, id) => {
      const req = contractRequest('POST', API.contracts.backupPrepare, id);
      return route(new URL(req.url), req);
    },
  },
  {
    name: 'POST /api/contracts/backup/finalize',
    method: 'finalizeContractBackup',
    drive: (route, id) => {
      const req = contractRequest('POST', API.contracts.backupFinalize, id);
      return route(new URL(req.url), req);
    },
  },
  {
    name: 'GET /api/contracts/backup/status/:jobId',
    method: 'assertContractProvider',
    drive: (route, id) => {
      const req = contractRequest('GET', API.contracts.backupStatus('job_1'), id);
      return route(new URL(req.url), req);
    },
  },
  {
    name: 'POST /api/contracts/restore/index',
    method: 'publishRestoreIndex',
    drive: (route, id) => {
      const req = contractRequest('POST', API.contracts.restoreIndex, id, {
        entries: [{ captureId: 'cap-1', takenAt: '2026-02-01T09:00:00.000Z', sizeBytes: 1, location: '/srv/x', identity: null }],
      });
      return route(new URL(req.url), req);
    },
  },
  {
    name: 'GET /api/contracts/restore/requests',
    method: 'pollRestoreRequests',
    drive: (route, id) => {
      const req = contractRequest('GET', API.contracts.restoreRequests, id);
      return route(new URL(req.url), req);
    },
  },
  {
    name: 'POST /api/contracts/restore/requests/:id/claim',
    method: 'claimRestoreRequest',
    drive: (route, id) => {
      const req = contractRequest('POST', API.contracts.restoreRequestClaim('req-1'), id);
      return route(new URL(req.url), req);
    },
  },
  {
    name: 'POST /api/contracts/restore/requests/:id/complete',
    method: 'completeRestoreRequest',
    drive: (route, id) => {
      const req = contractRequest('POST', API.contracts.restoreRequestComplete('req-1'), id, { outcome: 'completed' });
      return route(new URL(req.url), req);
    },
  },
];

describe('contract broker routes pass the calling token\'s deploymentId (#501)', () => {
  let route: Router;
  /** The real methods, put back afterwards — the services object is a singleton. */
  const originals = new Map<string, unknown>();

  beforeAll(async () => {
    await setupTestServer();
    route = (await import('../../server')).route;
    const deployments = getServices().deployments as unknown as Record<string, unknown>;
    for (const { method } of ROUTES) originals.set(method, deployments[method]);
    originals.set('getJob', (getServices().jobs as unknown as Record<string, unknown>).getJob);
  });

  afterAll(async () => {
    const deployments = getServices().deployments as unknown as Record<string, unknown>;
    for (const { method } of ROUTES) deployments[method] = originals.get(method);
    (getServices().jobs as unknown as Record<string, unknown>).getJob = originals.get('getJob');
    await teardownTestServer();
  });

  beforeEach(() => {
    calls = [];
    // Record what each broker method is handed. Assigned onto the live service
    // instance the router resolves through `getServices()`, so the real handler
    // code is what calls these.
    const deployments = getServices().deployments as unknown as Record<string, unknown>;
    for (const { method } of ROUTES) {
      deployments[method] = async (caller: unknown, ...rest: unknown[]) => {
        calls.push({ method, caller, rest });
        if (method === 'publishRestoreIndex') return { ok: true, count: 0 };
        if (method === 'pollRestoreRequests') return { requests: [], reindex: false };
        if (method === 'prepareContractBackup') return { apps: [], participations: [] };
        if (method === 'finalizeContractBackup') return { ok: true, results: [] };
        return { ok: true };
      };
    }
    // The status route reads a job after asserting the caller.
    (getServices().jobs as unknown as Record<string, unknown>).getJob = async () => ({ id: 'job_1', status: 'completed' });
  });

  for (const row of ROUTES) {
    test(`${row.name} passes it to ${row.method}`, async () => {
      const res = await row.drive(route, PROVIDER_ID);
      expect(res.status).toBe(200);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.method).toBe(row.method);
      expect(calls[0]!.caller).toBe(PROVIDER_ID);
    });

    test(`${row.name} refuses a principal carrying no deploymentId`, async () => {
      // An operator key or a dashboard session is not "the provider acting on
      // its own work". Refused in the handler, before the service is reached —
      // defaulting to some provider is exactly what this issue was.
      const res = await row.drive(route, undefined);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');
      expect(calls).toHaveLength(0);
    });
  }

  test('the table above covers every broker route the shared API surface declares', () => {
    // A route added to `API.contracts` without a row here would otherwise be
    // exactly the omission #501 was: one handler that never passes its caller.
    // `base` is the dashboard-facing read, not a broker route; everything else
    // in the block is, and each needs a row.
    expect(Object.keys(API.contracts).sort()).toEqual([
      'backupFinalize', 'backupPrepare', 'backupStatus', 'base',
      'restoreIndex', 'restoreRequestClaim', 'restoreRequestComplete', 'restoreRequests',
    ]);
    expect(ROUTES).toHaveLength(Object.keys(API.contracts).length - 1);
  });
});
