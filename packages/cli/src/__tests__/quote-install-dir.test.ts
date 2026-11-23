import { spawnSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runBootstrap } from '../commands/bootstrap/bootstrap';
import { buildVerifyCommand } from '../commands/bootstrap/verify';
import { runCredentials } from '../commands/credentials/credentials';
import { runTeardown } from '../commands/teardown/teardown';
import { runUpdate } from '../commands/update/update';
import { scriptedPrompter } from '../install/prompter';
import type { Runner, RunResult } from '../lib/runner';
import { shq } from '../lib/shell-quote';

// The install dir is operator supplied (--dir) and is interpolated into commands run
// by the REMOTE shell. These tests prove it only ever appears as one quoted word.
const HOSTILE = ['/srv/ho la', "/srv/it's; touch pwned"];

/** The command with every correctly quoted occurrence of `dir` removed. */
const stripQuoted = (cmd: string, dir: string) => cmd.split(shq(dir)).join('');
function expectOnlyQuoted(cmds: string[], dir: string) {
  expect(cmds.some((c) => c.includes(shq(dir)))).toBe(true);
  for (const c of cmds) {
    const rest = stripQuoted(c, dir);
    expect(rest).not.toContain('touch pwned');
    expect(rest).not.toContain('ho la');
    expect(rest).not.toContain("it's");
  }
}

function recorder(respond: (cmd: string) => Partial<RunResult> = () => ({})) {
  const calls: string[] = [];
  const runner = {
    calls,
    ssh: vi.fn(async (_h: string, cmd: string) => {
      calls.push(cmd);
      return { code: 0, stdout: '', stderr: '', ...respond(cmd) };
    }),
    local: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
  };
  return runner as unknown as Runner & { calls: string[] };
}

const BOOT_ANSWERS: Record<string, string> = {
  HOLA_BASE_DOMAIN: 'hola.example.com', HOLA_DOMAIN: 'app.hola.example.com',
  TRAEFIK_DASHBOARD_DOMAIN: 'traefik.hola.example.com', LETSENCRYPT_EMAIL: 'a@example.com',
  ACME_DNS_PROVIDER: 'route53', AWS_ACCESS_KEY_ID: 'AKIA1', AWS_SECRET_ACCESS_KEY: 's3cret',
  AWS_REGION: 'us-east-1', HOLA_CATALOG_URL: 'https://example.com/catalog.json',
  HOLA_AUTH_MODE: 'none', HOLA_USE_AUTH: 'true', HOLA_API_KEY: '',
};
const OK_PREFLIGHT = 'docker=ok\ncurl=ok\ntar=ok\ncompose=ok\ndockerperm=ok\nexisting_env=absent\nexisting_vol=absent\n';
const OK_ACCESS = '__HOLA_ACCESS__\nuser=me\ngroup=me\nuid=1000\ndir=ok\nowner=me\ndirowned=ok\ndirwritable=ok\nenv=ok\n';

function updateRunner(env: string) {
  return recorder((c) => {
    if (c.includes('__HOLA_ACCESS__')) return { stdout: OK_ACCESS };
    if (c.includes('command -v')) return { stdout: OK_PREFLIGHT };
    if (c.includes('__HOLA_ENV__')) return { stdout: `__HOLA_VERSION__=0.6.20\n__HOLA_EXAMPLE__\nHOLA_DOMAIN=\n__HOLA_ENV__\n${env}` };
    if (c.includes('HOLA_BACKUP_PATH=')) return { stdout: 'HOLA_BACKUP_PATH=/x/b.tar.gz\n' };
    return {};
  });
}

beforeEach(() => { process.exitCode = 0; });
afterEach(() => { process.exitCode = 0; });

describe.each(HOSTILE)('install dir %s is one quoted word in every remote command', (dir) => {
  it('bootstrap', async () => {
    const runner = recorder((c) => (c.includes('command -v') ? { stdout: OK_PREFLIGHT } : c.includes('curl -s') ? { stdout: 'verified 200' } : {}));
    await runBootstrap(
      { host: 'me@vm', ref: 'cli-v0.2.0', dir, skipChecks: true, json: true },
      { prompter: scriptedPrompter(BOOT_ANSWERS), runner },
    );
    expectOnlyQuoted(runner.calls, dir);
    expect(runner.calls.some((c) => c.includes(`cat > ${shq(dir)}/.env && chmod 600 ${shq(dir)}/.env`))).toBe(true);
    expect(runner.calls.some((c) => c.startsWith(`cd ${shq(dir)} && HOLA_BOOTSTRAP=1`))).toBe(true);
  });

  it('bootstrap --reinstall reset', async () => {
    const runner = recorder((c) => (c.includes('command -v') ? { stdout: OK_PREFLIGHT.replace('existing_env=absent', 'existing_env=present') } : {}));
    await runBootstrap(
      { host: 'me@vm', ref: 'cli-v0.2.0', dir, skipChecks: true, json: true, reinstall: true },
      { prompter: scriptedPrompter(BOOT_ANSWERS), runner },
    );
    expectOnlyQuoted(runner.calls.filter((c) => c.includes('down -v')), dir);
  });

  it('teardown (default and --include-certs)', async () => {
    for (const includeCerts of [false, true]) {
      const runner = recorder((c) => (c.includes('command -v docker') ? { stdout: 'ok' } : {}));
      await runTeardown({ host: 'me@vm', dir, yes: true, includeCerts }, { prompter: scriptedPrompter({}), runner });
      expectOnlyQuoted(runner.calls, dir);
      expect(runner.calls.some((c) => c.includes(`rm -rf ${shq(dir)} `))).toBe(true);
    }
  });

  it('credentials', async () => {
    const env = 'HOLA_DOMAIN=apps.example.com\nHOLA_USE_AUTH=true\nHOLA_API_KEY=\nHOLA_AUTH_MODE=authentik\nHOLA_ADMIN_EMAIL=me@example.com\nHOLA_AUTHENTIK_DOMAIN=auth.example.com\n';
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'hola-q-'));
    try {
      for (const showPassword of [false, true]) {
        const runner = recorder((c) => {
          if (c.includes('cat -- "$f"')) return { stdout: env };
          if (c.includes('admin-api-key')) return { stdout: 'key-abc' };
          if (c.includes('Hola admin setup')) return { stdout: 'https://auth.example.com/x?flow_token=t' };
          return {};
        });
        await runCredentials(
          { host: 'paul@vm', dir, json: true, showPassword },
          { prompter: scriptedPrompter({}), runner, credsDir: tmp, sleep: async () => {} },
        );
        expectOnlyQuoted(runner.calls, dir);
        expect(runner.calls.some((c) => c.startsWith(`cd ${shq(dir)} && for i`))).toBe(true);
        expect(runner.calls.some((c) => c.startsWith(`cd ${shq(dir)} && logs=`))).toBe(true);
      }
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  it('update (snapshot, enable-sso, install, ps)', async () => {
    const runner = updateRunner('HOLA_DOMAIN=apps.example.com\nHOLA_BASE_DOMAIN=hola.example.com\nHOLA_AUTH_MODE=none\n');
    await runUpdate(
      { host: 'me@vm', dir, ref: 'cli-v0.6.23', json: true, enableSso: true, backupAppData: true },
      { prompter: scriptedPrompter({}), runner },
    );
    expectOnlyQuoted(runner.calls, dir);
  });
});

describe('other operator-derived values in remote commands', () => {
  it('update quotes a hostile app-data root from the host .env', async () => {
    const root = "/srv/it's; touch pwned/apps";
    const parent = "/srv/it's; touch pwned";
    const runner = updateRunner(
      `HOLA_DOMAIN=apps.example.com\nHOLA_BASE_DOMAIN=hola.example.com\nHOLA_AUTH_MODE=authentik\nHOLA_APPS_BIND_ROOT=${root}\n`,
    );
    await runUpdate({ host: 'me@vm', ref: 'cli-v0.6.23', json: true, backupAppData: true }, { prompter: scriptedPrompter({}), runner });
    const snap = runner.calls.find((c) => c.includes('HOLA_BACKUP_PATH='))!;
    expect(snap).toContain(`-C ${shq(parent)} "apps"`);
    expect(snap.split(shq(root)).join('').split(shq(parent)).join('')).not.toContain('touch pwned');
  });

  it('the verify command quotes its URL', () => {
    expect(buildVerifyCommand('app.example.com')).toContain('https://app.example.com/api/system/health');
    const hostile = buildVerifyCommand('x.com; touch pwned');
    expect(hostile.split(shq('https://x.com; touch pwned/api/system/health')).join('')).not.toContain('touch pwned');
  });

  it('plain paths produce the historical, unquoted text', async () => {
    const runner = recorder((c) => (c.includes('command -v docker') ? { stdout: 'ok' } : {}));
    await runTeardown({ host: 'me@vm', yes: true }, { prompter: scriptedPrompter({}), runner });
    expect(runner.calls.some((c) => c.includes('[ -d /opt/hola ] && (cd /opt/hola && docker compose down'))).toBe(true);
  });
});

describe('credentials commands under a real shell', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(path.join(os.tmpdir(), 'hola-credsh-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  const ENV =
    'HOLA_DOMAIN=apps.example.com\nHOLA_USE_AUTH=true\nHOLA_API_KEY=\nHOLA_AUTH_MODE=authentik\nHOLA_ADMIN_EMAIL=@@EMAIL@@\nHOLA_AUTHENTIK_DOMAIN=auth.example.com\nAUTHENTIK_BOOTSTRAP_PASSWORD=pw-from-env\n';

  function localRunner(cwd: string, bin: string, rec: string): Runner {
    let n = 0;
    return {
      ssh: async (_h: string, cmd: string) => {
        // The link poll never gives up on its own; a regression must fail, not hang.
        if (++n > 25) throw new Error('too many remote commands (poll did not converge)');
        const r = spawnSync('sh', ['-c', cmd], { cwd, env: { PATH: `${bin}:/usr/bin:/bin`, REC: rec }, encoding: 'utf8' });
        return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
      },
      local: async () => ({ code: 0, stdout: '', stderr: '' }),
    } as Runner;
  }

  it.each(['ho la', "it's; touch pwned"])('runs against a dir named %s and executes no payload', async (name) => {
    const dir = path.join(tmp, name);
    mkdirSync(dir);
    const bin = path.join(tmp, 'bin');
    const cwd = path.join(tmp, 'cwd');
    mkdirSync(bin);
    mkdirSync(cwd);
    const rec = path.join(tmp, 'rec');
    writeFileSync(
      path.join(bin, 'docker'),
      '#!/bin/sh\npwd >> "$REC"\ncase "$*" in\n*admin-api-key*) echo key-abc;;\n*logs*) echo "Hola admin setup"; echo "https://auth.example.com/x?flow_token=t";;\nesac\n',
    );
    chmodSync(path.join(bin, 'docker'), 0o755);

    let revealed = false;
    for (const [email, showPassword] of [['me@example.com', false], ['', true]] as const) {
      writeFileSync(path.join(dir, '.env'), ENV.replace('@@EMAIL@@', email));
      const logs: string[] = [];
      const spy = vi.spyOn(console, 'log').mockImplementation((m?: unknown) => { logs.push(String(m)); });
      let res;
      try {
        res = await runCredentials(
          { host: 'paul@vm', dir, json: true, showPassword },
          { prompter: scriptedPrompter({}), runner: localRunner(cwd, bin, rec), credsDir: tmp, sleep: async () => {} },
        );
      } finally { spy.mockRestore(); }
      expect(res?.apiUrl).toBe('https://apps.example.com');
      if (email) expect(res?.recoveryLink).toBe('https://auth.example.com/x?flow_token=t');
      expect(readFileSync(path.join(tmp, 'hola-paul-vm.env'), 'utf8')).toContain('HOLA_TOKEN=key-abc');
      if (showPassword) revealed = true;
    }
    expect(revealed).toBe(true);
    // docker ran with the install dir as its working directory (the `cd` worked)...
    const pwds = readFileSync(rec, 'utf8').split('\n').filter(Boolean);
    expect(pwds.length).toBeGreaterThan(0);
    expect(pwds.every((l) => l === dir)).toBe(true);
    // ...and the injected `touch pwned` never ran, in any plausible location.
    expect(existsSync(path.join(cwd, 'pwned'))).toBe(false);
    expect(existsSync(path.join(tmp, 'pwned'))).toBe(false);
    expect(existsSync(path.join(dir, 'pwned'))).toBe(false);
  });

  it('reads the akadmin password from a quoted dir (grep ... .env)', () => {
    const dir = path.join(tmp, "it's; touch pwned");
    mkdirSync(dir);
    writeFileSync(path.join(dir, '.env'), 'AUTHENTIK_BOOTSTRAP_PASSWORD=pw-from-env\n');
    const cmd = `grep '^AUTHENTIK_BOOTSTRAP_PASSWORD=' ${shq(dir)}/.env | cut -d= -f2-`;
    const r = spawnSync('sh', ['-c', cmd], { cwd: tmp, env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
    expect(r.stdout.trim()).toBe('pw-from-env');
  });
});
