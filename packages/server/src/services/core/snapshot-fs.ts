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
import { readdir, rm, mkdir, stat, lstat, realpath, rename, cp } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { isStrictlyInside } from './path-containment';

/**
 * True if `dir` exists and holds at least one entry that isn't in `ignore`
 * (a fresh app has nothing to snapshot).
 *
 * `ignore` exists because the platform writes its own bookkeeping into the app
 * data root (`.hola/instance.json`, spec 006), which would otherwise make EVERY
 * materialized install look like it has data. Callers asking "has this app
 * written anything worth capturing?" must exclude it; callers asking "is there
 * anything here at all?" (uninstall) must not, or they would leave the
 * directory behind.
 */
export async function dirHasContents(dir: string, ignore: readonly string[] = []): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return ignore.length === 0 ? entries.length > 0 : entries.some((e) => !ignore.includes(e));
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

/**
 * Gzip-tar the CONTENTS of `srcDir` into `destFile` (whose parent dir must
 * exist), and PROVE the archive exists before reporting success (F15).
 *
 * Two facts have to coexist here, and mixing them up is the whole finding.
 *
 * **The tolerance (keep it).** Snapshotting a *live* data dir races with the
 * app's own writes: a file (e.g. a postgres WAL segment) can change or vanish
 * between tar's stat and read. tar reports that as a soft error (exit 1) while
 * still writing a complete, crash-consistent archive — which is exactly this
 * snapshot's contract (#284/#121). Making tar strict would fail every snapshot
 * of a busy app, i.e. break the feature the tolerance was added for.
 *
 * **The missing post-condition (the bug).** Tolerating exit 1 meant tolerating
 * *any* exit-1 outcome, including ones that wrote no archive at all. The
 * observed case is a non-GNU `tar`: libarchive's `bsdtar` — which is what
 * macOS ships as `/usr/bin/tar` — rejects the GNU-only flags below with
 * `Option --warning=no-file-changed is not supported`, exits **1**, and creates
 * nothing. `tarGzipDir` then resolved, `writeSnapshotMeta` recorded a snapshot
 * whose `sizeBytes` was 0, and the loss only surfaced at rollback time.
 *
 * So the exit code no longer decides on its own:
 *
 *  - exit >= 2 — fatal, fail immediately (unchanged).
 *  - exit 0 or 1 — provisional. The archive must then exist, be non-empty, and
 *    LIST (`tar -tzf`) with at least one entry. If it does, exit 1 was the
 *    documented soft error and this succeeds; if it does not, exit 1 was a real
 *    failure whatever tar said, and this throws with tar's own stderr attached.
 *
 * Listing rather than only stat'ing costs a full decompress of what was just
 * written, and it is what catches a *truncated* archive (a capture killed by
 * ENOSPC or an OOM) that a size check waves through. Measured on GNU tar 1.35:
 * a 400 MB incompressible root costs 12.8 s to create and 2.3 s to verify
 * (+18%); a highly compressible one is ~1:1 but trivial in absolute terms
 * (~2 s). Verification is bounded by decompression throughput and so is never
 * worse than the capture it follows — cheap next to restoring a snapshot that
 * turns out not to exist.
 *
 * The flag set is chosen per implementation rather than assumed, so a
 * developer machine with `bsdtar` produces real snapshots instead of merely
 * failing loudly: GNU tar needs `--ignore-failed-read` (without it a file that
 * vanishes mid-read is exit **2**, fatal) and `--warning=no-file-changed`,
 * while bsdtar needs neither — it ignores a mid-read change outright and
 * reports an unreadable file as exit 1 with a complete archive, which is
 * precisely what the tolerance above already accepts. Production (the Linux
 * image) is GNU either way.
 */
export async function tarGzipDir(srcDir: string, destFile: string): Promise<void> {
  const tolerance = (await tarIsGnu())
    ? ['--warning=no-file-changed', '--ignore-failed-read']
    : [];
  const created = await runTar(['-czf', destFile, ...tolerance, '-C', srcDir, '.']);
  // exit >= 2 already threw inside runTar; 0 and 1 are both provisional.
  await assertArchiveUsable(destFile, created);
}

interface TarRun {
  code: number;
  stderr: string;
}

/** Like `run('tar', …)` but tolerant of tar's exit-1 "file changed as we read it"
 *  (expected when archiving a live data dir); only exit >= 2 is a real failure.
 *  Returns the tolerated outcome so the caller can prove what tar actually did. */
function runTar(args: string[]): Promise<TarRun> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (d) => { stderr += String(d); });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 || code === 1
        ? resolve({ code: code ?? 0, stderr: stderr.trim() })
        : reject(new Error(`tar exited ${code}: ${stderr.trim()}`)),
    );
  });
}

/**
 * True when `tar` on PATH is GNU tar. Probed per call rather than cached: one
 * `tar --version` is a few milliseconds against a capture measured in seconds,
 * and a process-lifetime cache would make the answer depend on which snapshot
 * ran first. Anything unexpected — a spawn failure, a non-zero exit, an
 * unrecognised banner — answers **false**, which selects the portable flag set;
 * the post-condition backs that up either way.
 */
async function tarIsGnu(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('tar', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout?.on('data', (d) => { stdout += String(d); });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0 && /GNU tar/i.test(stdout)));
  });
}

/**
 * The post-condition F15 was missing: an archive this function reported was
 * created must exist, be non-empty, and be readable as a gzip tar holding at
 * least one member.
 *
 * `./` alone does not count. Both callers guarantee a non-empty source
 * (`capturePreUpgradeSnapshot` returns early on an empty data root; the
 * restore-on-install capture reads an installed deployment's root, which always
 * holds its `.hola/` marker), so an archive that lists nothing but its own root
 * entry means the capture did not see the data — a wrong `-C`, a directory that
 * disappeared — and recording it would put an `rm -rf`-shaped restore on disk.
 */
async function assertArchiveUsable(destFile: string, created: TarRun): Promise<void> {
  const context = `tar exited ${created.code}${created.stderr ? `: ${created.stderr}` : ''}`;

  let size: number;
  try {
    size = (await stat(destFile)).size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    throw new Error(
      `tar reported no fatal error but wrote no archive at ${destFile} (${context})`,
      { cause: err },
    );
  }
  if (size === 0) {
    throw new Error(`tar wrote an empty archive at ${destFile} (${context})`);
  }

  const listing = await listArchive(destFile);
  if (listing.code !== 0) {
    throw new Error(
      `the archive at ${destFile} is not readable (tar -t exited ${listing.code}` +
      `${listing.stderr ? `: ${listing.stderr}` : ''}; ${context})`,
    );
  }
  if (!listing.hasMember) {
    throw new Error(`the archive at ${destFile} holds no files (${context})`);
  }
}

/**
 * Read `destFile`'s member names to EOF — reading to the end is what detects
 * truncation — reporting only whether any member beyond the root entry was
 * seen. Names are scanned chunk by chunk and discarded: a data root with a
 * million files would otherwise buffer tens of megabytes of paths to answer a
 * yes/no question.
 */
function listArchive(destFile: string): Promise<{ code: number; stderr: string; hasMember: boolean }> {
  return new Promise((resolveList, reject) => {
    const child = spawn('tar', ['-tzf', destFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let carry = '';
    let hasMember = false;

    const scan = (line: string): void => {
      const name = line.trim().replace(/\/+$/, '');
      if (name !== '' && name !== '.') hasMember = true;
    };

    child.stdout?.on('data', (d) => {
      const lines = (carry + String(d)).split('\n');
      carry = lines.pop() ?? '';
      for (const line of lines) scan(line);
    });
    child.stderr?.on('data', (d) => { stderr += String(d); });
    child.on('error', reject);
    child.on('close', (code) => {
      scan(carry);
      resolveList({ code: code ?? 0, stderr: stderr.trim(), hasMember });
    });
  });
}

/**
 * Replace `destDir`'s contents with the extracted contents of `srcFile` —
 * **staged**, so a missing, truncated or corrupt archive cannot destroy the
 * only current copy of the data (F09).
 *
 * The order is the whole point. This used to be three lines — `rm -rf destDir`,
 * `mkdir`, `tar -xzf` — which deleted the destination *before* anything proved
 * the archive could be extracted. A deliberately invalid archive therefore left
 * the caller with neither the old data nor the new. The sequence is now:
 *
 *  1. extract into a fresh staging directory (`.incoming-<ts>`) under
 *     `stagingParent`. A bad archive fails HERE, with `destDir` untouched.
 *  2. assert the staged tree is non-empty — a technically-valid archive of
 *     nothing would otherwise be a silent `rm -rf` of the data root.
 *  3. move the existing `destDir` aside (`.superseded-<ts>`) — a rename, so
 *     the original is preserved, not copied, and the window is microseconds.
 *  4. move the staged tree into place. If THAT fails, the original is renamed
 *     back and the error propagates — the failure disposition is always "the
 *     data you had is the data you still have".
 *  5. only then remove the superseded tree (best-effort: a leftover costs
 *     disk, never data).
 *
 * `stagingParent` is required rather than derived: it must be on the same
 * filesystem as `destDir` for the renames to be atomic, and only the caller
 * knows a platform-owned directory that qualifies. It must NOT be a path any
 * app container can reach — staging holds the operator's app data mid-swap.
 * (`EXDEV` is still tolerated, falling back to a copy, so a per-app filesystem
 * degrades in speed rather than failing.)
 *
 * Callers MUST still stop the app's containers first: this proves the archive,
 * not that nothing is writing to the directory.
 */
export async function restoreTarGzInto(srcFile: string, destDir: string, stagingParent: string): Promise<void> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const staged = join(stagingParent, `${basename(destDir)}.incoming-${stamp}`);
  const superseded = join(stagingParent, `${basename(destDir)}.superseded-${stamp}`);

  await mkdir(stagingParent, { recursive: true, mode: 0o700 });
  await mkdir(staged, { recursive: true });
  try {
    // Strict `run`, not `runTar`: tolerating exit 1 is right when ARCHIVING a
    // live directory (files change under tar) and wrong when extracting — a
    // truncated archive is exactly what this function exists to refuse.
    await run('tar', ['-xzf', srcFile, '-C', staged]);
    if (!(await dirHasContents(staged))) {
      throw new Error(`refusing to restore: ${srcFile} extracted to nothing`);
    }
  } catch (err) {
    await rm(staged, { recursive: true, force: true });
    throw err;
  }

  const hadDest = await dirHasContents(destDir);
  if (hadDest) await moveDir(destDir, superseded);
  try {
    await moveDir(staged, destDir);
  } catch (err) {
    // Put the original back before surfacing the failure. Losing the data here
    // would be the very outcome the staging exists to prevent.
    if (hadDest) await moveDir(superseded, destDir).catch(() => undefined);
    await rm(staged, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
  if (hadDest) await rm(superseded, { recursive: true, force: true }).catch(() => undefined);
}

/** `rename`, falling back to copy+remove across filesystems (`EXDEV`). */
async function moveDir(from: string, to: string): Promise<void> {
  await rm(to, { recursive: true, force: true });
  try {
    await rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await cp(from, to, { recursive: true });
    await rm(from, { recursive: true, force: true });
  }
}

/**
 * Result of {@link locateAppRootInTree} (spec 008, FR-041, closes #486).
 * `ok: false` on zero or more than one match — refuse rather than guess.
 * `via` says WHICH rule identified the root, so the caller can log it: the
 * install-identity marker, or the capture's own recorded location.
 */
export type LocateAppRootResult =
  | { ok: true; path: string; via: 'marker' | 'location' }
  | { ok: false; matchCount: number };

/**
 * Locate the one directory inside `destination` that is the delivered app
 * data root (spec 008, FR-041, closes #486).
 *
 * A provider-delivered tree does NOT follow this codebase's own root-relative
 * assumption (every OTHER archive helper in this file), and it does not follow
 * ONE alternative either — which is the whole reason this function exists
 * rather than an offset. Measured layouts:
 *
 *   - Backrest/restic v1.14.1 reproduces the **last path segment** only:
 *     `/srv/hola/apps/wiki-1a2b3c4d` delivered into `<destination>` lands at
 *     `<destination>/wiki-1a2b3c4d`.
 *   - A borg-shaped restore, and restic's own `--target` with a full path,
 *     reproduce the **whole absolute path**:
 *     `<destination>/srv/hola/apps/wiki-1a2b3c4d`.
 *
 * So the layout is a property of the provider, not of the contract, and both
 * forms have to be tolerated (#511). Neither is trusted further than the
 * other: each is derived from the same recorded `location` and each must prove
 * strict containment on its own.
 *
 * Two rules, in order, neither of them a guess:
 *
 *  1. **Marker.** Exactly one directory in the tree holds the `markerDir`
 *     subdirectory (`.hola`) AND real content beyond it — the same shape
 *     `dirHasContents(dir, [markerDir])` already asserts as a post-condition
 *     once a payload has landed. Bounded, depth-limited; a matched
 *     directory's own subtree is not descended into (an app's real data may
 *     coincidentally contain a marker-shaped directory one level down — the
 *     FIRST match along a path is the one that counts). Two or more matches
 *     REFUSE rather than pick.
 *  2. **Location.** No marker anywhere, and the caller supplied the capture's
 *     own recorded `location` (`RestoreIndexEntry.location`): the app root is
 *     that path reproduced under `destination`, in EITHER of the two layouts
 *     above. If both forms resolve to real, contained, non-empty directories
 *     the result is ambiguous and REFUSED, exactly as two markers are — a
 *     delivered tree that answers to both descriptions is not one this can
 *     pick between. This is the ONLY
 *     rule that can work for a capture taken before install identity existed
 *     (spec 006) — it has no `.hola` to find, and rule 1 alone would make
 *     every inference-identified candidate (spec 008 US5, FR-048-FR-052)
 *     offerable but impossible to actually restore. It is not a guess: it is
 *     the provider's own statement of where the capture came from, and it is
 *     the same field the identity inference itself reads.
 *
 * Both rules resolve through `realpath` and demand strict containment inside
 * `destination`, and the walk never descends a symlink — the provider owns a
 * writable mount of the staging root, so a planted symlink (a `destination`
 * that IS a symlink to an app's data root, a `location` carrying `..`) must
 * not be able to point the rename at anything outside the tree it delivered.
 */
export async function locateAppRootInTree(
  destination: string,
  markerDir: string,
  opts: { locationHint?: string; maxDepth?: number } = {},
): Promise<LocateAppRootResult> {
  const maxDepth = opts.maxDepth ?? 24;

  // The destination itself must be a REAL directory. A provider holding the
  // staging mount can create `<staging>/<requestId>` as a symlink to any path
  // it can see (its own `apps-data` mount covers every app's data root);
  // `readdir` would happily follow it and `rename` would move the link, not
  // the tree — handing the restoring install another app's live data and
  // aiming the marker rewrite at it.
  let realDestination: string;
  try {
    if (!(await lstat(destination)).isDirectory()) return { ok: false, matchCount: 0 };
    realDestination = await realpath(destination);
  } catch {
    return { ok: false, matchCount: 0 };
  }

  const matches: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' || (err as NodeJS.ErrnoException).code === 'ENOTDIR') return;
      throw err;
    }
    const hasMarker = entries.some((e) => e.isDirectory() && e.name === markerDir);
    if (hasMarker && (await dirHasContents(dir, [markerDir]))) {
      matches.push(dir);
      return; // do not descend into a matched root's own subtree
    }
    for (const entry of entries) {
      // `isDirectory()` is false for a symlink, so the walk never follows one.
      if (entry.isDirectory()) await walk(join(dir, entry.name), depth + 1);
    }
  }

  await walk(realDestination, 0);
  if (matches.length === 1) return { ok: true, path: matches[0]!, via: 'marker' };
  if (matches.length > 1) return { ok: false, matchCount: matches.length };

  // Rule 2 — no marker anywhere in the delivered tree.
  const hinted = await resolveLocationHints(realDestination, opts.locationHint, markerDir);
  if (hinted.length === 1) return { ok: true, path: hinted[0]!, via: 'location' };
  return { ok: false, matchCount: hinted.length };
}

/**
 * Every directory the recorded `location` could name under `destination`, in
 * the two layouts providers actually produce (#511): the whole path, and its
 * last segment alone. Deduplicated by resolved path, so a single-segment
 * `location` yields one candidate rather than two identical ones.
 *
 * Returning a LIST rather than a first match is deliberate: if a delivered
 * tree answers to both descriptions, that is an ambiguity the caller must
 * refuse, not something to resolve by rule order. Ordering the forms by
 * preference would silently pick one and be wrong in whichever direction the
 * provider did not intend.
 */
async function resolveLocationHints(
  realDestination: string,
  locationHint: string | undefined,
  markerDir: string,
): Promise<string[]> {
  const relative = locationHint?.trim().replace(/^[/\\]+/, '').replace(/[/\\]+$/, '');
  if (!relative) return [];

  const last = basename(relative);
  const forms = last && last !== relative ? [relative, last] : [relative];

  const found: string[] = [];
  for (const form of forms) {
    const hit = await resolveOneLocationHint(realDestination, form, markerDir);
    if (hit && !found.includes(hit)) found.push(hit);
  }
  return found;
}

/**
 * `<destination>/<form>`, but only when that path is a real directory, strictly
 * inside `destination` after both sides are `realpath`'d, and actually holds
 * content. Anything else — a form with `..`, one naming the destination itself,
 * a symlinked tail, a path that doesn't exist or is empty — yields `undefined`.
 */
async function resolveOneLocationHint(
  realDestination: string,
  relative: string,
  markerDir: string,
): Promise<string | undefined> {
  const candidate = resolve(realDestination, relative);
  if (!isStrictlyInside(realDestination, candidate)) return undefined;

  try {
    if (!(await lstat(candidate)).isDirectory()) return undefined;
    const real = await realpath(candidate);
    if (!isStrictlyInside(realDestination, real)) return undefined;
    // Same emptiness rule rule 1 applies: a directory holding nothing but the
    // marker is not a payload (FR-036 — an empty destination is never success).
    if (!(await dirHasContents(real, [markerDir]))) return undefined;
    return real;
  } catch {
    return undefined;
  }
}

/**
 * Move `srcDir`'s CONTENTS into `destDir` (spec 008, FR-040): a rename when
 * both paths share a filesystem, falling back to a recursive copy (then
 * removing the source) on `EXDEV` — different filesystems, where `rename`
 * cannot work. `destDir` is wiped first, mirroring `restoreTarGzInto`'s own
 * "the restore is exact" contract. Returns which path was taken so the
 * caller can log it (FR-040 requires the slower path be visible, never silent).
 */
export async function landDirInto(srcDir: string, destDir: string): Promise<{ copied: boolean }> {
  await rm(destDir, { recursive: true, force: true });
  try {
    await rename(srcDir, destDir);
    return { copied: false };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      await cp(srcDir, destDir, { recursive: true });
      await rm(srcDir, { recursive: true, force: true });
      return { copied: true };
    }
    throw err;
  }
}
