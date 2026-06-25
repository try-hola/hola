import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { selfUpdateCli, selfUpdateAsset, type SelfUpdateEnv } from '../commands/update/self-update';

const REPO = 'https://github.com/try-hola/hola.git';

/** A buffer big enough to clear selfUpdateCli's "looks corrupt" floor. */
function binaryBytes(n = 1_500_000): Uint8Array {
  return new Uint8Array(n);
}

function makeEnv(over: Partial<SelfUpdateEnv> & { execPath: string }): SelfUpdateEnv {
  return {
    platform: 'linux',
    arch: 'x64',
    userArgs: ['update', '--host', 'me@vm'],
    baseEnv: {},
    fetchImpl: vi.fn(async () => new Response(binaryBytes().buffer as ArrayBuffer, { status: 200 })) as unknown as typeof fetch,
    spawn: vi.fn(async () => 0),
    // exit() must never return — throw a sentinel the test can assert on.
    exit: vi.fn((code: number) => {
      throw new Error(`__exit__:${code}`);
    }) as unknown as (code: number) => never,
    out: () => {},
    ...over,
  };
}

describe('selfUpdateAsset', () => {
  it('maps supported platforms and rejects the rest', () => {
    expect(selfUpdateAsset('linux', 'x64')).toBe('hola-linux-x64');
    expect(selfUpdateAsset('darwin', 'arm64')).toBe('hola-darwin-arm64');
    expect(selfUpdateAsset('win32', 'x64')).toBeNull();
    expect(selfUpdateAsset('linux', 'arm')).toBeNull();
  });
});

describe('selfUpdateCli', () => {
  it('skips when already on the latest', async () => {
    const env = makeEnv({ execPath: '/usr/local/bin/hola' });
    const outcome = await selfUpdateCli({ repo: REPO, latestVersion: '0.6.24', currentVersion: '0.6.24' }, env);
    expect(outcome).toBe('skipped');
    expect(env.fetchImpl).not.toHaveBeenCalled();
  });

  it('returns unsupported when there is no prebuilt binary for the platform', async () => {
    const env = makeEnv({ execPath: '/usr/local/bin/hola', platform: 'win32' as NodeJS.Platform });
    const outcome = await selfUpdateCli({ repo: REPO, latestVersion: '0.6.25', currentVersion: '0.6.24' }, env);
    expect(outcome).toBe('unsupported');
    expect(env.fetchImpl).not.toHaveBeenCalled();
  });

  it('dry run describes the upgrade without downloading', async () => {
    const env = makeEnv({ execPath: '/usr/local/bin/hola' });
    const outcome = await selfUpdateCli({ repo: REPO, latestVersion: '0.6.25', currentVersion: '0.6.24', dryRun: true }, env);
    expect(outcome).toBe('skipped');
    expect(env.fetchImpl).not.toHaveBeenCalled();
  });

  it('downloads the right asset, replaces the binary, and re-execs the new one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hola-su-'));
    const bin = join(dir, 'hola');
    await writeFile(bin, 'OLD-BINARY');
    await chmod(bin, 0o755);

    const spawn = vi.fn(async () => 0);
    const env = makeEnv({ execPath: bin, spawn });

    // exit() throws the sentinel, so the call rejects rather than returning.
    await expect(
      selfUpdateCli({ repo: REPO, latestVersion: '0.6.25', currentVersion: '0.6.24' }, env),
    ).rejects.toThrow('__exit__:0');

    // The binary was replaced with the downloaded bytes.
    const replaced = await readFile(bin);
    expect(replaced.length).toBeGreaterThan(1_000_000);

    // Re-exec used the same path + user args + the loop-guard env var.
    expect(spawn).toHaveBeenCalledWith(
      bin,
      ['update', '--host', 'me@vm'],
      expect.objectContaining({ HOLA_SELF_UPDATED: '1' }),
    );

    // Downloaded the platform-correct release asset.
    const url = (env.fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(url).toBe('https://github.com/try-hola/hola/releases/download/cli-v0.6.25/hola-linux-x64');
  });

  it('returns not-writable when the binary directory cannot be written', async () => {
    // Parent directory does not exist → access(W_OK) fails → not-writable.
    const env = makeEnv({ execPath: join(tmpdir(), 'hola-absent-dir-xyz', 'hola') });
    const outcome = await selfUpdateCli({ repo: REPO, latestVersion: '0.6.25', currentVersion: '0.6.24' }, env);
    expect(outcome).toBe('not-writable');
    expect(env.spawn).not.toHaveBeenCalled();
  });
});
