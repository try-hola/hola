/**
 * A cookie-authenticated mutation must have come from the dashboard (F04).
 *
 * The exposure this covers: Hola puts every installed app at
 * `<app>.<HOLA_BASE_DOMAIN>` and the dashboard at `HOLA_DOMAIN`, which are
 * same-SITE. `SameSite=Strict` is a same-site control, so it does not stop a
 * page served by an installed app from posting to the API with the operator's
 * session cookie attached — and because the action routes parsed a body
 * regardless of `Content-Type`, a `text/plain` POST (CORS-simple, no preflight,
 * no CORS header able to stop it) executed normally. Measured at the commit
 * before this fix: the finding's own request — dummy session cookie, sibling
 * `Origin`, `Sec-Fetch-Site: same-site`, `Content-Type: text/plain` — returned
 * 200 and enqueued a stop job.
 *
 * Two halves, and both matter:
 *
 * - The HTTP tests drive the real handler, so they exercise the guard exactly
 *   where a browser would hit it. The test environment disables auth, so the
 *   cookie is not what authenticates here — but the guard keys on the credential
 *   PRESENT ON THE REQUEST (`resolveCredential`), which is a pure function of
 *   headers and holds whether or not auth is enabled. That is deliberate: it is
 *   what makes the rule observable at all in this environment.
 * - The truth table exercises `judgeMutation` directly, because the
 *   combinations that must be ALLOWED — a Bearer-header caller from any origin,
 *   a dev query token, every read — outnumber the ones refused, and a rule is
 *   only worth having if it is known not to catch them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import { setupTestServer, teardownTestServer, TEST_BASE_URL } from '../utils/server';
import { SESSION_COOKIE, LEGACY_SESSION_COOKIE } from '../../middleware/auth';
import {
  judgeMutation,
  configuredTrustedHosts,
  mutationIntentOf,
  type MutationIntent,
} from '../../middleware/origin-guard';

/** The dashboard's own origin under the in-process harness (`Host` matches). */
const DASHBOARD_ORIGIN = TEST_BASE_URL;

/** A compromised app on a sibling subdomain — same site, different origin. */
const SIBLING_ORIGIN = 'https://evil.hola.example.com';

const COOKIE = `${SESSION_COOKIE}=dummy-admin-key`;

/** A mutation route with an observable side effect: it enqueues a job. */
async function firstDeploymentId(): Promise<string> {
  const res = await fetch(`${TEST_BASE_URL}/api/deployments`);
  const body = (await res.json()) as { items?: Array<{ id: string }> };
  const id = body.items?.[0]?.id;
  if (!id) throw new Error('seed deployment missing');
  return id;
}

async function jobCount(): Promise<number> {
  const res = await fetch(`${TEST_BASE_URL}/api/jobs`);
  const body = (await res.json()) as { items?: unknown[] };
  return body.items?.length ?? 0;
}

function stopRequest(id: string, headers: Record<string, string>): Promise<Response> {
  return fetch(`${TEST_BASE_URL}/api/deployments/${id}/actions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'stop' }),
  });
}

describe('cookie-authenticated mutations require a trusted origin (F04)', () => {
  beforeAll(async () => {
    await setupTestServer();
  });
  afterAll(async () => {
    await teardownTestServer();
  });

  it("refuses the finding's reproduction, and the mutation does not run", async () => {
    const id = await firstDeploymentId();
    const before = await jobCount();

    const res = await stopRequest(id, {
      'content-type': 'text/plain',
      origin: SIBLING_ORIGIN,
      'sec-fetch-site': 'same-site',
      cookie: COOKIE,
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CROSS_ORIGIN_MUTATION');
    // The refusal has to be BEFORE the handler, not a cosmetic status on a
    // mutation that already happened.
    expect(await jobCount()).toBe(before);
  });

  it('allows the same mutation from the dashboard origin', async () => {
    const id = await firstDeploymentId();

    const res = await stopRequest(id, {
      'content-type': 'application/json',
      origin: DASHBOARD_ORIGIN,
      'sec-fetch-site': 'same-origin',
      cookie: COOKIE,
    });

    expect(res.status).toBe(200);
    expect((await res.json()) as { ok?: boolean }).toMatchObject({ ok: true });
  });

  it('refuses a cookie mutation that sends no Origin at all', async () => {
    const id = await firstDeploymentId();
    const res = await stopRequest(id, { 'content-type': 'application/json', cookie: COOKIE });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('MISSING_ORIGIN');
  });

  it('refuses an unsupported content type even from the dashboard origin', async () => {
    const id = await firstDeploymentId();
    const res = await stopRequest(id, {
      'content-type': 'text/plain',
      origin: DASHBOARD_ORIGIN,
      cookie: COOKIE,
    });

    expect(res.status).toBe(415);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('refuses a cross-origin forced logout that carries the cookie', async () => {
    const res = await fetch(`${TEST_BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { origin: SIBLING_ORIGIN, cookie: COOKIE },
    });

    expect(res.status).toBe(403);
  });

  // --- Must pass with the fix REVERTED as well: legitimate callers. ---

  it('leaves a Bearer-header caller alone, sibling origin and all (CLI/SDK/broker)', async () => {
    const id = await firstDeploymentId();
    const res = await stopRequest(id, {
      'content-type': 'text/plain',
      origin: SIBLING_ORIGIN,
      'sec-fetch-site': 'same-site',
      authorization: 'Bearer some-operator-key',
    });

    // The CLI is the only artifact released as a binary and sends no Origin and
    // no cookie; a rule that keyed on "is this a mutation" would break it.
    expect(res.status).toBe(200);
  });

  it('leaves an X-API-Key caller alone', async () => {
    const id = await firstDeploymentId();
    const res = await stopRequest(id, {
      'content-type': 'application/json',
      'x-api-key': 'some-operator-key',
    });

    expect(res.status).toBe(200);
  });

  it('leaves the dashboard`s own no-body DELETE alone', async () => {
    const res = await fetch(`${TEST_BASE_URL}/api/jobs`, {
      method: 'DELETE',
      headers: { origin: DASHBOARD_ORIGIN, cookie: COOKIE },
    });

    expect(res.status).toBeLessThan(400);
  });

  it('leaves cookie-authenticated READS alone (SSE is a GET)', async () => {
    const res = await fetch(`${TEST_BASE_URL}/api/deployments`, {
      headers: { origin: SIBLING_ORIGIN, cookie: COOKIE, 'sec-fetch-site': 'same-site' },
    });

    expect(res.status).toBe(200);
  });

  it('logout retires both the current and the pre-F04 cookie name', async () => {
    const res = await fetch(`${TEST_BASE_URL}/api/auth/logout`, { method: 'POST' });
    const cookies = res.headers.getSetCookie();

    expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE}=;`))).toBe(true);
    expect(cookies.some((c) => c.startsWith(`${LEGACY_SESSION_COOKIE}=;`))).toBe(true);
  });
});

describe('SESSION_COOKIE is __Host- prefixed', () => {
  it('uses the prefix, so a sibling subdomain cannot set the session cookie', () => {
    // Cookies are scoped by DOMAIN, not origin: without this prefix an app at
    // `evil.hola.example.com` could set `hola_session` for `.hola.example.com`
    // and the browser would send it to the dashboard.
    expect(SESSION_COOKIE.startsWith('__Host-')).toBe(true);
  });

  it('never accepts the pre-F04 cookie name as a credential', () => {
    const req = new Request(`${TEST_BASE_URL}/api/deployments`, {
      method: 'POST',
      headers: { cookie: `${LEGACY_SESSION_COOKIE}=dummy-admin-key` },
    });
    expect(mutationIntentOf(req).credentialSource).toBeNull();
  });
});

// --- The rule as a truth table. ---

const BASE: MutationIntent = {
  method: 'POST',
  credentialSource: 'cookie',
  origin: 'https://hola.example.com',
  secFetchSite: 'same-origin',
  host: 'hola.example.com',
  contentType: 'application/json',
  trustedHosts: [],
};

function judge(overrides: Partial<MutationIntent>) {
  return judgeMutation({ ...BASE, ...overrides });
}

describe('judgeMutation', () => {
  it('allows every safe method regardless of origin', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(judge({ method, origin: SIBLING_ORIGIN, secFetchSite: 'same-site' })).toBe('allow');
    }
  });

  it('guards all four mutating methods', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post', 'delete']) {
      expect(judge({ method, origin: SIBLING_ORIGIN })).toBe('untrusted-origin');
    }
  });

  it('exempts header and query credentials, and unauthenticated requests', () => {
    for (const credentialSource of ['header', 'query', null] as const) {
      expect(
        judge({ credentialSource, origin: SIBLING_ORIGIN, secFetchSite: 'same-site', contentType: 'text/plain' }),
      ).toBe('allow');
    }
  });

  it('trusts an origin matching the Host the request was addressed to', () => {
    expect(judge({ origin: 'https://hola.example.com', host: 'hola.example.com' })).toBe('allow');
    expect(judge({ origin: 'http://localhost:3001', host: 'localhost:3001' })).toBe('allow');
  });

  it('trusts a configured host even when Host says otherwise', () => {
    expect(
      judge({ origin: 'https://dash.example.com', host: 'internal:3001', trustedHosts: ['dash.example.com'] }),
    ).toBe('allow');
  });

  it('refuses a sibling subdomain — the whole finding', () => {
    expect(judge({ origin: 'https://evil.hola.example.com', host: 'hola.example.com' })).toBe('untrusted-origin');
  });

  it('refuses a suffix or prefix that merely looks like the host', () => {
    for (const origin of [
      'https://hola.example.com.evil.test',
      'https://notahola.example.com',
      'https://hola.example.como',
    ]) {
      expect(judge({ origin, host: 'hola.example.com' })).toBe('untrusted-origin');
    }
  });

  it('refuses an opaque or non-HTTP origin', () => {
    for (const origin of ['null', 'data:text/html,x', 'file://', 'app://local', 'not a url']) {
      expect(judge({ origin })).toBe('untrusted-origin');
    }
  });

  it('refuses a missing Origin, distinctly from an untrusted one', () => {
    expect(judge({ origin: null })).toBe('missing-origin');
  });

  it('believes Sec-Fetch-Site over a matching Origin', () => {
    // A browser sets this header itself and no script can forge it, so a
    // `same-site`/`cross-site` value settles the question even if `Origin`
    // somehow passed the allowlist.
    for (const secFetchSite of ['same-site', 'cross-site', 'SAME-SITE']) {
      expect(judge({ secFetchSite })).toBe('untrusted-origin');
    }
  });

  it('accepts `none` and a missing Sec-Fetch-Site', () => {
    expect(judge({ secFetchSite: 'none' })).toBe('allow');
    expect(judge({ secFetchSite: null })).toBe('allow');
  });

  it('accepts json with parameters, and multipart for the upload route', () => {
    expect(judge({ contentType: 'application/json; charset=utf-8' })).toBe('allow');
    expect(judge({ contentType: 'APPLICATION/JSON' })).toBe('allow');
    expect(judge({ contentType: 'multipart/form-data; boundary=----x' })).toBe('allow');
    expect(judge({ contentType: null })).toBe('allow');
  });

  it('refuses the CORS-simple text types', () => {
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'text/html']) {
      expect(judge({ contentType })).toBe('unsupported-media-type');
    }
  });
});

describe('configuredTrustedHosts', () => {
  it('reads HOLA_DOMAIN', () => {
    expect(configuredTrustedHosts({ HOLA_DOMAIN: 'apps.example.com' })).toEqual(['apps.example.com']);
  });

  it('accepts HOLA_TRUSTED_ORIGINS as origins or bare hosts, and normalises both', () => {
    expect(
      configuredTrustedHosts({
        HOLA_TRUSTED_ORIGINS: 'https://one.example.com/, two.example.com , https://three.example.com:8443',
        HOLA_DOMAIN: 'apps.example.com',
      }),
    ).toEqual(['one.example.com', 'two.example.com', 'three.example.com:8443', 'apps.example.com']);
  });

  it('is empty when nothing is configured — the Host comparison still closes the hole', () => {
    expect(configuredTrustedHosts({})).toEqual([]);
    expect(judgeMutation({ ...BASE, trustedHosts: [], origin: SIBLING_ORIGIN })).toBe('untrusted-origin');
    expect(judgeMutation({ ...BASE, trustedHosts: [], origin: 'https://hola.example.com' })).toBe('allow');
  });
});
