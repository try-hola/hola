/**
 * Who a deployment is attributed to — the identity behind `${HOLA_USER_EMAIL}` /
 * `${HOLA_USER_USERNAME}`. An app may seed its own ADMIN account from these, so
 * the interesting cases are the ones that must resolve to nobody.
 */

import { describe, test, expect, afterEach } from 'bun:test';

import { createAdminApiKeyProvider } from '../../services/auth/api-key-config';
import { RealAuthService, type Principal } from '../../services/auth/auth-service';
import { resolveInstalledBy, setNamedAdminIdentity } from '../../services/auth/installer-identity';

const NAMED_ADMIN = { username: 'paul', email: 'paul@example.com', name: 'Paul' };

async function adminKeyPrincipal(): Promise<Principal> {
  const auth = new RealAuthService();
  auth.registerProvider(createAdminApiKeyProvider('the-key'));
  const res = await auth.authenticate('the-key');
  return res.principal!;
}

const sso: Principal = {
  id: 'sub-1',
  type: 'user',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  username: 'ada',
  roles: ['admin'],
  capabilities: ['*'],
  metadata: { provider: 'oidc', groups: [] },
};

describe('resolveInstalledBy', () => {
  afterEach(() => setNamedAdminIdentity(undefined));

  test('an SSO user is attributed to themselves, username included', () => {
    setNamedAdminIdentity(NAMED_ADMIN);
    expect(resolveInstalledBy(sso)).toEqual({ email: 'ada@example.com', name: 'Ada Lovelace', username: 'ada', via: 'principal' });
  });

  test('the admin key is attributed to the named admin once provisioning resolved one', async () => {
    setNamedAdminIdentity(NAMED_ADMIN);
    expect(resolveInstalledBy(await adminKeyPrincipal())).toEqual({ ...NAMED_ADMIN, via: 'named-admin' });
  });

  test('the admin key resolves to nobody when no named admin has been resolved', async () => {
    // No HOLA_ADMIN_EMAIL, or Authentik not provisioned yet — fail closed rather
    // than guess a username an app would then make an admin.
    expect(resolveInstalledBy(await adminKeyPrincipal())).toBeUndefined();
  });

  test('a service principal (contract token) never inherits the named admin', () => {
    setNamedAdminIdentity(NAMED_ADMIN);
    const contract: Principal = {
      id: 'contract-x',
      type: 'service',
      name: 'backrest',
      roles: [],
      capabilities: ['contract:backup'],
      metadata: { deploymentId: 'backrest-1' },
    };
    expect(resolveInstalledBy(contract)).toBeUndefined();
  });

  test('no principal resolves to nobody', () => {
    setNamedAdminIdentity(NAMED_ADMIN);
    expect(resolveInstalledBy(null)).toBeUndefined();
  });
});
