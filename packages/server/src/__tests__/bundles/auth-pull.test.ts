import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { suggestRegistryGlob } from '@hola/shared';
import { RealBundleService, bundleCacheKey, type CommandRunner } from '../../services/core/bundles';
import { BundleError } from '../../middleware/error-mapping';

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

  test('REF_NOT_ALLOWED carries the fix as structured details', async () => {
    // The web install wizard offers "allow this registry" straight from the
    // failure, so the remedy has to travel as DATA. If it only existed in the
    // prose message, the client would be back to regexing English.
    const base = await makeCache();
    const svc = new RealBundleService(base, async () => ({ stdout: '', stderr: '' }));

    let err: unknown;
    try {
      await svc.ensurePulled({ appId: 'cms', version: '0.1.13', source: 'pofallon', ociRef: 'ghcr.io/pofallon/hola-get2know-cms:0.1.13' });
    } catch (e) { err = e; }

    expect(err).toBeInstanceOf(BundleError);
    expect((err as BundleError).status).toBe(403);
    expect((err as BundleError).details).toEqual({
      ref: 'ghcr.io/pofallon/hola-get2know-cms:0.1.13',
      suggestedGlob: 'ghcr.io/pofallon/*',
      allowed: ['ghcr.io/try-hola/*'],
    });
  });

  test('the suggested glob is narrow, submittable, and actually unblocks the ref', async () => {
    // Namespace-scoped, never bare-host: allowing one publisher's package must
    // not silently allow every other org on the same registry.
    expect(suggestRegistryGlob('ghcr.io/pofallon/hola-get2know-cms:0.1.13')).toBe('ghcr.io/pofallon/*');
    expect(suggestRegistryGlob('ghcr.io/acme/app@sha256:abc')).toBe('ghcr.io/acme/*');
    // A namespace-less ref has no org to scope to — the host is as narrow as it gets.
    expect(suggestRegistryGlob('registry.example.com/app:1')).toBe('registry.example.com/*');

    // End to end: feeding the suggestion back as a source consent unblocks the pull.
    const base = await makeCache();
    const svc = new RealBundleService(base, async () => ({ stdout: '', stderr: '' }));
    const ref = 'ghcr.io/pofallon/hola-get2know-cms:0.1.13';
    const ok = await svc.ensurePulled({
      appId: 'cms', version: '0.1.13', source: 'pofallon', ociRef: ref,
      extraAllowlist: [suggestRegistryGlob(ref)],
    });
    expect(ok.localPath).toBe(join(base, 'pofallon__cms', '0.1.13'));

    // ...and does NOT unblock a different namespace on the same registry.
    await expect(
      svc.ensurePulled({
        appId: 'other', version: '1.0', source: 'pofallon', ociRef: 'ghcr.io/someone-else/app:1.0',
        extraAllowlist: [suggestRegistryGlob(ref)],
      }),
    ).rejects.toThrow('REF_NOT_ALLOWED');
  });
});

describe('RealBundleService digest-based staleness detection', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function makeCache() {
    const base = await mkdtemp(join(tmpdir(), 'hola-bundle-digest-test-'));
    dirs.push(base);
    return base;
  }

  /** Seeds a cache dir as if a prior `ensurePulled` already ran for this version. */
  function seedCachedBundle(base: string, appId: string, version: string, digest?: string) {
    const dest = join(base, appId, version);
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'compose.yaml'), 'services: {}');
    writeFileSync(join(dest, 'manifest.json'), '{}');
    if (digest) writeFileSync(join(dest, '.oras-digest'), digest);
    return dest;
  }

  const DIGEST_A = 'sha256:' + 'a'.repeat(64);
  const DIGEST_B = 'sha256:' + 'b'.repeat(64);

  function runnerResolving(digest: string, pullLog: string[]): CommandRunner {
    return async (cmd) => {
      if (cmd.startsWith('oras resolve')) return { stdout: digest + '\n', stderr: '' };
      if (cmd.startsWith('oras pull')) pullLog.push(cmd);
      return { stdout: '', stderr: '' };
    };
  }

  test('reuses the cache when the resolved digest matches the stamped marker', async () => {
    const base = await makeCache();
    seedCachedBundle(base, 'app', '1.0', DIGEST_A);
    const pulls: string[] = [];
    const svc = new RealBundleService(base, runnerResolving(DIGEST_A, pulls));

    const info = await svc.ensurePulled({ appId: 'app', version: '1.0', ociRef: 'ghcr.io/try-hola/app:1.0' });

    expect(pulls).toHaveLength(0); // no re-pull
    expect(info.digest).toBe(DIGEST_A);
  });

  test('re-pulls when the registry digest no longer matches the marker (same-tag republish)', async () => {
    const base = await makeCache();
    const dest = seedCachedBundle(base, 'app', '1.0', DIGEST_A);
    const pulls: string[] = [];
    const svc = new RealBundleService(base, runnerResolving(DIGEST_B, pulls));

    const info = await svc.ensurePulled({ appId: 'app', version: '1.0', ociRef: 'ghcr.io/try-hola/app:1.0' });

    expect(pulls).toHaveLength(1); // stale cache triggered a fresh pull
    expect(info.digest).toBe(DIGEST_B);
    // The old mixed-content marker is gone/replaced after the re-pull.
    expect(readFileSync(join(dest, '.oras-digest'), 'utf8').trim()).toBe(DIGEST_B);
  });

  test('trusts the existing cache when digest resolution fails (offline registry)', async () => {
    const base = await makeCache();
    seedCachedBundle(base, 'app', '1.0', DIGEST_A);
    const pulls: string[] = [];
    const runner: CommandRunner = async (cmd) => {
      if (cmd.startsWith('oras resolve')) throw new Error('network unreachable');
      if (cmd.startsWith('oras pull')) pulls.push(cmd);
      return { stdout: '', stderr: '' };
    };
    const svc = new RealBundleService(base, runner);

    const info = await svc.ensurePulled({ appId: 'app', version: '1.0', ociRef: 'ghcr.io/try-hola/app:1.0' });

    expect(pulls).toHaveLength(0); // resolve failure must not fail or force-repull the install
    expect(info.localPath).toBe(join(base, 'app', '1.0'));
  });

  test('trusts a pre-existing cache with no marker (bundle cached before this feature shipped)', async () => {
    const base = await makeCache();
    seedCachedBundle(base, 'app', '1.0'); // no .oras-digest written
    const pulls: string[] = [];
    const svc = new RealBundleService(base, runnerResolving(DIGEST_A, pulls));

    await svc.ensurePulled({ appId: 'app', version: '1.0', ociRef: 'ghcr.io/try-hola/app:1.0' });

    expect(pulls).toHaveLength(0); // no marker to compare against -> don't force a redundant re-pull
  });

  test('stamps a digest marker after a fresh (first-time) pull', async () => {
    const base = await makeCache();
    const pulls: string[] = [];
    const svc = new RealBundleService(base, runnerResolving(DIGEST_A, pulls));

    const info = await svc.ensurePulled({ appId: 'app', version: '2.0', ociRef: 'ghcr.io/try-hola/app:2.0' });

    expect(pulls).toHaveLength(1);
    expect(info.digest).toBe(DIGEST_A);
    expect(readFileSync(join(base, 'app', '2.0', '.oras-digest'), 'utf8').trim()).toBe(DIGEST_A);
  });
});

describe('RealBundleService allowlist consent via extraAllowlist', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function makeCache() {
    const base = await mkdtemp(join(tmpdir(), 'hola-bundle-allow-test-'));
    dirs.push(base);
    return base;
  }

  test('an extraAllowlist glob unlocks an anonymous pull from a non-baseline registry', async () => {
    const base = await makeCache();
    const runner: CommandRunner = async () => ({ stdout: '', stderr: '' });
    const svc = new RealBundleService(base, runner);

    // Without consent: blocked (baseline allowlist is ghcr.io/try-hola/*).
    await expect(
      svc.ensurePulled({ appId: 'cms', version: '0.1.2', source: 'pofallon', ociRef: 'ghcr.io/pofallon/hola-get2know-cms:0.1.2' })
    ).rejects.toThrow('REF_NOT_ALLOWED');

    // With the source's allowRegistries threaded as extraAllowlist: unlocked.
    const ok = await svc.ensurePulled({
      appId: 'cms',
      version: '0.1.2',
      source: 'pofallon',
      ociRef: 'ghcr.io/pofallon/hola-get2know-cms:0.1.2',
      extraAllowlist: ['ghcr.io/pofallon/*'],
    });
    expect(ok.localPath).toBe(join(base, 'pofallon__cms', '0.1.2'));
  });

  test('a typo-squat registry is still rejected even when a broader glob is allowed', async () => {
    const base = await makeCache();
    const runner: CommandRunner = async () => ({ stdout: '', stderr: '' });
    const svc = new RealBundleService(base, runner);

    // matchesAllowlist is glob-prefix anchored, so ghcr.io.evil.com must NOT
    // slip past a ghcr.io/* consent (the original typo-squat defense).
    await expect(
      svc.ensurePulled({
        appId: 'evil',
        version: '1.0',
        source: 'pofallon',
        ociRef: 'ghcr.io.evil.com/pofallon/evil:1.0',
        extraAllowlist: ['ghcr.io/*'],
      })
    ).rejects.toThrow('REF_NOT_ALLOWED');
  });
});
