/**
 * A principal without `read:secrets` is never handed an app's secret values
 * (F03).
 *
 * The exposure this covers: `getRequiredCapability` returns `null` for every
 * unmatched GET, which is the documented operator model ("if you hold a key to
 * this host, you may read it") — but the deployment-config read and the draft
 * read carried each app's database password, API token and encryption secret in
 * their `appEnv` rows. An authenticated non-admin OIDC user holds only the
 * read-only set (`oidc-provider.ts`), so "read-only dashboard access" was in
 * practice full credential access to every installed app.
 *
 * Driven through `route()` rather than `fetch`, for the same reason as
 * `contract-broker-routes.test.ts`: the auth middleware substitutes a WILDCARD
 * system principal whenever auth is disabled, which the test environment always
 * is, so an HTTP-level request could never present a read-only principal — and
 * a test that cannot present one cannot observe this rule at all.
 *
 * The services are doubled so the assertions are about the RESPONSE POLICY and
 * nothing else: both routes are handed the same row set, and the only variable
 * is who is asking.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

import type { AppEnvVar } from '@hola/shared';
import { CAPABILITIES } from '@hola/shared';
import { setupTestServer, teardownTestServer, TEST_BASE_URL } from '../utils/server';
import { principalHasCapability } from '../../middleware/auth';
import { READONLY_CAPABILITIES } from '../../services/auth/oidc-provider';
import { route } from '../../server';
import { getServices } from '../../services/simple-factory';
import type { Principal } from '../../services/auth/auth-service';

/** The value that must never reach a principal lacking `read:secrets`. */
const SECRET = 'db-password-must-not-leak';

const ROWS: AppEnvVar[] = [
  { key: 'MAX_CONNECTIONS', value: '10', isSecret: false, type: 'integer', min: 1, max: 100 },
  { key: 'DB_PASSWORD', value: SECRET, isSecret: true, required: true },
  // An intentionally EMPTY secret: it must stay distinguishable from a withheld
  // one, which is the whole reason the marker exists rather than just `''`.
  { key: 'OPTIONAL_TOKEN', value: '', isSecret: true, required: false },
];

/**
 * The capability set `oidc-provider.ts` mints for an authenticated non-admin —
 * imported rather than restated, so the assertions below are about the set this
 * host actually issues and cannot drift away from it.
 */
const READONLY = READONLY_CAPABILITIES;

function principalRequest(path: string, capabilities: string[] | null): Request {
  const req = new Request(`${TEST_BASE_URL}${path}`, { method: 'GET' });
  if (capabilities !== null) {
    const principal: Principal = {
      id: 'user-1',
      type: 'user',
      name: 'Dashboard user',
      roles: capabilities.includes('*') ? ['admin'] : ['user'],
      capabilities,
    };
    (req as Request & { authContext?: { isAuthenticated: boolean; principal: Principal } }).authContext = {
      isAuthenticated: true,
      principal,
    };
  }
  return req;
}

async function readEnv(path: string, capabilities: string[] | null): Promise<AppEnvVar[]> {
  const req = principalRequest(path, capabilities);
  const res = await route(new URL(req.url), req);
  expect(res.status).toBe(200);
  return ((await res.json()) as { appEnv: AppEnvVar[] }).appEnv;
}

/** Both env-bearing reads, so neither can be fixed while the other leaks. */
const SURFACES: Array<{ name: string; path: string }> = [
  { name: 'GET /api/deployments/:id/config', path: '/api/deployments/dep-1/config' },
  { name: 'GET /api/drafts/:id', path: '/api/drafts/draft-1' },
];

describe('secret-read authorization (F03)', () => {
  const originals = new Map<string, unknown>();

  beforeAll(async () => {
    await setupTestServer();
    const deployments = getServices().deployments as unknown as Record<string, unknown>;
    const drafts = getServices().drafts as unknown as Record<string, unknown>;
    originals.set('getConfig', deployments.getConfig);
    originals.set('getDraft', drafts.getDraft);
    // Same rows from both surfaces: the response policy is the only variable.
    deployments.getConfig = async () => ({ appEnv: ROWS.map((r) => ({ ...r })), systemOverrides: {} });
    drafts.getDraft = async () => ({
      draftId: 'draft-1',
      appId: 'app',
      version: '1.0.0',
      source: 'hola',
      systemOverrides: {},
      appEnv: ROWS.map((r) => ({ ...r })),
      ports: [],
      composeOverride: '',
      files: [],
    });
  });

  afterAll(async () => {
    (getServices().deployments as unknown as Record<string, unknown>).getConfig = originals.get('getConfig');
    (getServices().drafts as unknown as Record<string, unknown>).getDraft = originals.get('getDraft');
    await teardownTestServer();
  });

  for (const surface of SURFACES) {
    test(`${surface.name} withholds secret values from a read-only principal`, async () => {
      const env = await readEnv(surface.path, READONLY);

      const secret = env.find((e) => e.key === 'DB_PASSWORD')!;
      expect(secret.value).toBe('');
      expect(secret.valueRedacted).toBe(true);
      // The whole serialized response, not just the row we looked at — a leak
      // through any other field (a duplicate, a nested copy) fails here too.
      expect(JSON.stringify(env)).not.toContain(SECRET);
    });

    test(`${surface.name} keeps non-secret values readable for a read-only principal`, async () => {
      // Redaction that took the configuration view away from read-only users
      // would be a different, worse answer: they have a legitimate reason to see
      // which variables an app is configured with.
      const env = await readEnv(surface.path, READONLY);
      const row = env.find((e) => e.key === 'MAX_CONNECTIONS')!;
      expect(row.value).toBe('10');
      expect(row.valueRedacted).toBeUndefined();
      // The typed spec survives redaction, so the UI still renders the row.
      expect(row.type).toBe('integer');
      expect(row.max).toBe(100);
      expect(env.map((e) => e.key)).toEqual(['MAX_CONNECTIONS', 'DB_PASSWORD', 'OPTIONAL_TOKEN']);
    });

    test(`${surface.name} marks a withheld secret distinguishably from an empty one`, async () => {
      const env = await readEnv(surface.path, READONLY);
      // Both rows now carry `value: ''`. Without the marker a client cannot tell
      // "this app has no token" from "you may not see this app's token", and the
      // honest rendering of the two is not the same.
      expect(env.find((e) => e.key === 'OPTIONAL_TOKEN')?.value).toBe('');
      expect(env.find((e) => e.key === 'OPTIONAL_TOKEN')?.valueRedacted).toBe(true);
      expect(env.find((e) => e.key === 'MAX_CONNECTIONS')?.valueRedacted).toBeUndefined();
    });

    test(`${surface.name} returns real secret values to a principal holding read:secrets`, async () => {
      const env = await readEnv(surface.path, [...READONLY, 'read:secrets']);
      expect(env.find((e) => e.key === 'DB_PASSWORD')?.value).toBe(SECRET);
      expect(env.find((e) => e.key === 'DB_PASSWORD')?.valueRedacted).toBeUndefined();
    });

    test(`${surface.name} returns real secret values to an admin wildcard`, async () => {
      // An operator's own reads are unchanged by this fix — `*` matches
      // `read:secrets`, so the Configuration tab and `hola config` keep working
      // exactly as before for the principal that was always entitled to them.
      const env = await readEnv(surface.path, ['*']);
      expect(env.find((e) => e.key === 'DB_PASSWORD')?.value).toBe(SECRET);
    });

    test(`${surface.name} fails closed when no principal was resolved`, async () => {
      // A handler reached outside the auth middleware has no principal. That is
      // the case where guessing wrong publishes credentials, so it withholds.
      const env = await readEnv(surface.path, null);
      expect(env.find((e) => e.key === 'DB_PASSWORD')?.value).toBe('');
      expect(JSON.stringify(env)).not.toContain(SECRET);
    });
  }
});


/**
 * Host-wide `systemEnv` is the third env-bearing read, and the same policy
 * applies: `GET /api/settings` is an unmatched GET, and those rows hold the
 * operator's SMTP password and whatever else they put there. Its PATCH is a
 * FULL REPLACE, so the write-side rule (`restoreWithheldEnvValues`) is what
 * keeps a replayed settings form from blanking every host secret at once.
 */
describe('GET /api/settings (F03)', () => {
  const original = new Map<string, unknown>();
  const SMTP = 'smtp-password-must-not-leak';

  beforeAll(async () => {
    await setupTestServer();
    const config = getServices().config as unknown as Record<string, unknown>;
    original.set('getSystemSettings', config.getSystemSettings);
    config.getSystemSettings = async () => ({
      systemEnv: [
        { key: 'DOMAIN', value: 'hola.example.com', isSecret: false },
        { key: 'SMTP_PASSWORD', value: SMTP, isSecret: true },
      ],
      docker: { host: '/var/run/docker.sock' },
      tls: { email: '' },
      notifications: { smtpHost: '', smtpUser: '', smtpPassword: SMTP },
      channels: { showPrerelease: false },
    });
  });

  afterAll(async () => {
    (getServices().config as unknown as Record<string, unknown>).getSystemSettings = original.get('getSystemSettings');
    await teardownTestServer();
  });

  async function readSettings(capabilities: string[] | null): Promise<AppEnvVar[]> {
    const req = principalRequest('/api/settings', capabilities);
    const res = await route(new URL(req.url), req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { systemEnv: AppEnvVar[] };
    // The pre-existing `smtpPassword` redaction must still hold either way.
    expect(JSON.stringify(body)).not.toContain('"smtpPassword"');
    return body.systemEnv;
  }

  test('withholds a host secret from a read-only principal', async () => {
    const env = await readSettings(READONLY);
    expect(env.find((e) => e.key === 'SMTP_PASSWORD')?.value).toBe('');
    expect(env.find((e) => e.key === 'SMTP_PASSWORD')?.valueRedacted).toBe(true);
    expect(env.find((e) => e.key === 'DOMAIN')?.value).toBe('hola.example.com');
    expect(JSON.stringify(env)).not.toContain(SMTP);
  });

  test('returns it to an operator holding read:secrets', async () => {
    expect((await readSettings(['*'])).find((e) => e.key === 'SMTP_PASSWORD')?.value).toBe(SMTP);
  });
});

/**
 * The boundary itself, asserted directly rather than by inference from a
 * response: `read:secrets` must not be in the read-only set. Adding it there
 * would restore the exposure in full while every redaction test above still
 * passed, since each one would then be exercising a principal that legitimately
 * holds the capability.
 */
describe('the read-only capability set (F03)', () => {
  test('does not include read:secrets', () => {
    expect(READONLY_CAPABILITIES).not.toContain(CAPABILITIES.READ_SECRETS);
  });

  test('still includes the reads a read-only dashboard user needs', () => {
    // The fix withholds credential VALUES; it does not narrow what a read-only
    // user may see. A regression in the other direction is also a bug.
    expect(READONLY_CAPABILITIES).toEqual([
      'read:system',
      'read:deployments',
      'read:logs',
      'read:backups',
      'read:catalog',
    ]);
  });
});

/**
 * `principalHasCapability` is the response-policy check, deliberately decided
 * from the principal alone — both `hasCapability` implementations blanket-allow
 * when auth is disabled, which would make every rule above unobservable.
 */
describe('principalHasCapability', () => {
  const withCaps = (capabilities: string[]): Principal => ({
    id: 'p', type: 'user', name: 'p', roles: [], capabilities,
  });

  test('an exact capability holds', () => {
    expect(principalHasCapability(withCaps(['read:secrets']), CAPABILITIES.READ_SECRETS)).toBe(true);
  });

  test('a wildcard holds every capability — an operator key is unaffected', () => {
    expect(principalHasCapability(withCaps(['*']), CAPABILITIES.READ_SECRETS)).toBe(true);
  });

  test('a principal without it does not hold it, however many other reads it has', () => {
    expect(principalHasCapability(withCaps([...READONLY_CAPABILITIES]), CAPABILITIES.READ_SECRETS)).toBe(false);
  });

  test('a contract-scoped token does not hold it', () => {
    // Closed by default at the route (`authorizeRequest`), and closed here too —
    // a provider app's credential is not an operator's.
    expect(principalHasCapability(withCaps(['contract:backup']), CAPABILITIES.READ_SECRETS)).toBe(false);
  });

  test('no capabilities at all holds nothing', () => {
    expect(principalHasCapability(withCaps([]), CAPABILITIES.READ_SECRETS)).toBe(false);
  });
});
