import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import sade from 'sade';

import { camelKeys, parseOpts, streamOpts } from '../lib/opts';

describe('camelKeys', () => {
  it('camelCases kebab-case flag keys (the sade/mri multi-word fix)', () => {
    const out = camelKeys({
      'env-file': '/tmp/x',
      'skip-checks': true,
      'tarball-url': 'https://e/x.tgz',
      'dry-run': true,
    });
    expect(out).toEqual({
      envFile: '/tmp/x',
      skipChecks: true,
      tarballUrl: 'https://e/x.tgz',
      dryRun: true,
    });
  });

  it('leaves single-word keys (and mri --no-x → {x:false}) untouched', () => {
    const out = camelKeys({ host: 'me@vm', json: false, stream: false, _: ['a'] });
    expect(out).toEqual({ host: 'me@vm', json: false, stream: false, _: ['a'] });
  });
});

describe('streamOpts (--no-stream normalization)', () => {
  it('sets noStream=true when sade parsed --no-stream into {stream:false}', () => {
    // Reproduces sade/mri: `--no-stream` becomes `{ stream: false }`, never `noStream`.
    expect(streamOpts({ stream: false }).noStream).toBe(true);
  });

  it('leaves noStream=false when the flag is absent', () => {
    expect(streamOpts({}).noStream).toBe(false);
    expect(streamOpts({ stream: true }).noStream).toBe(false);
  });

  it('still honors an explicit noStream:true', () => {
    expect(streamOpts({ noStream: true }).noStream).toBe(true);
  });
});

/**
 * `--carry-env` is tri-state, so it is the one flag that cannot be registered
 * with a `false` default — and that default is what would otherwise put its
 * name in mri's boolean list. Without it mri treated the flag as value-taking
 * and swallowed the next positional (#488). These parse the real flag shapes
 * through sade + `parseOpts()` rather than asserting on a hand-built opts bag,
 * because the bug lives in parsing, not in normalization.
 */
describe('parseOpts (--carry-env tri-state, #488)', () => {
  /** Mirrors `install`'s restore-flag registration in src/index.ts. */
  const installProg = () =>
    sade('hola')
      .command('install <appId>')
      .option('--restore-from', 'Restore from an existing deployment of this app')
      .option('--no-restore', 'Explicitly install with no restore', false)
      .option('--restore-list', 'List restore candidates and exit', false)
      // No default — the tri-state flag under test.
      .option('--carry-env', 'Carry the restore candidate\'s configuration')
      .option('--no-carry-env', 'Do not carry the restore candidate\'s configuration', false)
      .option('--ack', 'Acknowledge a restore risk by code')
      .action(() => {});

  /** Parse an `hola …` argv the way index.ts does, without running a handler. */
  function parseInstall(argv: string[]) {
    const parsed = installProg().parse(['node', 'hola', ...argv], { ...parseOpts(), lazy: true }) as
      | { args: unknown[] }
      | undefined;
    if (!parsed) throw new Error('sade refused the argv'); // e.g. "Insufficient arguments!"
    const args = parsed.args;
    return {
      appId: args[0] as string,
      opts: camelKeys(args[args.length - 1] as Record<string, unknown>),
    };
  }

  it('does not swallow the positional after a bare --carry-env (the issue repro)', () => {
    // `hola install --carry-env gitea --restore-from latest` used to abort with
    // sade's "Insufficient arguments!" because mri assigned carryEnv: 'gitea'.
    const { appId, opts } = parseInstall(['install', '--carry-env', 'gitea', '--restore-from', 'latest']);
    expect(appId).toBe('gitea');
    expect(opts.carryEnv).toBe(true);
    expect(opts.restoreFrom).toBe('latest');
  });

  it('still reads --carry-env when it follows the positional', () => {
    const { appId, opts } = parseInstall(['install', 'gitea', '--carry-env', '--restore-from', 'latest']);
    expect(appId).toBe('gitea');
    expect(opts.carryEnv).toBe(true);
  });

  it('reads --no-carry-env as an explicit false, in either position', () => {
    expect(parseInstall(['install', '--no-carry-env', 'gitea']).opts.carryEnv).toBe(false);
    const trailing = parseInstall(['install', 'gitea', '--no-carry-env', '--ack', 'restore-env-not-carried']);
    expect(trailing.appId).toBe('gitea');
    expect(trailing.opts.carryEnv).toBe(false);
    expect(trailing.opts.ack).toBe('restore-env-not-carried');
  });

  it('leaves carryEnv undefined when neither flag is given — NOT false', () => {
    // The whole constraint: `undefined` means "default to the candidate's own
    // carriesEnv" (contracts/cli.md). Collapsing it to `false` would silently
    // stop carrying configuration on every restore that did not ask.
    const { appId, opts } = parseInstall(['install', 'gitea', '--restore-from', 'latest']);
    expect(appId).toBe('gitea');
    expect(opts.carryEnv).toBeUndefined();
  });

  it('reads an explicit --carry-env=false as false, not as truthy "false"', () => {
    expect(parseInstall(['install', 'gitea', '--carry-env=false']).opts.carryEnv).toBe(false);
    expect(parseInstall(['install', 'gitea', '--carry-env=true']).opts.carryEnv).toBe(true);
  });

  it('returns a fresh object each call (sade and mri both mutate what they get)', () => {
    const a = parseOpts();
    const b = parseOpts();
    expect(a).not.toBe(b);
    expect(a.boolean).not.toBe(b.boolean);
  });

  it('src/index.ts actually hands parseOpts() to prog.parse, for every flag it names', () => {
    // The mirror above only proves the mechanism; this proves the real CLI uses it.
    const src = readFileSync(join(__dirname, '../index.ts'), 'utf8');
    expect(src).toMatch(/prog\.parse\(process\.argv,\s*parseOpts\(\)\)/);
    for (const name of parseOpts().boolean) {
      expect(src).toContain(`.option('--${name}'`);
    }
  });
});
