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
    // Polymorphic property-mappings list (the typed provider/scope endpoint 403s
    // for the scoped token — see resolveScopeMappingPks / issue #144). Default
    // scope mappings carry stable `managed` identifiers.
    if (method === 'GET' && url.pathname === '/api/v3/propertymappings/all/') {
      return json({ results: [
        { pk: 'scope-openid', managed: 'goauthentik.io/providers/oauth2/scope-openid', scope_name: 'openid' },
        { pk: 'scope-profile', managed: 'goauthentik.io/providers/oauth2/scope-profile', scope_name: 'profile' },
        { pk: 'scope-email', managed: 'goauthentik.io/providers/oauth2/scope-email', scope_name: 'email' },
        { pk: 'mapping-unrelated', managed: 'goauthentik.io/providers/ldap/something', scope_name: undefined },
      ] });
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

    // Scope mappings were resolved from the polymorphic endpoint and attached, so
    // the OIDC client releases openid/profile/email claims (issue #144). The
    // provisioner must NOT hit the typed endpoint the scoped token is denied.
    expect(pbody.property_mappings).toEqual(['scope-openid', 'scope-profile', 'scope-email']);
    expect(calls.some(c => c.path.startsWith('/api/v3/propertymappings/provider/scope/'))).toBe(false);

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

  test('native-oidc resolves scope mappings by managed id when scope_name is absent', async () => {
    // The polymorphic endpoint doesn't always surface scope_name; the `managed`
    // identifier is the stable fallback (issue #144).
    installFetch((call) => {
      if (call.method === 'GET' && call.path === '/api/v3/propertymappings/all/') return json({ results: [
        { pk: 'pk-openid', managed: 'goauthentik.io/providers/oauth2/scope-openid' },
        { pk: 'pk-profile', managed: 'goauthentik.io/providers/oauth2/scope-profile' },
        { pk: 'pk-email', managed: 'goauthentik.io/providers/oauth2/scope-email' },
      ] });
      return undefined;
    });
    const svc = new RealAuthentikProvisionerService(CONFIG);

    await svc.provision(OIDC_INPUT);

    const pbody = calls.find(c => c.method === 'POST' && c.path === '/api/v3/providers/oauth2/')!.body as Record<string, unknown>;
    expect(pbody.property_mappings).toEqual(['pk-openid', 'pk-profile', 'pk-email']);
  });

  test('native-oidc still provisions (with no scope mappings) if listing them fails', async () => {
    // Best-effort: a 403/500 on the list must not abort the whole provision.
    installFetch((call) => {
      if (call.method === 'GET' && call.path === '/api/v3/propertymappings/all/') return new Response('denied', { status: 403 });
      return undefined;
    });
    const svc = new RealAuthentikProvisionerService(CONFIG);

    const result = await svc.provision(OIDC_INPUT);

    const pbody = calls.find(c => c.method === 'POST' && c.path === '/api/v3/providers/oauth2/')!.body as Record<string, unknown>;
    expect(pbody.property_mappings).toEqual([]);
    expect(result.ref.providerPk).toBe(42);
  });

  test('native-oidc injects explicit IdP endpoints + static env (Postiz-style apps)', async () => {
    installFetch();
    const svc = new RealAuthentikProvisionerService(CONFIG);

    const result = await svc.provision({
      deploymentId: 'dep-postiz0123456789',
      appName: 'postiz',
      mode: 'native-oidc' as const,
      host: 'postiz.example.com',
      oidc: {
        redirectPath: '/settings',
        scopes: ['openid', 'profile', 'email'],
        env: {
          issuer: 'POSTIZ_OAUTH_URL',
          clientId: 'POSTIZ_OAUTH_CLIENT_ID',
          clientSecret: 'POSTIZ_OAUTH_CLIENT_SECRET',
          authUrl: 'POSTIZ_OAUTH_AUTH_URL',
          tokenUrl: 'POSTIZ_OAUTH_TOKEN_URL',
          userinfoUrl: 'POSTIZ_OAUTH_USERINFO_URL',
        },
        staticEnv: {
          POSTIZ_GENERIC_OAUTH: 'true',
          NEXT_PUBLIC_POSTIZ_OAUTH_DISPLAY_NAME: 'Authentik',
        },
      },
    });

    // Explicit Authentik endpoints (global, not per-application).
    expect(result.env.POSTIZ_OAUTH_AUTH_URL).toBe('https://auth.example.com/application/o/authorize/');
    expect(result.env.POSTIZ_OAUTH_TOKEN_URL).toBe('https://auth.example.com/application/o/token/');
    expect(result.env.POSTIZ_OAUTH_USERINFO_URL).toBe('https://auth.example.com/application/o/userinfo/');
    // Per-app issuer + generated creds.
    expect(result.env.POSTIZ_OAUTH_URL).toBe(`https://auth.example.com/application/o/${result.ref.applicationSlug}/`);
    expect(typeof result.env.POSTIZ_OAUTH_CLIENT_ID).toBe('string');
    expect(typeof result.env.POSTIZ_OAUTH_CLIENT_SECRET).toBe('string');
    // Static literals only present because OIDC was provisioned.
    expect(result.env.POSTIZ_GENERIC_OAUTH).toBe('true');
    expect(result.env.NEXT_PUBLIC_POSTIZ_OAUTH_DISPLAY_NAME).toBe('Authentik');
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
      if (method === 'GET' && url.pathname === '/api/v3/propertymappings/all/') return json({ results: [
        { pk: 'm', managed: 'goauthentik.io/providers/oauth2/scope-openid', scope_name: 'openid' },
      ] });
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
      // Self-heal check: the flow already ends with a user_login stage → no repair.
      if (call.method === 'GET' && call.path.startsWith('/api/v3/flows/bindings/?target=recovery-flow')) return json({ results: [
        { pk: 'b0', order: 0, stage_obj: { component: 'ak-stage-prompt-form' } },
        { pk: 'b1', order: 1, stage_obj: { component: 'ak-stage-user-write-form' } },
        { pk: 'b2', order: 2, stage_obj: { component: 'ak-stage-user-login-form' } },
      ] });
      if (call.method === 'GET' && call.path.startsWith('/api/v3/core/brands/')) return json({ results: [{ brand_uuid: 'b1', flow_recovery: null }] });
      if (call.method === 'POST' && call.path === '/api/v3/core/users/101/recovery/') return json({ link: 'https://auth.example.com/recovery/abc' });
      return undefined;
    });
    calls.length = 0;

    const svc = new RealAuthentikProvisionerService({ ...CONFIG, adminEmail: 'me@example.com' });
    const result = await svc.ensureBootstrapAdmin('hola-admins');

    expect(result.created).toBe(true);
    // The link points at the recovery flow, with a `next` that lands the operator
    // on the dashboard (not Authentik's "My applications") once they're signed in.
    const link = new URL(result.recoveryLink!);
    expect(link.origin + link.pathname).toBe('https://auth.example.com/recovery/abc');
    expect(link.searchParams.get('next')).toBe('/application/launch/hola-dashboard/');
    expect(patchedGroupUsers).toEqual([101]);
    // Bound a recovery flow to the default brand so /recovery/ works.
    expect(calls.some(c => c.method === 'PATCH' && c.path === '/api/v3/core/brands/b1/')).toBe(true);
  });

  test('ensureBootstrapAdmin retries the recovery mint until the flow blueprint lands', async () => {
    // On a fresh Authentik boot the recovery-flow blueprint is applied a little
    // after the API starts answering, so the flow query is empty at first.
    let flowQueries = 0;
    installFetch((call) => {
      if (call.method === 'GET' && call.path.startsWith('/api/v3/core/users/?email=')) return json({ results: [] });
      if (call.method === 'POST' && call.path === '/api/v3/core/users/') return json({ pk: 101, last_login: null }, 201);
      if (call.method === 'GET' && call.path.startsWith('/api/v3/core/groups/?name=')) return json({ results: [{ pk: 'g1', users: [] }] });
      if (call.method === 'PATCH' && call.path === '/api/v3/core/groups/g1/') return json({ pk: 'g1' });
      if (call.method === 'GET' && call.path.startsWith('/api/v3/flows/instances/?designation=recovery')) {
        flowQueries += 1;
        return json({ results: flowQueries >= 3 ? [{ pk: 'recovery-flow' }] : [] }); // empty until the 3rd poll
      }
      if (call.method === 'GET' && call.path.startsWith('/api/v3/flows/bindings/?target=recovery-flow')) return json({ results: [
        { pk: 'b0', order: 0, stage_obj: { component: 'ak-stage-prompt-form' } },
        { pk: 'b1', order: 1, stage_obj: { component: 'ak-stage-user-write-form' } },
        { pk: 'b2', order: 2, stage_obj: { component: 'ak-stage-user-login-form' } },
      ] });
      if (call.method === 'GET' && call.path.startsWith('/api/v3/core/brands/')) return json({ results: [{ brand_uuid: 'b1', flow_recovery: null }] });
      if (call.method === 'POST' && call.path === '/api/v3/core/users/101/recovery/') return json({ link: 'https://auth.example.com/recovery/late' });
      return undefined;
    });
    calls.length = 0;

    // Subclass to skip the real backoff delays.
    class FastProvisioner extends RealAuthentikProvisionerService {
      protected sleep(): Promise<void> { return Promise.resolve(); }
    }
    const svc = new FastProvisioner({ ...CONFIG, adminEmail: 'me@example.com' });
    const result = await svc.ensureBootstrapAdmin('hola-admins');

    expect(flowQueries).toBeGreaterThanOrEqual(3); // kept polling until the flow appeared
    const lateLink = new URL(result.recoveryLink!);
    expect(lateLink.origin + lateLink.pathname).toBe('https://auth.example.com/recovery/late');
    expect(lateLink.searchParams.get('next')).toBe('/application/launch/hola-dashboard/');
    expect(calls.some((c) => c.method === 'PATCH' && c.path === '/api/v3/core/brands/b1/')).toBe(true);
  });

  test('ensureBootstrapAdmin creates a recovery flow when Authentik ships none', async () => {
    // Authentik 2025.x has no recovery flow, but does ship default-password-change
    // (a Prompt + User Write stage) we can reuse.
    const created: string[] = [];
    installFetch((call) => {
      if (call.method === 'GET' && call.path.startsWith('/api/v3/core/users/?email=')) return json({ results: [] });
      if (call.method === 'POST' && call.path === '/api/v3/core/users/') return json({ pk: 101, last_login: null }, 201);
      if (call.method === 'GET' && call.path.startsWith('/api/v3/core/groups/?name=')) return json({ results: [{ pk: 'g1', users: [] }] });
      if (call.method === 'PATCH' && call.path === '/api/v3/core/groups/g1/') return json({ pk: 'g1' });
      // No recovery flow, and our hola-recovery flow doesn't exist yet.
      if (call.method === 'GET' && call.path.startsWith('/api/v3/flows/instances/?designation=recovery')) return json({ results: [] });
      if (call.method === 'GET' && call.path.startsWith('/api/v3/flows/instances/?slug=hola-recovery')) return json({ results: [] });
      // default-password-change exists with two stages to reuse.
      if (call.method === 'GET' && call.path.startsWith('/api/v3/flows/instances/?slug=default-password-change')) return json({ results: [{ pk: 'pw-flow' }] });
      if (call.method === 'GET' && call.path.startsWith('/api/v3/flows/bindings/?target=pw-flow')) return json({ results: [{ stage: 'prompt-stage', order: 0 }, { stage: 'write-stage', order: 1 }] });
      // Self-heal reads the new flow's bindings (prompt + write, no login yet)…
      if (call.method === 'GET' && call.path.startsWith('/api/v3/flows/bindings/?target=hola-recovery-pk')) return json({ results: [
        { pk: 'rb0', order: 0, stage_obj: { component: 'ak-stage-prompt-form' } },
        { pk: 'rb1', order: 1, stage_obj: { component: 'ak-stage-user-write-form' } },
      ] });
      // …then resolves the Login stage from /stages/all/ by COMPONENT. That
      // endpoint ignores name__iexact and lists every stage (a password stage
      // sorts first here), and the scoped token can't read the typed
      // /stages/user_login/ endpoint — so the code must filter by component and
      // prefer the default-authentication-login name, not take results[0].
      if (call.method === 'GET' && call.path.startsWith('/api/v3/stages/all/')) return json({ results: [
        { pk: 'pw-stage', name: 'default-authentication-password', component: 'ak-stage-password-form' },
        { pk: 'src-login', name: 'default-source-enrollment-login', component: 'ak-stage-user-login-form' },
        { pk: 'login-stage', name: 'default-authentication-login', component: 'ak-stage-user-login-form' },
      ] });
      if (call.method === 'POST' && call.path === '/api/v3/flows/instances/') { created.push('flow'); return json({ pk: 'hola-recovery-pk' }, 201); }
      if (call.method === 'POST' && call.path === '/api/v3/flows/bindings/') { const b = call.body as { stage: string; order: number }; created.push(`bind:${b.stage}@${b.order}`); return json({ pk: 'b' }, 201); }
      if (call.method === 'GET' && call.path.startsWith('/api/v3/core/brands/')) return json({ results: [{ brand_uuid: 'b1', flow_recovery: null }] });
      if (call.method === 'POST' && call.path === '/api/v3/core/users/101/recovery/') return json({ link: 'https://auth.example.com/if/flow/hola-recovery/?flow_token=abc' });
      return undefined;
    });
    calls.length = 0;

    const svc = new RealAuthentikProvisionerService({ ...CONFIG, adminEmail: 'me@example.com' });
    const result = await svc.ensureBootstrapAdmin('hola-admins');

    expect(result.recoveryLink).toContain('hola-recovery');
    expect(new URL(result.recoveryLink!).searchParams.get('next')).toBe('/application/launch/hola-dashboard/');
    // It created the flow, rebound the two reused stages, then appended the Login
    // stage as the final binding (order after the reused stages) for auto-login.
    expect(created).toEqual(['flow', 'bind:prompt-stage@0', 'bind:write-stage@1', 'bind:login-stage@2']);
    // And bound the new flow to the default brand.
    expect(calls.some((c) => c.method === 'PATCH' && c.path === '/api/v3/core/brands/b1/'
      && (c.body as { flow_recovery: string }).flow_recovery === 'hola-recovery-pk')).toBe(true);
  });

  test('ensureBootstrapAdmin rewrites the recovery link to the public Authentik URL', async () => {
    installFetch((call) => {
      if (call.method === 'GET' && call.path.startsWith('/api/v3/core/users/?email=')) return json({ results: [] });
      if (call.method === 'POST' && call.path === '/api/v3/core/users/') return json({ pk: 101, last_login: null }, 201);
      if (call.method === 'GET' && call.path.startsWith('/api/v3/core/groups/?name=')) return json({ results: [{ pk: 'g1', users: [] }] });
      if (call.method === 'PATCH' && call.path === '/api/v3/core/groups/g1/') return json({ pk: 'g1' });
      if (call.method === 'GET' && call.path.startsWith('/api/v3/flows/instances/?designation=recovery')) return json({ results: [{ pk: 'recovery-flow' }] });
      if (call.method === 'GET' && call.path.startsWith('/api/v3/flows/bindings/?target=recovery-flow')) return json({ results: [
        { pk: 'b0', order: 0, stage_obj: { component: 'ak-stage-prompt-form' } },
        { pk: 'b1', order: 1, stage_obj: { component: 'ak-stage-user-write-form' } },
        { pk: 'b2', order: 2, stage_obj: { component: 'ak-stage-user-login-form' } },
      ] });
      if (call.method === 'GET' && call.path.startsWith('/api/v3/core/brands/')) return json({ results: [{ brand_uuid: 'b1', flow_recovery: null }] });
      // Authentik returns the link on the INTERNAL host the API was called on.
      if (call.method === 'POST' && call.path === '/api/v3/core/users/101/recovery/') return json({ link: 'http://authentik-server:9000/if/flow/hola-recovery/?flow_token=tok' });
      return undefined;
    });
    calls.length = 0;
    // CONFIG.authentikPublicUrl is https://auth.example.com.
    const svc = new RealAuthentikProvisionerService({ ...CONFIG, adminEmail: 'me@example.com' });
    const result = await svc.ensureBootstrapAdmin('hola-admins');
    // Origin rewritten to the public host; the existing flow_token query is preserved
    // and the dashboard-landing `next` is appended alongside it.
    const publicLink = new URL(result.recoveryLink!);
    expect(publicLink.origin + publicLink.pathname).toBe('https://auth.example.com/if/flow/hola-recovery/');
    expect(publicLink.searchParams.get('flow_token')).toBe('tok');
    expect(publicLink.searchParams.get('next')).toBe('/application/launch/hola-dashboard/');
  });

  test('ensureBootstrapAdmin repairs a legacy recovery flow that lacks the login stage', async () => {
    // Reproduces the host bug: an existing flow ends with a stray PASSWORD stage
    // (mis-bound by the old /stages/all/ filter) instead of a user_login stage,
    // so the operator was never signed in. Self-heal must drop the password
    // binding and append a real user_login stage.
    const deleted: string[] = [];
    const bound: Array<{ target: string; stage: string; order: number }> = [];
    installFetch((call) => {
      if (call.method === 'GET' && call.path.startsWith('/api/v3/core/users/?email=')) return json({ results: [] });
      if (call.method === 'POST' && call.path === '/api/v3/core/users/') return json({ pk: 101, last_login: null }, 201);
      if (call.method === 'GET' && call.path.startsWith('/api/v3/core/groups/?name=')) return json({ results: [{ pk: 'g1', users: [] }] });
      if (call.method === 'PATCH' && call.path === '/api/v3/core/groups/g1/') return json({ pk: 'g1' });
      if (call.method === 'GET' && call.path.startsWith('/api/v3/flows/instances/?designation=recovery')) return json({ results: [{ pk: 'broken-flow' }] });
      if (call.method === 'GET' && call.path.startsWith('/api/v3/flows/bindings/?target=broken-flow')) return json({ results: [
        { pk: 'b0', order: 0, stage_obj: { component: 'ak-stage-prompt-form' } },
        { pk: 'b1', order: 1, stage_obj: { component: 'ak-stage-user-write-form' } },
        { pk: 'bpw', order: 2, stage_obj: { component: 'ak-stage-password-form' } }, // the bug
      ] });
      if (call.method === 'DELETE' && call.path.startsWith('/api/v3/flows/bindings/')) { deleted.push(call.path); return new Response(null, { status: 204 }); }
      if (call.method === 'GET' && call.path.startsWith('/api/v3/stages/all/')) return json({ results: [
        { pk: 'pw-stage', name: 'default-authentication-password', component: 'ak-stage-password-form' },
        { pk: 'login-stage', name: 'default-authentication-login', component: 'ak-stage-user-login-form' },
      ] });
      if (call.method === 'POST' && call.path === '/api/v3/flows/bindings/') { bound.push(call.body as { target: string; stage: string; order: number }); return json({ pk: 'nb' }, 201); }
      // Brand already bound to this flow → no re-patch needed.
      if (call.method === 'GET' && call.path.startsWith('/api/v3/core/brands/')) return json({ results: [{ brand_uuid: 'b1', flow_recovery: 'broken-flow' }] });
      if (call.method === 'POST' && call.path === '/api/v3/core/users/101/recovery/') return json({ link: 'https://auth.example.com/if/flow/hola-recovery/?flow_token=t' });
      return undefined;
    });
    calls.length = 0;
    const svc = new RealAuthentikProvisionerService({ ...CONFIG, adminEmail: 'me@example.com' });
    await svc.ensureBootstrapAdmin('hola-admins');

    // Deleted exactly the stray password binding…
    expect(deleted).toEqual(['/api/v3/flows/bindings/bpw/']);
    // …and appended the user_login stage after the two kept stages (order 2).
    expect(bound).toEqual([{ target: 'broken-flow', stage: 'login-stage', order: 2 }]);
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
