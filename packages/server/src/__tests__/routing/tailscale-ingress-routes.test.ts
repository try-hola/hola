/**
 * Spec 010: the private-ingress routes' authorization and origin posture.
 * (Service behaviour is covered in deployments/tailscale-ingress-*.test.ts.)
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

import { API, CAPABILITIES } from '@hola/shared';
import { setupTestServer, teardownTestServer, TEST_BASE_URL } from '../utils/server';
import { SESSION_COOKIE, getRequiredCapability } from '../../middleware/auth';
import { READONLY_CAPABILITIES } from '../../services/auth/oidc-provider';

const PATH = API.deployments.tailscaleIngress('dep-1');

describe('capabilities (R11)', () => {
  test('mutations fall through to write:deployments; the read names no capability', () => {
    expect(getRequiredCapability(PATH, 'PUT')).toBe('write:deployments');
    expect(getRequiredCapability(PATH, 'DELETE')).toBe('write:deployments');
    expect(getRequiredCapability(PATH, 'GET')).toBeNull();
  });

  test('a read-only principal holds no write:deployments', () => {
    expect(READONLY_CAPABILITIES).not.toContain(CAPABILITIES.WRITE_DEPLOYMENTS);
  });
});

describe('origin guard covers the new mutations', () => {
  beforeAll(async () => { await setupTestServer(); });
  afterAll(async () => { await teardownTestServer(); });

  const cookie = `${SESSION_COOKIE}=dummy-admin-key`;

  test.each(['PUT', 'DELETE'])('a cookie-authenticated cross-origin %s is refused before the handler', async (method) => {
    const res = await fetch(`${TEST_BASE_URL}${PATH}`, {
      method,
      headers: { 'content-type': 'text/plain', origin: 'https://evil.hola.example.com', 'sec-fetch-site': 'same-site', cookie },
      body: method === 'PUT' ? JSON.stringify({ serviceName: 'svc:x', tag: 'tag:x', authKey: 'tskey-auth-kabc-def' }) : undefined,
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CROSS_ORIGIN_MUTATION');
  });
});
