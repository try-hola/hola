/**
 * Unit tests for coerceManifestAuth (epic #89, PR1).
 *
 * The catalog drops unknown manifest fields, so the `auth` block is coerced
 * defensively: well-formed blocks pass through, malformed ones degrade to
 * undefined (treated as no-auth) rather than throwing — a sloppy manifest must
 * never break catalog browsing or half-provision an app.
 */

import { describe, test, expect } from 'bun:test';
import { coerceManifestAuth } from '../../services/core/manifest-auth';

describe('coerceManifestAuth', () => {
  test('returns undefined for missing/non-object input', () => {
    expect(coerceManifestAuth(undefined)).toBeUndefined();
    expect(coerceManifestAuth(null)).toBeUndefined();
    expect(coerceManifestAuth('native-oidc')).toBeUndefined();
    expect(coerceManifestAuth([])).toBeUndefined();
  });

  test('returns undefined for an unknown mode', () => {
    expect(coerceManifestAuth({ mode: 'magic' })).toBeUndefined();
  });

  test('coerces mode: none', () => {
    expect(coerceManifestAuth({ mode: 'none' })).toEqual({ mode: 'none' });
  });

  test('coerces a complete native-oidc block', () => {
    const result = coerceManifestAuth({
      mode: 'native-oidc',
      oidc: {
        redirectPath: '/cb',
        scopes: ['openid', 'email'],
        env: { issuer: 'ISS', clientId: 'CID', clientSecret: 'SEC', redirectUri: 'RU' },
      },
      fallback: 'forward-auth',
    });
    expect(result).toEqual({
      mode: 'native-oidc',
      oidc: {
        redirectPath: '/cb',
        scopes: ['openid', 'email'],
        env: { issuer: 'ISS', clientId: 'CID', clientSecret: 'SEC', redirectUri: 'RU' },
      },
      fallback: 'forward-auth',
    });
  });

  test('native-oidc env without redirectUri is valid (app derives its own redirect URI)', () => {
    const result = coerceManifestAuth({
      mode: 'native-oidc',
      oidc: {
        redirectPath: '/openid/callback',
        scopes: ['openid', 'email', 'profile'],
        env: { issuer: 'ACTUAL_OPENID_DISCOVERY_URL', clientId: 'ACTUAL_OPENID_CLIENT_ID', clientSecret: 'ACTUAL_OPENID_CLIENT_SECRET' },
      },
    });
    expect(result).toEqual({
      mode: 'native-oidc',
      oidc: {
        redirectPath: '/openid/callback',
        scopes: ['openid', 'email', 'profile'],
        env: { issuer: 'ACTUAL_OPENID_DISCOVERY_URL', clientId: 'ACTUAL_OPENID_CLIENT_ID', clientSecret: 'ACTUAL_OPENID_CLIENT_SECRET' },
      },
    });
  });

  test('native-oidc with an incomplete env mapping degrades to undefined', () => {
    expect(
      coerceManifestAuth({
        mode: 'native-oidc',
        oidc: { redirectPath: '/cb', scopes: ['openid'], env: { issuer: 'ISS', clientId: 'CID' } },
      })
    ).toBeUndefined();
  });

  test('native-oidc missing the oidc block degrades to undefined', () => {
    expect(coerceManifestAuth({ mode: 'native-oidc' })).toBeUndefined();
  });

  test('native-oidc with a setup command and no env is valid', () => {
    const result = coerceManifestAuth({
      mode: 'native-oidc',
      oidc: {
        redirectPath: '/cb',
        scopes: ['openid'],
        setup: { user: 'git', check: ['gitea', 'admin', 'auth', 'list'], checkMatch: 'authentik', command: ['gitea', 'admin', 'auth', 'add-oauth', '--key', '{{clientId}}'] },
      },
    });
    expect(result).toEqual({
      mode: 'native-oidc',
      oidc: {
        redirectPath: '/cb',
        scopes: ['openid'],
        setup: { user: 'git', check: ['gitea', 'admin', 'auth', 'list'], checkMatch: 'authentik', command: ['gitea', 'admin', 'auth', 'add-oauth', '--key', '{{clientId}}'] },
      },
    });
  });

  test('native-oidc setup without a command argv degrades to undefined', () => {
    expect(
      coerceManifestAuth({ mode: 'native-oidc', oidc: { redirectPath: '/cb', scopes: ['openid'], setup: { check: ['x'] } } })
    ).toBeUndefined();
  });

  test('native-oidc carries staticEnv (the SSO enable flag/button label)', () => {
    const result = coerceManifestAuth({
      mode: 'native-oidc',
      oidc: {
        redirectPath: '/cb',
        scopes: ['openid'],
        env: { issuer: 'ISS', clientId: 'CID', clientSecret: 'SEC' },
        staticEnv: { POSTIZ_GENERIC_OAUTH: 'true', NEXT_PUBLIC_POSTIZ_OAUTH_DISPLAY_NAME: 'Authentik' },
      },
    });
    expect(result?.oidc?.staticEnv).toEqual({
      POSTIZ_GENERIC_OAUTH: 'true',
      NEXT_PUBLIC_POSTIZ_OAUTH_DISPLAY_NAME: 'Authentik',
    });
  });

  test('native-oidc carries extraRedirectUris and a credentialsFile, and credentialsFile alone is a valid wiring mechanism', () => {
    const result = coerceManifestAuth({
      mode: 'native-oidc',
      oidc: {
        redirectPath: '/auth/login',
        scopes: ['openid', 'profile', 'email'],
        extraRedirectUris: ['https://${HOLA_APP_HOST}/user-settings', 'app.immich:///oauth-callback'],
        credentialsFile: { path: 'oidc.json' },
      },
    });
    expect(result).toEqual({
      mode: 'native-oidc',
      oidc: {
        redirectPath: '/auth/login',
        scopes: ['openid', 'profile', 'email'],
        extraRedirectUris: ['https://${HOLA_APP_HOST}/user-settings', 'app.immich:///oauth-callback'],
        credentialsFile: { path: 'oidc.json' },
      },
    });
  });

  test('native-oidc with neither env, setup, nor credentialsFile degrades to undefined', () => {
    expect(
      coerceManifestAuth({ mode: 'native-oidc', oidc: { redirectPath: '/cb', scopes: ['openid'] } })
    ).toBeUndefined();
  });

  test('native-oidc carries a roleClaim (admin-by-group), claim required + defaults left to provisioner', () => {
    const result = coerceManifestAuth({
      mode: 'native-oidc',
      oidc: {
        redirectPath: '/auth/login',
        scopes: ['openid', 'profile', 'email'],
        credentialsFile: { path: 'oidc.json' },
        roleClaim: { claim: 'immich_role', adminGroup: 'hola-admins', adminValue: 'admin', memberValue: 'user' },
      },
    });
    expect(result?.oidc?.roleClaim).toEqual({
      claim: 'immich_role',
      adminGroup: 'hola-admins',
      adminValue: 'admin',
      memberValue: 'user',
    });
  });

  test('native-oidc roleClaim without a claim name is dropped (the rest still coerces)', () => {
    const result = coerceManifestAuth({
      mode: 'native-oidc',
      oidc: {
        redirectPath: '/cb',
        scopes: ['openid'],
        env: { issuer: 'ISS', clientId: 'CID', clientSecret: 'SEC' },
        roleClaim: { adminGroup: 'hola-admins' },
      },
    });
    expect(result?.oidc?.roleClaim).toBeUndefined();
    expect(result?.oidc?.env).toBeDefined();
  });

  test('native-oidc credentialsFile missing its path degrades to undefined', () => {
    expect(
      coerceManifestAuth({
        mode: 'native-oidc',
        oidc: { redirectPath: '/cb', scopes: ['openid'], credentialsFile: {} },
      })
    ).toBeUndefined();
  });

  test('coerces native-ldap and forward-auth blocks', () => {
    expect(
      coerceManifestAuth({
        mode: 'native-ldap',
        ldap: { env: { host: 'H', port: 'P', bindDn: 'B', bindPassword: 'PW', baseDn: 'BD' } },
      })
    ).toEqual({
      mode: 'native-ldap',
      ldap: { env: { host: 'H', port: 'P', bindDn: 'B', bindPassword: 'PW', baseDn: 'BD' } },
    });

    expect(coerceManifestAuth({ mode: 'forward-auth' })).toEqual({ mode: 'forward-auth', forwardAuth: {} });
    expect(coerceManifestAuth({ mode: 'forward-auth', forwardAuth: { allowedGroups: ['admins'] } })).toEqual({
      mode: 'forward-auth',
      forwardAuth: { allowedGroups: ['admins'] },
    });
  });
});
