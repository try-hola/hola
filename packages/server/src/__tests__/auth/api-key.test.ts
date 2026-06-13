/**
 * Admin API key + control-plane auth tests (issue #53, MVP pt.1).
 *
 * Verifies the first-admin bootstrap (env or generated+persisted key) and the
 * API-key enforcement semantics the auth middleware maps to 401/403.
 */

import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { resolveAdminApiKey, createAdminApiKeyProvider, adminApiKeyPath } from '../../services/auth/api-key-config';
import { RealAuthService, type Principal } from '../../services/auth/auth-service';

describe('Admin API key bootstrap', () => {
  const savedKey = process.env.HOLA_API_KEY;
  const savedDir = process.env.HOLA_DATA_DIR;
  let tmp: string | undefined;

  afterEach(async () => {
    if (savedKey === undefined) delete process.env.HOLA_API_KEY; else process.env.HOLA_API_KEY = savedKey;
    if (savedDir === undefined) delete process.env.HOLA_DATA_DIR; else process.env.HOLA_DATA_DIR = savedDir;
    if (tmp) { await rm(tmp, { recursive: true, force: true }); tmp = undefined; }
  });

  test('uses HOLA_API_KEY when set', () => {
    process.env.HOLA_API_KEY = 'env-provided-key';
    expect(resolveAdminApiKey()).toBe('env-provided-key');
  });

  test('generates and persists a key on first boot, stable across reboots', async () => {
    delete process.env.HOLA_API_KEY;
    tmp = await mkdtemp(join(tmpdir(), 'hola-auth-'));
    process.env.HOLA_DATA_DIR = tmp;

    const key = resolveAdminApiKey();
    expect(key).toMatch(/^[0-9a-f]{48}$/);

    // Persisted to the data root...
    expect((await readFile(adminApiKeyPath(), 'utf8')).trim()).toBe(key);
    // ...and read back identically on the next boot.
    expect(resolveAdminApiKey()).toBe(key);
  });
});

describe('API-key auth enforcement', () => {
  test('valid admin key authenticates with full capability', async () => {
    const auth = new RealAuthService(true);
    auth.registerProvider(createAdminApiKeyProvider('secret-admin-key'));

    const ok = await auth.authenticate('secret-admin-key');
    expect(ok.success).toBe(true);
    expect(ok.principal?.id).toBe('admin');
    expect(auth.hasCapability(ok.principal!, 'write:deployments')).toBe(true);
    expect(auth.hasCapability(ok.principal!, 'manage:system')).toBe(true);
  });

  test('invalid or absent credentials fail when auth is enabled (401 semantics)', async () => {
    const auth = new RealAuthService(true);
    auth.registerProvider(createAdminApiKeyProvider('the-key'));

    expect((await auth.authenticate('wrong-key')).success).toBe(false);
    expect((await auth.authenticate('')).success).toBe(false);
  });

  test('insufficient capability is denied (403 semantics)', () => {
    const auth = new RealAuthService(true);
    auth.registerProvider(createAdminApiKeyProvider('the-key'));

    const readonly: Principal = {
      id: 'viewer', type: 'user', name: 'Viewer', roles: ['viewer'], capabilities: ['read:deployments'],
    };
    expect(auth.hasCapability(readonly, 'read:deployments')).toBe(true);
    expect(auth.hasCapability(readonly, 'write:deployments')).toBe(false);
  });

  test('disabled auth allows all (dev/test) with a system principal', async () => {
    const auth = new RealAuthService(false);
    const res = await auth.authenticate('');
    expect(res.success).toBe(true);
    expect(res.principal?.capabilities).toContain('*');
  });
});
