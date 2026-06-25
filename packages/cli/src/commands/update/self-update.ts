import { access, chmod, rename, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';

import { isNewerVersion } from '@hola/shared';

import { colors } from '../../lib/ui';

/**
 * Outcome of an attempted CLI self-update:
 *   - `skipped`        already on the latest (or a dry run) — nothing to do.
 *   - `unsupported`    no prebuilt binary for this OS/arch — can't self-update.
 *   - `not-writable`   a newer CLI exists but the binary can't be replaced
 *                      (e.g. installed root-owned under /usr/local/bin).
 * On a successful replace the new binary is re-exec'd and the process exits, so
 * this never returns in that case.
 */
export type SelfUpdateOutcome = 'skipped' | 'unsupported' | 'not-writable';

/** Injectable environment so the real fs/network/exec can be faked in tests. */
export interface SelfUpdateEnv {
  /** Path to the currently running binary (process.execPath). */
  execPath: string;
  platform: NodeJS.Platform;
  arch: string;
  /** The user-supplied args to re-run after upgrading (process.argv.slice(2)). */
  userArgs: string[];
  baseEnv: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  /** Spawn the replacement binary; resolves with its exit code. */
  spawn: (cmd: string, args: string[], env: NodeJS.ProcessEnv) => Promise<number>;
  exit: (code: number) => never;
  out: (msg: string) => void;
}

export interface SelfUpdateArgs {
  repo: string;
  latestVersion: string;
  currentVersion: string;
  dryRun?: boolean;
}

/** Release asset name for a platform/arch, or null if unsupported (mirrors cli-install.sh). */
export function selfUpdateAsset(platform: NodeJS.Platform, arch: string): string | null {
  const os = platform === 'linux' ? 'linux' : platform === 'darwin' ? 'darwin' : null;
  const a = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : null;
  return os && a ? `hola-${os}-${a}` : null;
}

/** Derive the GitHub release-download base from a clone URL (…/hola.git → …/hola). */
function releaseBase(repo: string): string {
  return repo.replace(/\.git$/, '');
}

/**
 * Upgrade the running `hola` binary in place to `latestVersion`, then re-exec it
 * to perform the actual work with the new code/version. Downloads the matching
 * release asset to a temp file in the binary's own directory, marks it
 * executable, and atomically renames it over the running binary — which is safe
 * on Linux/macOS, where the kernel keeps the open inode of the running process.
 * The re-exec carries `HOLA_SELF_UPDATED=1` so the new process doesn't loop.
 */
export async function selfUpdateCli(args: SelfUpdateArgs, env: SelfUpdateEnv): Promise<SelfUpdateOutcome> {
  const { repo, latestVersion, currentVersion, dryRun } = args;
  if (!isNewerVersion(latestVersion, currentVersion)) return 'skipped';

  const asset = selfUpdateAsset(env.platform, env.arch);
  if (!asset) {
    env.out(colors.yellow(`No prebuilt CLI for ${env.platform}/${env.arch}; updating the server only.`));
    return 'unsupported';
  }

  const binPath = env.execPath;
  env.out(colors.dim(`==> Upgrade CLI ${currentVersion} → ${latestVersion}`));
  if (dryRun) {
    env.out(`  would download ${asset} and replace ${binPath}`);
    return 'skipped';
  }

  // The binary is replaced via a rename within its own directory, so we need to
  // be able to write that directory — check up front for a clear early abort.
  const dir = dirname(binPath);
  try {
    await access(dir, constants.W_OK);
  } catch {
    return 'not-writable';
  }

  const url = `${releaseBase(repo)}/releases/download/cli-v${latestVersion}/${asset}`;
  const res = await env.fetchImpl(url, {
    headers: { 'User-Agent': 'hola-cli' },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Downloading the new CLI failed (HTTP ${res.status}) from ${url}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  // Sanity floor: a real compiled Bun binary is tens of MB; anything tiny is an
  // error page or a truncated download, not something to chmod +x and run.
  if (bytes.length < 1_000_000) {
    throw new Error(`Downloaded CLI looks corrupt (${bytes.length} bytes) from ${url}`);
  }

  const tmp = join(dir, `.hola-update-${latestVersion}.tmp`);
  try {
    await writeFile(tmp, bytes, { mode: 0o755 });
    await chmod(tmp, 0o755);
    await rename(tmp, binPath);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'not-writable';
    throw err;
  }
  env.out(colors.green(`  CLI upgraded to ${latestVersion}.`));

  // Hand off to the freshly installed binary so the rest of the run uses the new
  // code and version. HOLA_SELF_UPDATED stops it from trying to self-update again.
  const code = await env.spawn(binPath, env.userArgs, { ...env.baseEnv, HOLA_SELF_UPDATED: '1' });
  env.exit(code);
}
