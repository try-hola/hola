import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SignJWT, exportJWK, generateKeyPair, type KeyLike } from 'jose';

import { OidcAuthProvider } from '../../services/auth/oidc-provider';
import { clearProvisionedOidc, resolveOidcConfig } from '../../config/oidc';

const ISSUER = 'https://idp.test/application/o/hola-dashboard/';
const JWKS_URI = 'https://idp.test/jwks';
const CLIENT_ID = 'dashboard-client-123';
const KID = 'test-key-1';

let privateKey: KeyLike;
let publicJwk: Record<string, unknown>;
let realFetch: typeof globalThis.fetch;

/** A fetch stub serving the OIDC discovery doc and the JWKS. */
function installFetchStub() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/.well-known/openid-configuration')) {
      return new Response(JSON.stringify({ issuer: ISSUER, jwks_uri: JWKS_URI }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === JWKS_URI) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof globalThis.fetch;
}

async function signToken(claims: {
  iss?: string;
  aud?: string | string[];
  azp?: string;
  expSecondsFromNow?: number;
  sub?: string;
  extra?: Record<string, unknown>;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (claims.expSecondsFromNow ?? 300);
  const builder = new SignJWT({ azp: claims.azp, ...claims.extra })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setSubject(claims.sub ?? 'user-1');
  if (claims.iss !== undefined) builder.setIssuer(claims.iss);
  if (claims.aud !== undefined) builder.setAudience(claims.aud);
  return builder.sign(privateKey);
}

describe('OidcAuthProvider', () => {
  beforeEach(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
    realFetch = globalThis.fetch;
    installFetchStub();
    process.env.HOLA_OIDC_ISSUER = ISSUER;
    process.env.HOLA_OIDC_CLIENT_ID = CLIENT_ID;
    delete process.env.HOLA_OIDC_AUDIENCE;
    delete process.env.HOLA_OIDC_ADMIN_GROUP;
    clearProvisionedOidc();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.HOLA_OIDC_ISSUER;
    delete process.env.HOLA_OIDC_CLIENT_ID;
    delete process.env.HOLA_OIDC_AUDIENCE;
    delete process.env.HOLA_OIDC_ADMIN_GROUP;
    clearProvisionedOidc();
  });

  it('resolves config as enabled from env (issuer normalized with trailing slash)', () => {
    process.env.HOLA_OIDC_ISSUER = 'https://idp.test/application/o/hola-dashboard';
    const cfg = resolveOidcConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.issuer).toBe(ISSUER);
    expect(cfg.audience).toBe(CLIENT_ID); // defaults to clientId
  });

  it('accepts a valid token (aud = clientId) and maps an admin principal', async () => {
    const provider = new OidcAuthProvider();
    const token = await signToken({ iss: ISSUER, aud: CLIENT_ID, sub: 'abc', extra: { email: 'a@b.c', name: 'Ada' } });
    const res = await provider.authenticate(token);
    expect(res.success).toBe(true);
    expect(res.principal?.id).toBe('abc');
    expect(res.principal?.email).toBe('a@b.c');
    expect(res.principal?.capabilities).toContain('*');
  });

  it('accepts a token whose audience is in an array', async () => {
    const provider = new OidcAuthProvider();
    const token = await signToken({ iss: ISSUER, aud: ['other', CLIENT_ID] });
    expect((await provider.authenticate(token)).success).toBe(true);
  });

  it('accepts a token that names the client only via azp', async () => {
    const provider = new OidcAuthProvider();
    const token = await signToken({ iss: ISSUER, aud: 'someone-else', azp: CLIENT_ID });
    expect((await provider.authenticate(token)).success).toBe(true);
  });

  it('rejects a token whose audience/azp does not match the client', async () => {
    const provider = new OidcAuthProvider();
    const token = await signToken({ iss: ISSUER, aud: 'wrong-client' });
    const res = await provider.authenticate(token);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/audience/);
  });

  it('rejects a token with the wrong issuer', async () => {
    const provider = new OidcAuthProvider();
    const token = await signToken({ iss: 'https://evil.test/', aud: CLIENT_ID });
    expect((await provider.authenticate(token)).success).toBe(false);
  });

  it('rejects an expired token', async () => {
    const provider = new OidcAuthProvider();
    const token = await signToken({ iss: ISSUER, aud: CLIENT_ID, expSecondsFromNow: -60 });
    expect((await provider.authenticate(token)).success).toBe(false);
  });

  it('fails fast (not a JWT) for an opaque admin key, leaving it to other providers', async () => {
    const provider = new OidcAuthProvider();
    const res = await provider.authenticate('deadbeefcafe1234567890');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not a JWT/);
  });

  it('is disabled (fails closed) when no issuer/clientId is configured', async () => {
    delete process.env.HOLA_OIDC_ISSUER;
    delete process.env.HOLA_OIDC_CLIENT_ID;
    const provider = new OidcAuthProvider();
    const token = await signToken({ iss: ISSUER, aud: CLIENT_ID });
    const res = await provider.authenticate(token);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not configured/);
  });

  it('maps a read-only principal when an admin group is required and absent', async () => {
    process.env.HOLA_OIDC_ADMIN_GROUP = 'hola-admins';
    const provider = new OidcAuthProvider();
    const token = await signToken({ iss: ISSUER, aud: CLIENT_ID, extra: { groups: ['users'] } });
    const res = await provider.authenticate(token);
    expect(res.success).toBe(true);
    expect(res.principal?.capabilities).not.toContain('*');
    expect(res.principal?.capabilities).toContain('read:deployments');
  });

  it('maps an admin principal when the user is in the required admin group', async () => {
    process.env.HOLA_OIDC_ADMIN_GROUP = 'hola-admins';
    const provider = new OidcAuthProvider();
    const token = await signToken({ iss: ISSUER, aud: CLIENT_ID, extra: { groups: ['hola-admins'] } });
    const res = await provider.authenticate(token);
    expect(res.principal?.capabilities).toContain('*');
  });
});
