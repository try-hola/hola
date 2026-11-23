// Preflight for `hola update`: can the SSH user actually modify the install dir?
//
// `hola update` runs everything as the SSH user with no sudo. When the install dir
// has mixed ownership (an earlier root-run bootstrap/update left root- or uid-1001-
// owned entries behind), the failures came out as "Could not connect" and "check the
// release exists" (#599). This reports the real cause, and the fix, before anything
// on the host is changed. It only reads; the CLI never runs sudo.
//
// What tar needs, which decides the test below:
//  - The bundle contains the top-level `.` entry, so tar chmods and utimes the
//    install dir itself, and the same for `scripts/` and `compose/`. chmod/utime
//    need OWNERSHIP of (not just write access to) each directory. That is the
//    "Cannot utime: Operation not permitted" of the issue.
//  - Replacing a file needs write+search on its directory (tar unlinks, then
//    recreates). A directory we cannot write is the "Cannot open: File exists".
//  - Foreign-owned FILES inside a directory we own and can write are fine to replace
//    (the directory permission governs unlink), so they are reported but are not by
//    themselves a failure. Hence the checks are on directories, not on every file.
//  - `.env` is read by the update. It is only rewritten (by temp file + mv, which
//    needs the directory, not the file) for --enable-sso, so no separate `.env`
//    write test exists.
// `traefik/` and `backups/` are not in the bundle; `traefik/` (ACME store) is often
// root-owned by design, so it is excluded from the foreign-entry listing. `backups/`
// is written by the pre-upgrade snapshot, so its writability is checked.
// Root passes every check: it can do all of it.

import { chownGuidance } from '../../lib/remote-failure';
import { shq } from '../../lib/shell-quote';

export interface InstallAccess {
  user: string;
  group: string;
  uid: string;
  dirExists: boolean;
  dirOwner: string;
  /** The SSH user is root or owns the install dir. */
  dirOwned: boolean;
  /** Search + write on the install dir. */
  dirWritable: boolean;
  /** Existing subdirs (relative names) the user cannot write or does not own. */
  blockedSubdirs: string[];
  env: 'ok' | 'unreadable' | 'missing';
  /** Up to FOREIGN_LIMIT entries not owned by the SSH user. */
  foreign: string[];
}

const FOREIGN_LIMIT = 5;
const MARKER = '__HOLA_ACCESS__';

export function buildAccessCommand(dir: string): string {
  return [
    `d=${shq(dir)}`,
    `u=$(id -un)`,
    `g=$(id -gn)`,
    `n=$(id -u)`,
    `echo ${MARKER}`,
    `echo "user=$u"`,
    `echo "group=$g"`,
    `echo "uid=$n"`,
    `if [ ! -d "$d" ]; then echo dir=missing; exit 0; fi`,
    `echo dir=ok`,
    `echo "owner=$(ls -ld -- "$d" | awk '{print $3}')"`,
    `own() { [ "$n" = 0 ] || [ -O "$1" ]; }`,
    `wr() { [ "$n" = 0 ] || { [ -w "$1" ] && [ -x "$1" ]; }; }`,
    `if own "$d"; then echo dirowned=ok; else echo dirowned=fail; fi`,
    `if wr "$d"; then echo dirwritable=ok; else echo dirwritable=fail; fi`,
    `for s in scripts compose backups; do if [ -d "$d/$s" ]; then { own "$d/$s" && wr "$d/$s"; } || echo "blocked=$s"; fi; done`,
    `if [ ! -e "$d/.env" ]; then echo env=missing; elif [ "$n" = 0 ] || [ -r "$d/.env" ]; then echo env=ok; else echo env=unreadable; fi`,
    `find "$d" -maxdepth 2 -path "$d/traefik" -prune -o ! -user "$u" -print 2>/dev/null | head -n ${FOREIGN_LIMIT} | sed 's/^/foreign=/'`,
    `exit 0`,
  ].join('; ');
}

export function parseAccess(stdout: string): InstallAccess | null {
  if (!stdout.includes(MARKER)) return null;
  const kv: Record<string, string> = {};
  const blocked: string[] = [];
  const foreign: string[] = [];
  for (const raw of stdout.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const k = line.slice(0, eq);
    const v = line.slice(eq + 1);
    if (k === 'blocked') blocked.push(v);
    else if (k === 'foreign') foreign.push(v);
    else kv[k] = v;
  }
  if (!kv.user) return null;
  return {
    user: kv.user,
    group: kv.group || kv.user,
    uid: kv.uid ?? '',
    dirExists: kv.dir === 'ok',
    dirOwner: kv.owner ?? '',
    dirOwned: kv.dirowned === 'ok',
    dirWritable: kv.dirwritable === 'ok',
    blockedSubdirs: blocked,
    env: kv.env === 'ok' ? 'ok' : kv.env === 'unreadable' ? 'unreadable' : 'missing',
    foreign: foreign.slice(0, FOREIGN_LIMIT),
  };
}

/** null when the user can update this install; otherwise an actionable message. */
export function accessProblem(a: InstallAccess, dir: string, host: string): string | null {
  if (!a.dirExists) {
    return `No Hola install found at ${dir} on ${host} (the directory does not exist).`;
  }
  const problems: string[] = [];
  if (!a.dirOwned) problems.push(`${dir} is owned by ${a.dirOwner || 'another user'}, not ${a.user} (tar must set its permissions and times)`);
  if (!a.dirWritable) problems.push(`${a.user} cannot write to ${dir}`);
  for (const s of a.blockedSubdirs) problems.push(`${dir}/${s} is not owned or writable by ${a.user}`);
  if (a.env === 'unreadable') problems.push(`${a.user} cannot read ${dir}/.env (permission denied)`);
  if (problems.length === 0) return null;
  const foreign = a.foreign.length
    ? `\nEntries not owned by ${a.user}:\n${a.foreign.map((f) => `  ${f}`).join('\n')}\n`
    : '\n';
  return (
    `hola update cannot modify the install at ${dir} on ${host} as ${a.user}:\n` +
    problems.map((p) => `  - ${p}`).join('\n') +
    `\n${foreign}` +
    chownGuidance(a.user, a.group, dir)
  );
}
