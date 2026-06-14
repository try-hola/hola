/**
 * Authentik provisioner contract tests (epic #89, PR1).
 *
 * Exercises RealAuthentikProvisionerService against a mocked `fetch`, asserting
 * it speaks the documented Authentik REST endpoints: resolves the default flows,
 * creates an OAuth2 provider with Hola-generated client_id/secret and a strict
 * redirect URI, links an application, returns env under the app's expected names,
 * and tears both down on deprovision. No live Authentik.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { RealAuthentikProvisionerService } from '../../services/core/provisioner';
import type { AuthConfig } from '../../config/auth';

const CONFIG: AuthConfig = {
  mode: 'authentik',
  authentikUrl: 'http://authentik-server:9000',
  authentikPublicUrl: 'https://auth.example.com',
  authentikApiToken: 'test-token',
  fetchTimeoutMs: 5000,
};

interface RecordedCall {
  method: string;
  path: string;
  body?: unknown;
  authorization?: string;
}

let calls: RecordedCall[] = [];
let originalFetch: typeof globalThis.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Install a fetch that answers the Authentik endpoints the provisioner calls. */
function installFetch(handler?: (call: RecordedCall) => Response | undefined) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
    const call: RecordedCall = { method, path: url.pathname + url.search, body, authorization };
    calls.push(call);

    const override = handler?.(call);
    if (override) return override;

    // Default happy-path responses.
    if (method === 'GET' && url.pathname.startsWith('/api/v3/flows/instances/')) {
      return json({ pk: `flow-${url.pathname.split('/').slice(-2, -1)[0]}` });
    }
    if (method === 'GET' && url.pathname.startsWith('/api/v3/propertymappings/provider/scope/')) {
      return json({ results: [{ pk: `scope-${url.searchParams.get('scope_name')}` }] });
    }
    if (method === 'POST' && url.pathname === '/api/v3/providers/oauth2/') {
      return json({ pk: 42, client_id: body.client_id, client_secret: body.client_secret }, 201);
    }
    if (method === 'POST' && url.pathname === '/api/v3/core/applications/') {
      return json({ pk: 7, slug: body.slug }, 201);
    }
    if (method === 'POST' && url.pathname === '/api/v3/providers/proxy/') {
      return json({ pk: 55 }, 201);
    }
    if (method === 'GET' && url.pathname === '/api/v3/outposts/instances/') {
      return json({ results: [{ pk: 1, providers: [] }] });
    }
    if (method === 'GET' && url.pathname.startsWith('/api/v3/outposts/instances/')) {
      return json({ pk: 1, providers: [55] });
    }
    if (method === 'PATCH') {
      return json({ pk: 1 });
    }
    if (method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    return new Response('unexpected', { status: 500 });
  }) as typeof globalThis.fetch;
}

const OIDC_INPUT = {
  deploymentId: 'dep-abcdef0123456789',
  appName: 'gitea',
  mode: 'native-oidc' as const,
  host: 'gitea.example.com',
  oidc: {
    redirectPath: '/user/oauth2/authentik/callback',
    scopes: ['openid', 'profile', 'email'],
    env: {
      issuer: 'GITEA_OIDC_ISSUER',
      clientId: 'GITEA_OIDC_CLIENT_ID',
      clientSecret: 'GITEA_OIDC_CLIENT_SECRET',
      redirectUri: 'GITEA_OIDC_REDIRECT',
    },
  },
};

describe('RealAuthentikProvisionerService (REST contract)', () => {
  beforeEach(() => {
    calls = [];
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('native-oidc provision creates a provider + application and returns mapped env', async () => {
    installFetch();
    const svc = new RealAuthentikProvisionerService(CONFIG);

    const result = await svc.provision(OIDC_INPUT);

    // The provider POST carried Hola-generated credentials and a strict redirect URI.
    const providerCall = calls.find(c => c.method === 'POST' && c.path === '/api/v3/providers/oauth2/')!;
    expect(providerCall).toBeDefined();
    expect(providerCall.authorization).toBe('Bearer test-token');
    const pbody = providerCall.body as Record<string, unknown>;
    expect(pbody.client_type).toBe('confidential');
    expect(typeof pbody.client_id).toBe('string');
    expect(typeof pbody.client_secret).toBe('string');
    expect(pbody.redirect_uris).toEqual([
      { matching_mode: 'strict', url: 'https://gitea.example.com/user/oauth2/authentik/callback' },
    ]);
    expect(pbody.authorization_flow).toBeTruthy();
    expect(pbody.invalidation_flow).toBeTruthy();

    // An application was linked to the provider pk.
    const appCall = calls.find(c => c.method === 'POST' && c.path === '/api/v3/core/applications/')!;
    expect(appCall).toBeDefined();
    expect((appCall.body as Record<string, unknown>).provider).toBe(42);

    // Returned env is keyed by the app's expected names and matches the generated creds.
    expect(result.env.GITEA_OIDC_CLIENT_ID).toBe(pbody.client_id as string);
    expect(result.env.GITEA_OIDC_CLIENT_SECRET).toBe(pbody.client_secret as string);
    expect(result.env.GITEA_OIDC_REDIRECT).toBe('https://gitea.example.com/user/oauth2/authentik/callback');
    expect(result.env.GITEA_OIDC_ISSUER).toBe(`https://auth.example.com/application/o/${result.ref.applicationSlug}/`);

    // The ref carries what teardown needs.
    expect(result.ref.mode).toBe('native-oidc');
    expect(result.ref.providerPk).toBe(42);
    expect(result.ref.applicationSlug).toBeTruthy();
  });

  test('rolls back the provider if application creation fails', async () => {
    installFetch(call => {
      if (call.method === 'POST' && call.path === '/api/v3/core/applications/') {
        return new Response('boom', { status: 400 });
      }
      return undefined;
    });
    const svc = new RealAuthentikProvisionerService(CONFIG);

    await expect(svc.provision(OIDC_INPUT)).rejects.toThrow();
    // The orphaned provider was deleted.
    expect(calls.some(c => c.method === 'DELETE' && c.path === '/api/v3/providers/oauth2/42/')).toBe(true);
  });

  test('deprovision deletes the application then the provider', async () => {
    installFetch();
    const svc = new RealAuthentikProvisionerService(CONFIG);

    await svc.deprovision({
      deploymentId: 'dep-abcdef0123456789',
      ref: { mode: 'native-oidc', providerPk: 42, applicationSlug: 'gitea-dep-abcd' },
    });

    const deletes = calls.filter(c => c.method === 'DELETE').map(c => c.path);
    expect(deletes).toContain('/api/v3/core/applications/gitea-dep-abcd/');
    expect(deletes).toContain('/api/v3/providers/oauth2/42/');
  });

  test('deprovision tolerates an already-deleted resource (404)', async () => {
    installFetch(call => (call.method === 'DELETE' ? new Response('gone', { status: 404 }) : undefined));
    const svc = new RealAuthentikProvisionerService(CONFIG);

    await expect(
      svc.deprovision({ deploymentId: 'x', ref: { mode: 'native-oidc', providerPk: 99, applicationSlug: 'gone' } })
    ).resolves.toBeUndefined();
  });

  test('native-ldap is not implemented yet', async () => {
    installFetch();
    const svc = new RealAuthentikProvisionerService(CONFIG);
    await expect(svc.provision({ ...OIDC_INPUT, mode: 'native-ldap', oidc: undefined })).rejects.toThrow(/not implemented/);
  });

  test('forward-auth provision creates a proxy provider, app, and binds the outpost', async () => {
    installFetch();
    const svc = new RealAuthentikProvisionerService(CONFIG);

    const result = await svc.provision({
      deploymentId: 'dep-abcdef0123456789',
      appName: 'grafana',
      mode: 'forward-auth',
      host: 'grafana.example.com',
    });

    // Proxy provider created in forward_single mode for the app's host.
    const provCall = calls.find(c => c.method === 'POST' && c.path === '/api/v3/providers/proxy/')!;
    expect(provCall).toBeDefined();
    expect((provCall.body as Record<string, unknown>).mode).toBe('forward_single');
    expect((provCall.body as Record<string, unknown>).external_host).toBe('https://grafana.example.com');

    // Provider bound to the embedded outpost (PATCH includes its pk).
    const patch = calls.find(c => c.method === 'PATCH' && c.path.startsWith('/api/v3/outposts/instances/'))!;
    expect(patch).toBeDefined();
    expect((patch.body as { providers: number[] }).providers).toContain(55);

    // Returns a middleware descriptor pointing at the internal outpost URL.
    expect(result.middleware?.outpostUrl).toBe('http://authentik-server:9000');
    expect(result.ref).toMatchObject({ mode: 'forward-auth', providerPk: 55, outpostPk: 1 });
  });

  test('forward-auth deprovision detaches the outpost then deletes app + provider', async () => {
    installFetch();
    const svc = new RealAuthentikProvisionerService(CONFIG);

    await svc.deprovision({
      deploymentId: 'x',
      ref: { mode: 'forward-auth', providerPk: 55, applicationSlug: 'grafana-x', outpostPk: 1 },
    });

    // Outpost PATCHed to drop the provider, then both resources deleted.
    expect(calls.some(c => c.method === 'PATCH' && c.path === '/api/v3/outposts/instances/1/')).toBe(true);
    const deletes = calls.filter(c => c.method === 'DELETE').map(c => c.path);
    expect(deletes).toContain('/api/v3/core/applications/grafana-x/');
    expect(deletes).toContain('/api/v3/providers/proxy/55/');
  });
});
