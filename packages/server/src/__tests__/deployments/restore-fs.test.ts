/**
 * `snapshot-fs.ts`'s spec-008 additions — `locateAppRootInTree` (FR-041,
 * closes #486) and `landDirInto` (FR-040) — on a REAL filesystem.
 *
 * These are the two primitives that stand between "a foreign container wrote
 * into a directory Hola owns" and "that tree is now an app's data root", so
 * every one of them is exercised against real dirents, real symlinks and a
 * real cross-device rename rather than a mock.
 *
 * Covers the gaps a review of the spec-008 implementation found:
 *  - T054: the `EXDEV` copy fallback had no test at all.
 *  - A capture with NO `.hola` marker — every capture predating spec 006, and
 *    the entire inference-identified candidate path (US5, FR-048-FR-052) —
 *    could be listed and selected but never actually located, so every such
 *    restore failed `RESTORE_SOURCE_UNLOCATABLE`.
 *  - A `destination` that is a SYMLINK: the provider owns a writable mount of
 *    the staging root and can create one pointing at any path it can see.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile, readdir, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { locateAppRootInTree, landDirInto } from '../../services/core/snapshot-fs';

const MARKER = '.hola';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hola-restore-fs-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A landed app data root: the marker directory plus real content beside it. */
async function makeAppRoot(dir: string, files: Record<string, string> = { 'note.txt': 'hello' }) {
  await mkdir(join(dir, MARKER), { recursive: true });
  await writeFile(join(dir, MARKER, 'instance.json'), '{}');
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
  return dir;
}

/**
 * A scratch directory on a DIFFERENT filesystem from `sameFsPath`, or
 * `undefined` if the host has none. Verified by probing an actual `rename`
 * and requiring the kernel's own `EXDEV`, so a host where these happen to
 * share a device is detected rather than assumed.
 */
async function crossDeviceBase(sameFsPath: string): Promise<string | undefined> {
  for (const base of ['/dev/shm', '/run/shm']) {
    if (!existsSync(base)) continue;
    const candidate = join(base, `hola-restore-fs-xdev-${process.pid}-${Date.now()}`);
    const probeSrc = join(sameFsPath, `.xdev-probe-${Date.now()}`);
    try {
      await mkdir(candidate, { recursive: true });
      await mkdir(probeSrc, { recursive: true });
      const { rename } = await import('node:fs/promises');
      await rename(probeSrc, join(candidate, 'probe'));
      // Same device after all — no EXDEV, so this base is useless here.
      await rm(candidate, { recursive: true, force: true });
    } catch (err) {
      await rm(probeSrc, { recursive: true, force: true });
      if ((err as NodeJS.ErrnoException).code === 'EXDEV') return candidate;
      await rm(candidate, { recursive: true, force: true });
    }
  }
  return undefined;
}

/** The same, but with NO marker — a capture taken before spec 006 existed. */
async function makeMarkerlessAppRoot(dir: string, files: Record<string, string> = { 'note.txt': 'hello' }) {
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
  return dir;
}

describe('locateAppRootInTree — the marker rule', () => {
  test('finds a root-relative payload at the top of the destination', async () => {
    const dest = join(root, 'dest');
    await makeAppRoot(dest);
    const result = await locateAppRootInTree(dest, MARKER);
    expect(result).toMatchObject({ ok: true, path: dest, via: 'marker' });
  });

  test('finds a payload several levels down, the shape a repository tool produces', async () => {
    const dest = join(root, 'dest');
    const app = await makeAppRoot(join(dest, 'srv', 'hola', 'apps', 'wiki-1a2b3c4d'));
    const result = await locateAppRootInTree(dest, MARKER);
    expect(result).toMatchObject({ ok: true, path: app, via: 'marker' });
  });

  test('two plausible roots REFUSE rather than pick either', async () => {
    const dest = join(root, 'dest');
    await makeAppRoot(join(dest, 'srv', 'hola', 'apps', 'wiki-a'));
    await makeAppRoot(join(dest, 'srv', 'hola', 'apps', 'wiki-b'));
    expect(await locateAppRootInTree(dest, MARKER)).toEqual({ ok: false, matchCount: 2 });
  });

  test('a nested marker-shaped directory inside a matched root is NOT a second match', async () => {
    const dest = join(root, 'dest');
    const app = await makeAppRoot(join(dest, 'apps', 'wiki-1a2b3c4d'));
    // Real app data that happens to look like an app root one level down.
    await makeAppRoot(join(app, 'data', 'nested-looking-thing'));
    const result = await locateAppRootInTree(dest, MARKER);
    expect(result).toMatchObject({ ok: true, path: app, via: 'marker' });
  });

  test('a marker that is a SYMLINK, not a directory, does not make a match', async () => {
    const dest = join(root, 'dest');
    const victim = await makeAppRoot(join(root, 'victim'));
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, 'note.txt'), 'hello');
    await symlink(join(victim, MARKER), join(dest, MARKER));
    expect(await locateAppRootInTree(dest, MARKER)).toEqual({ ok: false, matchCount: 0 });
  });

  test('a directory holding ONLY the marker is not a payload (FR-036)', async () => {
    const dest = join(root, 'dest');
    await mkdir(join(dest, MARKER), { recursive: true });
    await writeFile(join(dest, MARKER, 'instance.json'), '{}');
    expect(await locateAppRootInTree(dest, MARKER)).toEqual({ ok: false, matchCount: 0 });
  });

  test('an absent destination refuses rather than throwing', async () => {
    expect(await locateAppRootInTree(join(root, 'nope'), MARKER)).toEqual({ ok: false, matchCount: 0 });
  });
});

describe('locateAppRootInTree — the symlink boundary', () => {
  // The provider holds a WRITABLE mount of the staging root and knows the
  // destination path before it delivers (the poll response names it), so it
  // can create that path as a symlink instead of a directory. Without the
  // lstat guard, `readdir` follows it, the victim's own app root matches, and
  // `landDirInto` then renames the LINK into the new install's data root —
  // handing the restored app another app's live data and aiming the
  // subsequent marker rewrite at it.
  test('a destination that IS a symlink to another app data root is refused', async () => {
    const victim = await makeAppRoot(join(root, 'srv', 'hola', 'apps', 'victim-1a2b3c4d'), { 'secret.txt': 'victim data' });
    const dest = join(root, 'staging', 'req-1');
    await mkdir(join(root, 'staging'), { recursive: true });
    await symlink(victim, dest);

    expect(await locateAppRootInTree(dest, MARKER)).toEqual({ ok: false, matchCount: 0 });
    // And the victim is untouched by the attempt.
    expect(await readFile(join(victim, 'secret.txt'), 'utf8')).toBe('victim data');
  });

  test('a symlinked subdirectory is never descended into', async () => {
    const victim = await makeAppRoot(join(root, 'victim'));
    const dest = join(root, 'dest');
    await mkdir(dest, { recursive: true });
    await symlink(victim, join(dest, 'escape'));
    expect(await locateAppRootInTree(dest, MARKER)).toEqual({ ok: false, matchCount: 0 });
  });
});

describe('locateAppRootInTree — the location rule (a capture with no marker)', () => {
  // Every capture taken before spec 006 has no `.hola` directory. Those are
  // exactly the captures spec 008 US5 offers as inference-identified
  // candidates, so if the marker rule were the only rule, US5 would deliver a
  // candidate that can be listed, acknowledged and selected — and then always
  // fails at the last step.
  test('a markerless payload is located from the capture\'s own recorded location', async () => {
    const dest = join(root, 'dest');
    const app = await makeMarkerlessAppRoot(join(dest, 'srv', 'hola', 'apps', 'wiki-1a2b3c4d'), { 'old.txt': 'pre-006' });
    const result = await locateAppRootInTree(dest, MARKER, { locationHint: '/srv/hola/apps/wiki-1a2b3c4d' });
    expect(result).toMatchObject({ ok: true, path: app, via: 'location' });
  });

  test('a markerless payload with NO hint still refuses — the rule is never a search', async () => {
    const dest = join(root, 'dest');
    await makeMarkerlessAppRoot(join(dest, 'srv', 'hola', 'apps', 'wiki-1a2b3c4d'));
    expect(await locateAppRootInTree(dest, MARKER)).toEqual({ ok: false, matchCount: 0 });
  });

  test('the marker rule WINS when both could apply — the hint is a fallback, not an override', async () => {
    const dest = join(root, 'dest');
    const real = await makeAppRoot(join(dest, 'srv', 'hola', 'apps', 'wiki-1a2b3c4d'));
    // A decoy at the hinted path would be chosen if the hint took precedence.
    await makeMarkerlessAppRoot(join(dest, 'elsewhere', 'wiki-1a2b3c4d'), { 'decoy.txt': 'x' });
    const result = await locateAppRootInTree(dest, MARKER, { locationHint: '/elsewhere/wiki-1a2b3c4d' });
    expect(result).toMatchObject({ ok: true, path: real, via: 'marker' });
  });

  test('an ambiguous marker tree still REFUSES — the hint never breaks a tie', async () => {
    const dest = join(root, 'dest');
    await makeAppRoot(join(dest, 'apps', 'wiki-a'));
    await makeAppRoot(join(dest, 'apps', 'wiki-b'));
    expect(await locateAppRootInTree(dest, MARKER, { locationHint: '/apps/wiki-a' })).toEqual({ ok: false, matchCount: 2 });
  });

  test('a hint that climbs out with `..` is refused, not followed', async () => {
    const victim = await makeAppRoot(join(root, 'victim'), { 'secret.txt': 'victim data' });
    const dest = join(root, 'dest');
    await mkdir(dest, { recursive: true });
    expect(await locateAppRootInTree(dest, MARKER, { locationHint: '../victim' })).toEqual({ ok: false, matchCount: 0 });
    expect(await locateAppRootInTree(dest, MARKER, { locationHint: '/a/../../victim' })).toEqual({ ok: false, matchCount: 0 });
    expect(await readFile(join(victim, 'secret.txt'), 'utf8')).toBe('victim data');
  });

  test('a hint naming the destination itself is refused (strict containment)', async () => {
    const dest = join(root, 'dest');
    await makeMarkerlessAppRoot(dest);
    expect(await locateAppRootInTree(dest, MARKER, { locationHint: '/' })).toEqual({ ok: false, matchCount: 0 });
    expect(await locateAppRootInTree(dest, MARKER, { locationHint: '' })).toEqual({ ok: false, matchCount: 0 });
  });

  test('a hint resolving through a SYMLINK out of the destination is refused', async () => {
    const victim = await makeMarkerlessAppRoot(join(root, 'victim'), { 'secret.txt': 'victim data' });
    const dest = join(root, 'dest');
    await mkdir(dest, { recursive: true });
    await symlink(victim, join(dest, 'link'));
    expect(await locateAppRootInTree(dest, MARKER, { locationHint: '/link' })).toEqual({ ok: false, matchCount: 0 });
    expect(await readFile(join(victim, 'secret.txt'), 'utf8')).toBe('victim data');
  });

  test('a hint pointing at an empty or absent directory is refused, never treated as success', async () => {
    const dest = join(root, 'dest');
    await mkdir(join(dest, 'srv', 'hola', 'apps', 'wiki-1a2b3c4d'), { recursive: true });
    expect(await locateAppRootInTree(dest, MARKER, { locationHint: '/srv/hola/apps/wiki-1a2b3c4d' })).toEqual({ ok: false, matchCount: 0 });
    expect(await locateAppRootInTree(dest, MARKER, { locationHint: '/does/not/exist' })).toEqual({ ok: false, matchCount: 0 });
  });

  test('a hint pointing at a FILE rather than a directory is refused', async () => {
    const dest = join(root, 'dest');
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, 'payload'), 'not a directory');
    expect(await locateAppRootInTree(dest, MARKER, { locationHint: '/payload' })).toEqual({ ok: false, matchCount: 0 });
  });
});

describe('landDirInto', () => {
  test('renames when both paths share a filesystem, reporting copied: false', async () => {
    const src = await makeAppRoot(join(root, 'src'), { 'note.txt': 'hello' });
    const dest = join(root, 'dest');
    // The target already holds the marker `materializeCompose` just wrote.
    await mkdir(join(dest, MARKER), { recursive: true });

    expect(await landDirInto(src, dest)).toEqual({ copied: false });
    expect(await readFile(join(dest, 'note.txt'), 'utf8')).toBe('hello');
    // A rename, so the source is gone.
    expect(existsSync(src)).toBe(false);
  });

  // T054: the EXDEV fallback is the branch that runs whenever an operator
  // puts HOLA_RESTORE_STAGING_ROOT on a different filesystem from the apps
  // root, which is a perfectly ordinary thing to do (a big disk for staging).
  // `rename(2)` cannot cross devices, and nothing exercised the copy path at
  // all until this test.
  //
  // Driven by a REAL cross-device rename rather than a stubbed error: on
  // Linux `/dev/shm` is its own tmpfs mount, distinct from the one holding
  // the test's temp dir, so the kernel raises the genuine EXDEV. Stubbing
  // `rename` would test that the catch block runs; this tests that the whole
  // fallback actually lands the tree. Skipped (loudly, never silently) if the
  // host cannot produce a cross-device pair.
  test('falls back to a recursive copy on EXDEV, reporting copied: true', async () => {
    const otherFsBase = await crossDeviceBase(root);
    if (!otherFsBase) {
      throw new Error('No cross-device path available to exercise landDirInto\'s EXDEV fallback');
    }
    const src = await makeAppRoot(join(root, 'src'), { 'note.txt': 'hello', 'other.txt': 'world' });
    await mkdir(join(src, 'nested'), { recursive: true });
    await writeFile(join(src, 'nested', 'deep.txt'), 'deep');

    // The destination is on the OTHER filesystem, so `rename` genuinely fails.
    const dest = join(otherFsBase, 'dest');
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, 'stale.txt'), 'should be wiped');

    try {
      expect(await landDirInto(src, dest)).toEqual({ copied: true });

      // Everything arrived, including nested content and the marker directory...
      expect(await readFile(join(dest, 'note.txt'), 'utf8')).toBe('hello');
      expect(await readFile(join(dest, 'other.txt'), 'utf8')).toBe('world');
      expect(await readFile(join(dest, 'nested', 'deep.txt'), 'utf8')).toBe('deep');
      expect(existsSync(join(dest, MARKER, 'instance.json'))).toBe(true);
      // ...the pre-existing target content was wiped, not merged...
      expect(existsSync(join(dest, 'stale.txt'))).toBe(false);
      // ...and the source was removed, exactly as the rename path leaves it, so
      // neither branch leaves a second copy behind in the staging root.
      expect(existsSync(src)).toBe(false);
    } finally {
      await rm(otherFsBase, { recursive: true, force: true });
    }
  });

  test('a non-EXDEV rename failure propagates rather than silently copying', async () => {
    const src = join(root, 'missing');
    const dest = join(root, 'dest');
    await expect(landDirInto(src, dest)).rejects.toThrow();
  });

  test('the destination is replaced exactly — no leftovers from what was there before', async () => {
    const src = await makeAppRoot(join(root, 'src'), { 'new.txt': 'new' });
    const dest = join(root, 'dest');
    await mkdir(join(dest, 'old-subdir'), { recursive: true });
    await writeFile(join(dest, 'old-subdir', 'old.txt'), 'old');

    await landDirInto(src, dest);
    const entries = (await readdir(dest)).sort();
    expect(entries).toEqual([MARKER, 'new.txt']);
    expect((await lstat(dest)).isDirectory()).toBe(true);
  });
});
