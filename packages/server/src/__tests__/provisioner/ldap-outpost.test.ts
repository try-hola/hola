/**
 * Contract tests for automatic LDAP outpost provisioning.
 *
 * The `authentik-ldap` container authenticates with an outpost token that only
 * exists after Authentik is running. Creating the provider + outpost used to be a
 * manual click-through, and an empty token makes the outpost exit and restart-loop
 * — so this path is what turns LDAP into a component that comes up on its own.
 *
 * Asserts the documented Authentik REST calls against a mocked `fetch`: reuse
 * before create (so upgrades don't duplicate), the token read via `view_key`, and
 * that it authenticates with the ADMIN bootstrap token rather than widening the
 * least-privilege scoped account. No live Authentik.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { RealAuthentikProvisionerService } from '../../services/core/provisioner';
import type { AuthConfig } from '../../config/auth';

const BOOTSTRAP_TOKEN = 'admin-bootstrap-token';

const CONFIG: AuthConfig = {
  mode: 'authentik',
  authentikUrl: 'http://authentik-server:9000',
  authentikPublicUrl: 'https://auth.example.com',
  authentikBootstrapToken: BOOTSTRAP_TOKEN,
  fetchTimeoutMs: 5000,
  ldapHost: 'authentik-ldap',
  ldapPort: '3389',
  ldapBaseDn: 'dc=hola,dc=internal',
};

interface RecordedCall {
  method: string;
  path: string;
  search: URLSearchParams;
  body?: Record<string, unknown>;
  authorization?: string;
}

let calls: RecordedCall[] = [];
let originalFetch: typeof globalThis.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** `existingOutpost` toggles between the fresh-provision and reuse paths. */
function installFetch(opts: {
  existingProvider?: boolean;
  existingOutpost?: { providers: number[] } | null;
  existingApplication?: { provider: number } | null;
  tokenKey?: string;
} = {}) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({
      method,
      path: url.pathname,
      search: url.searchParams,
      body,
      authorization: (init?.headers as Record<string, string> | undefined)?.Authorization,
    });

    if (method === 'GET' && url.pathname === '/api/v3/providers/ldap/') {
      return json({ results: opts.existingProvider ? [{ pk: 99 }] : [] });
    }
    if (method === 'GET' && url.pathname.startsWith('/api/v3/flows/instances/')) {
      // Distinct pks per slug so the assertions prove BOTH flows were resolved.
      const slug = url.pathname.split('/').filter(Boolean).pop() ?? '';
      return json({ pk: slug.includes('invalidation') ? 'flow-invalidation' : 'flow-authorization' });
    }
    if (method === 'POST' && url.pathname === '/api/v3/providers/ldap/') {
      return json({ pk: 99 }, 201);
    }
    if (url.pathname === '/api/v3/core/applications/hola-ldap/') {
      if (method === 'GET') {
        return opts.existingApplication
          ? json({ pk: 'app-uuid', provider: opts.existingApplication.provider })
          : json({ detail: 'Not found.' }, 404);
      }
      if (method === 'PATCH') return json({ pk: 'app-uuid' });
    }
    if (method === 'POST' && url.pathname === '/api/v3/core/applications/') {
      return json({ pk: 'app-uuid', slug: 'hola-ldap' }, 201);
    }
    if (method === 'GET' && url.pathname === '/api/v3/outposts/instances/') {
      return json({
        results: opts.existingOutpost
          ? [{ pk: 'outpost-uuid', token_identifier: 'ak-outpost-id', providers: opts.existingOutpost.providers }]
          : [],
      });
    }
    if (method === 'POST' && url.pathname === '/api/v3/outposts/instances/') {
      return json({ pk: 'outpost-uuid', token_identifier: 'ak-outpost-id', providers: [99] }, 201);
    }
    if (method === 'PATCH' && url.pathname.startsWith('/api/v3/outposts/instances/')) {
      return json({ pk: 'outpost-uuid', token_identifier: 'ak-outpost-id' });
    }
    if (method === 'GET' && url.pathname === '/api/v3/core/tokens/ak-outpost-id/view_key/') {
      return json({ key: opts.tokenKey ?? 'outpost-secret-token' });
    }
    return json({ detail: `unexpected ${method} ${url.pathname}` }, 500);
  }) as typeof globalThis.fetch;
}

function find(method: string, path: string): RecordedCall | undefined {
  return calls.find((c) => c.method === method && c.path === path);
}

describe('ensureLdapOutpost', () => {
  beforeEach(() => {
    calls = [];
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('provisions provider + outpost and returns the token on a fresh install', async () => {
    installFetch();
    const svc = new RealAuthentikProvisionerService(CONFIG);

    const result = await svc.ensureLdapOutpost();

    expect(result.token).toBe('outpost-secret-token');
    expect(result.baseDn).toBe('dc=hola,dc=internal');

    // Provider carries the configured base DN and BOTH resolved flows.
    // invalidation_flow is required on providers from Authentik 2024.10 —
    // omitting it 400s, which silently leaves the outpost unprovisioned.
    const createProvider = find('POST', '/api/v3/providers/ldap/');
    expect(createProvider?.body).toMatchObject({
      name: 'hola-ldap',
      base_dn: 'dc=hola,dc=internal',
      authorization_flow: 'flow-authorization',
      invalidation_flow: 'flow-invalidation',
    });

    // Looked up with the same filter every other provider lookup uses; a bare
    // `?name=` is not a supported filter and would not narrow the list.
    expect(find('GET', '/api/v3/providers/ldap/')?.search.get('name__iexact')).toBe('hola-ldap');

    // Outpost is type ldap and bound to that provider.
    const createOutpost = find('POST', '/api/v3/outposts/instances/');
    expect(createOutpost?.body).toMatchObject({ name: 'hola-ldap', type: 'ldap', providers: [99] });

    // The provider MUST be backed by an application. Authentik only serves an
    // outpost the providers that have one, so without this the outpost starts,
    // authenticates, and panics with "no ldap provider defined".
    const createApp = find('POST', '/api/v3/core/applications/');
    expect(createApp?.body).toMatchObject({ slug: 'hola-ldap', provider: 99 });

    // Token is read back by identifier — Authentik never returns keys on list.
    expect(find('GET', '/api/v3/core/tokens/ak-outpost-id/view_key/')).toBeDefined();
  });

  test('re-points an application left bound to a stale provider', async () => {
    installFetch({
      existingProvider: true,
      existingApplication: { provider: 7 },
      existingOutpost: { providers: [99] },
    });
    const svc = new RealAuthentikProvisionerService(CONFIG);

    await svc.ensureLdapOutpost();

    // Otherwise the outpost keeps serving nothing after the provider is recreated.
    const patch = calls.find((c) => c.method === 'PATCH' && c.path === '/api/v3/core/applications/hola-ldap/');
    expect(patch?.body).toMatchObject({ provider: 99 });
    expect(find('POST', '/api/v3/core/applications/')).toBeUndefined();
  });

  test('leaves a correctly bound application alone', async () => {
    installFetch({
      existingProvider: true,
      existingApplication: { provider: 99 },
      existingOutpost: { providers: [99] },
    });
    const svc = new RealAuthentikProvisionerService(CONFIG);

    await svc.ensureLdapOutpost();

    expect(calls.some((c) => c.path === '/api/v3/core/applications/hola-ldap/' && c.method === 'PATCH')).toBe(false);
    expect(find('POST', '/api/v3/core/applications/')).toBeUndefined();
  });

  test('reuses an existing provider and outpost instead of duplicating them', async () => {
    installFetch({ existingProvider: true, existingOutpost: { providers: [99] } });
    const svc = new RealAuthentikProvisionerService(CONFIG);

    const result = await svc.ensureLdapOutpost();

    expect(result.token).toBe('outpost-secret-token');
    // Re-running on every upgrade must not create a second provider/outpost.
    expect(find('POST', '/api/v3/providers/ldap/')).toBeUndefined();
    expect(find('POST', '/api/v3/outposts/instances/')).toBeUndefined();
    // Binding already correct, so no needless PATCH either.
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  test('re-attaches the provider when an existing outpost lost its binding', async () => {
    installFetch({ existingProvider: true, existingOutpost: { providers: [] } });
    const svc = new RealAuthentikProvisionerService(CONFIG);

    await svc.ensureLdapOutpost();

    // Otherwise the outpost would serve an empty directory tree.
    const patch = calls.find((c) => c.method === 'PATCH' && c.path.startsWith('/api/v3/outposts/instances/'));
    expect(patch?.body).toMatchObject({ providers: [99] });
  });

  test('authenticates with the admin bootstrap token, not the scoped account', async () => {
    installFetch();
    const svc = new RealAuthentikProvisionerService(CONFIG);

    await svc.ensureLdapOutpost();

    // Reading a token key and creating outposts are broader rights than
    // day-to-day provisioning; keeping them on the bootstrap token means the
    // least-privilege scoped account stays exactly as narrow as it already is.
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.authorization).toBe(`Bearer ${BOOTSTRAP_TOKEN}`);
    }
  });

  test('fails clearly when no bootstrap token is configured', async () => {
    installFetch();
    const svc = new RealAuthentikProvisionerService({ ...CONFIG, authentikBootstrapToken: undefined });

    await expect(svc.ensureLdapOutpost()).rejects.toThrow(/bootstrap token/i);
  });

  test('rejects an empty token rather than wiring one that crash-loops the outpost', async () => {
    installFetch({ tokenKey: '' });
    const svc = new RealAuthentikProvisionerService(CONFIG);

    // An empty AUTHENTIK_TOKEN is precisely what makes the container exit and
    // restart forever, so it must never be written to .env as if it succeeded.
    await expect(svc.ensureLdapOutpost()).rejects.toThrow(/empty LDAP outpost token/i);
  });
});
