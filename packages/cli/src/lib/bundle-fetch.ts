// Download + extract the compose bundle on the remote host. Shared by `hola update`
// and `hola bootstrap`, which previously ran `curl -fsSL url | tar xz -C dir`.
//
// Three problems with that one-liner, each of which was hit (#599):
//
// 1. ATTRIBUTION. Without `pipefail` (not POSIX sh) a pipeline reports only tar's
//    status, so a failed download surfaced as whatever tar made of empty input, and
//    a failed extraction was blamed on the network ("check that the release
//    exists"). The bundle is now downloaded to a temp file first, then extracted,
//    and each failure exits with its own code so the caller can say which step broke.
//    The temp file is removed by an EXIT trap on every path.
//
// 2. OWNERSHIP. The bundle is built by CI as uid 1001. Run as root, `tar x` restores
//    that owner, so a later non-root `hola update` finds root/1001-owned files it
//    cannot replace. Extraction therefore never restores owners: `--no-same-owner`
//    on GNU tar and bsdtar. busybox tar (Alpine and some minimal hosts) only has the
//    long option when built with FEATURE_TAR_LONG_OPTIONS, but always has `-o`
//    ("don't restore user:group"); on GNU tar `-o` means the same thing while
//    extracting. The remote shell picks the long option when this tar accepts it
//    (`tar --no-same-owner --version` succeeds on GNU/bsdtar and fails on a busybox
//    that lacks the long option) and falls back to `-o`. `--no-same-permissions` is
//    deliberately NOT used: the bundle's scripts must keep their executable bit.
//
// 3. HIDDEN CAUSE. curl and tar write their real diagnostics to stderr; the caller
//    surfaces the tail of it instead of a generic hint.

import { shq } from './shell-quote';

export const FETCH_EXIT = { tmpfile: 41, download: 42, extract: 43 } as const;

export function buildFetchBundleCommand(url: string, dir: string): string {
  return [
    `d=${shq(dir)}`,
    `tmp=$(mktemp "\${TMPDIR:-/tmp}/hola-bundle.XXXXXX") || exit ${FETCH_EXIT.tmpfile}`,
    `trap 'rm -f "$tmp"' EXIT`,
    `curl -fsSL -o "$tmp" ${shq(url)} || exit ${FETCH_EXIT.download}`,
    `own=--no-same-owner`,
    `tar "$own" --version >/dev/null 2>&1 || own=-o`,
    `tar xzf "$tmp" "$own" -C "$d" || exit ${FETCH_EXIT.extract}`,
  ].join('; ');
}

export type FetchFailure = 'connection' | 'tmpfile' | 'download' | 'extract' | 'unknown';

export function classifyFetch(code: number): FetchFailure | 'ok' {
  if (code === 0) return 'ok';
  if (code === 255) return 'connection';
  if (code === FETCH_EXIT.tmpfile) return 'tmpfile';
  if (code === FETCH_EXIT.download) return 'download';
  if (code === FETCH_EXIT.extract) return 'extract';
  return 'unknown';
}

/** The last few non-empty stderr lines, for inclusion in an error message. */
export function stderrTail(stderr: string, max = 4): string {
  const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.slice(-max).join('\n    ');
}

export function fetchFailureMessage(
  kind: Exclude<FetchFailure, 'connection'>,
  ctx: { host: string; dir: string; ref: string; url: string; code: number; stderr: string },
): string {
  const detail = stderrTail(ctx.stderr);
  const tail = detail ? `\n  Output:\n    ${detail}` : '';
  switch (kind) {
    case 'download':
      return (
        `Downloading the compose bundle failed. ` +
        `Check that release ${ctx.ref} exists and the host can reach ${ctx.url}.${tail}`
      );
    case 'extract':
      return (
        `Downloaded the compose bundle but could not extract it into ${ctx.dir} on ${ctx.host}.` +
        `${tail}\n  If this is a permissions problem, fix ownership on the host: ` +
        `sudo chown -R "$(id -un):$(id -gn)" ${shq(ctx.dir)}`
      );
    case 'tmpfile':
      return `Could not create a temporary file on ${ctx.host} to hold the download (is /tmp writable and not full?).${tail}`;
    case 'unknown':
      return `The bundle download/extract step failed on ${ctx.host} (exit ${ctx.code}).${tail}`;
  }
}
