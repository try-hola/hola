import { spawnSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildAccessCommand, accessProblem, parseAccess } from '../commands/update/install-access';
import { buildFetchBundleCommand, classifyFetch } from '../lib/bundle-fetch';
import { shq } from '../lib/shell-quote';

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const PATH = '/usr/bin:/bin';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(path.join(os.tmpdir(), 'hola-access-')); });
afterEach(() => {
  // Restore permissions so cleanup can descend into chmod'ed dirs.
  spawnSync('chmod', ['-R', 'u+rwx', tmp]);
  rmSync(tmp, { recursive: true, force: true });
});

function probe(dir: string) {
  const r = spawnSync('sh', ['-c', buildAccessCommand(dir)], { env: { PATH }, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, access: parseAccess(r.stdout) };
}

describe('shq', () => {
  it('leaves path-safe values alone and quotes the rest', () => {
    expect(shq('/opt/hola')).toBe('/opt/hola');
    expect(shq('/srv/my hola')).toBe("'/srv/my hola'");
    expect(shq("a'b")).toBe(`'a'\\''b'`);
    expect(shq('/x; rm -rf /')).toBe(`'/x; rm -rf /'`);
  });
});

describe('install access probe under a real shell', () => {
  it('reports a healthy, owned install as clear', () => {
    writeFileSync(path.join(tmp, '.env'), 'SECRET=hunter2\n');
    mkdirSync(path.join(tmp, 'scripts'));
    const { code, access, stdout } = probe(tmp);
    expect(code).toBe(0);
    expect(access).toMatchObject({ dirExists: true, dirOwned: true, dirWritable: true, env: 'ok', blockedSubdirs: [] });
    expect(accessProblem(access!, tmp, 'me@vm')).toBeNull();
    // The probe never reads the contents of .env.
    expect(stdout).not.toContain('hunter2');
  });

  it('works for an install dir containing spaces and quotes', () => {
    const dir = path.join(tmp, "my hola's dir");
    mkdirSync(dir);
    writeFileSync(path.join(dir, '.env'), 'A=1\n');
    const { access } = probe(dir);
    expect(access).toMatchObject({ dirExists: true, dirWritable: true, env: 'ok' });
  });

  it('reports a missing dir', () => {
    const { access } = probe(path.join(tmp, 'nope'));
    expect(access?.dirExists).toBe(false);
    expect(accessProblem(access!, '/nope', 'me@vm')).toContain('No Hola install found');
  });

  it.skipIf(isRoot)('reports an unreadable .env (chmod 000) and names it', () => {
    writeFileSync(path.join(tmp, '.env'), 'SECRET=hunter2\n');
    chmodSync(path.join(tmp, '.env'), 0o000);
    const { access, stdout } = probe(tmp);
    expect(access?.env).toBe('unreadable');
    const msg = accessProblem(access!, tmp, 'me@vm')!;
    expect(msg).toContain(`${tmp}/.env (permission denied)`);
    expect(msg).toContain(`sudo chown -R ${access!.user}:${access!.group} ${tmp}`);
    expect(stdout + msg).not.toContain('hunter2');
  });

  it.skipIf(isRoot)('reports a non-writable dir (chmod 555)', () => {
    writeFileSync(path.join(tmp, '.env'), 'A=1\n');
    chmodSync(tmp, 0o555);
    const { access } = probe(tmp);
    expect(access?.dirWritable).toBe(false);
    expect(accessProblem(access!, tmp, 'me@vm')).toContain('cannot write to');
  });

  it.skipIf(isRoot)('reports a non-writable existing subdirectory', () => {
    mkdirSync(path.join(tmp, 'scripts'));
    chmodSync(path.join(tmp, 'scripts'), 0o555);
    const { access } = probe(tmp);
    expect(access?.blockedSubdirs).toEqual(['scripts']);
  });

  it.skipIf(isRoot)('lists entries not owned by the SSH user, capped at five (system dir as the foreign owner)', () => {
    // /usr/bin entries are root-owned: scanning a root-owned tree stands in for foreign uid files.
    const { access } = probe('/usr');
    expect(access!.foreign.length).toBe(5);
    expect(access!.dirOwned).toBe(false);
  });

  it('interprets a foreign-uid dir from canned output, using the real primary group', () => {
    const access = parseAccess(
      '__HOLA_ACCESS__\nuser=paul\ngroup=users\nuid=1000\ndir=ok\nowner=1001\ndirowned=fail\ndirwritable=fail\nenv=ok\nforeign=/opt/hola/VERSION\n',
    )!;
    const msg = accessProblem(access, '/opt/hola', 'paul@hola')!;
    expect(msg).toContain('owned by 1001, not paul');
    expect(msg).toContain('/opt/hola/VERSION');
    expect(msg).toContain('sudo chown -R paul:users /opt/hola');
  });

  it('quotes the dir in the suggested chown', () => {
    const access = parseAccess('__HOLA_ACCESS__\nuser=a\ngroup=b\nuid=1\ndir=ok\nowner=root\ndirowned=fail\ndirwritable=ok\nenv=ok\n')!;
    expect(accessProblem(access, '/srv/my hola', 'h')).toContain("sudo chown -R a:b '/srv/my hola'");
  });

  it('root (uid 0) passes even when everything is foreign-owned', () => {
    const access = parseAccess(
      '__HOLA_ACCESS__\nuser=root\ngroup=root\nuid=0\ndir=ok\nowner=1001\ndirowned=ok\ndirwritable=ok\nenv=ok\nforeign=/opt/hola/x\n',
    )!;
    expect(accessProblem(access, '/opt/hola', 'root@h')).toBeNull();
  });

  it('returns null (not a verdict) when the marker is absent', () => {
    expect(parseAccess('')).toBeNull();
    expect(parseAccess('Permission denied')).toBeNull();
  });
});

describe('bundle fetch command under a real shell', () => {
  let bin: string;
  let work: string;
  let tmpdir: string;
  beforeEach(() => {
    bin = path.join(tmp, 'bin');
    work = path.join(tmp, 'install dir');
    tmpdir = path.join(tmp, 'tmpdir');
    for (const d of [bin, work, tmpdir]) mkdirSync(d);
  });

  const fake = (name: string, body: string) => {
    const f = path.join(bin, name);
    writeFileSync(f, `#!/bin/sh\n${body}\n`);
    chmodSync(f, 0o755);
  };
  const run = () =>
    spawnSync('sh', ['-c', buildFetchBundleCommand('https://example.com/b.tar.gz', work)], {
      env: { PATH: `${bin}:${PATH}`, TMPDIR: tmpdir },
      encoding: 'utf8',
    });

  it('download failure exits 42, surfaces curl stderr, never runs tar, and removes the temp file', () => {
    fake('curl', 'echo "curl: (22) The requested URL returned error: 404" >&2; exit 22');
    fake('tar', `touch "${tmp}/tar-ran"`);
    const r = run();
    expect(r.status).toBe(42);
    expect(classifyFetch(r.status!)).toBe('download');
    expect(r.stderr).toContain('returned error: 404');
    expect(existsSync(path.join(tmp, 'tar-ran'))).toBe(false);
    expect(readdirSync(tmpdir)).toEqual([]);
  });

  it('extract failure exits 43 (not blamed on the download), surfaces tar stderr, and removes the temp file', () => {
    fake('curl', 'out=; while [ $# -gt 0 ]; do [ "$1" = -o ] && out=$2; shift; done; echo data > "$out"');
    fake('tar', 'case "$*" in *--version*) exit 0;; esac; echo "tar: ./VERSION: Cannot open: File exists" >&2; exit 2');
    const r = run();
    expect(r.status).toBe(43);
    expect(classifyFetch(r.status!)).toBe('extract');
    expect(r.stderr).toContain('Cannot open: File exists');
    expect(readdirSync(tmpdir)).toEqual([]);
  });

  it('GNU-style tar gets --no-same-owner, with the install dir intact (spaces) and cleanup on success', () => {
    fake('curl', 'out=; while [ $# -gt 0 ]; do [ "$1" = -o ] && out=$2; shift; done; echo data > "$out"');
    fake('tar', `case "$*" in *--version*) exit 0;; esac; echo "$@" > "${tmp}/tar-args"`);
    const r = run();
    expect(r.status).toBe(0);
    const args = readFileSync(path.join(tmp, 'tar-args'), 'utf8');
    expect(args).toContain('--no-same-owner');
    expect(args).toContain(`-C ${work}`);
    expect(readdirSync(tmpdir)).toEqual([]);
  });

  it('a tar without the long option (busybox) falls back to -o', () => {
    fake('curl', 'out=; while [ $# -gt 0 ]; do [ "$1" = -o ] && out=$2; shift; done; echo data > "$out"');
    fake(
      'tar',
      `case "$*" in *--no-same-owner*) echo "tar: unrecognized option" >&2; exit 1;; esac; echo "$@" > "${tmp}/tar-args"`,
    );
    const r = run();
    expect(r.status).toBe(0);
    const args = readFileSync(path.join(tmp, 'tar-args'), 'utf8');
    expect(args).toMatch(/(^| )-o( |$)/);
    expect(args).not.toContain('--no-same-owner');
  });

  it('really extracts with the host tar, without restoring the archive owner', () => {
    const src = path.join(tmp, 'src');
    mkdirSync(src);
    writeFileSync(path.join(src, 'VERSION'), '1.2.3\n');
    const archive = path.join(tmp, 'b.tar.gz');
    expect(spawnSync('tar', ['czf', archive, '-C', src, '.']).status).toBe(0);
    fake('curl', `out=; while [ $# -gt 0 ]; do [ "$1" = -o ] && out=$2; shift; done; cp "${archive}" "$out"`);
    const r = run();
    expect(r.status).toBe(0);
    expect(existsSync(path.join(work, 'VERSION'))).toBe(true);
  });
});
