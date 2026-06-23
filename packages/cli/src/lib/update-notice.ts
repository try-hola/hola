// A best-effort "an upgrade is available" notice appended to the end of any
// command that already talks to the server. It reuses the command's SDK (so it
// hits the same host with the same cached server-side check the web dashboard
// uses), prints at most one line to STDERR, and NEVER affects the command's
// output, exit code, or success — every failure is swallowed.

import type { HolaSdk } from '@hola/sdk';
import { isNewerVersion, type GetUpdateCheckResponse } from '@hola/shared';

import { CLI_VERSION } from '../version';
import { colors } from './ui';

/**
 * Build the one-line notice for an update-check result, or null when nothing is
 * worth saying. Prefers the "newer release exists" message; otherwise flags the
 * case where this CLI is ahead of the running server (a `hola update` would close
 * the skew). Pure + exported so it can be unit-tested without a network.
 */
export function updateNoticeLine(res: GetUpdateCheckResponse): string | null {
  if (res.updateAvailable && res.latest) {
    return colors.yellow(
      `A newer Hola version (${res.latest}) is available — the server is on ${res.current}. ` +
        'Run `hola update --host …` to upgrade.',
    );
  }
  if (res.current && isNewerVersion(CLI_VERSION, res.current)) {
    return colors.yellow(
      `Your CLI (${CLI_VERSION}) is newer than the server (${res.current}). ` +
        'Run `hola update --host …` to upgrade the server.',
    );
  }
  return null;
}

/**
 * Fetch the server's (cached) update-check and print a one-line notice. No-op
 * under `--json` (keeps machine output clean) or when HOLA_NO_UPDATE_NOTICE is
 * set, and silent on any error so it can be called unconditionally on success.
 */
export async function maybeNotifyUpdate(sdk: HolaSdk, opts: { json?: boolean }): Promise<void> {
  if (opts.json || process.env.HOLA_NO_UPDATE_NOTICE) return;
  try {
    const res = (await sdk.system.updateCheck()) as GetUpdateCheckResponse;
    const line = updateNoticeLine(res);
    if (line) console.error(`\n${line}`);
  } catch {
    // Best-effort: a version check must never change a command's outcome.
  }
}
