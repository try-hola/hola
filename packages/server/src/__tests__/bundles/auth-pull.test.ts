import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { readFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { RealBundleService, bundleCacheKey, type CommandRunner } from '../../services/core/bundles';

describe('bundleCacheKey (cross-source collision guard)', () => {
  test('the built-in hola source keeps the bare appId; others are namespaced', () => {
    expect(bundleCacheKey(undefined, 'uptime-kuma')).toBe('uptime-kuma');
    expect(bundleCacheKey('hola', 'uptime-kuma')).toBe('uptime-kuma');
    expect(bundleCacheKey('acme', 'uptime-kuma')).toBe('acme__uptime-kuma');
    expect(bundleCacheKey('(ref)', 'app')).toBe('_ref___app');
  });
});

describe('RealBundleService authenticated pull', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function makeCache() {
    const base = await mkdtemp(join(tmpdir(), 'hola-bundle-test-'));
    dirs.push(base);
    return base;
  }

  test('writes a scoped 0o600 auth file, keeps the token off argv, and cleans up', async () => {
    const base = await makeCache();
    const commands: string[] = [];
    let authFile: { contents: string; mode: number } | undefined;

    const runner: CommandRunner = async (cmd) => {
      commands.push(cmd);
      const m = cmd.match(/--registry-config (\S+)/);
      if (m) {
        // Capture the auth file WHILE it exists (ensurePulled removes it in finally).
        authFile = { contents: readFileSync(m[1], 'utf8'), mode: statSync(m[1]).mode & 0o777 };
      }
      return { stdout: '', stderr: '' };
    };

    const svc = new RealBundleService(base, runner);
    await svc.ensurePulled({
      appId: 'cms',
      version: '0.1.0',
      source: 'acme',
      ociRef: 'ghcr.io/acme/cms:0.1.0',
      credentials: { registry: 'ghcr.io', username: 'bot', password: 'ghp_secret' },
    });

    const pullCmd = commands.find((c) => c.startsWith('oras pull'))!;
    expect(pullCmd).toContain('--registry-config');
    // The secret must never appear on the command line.
    expect(pullCmd).not.toContain('ghp_secret');

    // The auth file is an owner-only docker config with the base64(user:pass) entry.
    expect(authFile).toBeDefined();
    expect(authFile!.mode).toBe(0o600);
    const parsed = JSON.parse(authFile!.contents);
    expect(parsed.auths['ghcr.io'].auth).toBe(Buffer.from('bot:ghp_secret').toString('base64'));
  });

  test('namespaces the cache dir by source', async () => {
    const base = await makeCache();
    const runner: CommandRunner = async () => ({ stdout: '', stderr: '' });
    const svc = new RealBundleService(base, runner);

    const hola = await svc.ensurePulled({ appId: 'app', version: '1.0', ociRef: 'ghcr.io/try-hola/app:1.0' });
    expect(hola.localPath).toBe(join(base, 'app', '1.0'));

    const acme = await svc.ensurePulled({
      appId: 'app',
      version: '1.0',
      source: 'acme',
      ociRef: 'ghcr.io/acme/app:1.0',
      credentials: { registry: 'ghcr.io', username: 'u', password: 'p' },
    });
    expect(acme.localPath).toBe(join(base, 'acme__app', '1.0'));
  });

  test('rejects a non-allowlisted ref unless a matching credential authorizes it', async () => {
    const base = await makeCache();
    const runner: CommandRunner = async () => ({ stdout: '', stderr: '' });
    const svc = new RealBundleService(base, runner);

    // Anonymous pull from a registry outside the base allowlist is blocked.
    await expect(
      svc.ensurePulled({ appId: 'app', version: '1.0', source: 'acme', ociRef: 'registry.example.com/acme/app:1.0' })
    ).rejects.toThrow('REF_NOT_ALLOWED');

    // Supplying a credential for that registry is the operator's consent → allowed.
    const ok = await svc.ensurePulled({
      appId: 'app',
      version: '1.0',
      source: 'acme',
      ociRef: 'registry.example.com/acme/app:1.0',
      credentials: { registry: 'registry.example.com', username: 'u', password: 'p' },
    });
    expect(ok.localPath).toBe(join(base, 'acme__app', '1.0'));
  });
});
