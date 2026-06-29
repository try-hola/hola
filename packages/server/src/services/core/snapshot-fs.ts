/**
 * Filesystem primitives for pre-upgrade app-data snapshots (#284 Phase 1).
 *
 * The server reaches app data directly through the identity bind mount
 * (`<HOLA_APPS_BIND_ROOT>:<HOLA_APPS_BIND_ROOT>`), so these helpers tar/untar a
 * host directory in-process. Kept separate from the deployment service so the
 * I/O is unit-testable on its own. File-level (crash-consistent); transaction-
 * consistent dumps are the per-app backup hooks tracked in #121.
 */
import { spawn } from 'node:child_process';
import { readdir, rm, mkdir, stat } from 'node:fs/promises';

/** True if `dir` exists and holds at least one entry (a fresh app has nothing to snapshot). */
export async function dirHasContents(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.length > 0;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/** Size of a file in bytes (0 if it can't be stat'd). */
export async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (d) => { stderr += String(d); });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${stderr.trim()}`)),
    );
  });
}

/** Gzip-tar the CONTENTS of `srcDir` into `destFile` (whose parent dir must exist). */
export async function tarGzipDir(srcDir: string, destFile: string): Promise<void> {
  await run('tar', ['-czf', destFile, '-C', srcDir, '.']);
}

/**
 * Replace `destDir`'s contents with the extracted contents of `srcFile`. The dir
 * is wiped first so the restore is exact (no stale files from the newer release
 * left behind) — callers MUST stop the app's containers before calling this.
 */
export async function restoreTarGzInto(srcFile: string, destDir: string): Promise<void> {
  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });
  await run('tar', ['-xzf', srcFile, '-C', destDir]);
}
