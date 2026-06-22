/**
 * Authentik provisioner — end-to-end against a real Authentik (#102, real daemon)
 *
 * Boots a real Authentik (server + Postgres) in Docker, bootstraps an API token,
 * and drives RealAuthentikProvisionerService against it for all three auth modes,
 * asserting the artifacts actually exist in Authentik via its REST API and are
 * torn down on deprovision. This is the real-world check the unit contract tests
 * (mocked fetch) can't give. Gated on Docker; run via `bun test:integration`.
 *
 * First boot pulls the image + runs migrations, so beforeAll is slow (minutes).
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { exec } from 'child_process';
import { promisify } from 'util';
import { randomBytes } from 'crypto';

import { RealAuthentikProvisionerService } from '../../services/core/provisioner';
import type { AuthConfig } from '../../config/auth';

const execAsync = promisify(exec);

async function sh(cmd: string, timeout = 120_000): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout });
    return { stdout, stderr, ok: true };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '', ok: false };
  }
}

async function detectDocker(): Promise<boolean> {
  const res = await sh('docker version --format "{{.Server.Version}}"', 15_000);
  return res.ok && res.stdout.trim().length > 0;
}

const dockerOk = await detectDocker();
if (!dockerOk) {
  console.warn('[#102] Docker unavailable — skipping Authentik provisioner e2e');
}

// Fixed names/ports for this test run; cleaned up in afterAll.
const NET = 'hola-ak-it';
const PG = 'hola-ak-it-pg';
const SERVER = 'hola-ak-it-server';
const WORKER = 'hola-ak-it-worker';
const HOST_PORT = 9123;
const IMAGE = 'ghcr.io/goauthentik/server:2025.10';
const PG_IMAGE = 'docker.io/library/postgres:16-alpine';
const SECRET_KEY = randomBytes(40).toString('hex');
const PG_PASS = randomBytes(16).toString('hex');
const BOOTSTRAP_TOKEN = randomBytes(32).toString('hex');
const BASE_URL = `http://localhost:${HOST_PORT}`;

const config: AuthConfig = {
  mode: 'authentik',
  authentikUrl: BASE_URL,
  authentikPublicUrl: BASE_URL,
  authentikApiToken: BOOTSTRAP_TOKEN,
  fetchTimeoutMs: 15_000,
  ldapHost: 'authentik-ldap',
  ldapPort: '3389',
  ldapBaseDn: 'dc=hola,dc=internal',
};

/** Authenticated GET against Authentik; returns { status, body }. */
async function akGet(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: { Authorization: `Bearer ${BOOTSTRAP_TOKEN}` } });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

async function waitForApi(timeoutMs = 300_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(`${BASE_URL}/api/v3/admin/version/`, {
        headers: { Authorization: `Bearer ${BOOTSTRAP_TOKEN}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() - start > timeoutMs) {
      const logs = await sh(`docker logs --tail 40 ${SERVER}`, 15_000);
      throw new Error(`Authentik API not ready in ${timeoutMs}ms. Last server logs:\n${logs.stdout}\n${logs.stderr}`);
    }
    await new Promise(r => setTimeout(r, 3_000));
  }
}

describe.skipIf(!dockerOk)('Authentik provisioner (real daemon)', () => {
  // Shared Authentik env for server + worker.
  const akEnv =
    `-e AUTHENTIK_SECRET_KEY=${SECRET_KEY} ` +
    `-e AUTHENTIK_POSTGRESQL__HOST=${PG} -e AUTHENTIK_POSTGRESQL__USER=authentik ` +
    `-e AUTHENTIK_POSTGRESQL__PASSWORD=${PG_PASS} -e AUTHENTIK_POSTGRESQL__NAME=authentik ` +
    `-e AUTHENTIK_BOOTSTRAP_TOKEN=${BOOTSTRAP_TOKEN} -e AUTHENTIK_BOOTSTRAP_PASSWORD=${PG_PASS}`;

  beforeAll(async () => {
    // Clean any leftovers from a prior aborted run.
    await sh(`docker rm -f ${SERVER} ${WORKER} ${PG} 2>/dev/null; docker network rm ${NET} 2>/dev/null`, 30_000);
    await sh(`docker network create ${NET}`, 30_000);

    const pg = await sh(
      `docker run -d --name ${PG} --network ${NET} ` +
        `-e POSTGRES_USER=authentik -e POSTGRES_PASSWORD=${PG_PASS} -e POSTGRES_DB=authentik ${PG_IMAGE}`,
      120_000
    );
    if (!pg.ok) throw new Error(`failed to start postgres: ${pg.stderr}`);

    const server = await sh(`docker run -d --name ${SERVER} --network ${NET} -p ${HOST_PORT}:9000 ${akEnv} ${IMAGE} server`, 180_000);
    if (!server.ok) throw new Error(`failed to start authentik-server: ${server.stderr}`);

    // The worker runs the bootstrap task that creates the akadmin user + API token,
    // so the API rejects the bootstrap token until the worker has run. Required.
    const worker = await sh(`docker run -d --name ${WORKER} --network ${NET} ${akEnv} ${IMAGE} worker`, 180_000);
    if (!worker.ok) throw new Error(`failed to start authentik-worker: ${worker.stderr}`);

    await waitForApi();
  }, 600_000);

  afterAll(async () => {
    await sh(`docker rm -f ${SERVER} ${WORKER} ${PG} 2>/dev/null; docker network rm ${NET} 2>/dev/null`, 60_000);
  });

  test('native-oidc: provisions a real OAuth2 provider + application, then tears them down', async () => {
    const svc = new RealAuthentikProvisionerService(config);
    const result = await svc.provision({
      deploymentId: 'dep-oidc-0001abcd',
      appName: 'gitea',
      mode: 'native-oidc',
      host: 'gitea.example.com',
      oidc: {
        redirectPath: '/user/oauth2/authentik/callback',
        scopes: ['openid', 'profile', 'email'],
        env: { issuer: 'ISSUER', clientId: 'CID', clientSecret: 'SECRET', redirectUri: 'REDIRECT' },
      },
    });

    expect(result.ref.providerPk).toBeDefined();
    // The provider really exists and carries the credentials Hola generated.
    const provider = (await akGet(`/api/v3/providers/oauth2/${result.ref.providerPk}/`)) as {
      status: number;
      body: { client_id: string; redirect_uris: Array<{ url: string }> };
    };
    expect(provider.status).toBe(200);
    expect(provider.body.client_id).toBe(result.env.CID);
    expect(JSON.stringify(provider.body.redirect_uris)).toContain('https://gitea.example.com/user/oauth2/authentik/callback');

    // The application exists and points at the provider.
    const app = await akGet(`/api/v3/core/applications/${result.ref.applicationSlug}/`);
    expect(app.status).toBe(200);

    // Deprovision removes both.
    await svc.deprovision({ deploymentId: 'dep-oidc-0001abcd', ref: result.ref });
    expect((await akGet(`/api/v3/providers/oauth2/${result.ref.providerPk}/`)).status).toBe(404);
    expect((await akGet(`/api/v3/core/applications/${result.ref.applicationSlug}/`)).status).toBe(404);
  }, 120_000);

  test('forward-auth: provisions a proxy provider and binds the embedded outpost', async () => {
    const svc = new RealAuthentikProvisionerService(config);
    const result = await svc.provision({
      deploymentId: 'dep-fwd-0002abcd',
      appName: 'grafana',
      mode: 'forward-auth',
      host: 'grafana.example.com',
    });

    expect(result.ref.providerPk).toBeDefined();
    expect(result.middleware?.outpostUrl).toBe(BASE_URL);

    // Proxy provider exists with the app's external host.
    const provider = (await akGet(`/api/v3/providers/proxy/${result.ref.providerPk}/`)) as {
      status: number;
      body: { external_host: string };
    };
    expect(provider.status).toBe(200);
    expect(provider.body.external_host).toBe('https://grafana.example.com');

    // The embedded outpost now lists the provider.
    const outpost = (await akGet(`/api/v3/outposts/instances/${result.ref.outpostPk}/`)) as {
      status: number;
      body: { providers: number[] };
    };
    expect(outpost.status).toBe(200);
    expect(outpost.body.providers).toContain(result.ref.providerPk!);

    await svc.deprovision({ deploymentId: 'dep-fwd-0002abcd', ref: result.ref });
    expect((await akGet(`/api/v3/providers/proxy/${result.ref.providerPk}/`)).status).toBe(404);
    // And the outpost no longer lists it.
    const after = (await akGet(`/api/v3/outposts/instances/${result.ref.outpostPk}/`)) as {
      status: number;
      body: { providers: number[] };
    };
    expect(after.body.providers).not.toContain(result.ref.providerPk!);
  }, 120_000);

  test('scoped-token bootstrap: self-mints a non-superuser token and provisions with it', async () => {
    // No direct API token — force the self-bootstrap path from the admin token.
    const svc = new RealAuthentikProvisionerService({ ...config, authentikApiToken: undefined, authentikBootstrapToken: BOOTSTRAP_TOKEN });

    // native-oidc through the scoped token (exercises provider/app/flows/scope mappings).
    const oidc = await svc.provision({
      deploymentId: 'dep-scoped-oidc-01',
      appName: 'gitea',
      mode: 'native-oidc',
      host: 'g.example.com',
      oidc: { redirectPath: '/cb', scopes: ['openid', 'email'], env: { issuer: 'I', clientId: 'C', clientSecret: 'S', redirectUri: 'R' } },
    });
    expect((await akGet(`/api/v3/providers/oauth2/${oidc.ref.providerPk}/`)).status).toBe(200);
    await svc.deprovision({ deploymentId: 'dep-scoped-oidc-01', ref: oidc.ref });

    // native-ldap through the scoped token (exercises create_user + set_password + the grant).
    const ldap = await svc.provision({
      deploymentId: 'dep-scoped-ldap-01',
      appName: 'nextcloud',
      mode: 'native-ldap',
      host: 'nc.example.com',
      ldap: { env: { host: 'H', port: 'P', bindDn: 'BIND_DN', bindPassword: 'BIND_PW', baseDn: 'BASE_DN' } },
    });
    expect((await akGet(`/api/v3/core/users/${ldap.ref.bindAccountPk}/`)).status).toBe(200);
    await svc.deprovision({ deploymentId: 'dep-scoped-ldap-01', ref: ldap.ref });

    // The bootstrapped service account exists and is NOT a superuser.
    const users = (await akGet('/api/v3/core/users/?username=hola-provisioner')) as {
      status: number;
      body: { results: Array<{ is_superuser: boolean }> };
    };
    expect(users.status).toBe(200);
    expect(users.body.results.length).toBeGreaterThan(0);
    expect(users.body.results[0].is_superuser).toBe(false);
  }, 120_000);

  test('native-ldap: provisions a real bind service account, then deletes it', async () => {
    const svc = new RealAuthentikProvisionerService(config);
    const result = await svc.provision({
      deploymentId: 'dep-ldap-0003abcd',
      appName: 'nextcloud',
      mode: 'native-ldap',
      host: 'nextcloud.example.com',
      ldap: {
        env: { host: 'H', port: 'P', bindDn: 'BIND_DN', bindPassword: 'BIND_PW', baseDn: 'BASE_DN' },
      },
    });

    expect(result.ref.bindAccountPk).toBeDefined();
    expect(result.env.BIND_DN).toMatch(/^cn=hola-nextcloud-.*,ou=users,dc=hola,dc=internal$/);

    // The bind user really exists.
    const user = await akGet(`/api/v3/core/users/${result.ref.bindAccountPk}/`);
    expect(user.status).toBe(200);

    // ...and was granted directory-search rights (regression guard for the grant
    // endpoint/codename — this is otherwise a best-effort, swallowed call).
    const perms = (await akGet(`/api/v3/rbac/permissions/?user=${result.ref.bindAccountPk}`)) as {
      status: number;
      body: { results: Array<{ app_label: string; codename: string }> };
    };
    expect(perms.status).toBe(200);
    expect(perms.body.results.some(p => p.app_label === 'authentik_providers_ldap' && p.codename === 'search_full_directory')).toBe(true);

    await svc.deprovision({ deploymentId: 'dep-ldap-0003abcd', ref: result.ref });
    expect((await akGet(`/api/v3/core/users/${result.ref.bindAccountPk}/`)).status).toBe(404);
  }, 120_000);

  test('scoped-token bootstrap admin: creates the missing recovery flow and mints a link', async () => {
    // Authentik 2025.x ships NO recovery flow, so the provisioner must create one.
    // Use the self-bootstrapped scoped token (not the superuser admin token) so this
    // also verifies the scoped permission set can add the flow + stage bindings.
    const svc = new RealAuthentikProvisionerService({
      ...config, authentikApiToken: undefined, authentikBootstrapToken: BOOTSTRAP_TOKEN, adminEmail: 'recovery-it@example.com',
    });

    // Precondition: confirm Authentik really ships no recovery flow out of the box.
    const before = (await akGet('/api/v3/flows/instances/?designation=recovery')) as {
      status: number; body: { results: unknown[] };
    };
    expect(before.body.results.length).toBe(0);

    await svc.ensureAdminGroup('hola-admins');
    const result = await svc.ensureBootstrapAdmin('hola-admins');

    expect(result.recoveryLink).toBeTruthy();
    expect(result.recoveryLink).toContain('/if/flow/');
    // Lands on the dashboard after set-password+login, not Authentik's app library.
    expect(new URL(result.recoveryLink!).searchParams.get('next')).toBe('/application/launch/hola-dashboard/');

    // The recovery flow now exists, is bound to the default brand, and has the two
    // reused stages (prompt + user-write) PLUS the appended Login stage so setting
    // the password also signs the operator in.
    const after = (await akGet('/api/v3/flows/instances/?designation=recovery')) as {
      status: number; body: { results: Array<{ pk: string; slug: string }> };
    };
    const flow = after.body.results.find(f => f.slug === 'hola-recovery');
    expect(flow).toBeDefined();
    const brand = (await akGet('/api/v3/core/brands/?default=true')) as {
      status: number; body: { results: Array<{ flow_recovery: string | null }> };
    };
    expect(brand.body.results[0].flow_recovery).toBe(flow!.pk);
    const bindings = (await akGet(`/api/v3/flows/bindings/?target=${flow!.pk}`)) as {
      status: number; body: { results: Array<{ stage: string; order: number }> };
    };
    expect(bindings.body.results.length).toBe(3);
    // The final (highest-order) binding is Authentik's user_login stage, so
    // setting the password also signs the operator in. Resolve it via the TYPED
    // user_login endpoint — /api/v3/stages/all/ ignores name__iexact and returns
    // every stage (results[0] is a password stage), which is exactly the bug that
    // left the flow without a login stage.
    const lastStage = [...bindings.body.results].sort((a, b) => b.order - a.order)[0].stage;
    const loginStages = (await akGet('/api/v3/stages/user_login/')) as {
      status: number; body: { results: Array<{ pk: string; name: string }> };
    };
    const expectedLogin = loginStages.body.results.find((s) => s.name === 'default-authentication-login');
    expect(expectedLogin).toBeDefined();
    expect(lastStage).toBe(expectedLogin!.pk);
  }, 180_000);
});
