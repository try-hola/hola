/**
 * F15 — a snapshot capture must not report success without producing a
 * readable archive.
 *
 * `tarGzipDir` tolerates `tar` exiting 1 on purpose: archiving a *live* data
 * dir races the app's own writes, and a file changing or vanishing mid-read is
 * a soft error that still yields a complete, crash-consistent archive (#284 /
 * #121). That tolerance is correct and these tests hold it in place. What was
 * missing is the other half — a post-condition proving an archive actually
 * exists and can be read — so an exit-1 outcome that wrote *nothing* was
 * reported as a successful snapshot and only discovered at rollback time.
 *
 * The observed instance was a non-GNU `tar`: libarchive's `bsdtar`, which is
 * what macOS ships as `/usr/bin/tar`, refuses the GNU-only flags
 * (`--warning=no-file-changed`, `--ignore-failed-read`) with "Option … is not
 * supported", exits **1**, and creates no file. That was reproduced directly —
 * `bsdtar 3.7.2 / libarchive 3.7.2`, the same implementation family macOS
 * ships, run with the pre-fix flag set — rather than inferred.
 *
 * CI runs GNU tar, so the failure cannot be reproduced by calling the real one
 * here. Instead the tar implementation is substituted on PATH (the technique
 * F01's `compose-env.test.ts` uses for `docker`): each case below is a tiny
 * `tar` that behaves exactly like one of the observed or plausible failures,
 * so the post-condition is tested against the behaviour rather than against a
 * mock of our own code. Two cases delegate to the real `tar` — one to prove a
 * soft-errored-but-complete archive still succeeds, one to prove a bsdtar-like
 * implementation now captures instead of silently doing nothing.
 *
 * Running these against a real non-GNU tar (a macOS job, or a `bsdtar` shim in
 * the existing Linux one) is #549 — judged not worth a second runner for a P2.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { spawnSync } from 'child_process';
import { mkdtemp, mkdir, rm, writeFile, appendFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { tarGzipDir, restoreTarGzInto, fileSize } from '../../services/core/snapshot-fs';

/** Absolute path to the host's real tar, resolved BEFORE PATH is shadowed. */
const REAL_TAR = (() => {
  const found = spawnSync('sh', ['-c', 'command -v tar'], { encoding: 'utf8' }).stdout.trim();
  if (!found) throw new Error('no tar on PATH — this suite tests tar behaviour');
  return found;
})();

const GNU_BANNER = 'tar (GNU tar) 1.35';
const BSD_BANNER = 'bsdtar 3.7.2 - libarchive 3.7.2 zlib/1.3';

describe('F15: a capture proves it produced an archive', () => {
  let root: string;
  let src: string;
  let dest: string;
  let binDir: string;
  let savedPath: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'hola-f15-'));
    src = join(root, 'src');
    dest = join(root, 'out', 'data.tar.gz');
    binDir = join(root, 'bin');
    await mkdir(join(src, 'nested'), { recursive: true });
    await mkdir(join(root, 'out'), { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(join(src, 'state.txt'), 'the app data');
    await writeFile(join(src, 'nested', 'more.txt'), 'more app data');
    savedPath = process.env.PATH;
  });

  afterEach(async () => {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    await rm(root, { recursive: true, force: true });
  });

  /**
   * Install `body` as `tar` ahead of the real one on PATH. `body` receives the
   * original arguments; `$REAL_TAR` is the genuine implementation, and the
   * `--version` banner is answered before `body` runs so the flag-selection
   * probe sees whatever the case is simulating.
   */
  async function fakeTar(banner: string, body: string): Promise<void> {
    await writeFile(
      join(binDir, 'tar'),
      `#!/bin/sh\nREAL_TAR='${REAL_TAR}'\n` +
      `if [ "$1" = "--version" ]; then echo "${banner}"; exit 0; fi\n${body}\n`,
      { mode: 0o755 },
    );
    process.env.PATH = `${binDir}:${savedPath ?? ''}`;
  }

  // --------------------------------------------------------------- real tar --

  test('a real capture produces an archive that lists, and restores', async () => {
    await tarGzipDir(src, dest);

    expect(await fileSize(dest)).toBeGreaterThan(0);
    const back = join(root, 'back');
    await mkdir(back, { recursive: true });
    await restoreTarGzInto(dest, back, join(root, 'staging'));
    expect(existsSync(join(back, 'nested', 'more.txt'))).toBe(true);
  });

  /**
   * THE tolerance, on real tar: a directory whose files are being rewritten
   * while tar reads them still yields a snapshot. This is the behaviour the
   * exit-1 allowance exists for, and a "fix" that made tar strict would break
   * it — so it is asserted on both sides of the change, not just after.
   *
   * The file is large enough that the writer genuinely overlaps the read; the
   * test does not *depend* on winning that race, because a capture that
   * happens to see a quiet moment must succeed too. What it forbids is a
   * capture that fails, or one that "succeeds" with nothing on disk.
   */
  test('a live directory whose files change mid-read still snapshots', async () => {
    const churn = join(src, 'busy.bin');
    await writeFile(churn, Buffer.alloc(8 * 1024 * 1024, 7));

    let writing = true;
    const writer = (async () => {
      while (writing) {
        await appendFile(churn, Buffer.alloc(256 * 1024, 9));
        await new Promise((r) => setTimeout(r, 1));
      }
    })();

    await tarGzipDir(src, dest);
    writing = false;
    await writer;

    // Succeeded, and with a real archive — the point of the post-condition is
    // that "it did not throw" is no longer the only thing asserted.
    expect(await fileSize(dest)).toBeGreaterThan(0);
    const back = join(root, 'back');
    await mkdir(back, { recursive: true });
    await restoreTarGzInto(dest, back, join(root, 'staging'));
    expect(existsSync(join(back, 'state.txt'))).toBe(true);
  });

  // ------------------------------------------------ the finding, simulated --

  /**
   * The macOS reproduction, verbatim: bsdtar rejects the GNU flags, exits 1,
   * writes nothing. Before the fix this resolved successfully.
   */
  test('a tar that rejects the GNU flags and writes nothing is a failure, not a snapshot', async () => {
    await fakeTar(BSD_BANNER, [
      'for a in "$@"; do',
      '  case "$a" in',
      '    --warning=*|--ignore-failed-read)',
      '      echo "bsdtar: Option $a is not supported" >&2; exit 1;;',
      '  esac',
      'done',
      'exit 1',
    ].join('\n'));

    await expect(tarGzipDir(src, dest)).rejects.toThrow(/wrote no archive/);
    expect(existsSync(dest)).toBe(false);
  });

  test('a tar that exits 0 having written nothing is a failure', async () => {
    await fakeTar(GNU_BANNER, 'exit 0');
    await expect(tarGzipDir(src, dest)).rejects.toThrow(/wrote no archive/);
  });

  test('a tar that leaves a zero-byte archive is a failure', async () => {
    await fakeTar(GNU_BANNER, ': > "$2"\nexit 0');
    await expect(tarGzipDir(src, dest)).rejects.toThrow(/empty archive/);
  });

  /**
   * What listing buys over `size > 0`: a capture cut short (ENOSPC, OOM, a
   * killed container) leaves a plausible-looking file that cannot be read.
   */
  test('a truncated archive is a failure even though the file is non-empty', async () => {
    await fakeTar(GNU_BANNER, [
      '"$REAL_TAR" "$@" || exit $?',
      'head -c 200 "$2" > "$2.part" && mv "$2.part" "$2"',
      'exit 0',
    ].join('\n'));

    await expect(tarGzipDir(src, dest)).rejects.toThrow(/not readable/);
    expect(await fileSize(dest)).toBeGreaterThan(0); // size alone would have passed
  });

  /**
   * A valid archive holding nothing but its own root entry. Both callers
   * guarantee a non-empty source, so this means the capture never saw the
   * data — and recording it would put an `rm -rf`-shaped restore on disk.
   */
  test('an archive with no members is a failure', async () => {
    await fakeTar(GNU_BANNER, [
      'empty="$(mktemp -d)"',
      '"$REAL_TAR" -czf "$2" -C "$empty" .',
      'rmdir "$empty"',
      'exit 0',
    ].join('\n'));

    await expect(tarGzipDir(src, dest)).rejects.toThrow(/holds no files/);
  });

  test('the failure names what tar said, so the cause is not guesswork', async () => {
    await fakeTar(GNU_BANNER, 'echo "tar: /data: Cannot open: Permission denied" >&2\nexit 1');
    await expect(tarGzipDir(src, dest)).rejects.toThrow(/Permission denied/);
  });

  // ----------------------------------------------- the tolerance, simulated --

  /**
   * The soft error the tolerance exists for, made deterministic: a complete
   * archive plus exit 1, exactly what GNU tar reports when a file changed as it
   * was read. This must succeed — the post-condition judges the archive, never
   * the exit code.
   *
   * Only creation is soft-errored; the listing pass stays strict, which is the
   * rule stated in `tarGzipDir`: exit 1 with a good archive passes, exit 1
   * with a bad one does not.
   */
  test('exit 1 with a complete archive is the live-file race and still succeeds', async () => {
    await fakeTar(GNU_BANNER, [
      '"$REAL_TAR" "$@"',
      'rc=$?',
      'case " $* " in',
      '  *" -czf "*) echo "tar: ./busy.bin: file changed as we read it" >&2',
      '              [ $rc -eq 0 ] && rc=1;;',
      'esac',
      'exit $rc',
    ].join('\n'));

    await tarGzipDir(src, dest);
    expect(await fileSize(dest)).toBeGreaterThan(0);
  });

  /**
   * And the developer-environment outcome: a bsdtar-like tar is no longer given
   * flags it cannot parse, so it captures for real instead of failing (loudly
   * now, but still failing). Same fake as the finding above, except it delegates
   * the portable invocation to the real implementation — which is precisely what
   * bsdtar would do with it.
   */
  test('a non-GNU tar is given portable options and captures normally', async () => {
    await fakeTar(BSD_BANNER, [
      'for a in "$@"; do',
      '  case "$a" in',
      '    --warning=*|--ignore-failed-read)',
      '      echo "bsdtar: Option $a is not supported" >&2; exit 1;;',
      '  esac',
      'done',
      'exec "$REAL_TAR" "$@"',
    ].join('\n'));

    await tarGzipDir(src, dest);
    expect(await fileSize(dest)).toBeGreaterThan(0);

    const back = join(root, 'back');
    await mkdir(back, { recursive: true });
    await restoreTarGzInto(dest, back, join(root, 'staging'));
    expect(await readdir(back)).toContain('state.txt');
  });
});
