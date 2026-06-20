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
  ldapHost: 'authentik-ldap',
  ldapPort: '3389',
  ldapBaseDn: 'dc=hola,dc=internal',
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
    if (method === 'POST' && url.pathname === '/api/v3/core/users/') {
      return json({ pk: 88, username: body.username }, 201);
    }
    if (method === 'POST' && /^\/api\/v3\/core\/users\/\d+\/set_password\/$/.test(url.pathname)) {
      return new Response(null, { status: 204 });
    }
    if (method === 'POST' && /^\/api\/v3\/rbac\/permissions\/assigned\/users\/\d+\/assign\/$/.test(url.pathname)) {
      return json({});
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

  const LDAP_INPUT = {
    deploymentId: 'dep-abcdef0123456789',
    appName: 'nextcloud',
    mode: 'native-ldap' as const,
    host: 'nextcloud.example.com',
    ldap: {
      env: { host: 'LDAP_HOST', port: 'LDAP_PORT', bindDn: 'LDAP_BIND_DN', bindPassword: 'LDAP_BIND_PW', baseDn: 'LDAP_BASE_DN' },
    },
  };

  test('native-ldap provision creates a bind service account, sets its password, maps env', async () => {
    installFetch();
    const svc = new RealAuthentikProvisionerService(CONFIG);

    const result = await svc.provision(LDAP_INPUT);

    // A service-account user was created and given a password.
    const userCall = calls.find(c => c.method === 'POST' && c.path === '/api/v3/core/users/')!;
    expect(userCall).toBeDefined();
    expect((userCall.body as Record<string, unknown>).type).toBe('service_account');
    expect(calls.some(c => c.method === 'POST' && /\/api\/v3\/core\/users\/88\/set_password\/$/.test(c.path))).toBe(true);

    // Env mapped onto the app's expected names, with a DN derived from the username.
    expect(result.env.LDAP_HOST).toBe('authentik-ldap');
    expect(result.env.LDAP_PORT).toBe('3389');
    expect(result.env.LDAP_BASE_DN).toBe('dc=hola,dc=internal');
    expect(result.env.LDAP_BIND_DN).toMatch(/^cn=hola-nextcloud-.*,ou=users,dc=hola,dc=internal$/);
    expect(typeof result.env.LDAP_BIND_PW).toBe('string');
    expect(result.ref).toMatchObject({ mode: 'native-ldap', bindAccountPk: 88 });
  });

  test('native-ldap re-provision reuses the bind account (only resets the password)', async () => {
    installFetch();
    const svc = new RealAuthentikProvisionerService(CONFIG);

    await svc.provision({ ...LDAP_INPUT, existingRef: { mode: 'native-ldap', bindAccountPk: 88 } });

    // No new user created; password re-set on the existing account.
    expect(calls.some(c => c.method === 'POST' && c.path === '/api/v3/core/users/')).toBe(false);
    expect(calls.some(c => /\/api\/v3\/core\/users\/88\/set_password\/$/.test(c.path))).toBe(true);
  });

  test('native-ldap deprovision deletes the bind account', async () => {
    installFetch();
    const svc = new RealAuthentikProvisionerService(CONFIG);
    await svc.deprovision({ deploymentId: 'x', ref: { mode: 'native-ldap', bindAccountPk: 88 } });
    expect(calls.some(c => c.method === 'DELETE' && c.path === '/api/v3/core/users/88/')).toBe(true);
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

    // Outpost's browser host is pinned to the public Authentik URL, otherwise it
    // defaults to http://0.0.0.0:9000 and forward-auth login redirects 302 to a
    // host the user's browser can't reach.
    const cfg = (patch.body as { config?: Record<string, unknown> }).config;
    expect(cfg?.authentik_host).toBe('https://auth.example.com');
    expect(cfg?.authentik_host_browser).toBe('https://auth.example.com');

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

describe('RealAuthentikProvisionerService — scoped-token bootstrap', () => {
  const BOOTSTRAP_CONFIG: AuthConfig = { ...CONFIG, authentikApiToken: undefined, authentikBootstrapToken: 'admin-tok' };
  let bootCalls: Array<{ method: string; path: string; auth?: string; body?: Record<string, unknown> }>;

  beforeEach(() => {
    bootCalls = [];
    originalFetch = globalThis.fetch;
    let tokenCreated = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      bootCalls.push({ method, path: url.pathname, auth, body });

      if (method === 'GET' && url.pathname === '/api/v3/core/users/') return json({ results: [] }); // no SA yet
      if (method === 'POST' && url.pathname === '/api/v3/core/users/service_account/') return json({ user_pk: 9, username: 'hola-provisioner' }, 201);
      if (method === 'POST' && url.pathname === '/api/v3/rbac/permissions/assigned_by_users/9/assign/') return json({});
      if (method === 'GET' && url.pathname === '/api/v3/core/tokens/hola-provisioner-token/view_key/') {
        return tokenCreated ? json({ key: 'scoped-key-xyz' }) : new Response('gone', { status: 404 });
      }
      if (method === 'POST' && url.pathname === '/api/v3/core/tokens/') { tokenCreated = true; return json({ pk: 1 }, 201); }
      // OIDC provisioning calls (should use the scoped token):
      if (method === 'GET' && url.pathname.startsWith('/api/v3/flows/instances/')) return json({ pk: 'flow' });
      if (method === 'GET' && url.pathname.startsWith('/api/v3/propertymappings/provider/scope/')) return json({ results: [{ pk: 'm' }] });
      if (method === 'POST' && url.pathname === '/api/v3/providers/oauth2/') return json({ pk: 1, client_id: body.client_id, client_secret: body.client_secret }, 201);
      if (method === 'POST' && url.pathname === '/api/v3/core/applications/') return json({ pk: 2 }, 201);
      return new Response('unexpected', { status: 500 });
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('mints a scoped token from the bootstrap token, then provisions with the scoped token', async () => {
    const svc = new RealAuthentikProvisionerService(BOOTSTRAP_CONFIG);
    const result = await svc.provision(OIDC_INPUT);

    // Bootstrap sequence ran with the ADMIN token: ensure SA, assign perms, mint + read token.
    const boot = bootCalls.filter(c =>
      c.path === '/api/v3/core/users/service_account/' ||
      c.path === '/api/v3/rbac/permissions/assigned_by_users/9/assign/' ||
      c.path === '/api/v3/core/tokens/');
    expect(boot.length).toBe(3);
    expect(boot.every(c => c.auth === 'Bearer admin-tok')).toBe(true);
    // Assigned a non-superuser permission set (a representative perm is present).
    const assign = bootCalls.find(c => c.path === '/api/v3/rbac/permissions/assigned_by_users/9/assign/')!;
    expect((assign.body!.permissions as string[])).toContain('authentik_providers_oauth2.add_oauth2provider');

    // The actual provisioning calls used the SCOPED token, not the admin token.
    const providerCall = bootCalls.find(c => c.method === 'POST' && c.path === '/api/v3/providers/oauth2/')!;
    expect(providerCall.auth).toBe('Bearer scoped-key-xyz');
    expect(result.ref.providerPk).toBe(1);

    // A second provision reuses the cached scoped token (no second bootstrap).
    bootCalls.length = 0;
    await svc.provision({ ...OIDC_INPUT, deploymentId: 'dep-second-0002' });
    expect(bootCalls.some(c => c.path === '/api/v3/core/users/service_account/')).toBe(false);
    expect(bootCalls.find(c => c.path === '/api/v3/providers/oauth2/')!.auth).toBe('Bearer scoped-key-xyz');
  });

  test('ensureAdminGroup creates the group and seeds all superusers', async () => {
    let created = false;
    let patchedUsers: number[] | undefined;
    installFetch((call) => {
      if (call.method === 'GET' && call.path.startsWith('/api/v3/core/groups/?name=')) {
        return created ? json({ results: [{ pk: 'g1', users: [] }] }) : json({ results: [] });
      }
      if (call.method === 'POST' && call.path === '/api/v3/core/groups/') {
        created = true;
        return json({ pk: 'g1', users: [] }, 201);
      }
      if (call.method === 'GET' && call.path.startsWith('/api/v3/core/users/?is_superuser=true')) {
        return json({ results: [{ pk: 7 }, { pk: 9 }] });
      }
      if (call.method === 'PATCH' && call.path === '/api/v3/core/groups/g1/') {
        patchedUsers = (call.body as { users: number[] }).users;
        return json({ pk: 'g1' });
      }
      return undefined;
    });

    const svc = new RealAuthentikProvisionerService(CONFIG);
    await svc.ensureAdminGroup('hola-admins');

    // Group was created, then PATCHed to contain both superusers.
    expect(calls.some(c => c.method === 'POST' && c.path === '/api/v3/core/groups/')).toBe(true);
    expect(patchedUsers).toEqual([7, 9]);
  });

  test('ensureAdminGroup is best-effort: a backend error does not throw', async () => {
    installFetch((call) => {
      if (call.path.startsWith('/api/v3/core/groups/')) return new Response('boom', { status: 500 });
      return undefined;
    });
    const svc = new RealAuthentikProvisionerService(CONFIG);
    await expect(svc.ensureAdminGroup('hola-admins')).resolves.toBeUndefined();
  });

  test('ensureBootstrapAdmin creates the user, adds it to the group, returns a recovery link', async () => {
    let patchedGroupUsers: number[] | undefined;
    installFetch((call) => {
      if (call.method === 'GET' && call.path.startsWith('/api/v3/core/users/?email=')) return json({ results: [] });
      if (call.method === 'POST' && call.path === '/api/v3/core/users/') return json({ pk: 101, last_login: null }, 201);
      if (call.method === 'GET' && call.path.startsWith('/api/v3/core/groups/?name=')) return json({ results: [{ pk: 'g1', users: [] }] });
      if (call.method === 'PATCH' && call.path === '/api/v3/core/groups/g1/') {
        patchedGroupUsers = (call.body as { users: number[] }).users;
        return json({ pk: 'g1' });
      }
      if (call.method === 'GET' && call.path.startsWith('/api/v3/flows/instances/?designation=recovery')) return json({ results: [{ pk: 'recovery-flow' }] });
      if (call.method === 'GET' && call.path.startsWith('/api/v3/core/brands/')) return json({ results: [{ brand_uuid: 'b1', flow_recovery: null }] });
      if (call.method === 'POST' && call.path === '/api/v3/core/users/101/recovery/') return json({ link: 'https://auth.example.com/recovery/abc' });
      return undefined;
    });
    calls.length = 0;

    const svc = new RealAuthentikProvisionerService({ ...CONFIG, adminEmail: 'me@example.com' });
    const result = await svc.ensureBootstrapAdmin('hola-admins');

    expect(result.created).toBe(true);
    expect(result.recoveryLink).toBe('https://auth.example.com/recovery/abc');
    expect(patchedGroupUsers).toEqual([101]);
    // Bound a recovery flow to the default brand so /recovery/ works.
    expect(calls.some(c => c.method === 'PATCH' && c.path === '/api/v3/core/brands/b1/')).toBe(true);
  });

  test('ensureBootstrapAdmin no-ops without HOLA_ADMIN_EMAIL', async () => {
    installFetch();
    calls.length = 0;
    const svc = new RealAuthentikProvisionerService(CONFIG);
    const result = await svc.ensureBootstrapAdmin('hola-admins');
    expect(result).toEqual({ created: false });
    expect(calls.some(c => c.path.startsWith('/api/v3/core/users/?email='))).toBe(false);
  });

  test('ensureBootstrapAdmin skips the recovery link once the admin has logged in', async () => {
    installFetch((call) => {
      if (call.method === 'GET' && call.path.startsWith('/api/v3/core/users/?email=')) {
        return json({ results: [{ pk: 101, last_login: '2026-01-01T00:00:00Z' }] });
      }
      if (call.method === 'GET' && call.path.startsWith('/api/v3/core/groups/?name=')) return json({ results: [{ pk: 'g1', users: [101] }] });
      return undefined;
    });
    calls.length = 0;
    const svc = new RealAuthentikProvisionerService({ ...CONFIG, adminEmail: 'me@example.com' });
    const result = await svc.ensureBootstrapAdmin('hola-admins');
    expect(result).toEqual({ created: false });
    expect(calls.some(c => c.path.endsWith('/recovery/'))).toBe(false);
  });
});
