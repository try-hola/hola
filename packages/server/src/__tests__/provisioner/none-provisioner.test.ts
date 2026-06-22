/**
 * NoneProvisionerService — the real no-op provisioner used in production when
 * HOLA_AUTH_MODE != authentik (issue #110). Unlike the Mock, it must inject
 * NOTHING for modes that can run without SSO and REFUSE the ones that can't.
 */

import { describe, test, expect } from 'bun:test';
import { NoneProvisionerService } from '../../services/core/provisioner';

const base = {
  deploymentId: 'dep-abcdef0123456789',
  appName: 'gitea',
  host: 'gitea.example.com',
};

describe('NoneProvisionerService', () => {
  test('native-oidc is a no-op: injects no env and no fake credentials', async () => {
    const svc = new NoneProvisionerService();
    const result = await svc.provision({
      ...base,
      mode: 'native-oidc',
      oidc: {
        redirectPath: '/user/oauth2/authentik/callback',
        scopes: ['openid', 'profile', 'email'],
        env: { issuer: 'GITEA_OIDC_ISSUER', clientId: 'GITEA_OIDC_CLIENT_ID', clientSecret: 'GITEA_OIDC_CLIENT_SECRET' },
      },
    });
    expect(result.env).toEqual({});
    expect(result.credentials).toBeUndefined();
    expect(result.middleware).toBeUndefined();
    expect(result.ref).toEqual({ mode: 'native-oidc' });
  });

  test('none mode is a no-op', async () => {
    const svc = new NoneProvisionerService();
    const result = await svc.provision({ ...base, mode: 'none' });
    expect(result.env).toEqual({});
    expect(result.ref).toEqual({ mode: 'none' });
  });

  test('forward-auth is refused with an actionable error (no dead gate)', async () => {
    const svc = new NoneProvisionerService();
    const p = svc.provision({ ...base, appName: 'homepage', mode: 'forward-auth', forwardAuth: {} });
    await expect(p).rejects.toThrow(/HOLA_AUTH_MODE=authentik/);
  });

  test('native-ldap is refused with an actionable error', async () => {
    const svc = new NoneProvisionerService();
    const p = svc.provision({
      ...base,
      mode: 'native-ldap',
      ldap: { env: { host: 'H', port: 'P', bindDn: 'BD', bindPassword: 'BP', baseDn: 'BASE' } },
    });
    await expect(p).rejects.toThrow(/HOLA_AUTH_MODE=authentik/);
  });

  test('deprovision is a harmless no-op', async () => {
    const svc = new NoneProvisionerService();
    await expect(svc.deprovision({ deploymentId: base.deploymentId })).resolves.toBeUndefined();
  });

  test('healthCheck reports healthy', async () => {
    const svc = new NoneProvisionerService();
    expect((await svc.healthCheck()).healthy).toBe(true);
  });
});
