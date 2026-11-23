import { spawnSync } from 'child_process';
import { chmodSync, mkdirSync, mkdtempSync as mkdtempSyncFs, rmSync, writeFileSync } from 'fs';
import os from 'os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { runCredentials, formatElapsed, buildReadEnvCommand } from '../commands/credentials/credentials';
import { scriptedPrompter } from '../install/prompter';
import type { Runner } from '../lib/runner';

describe('formatElapsed', () => {
  it('shows seconds under a minute', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(59_000)).toBe('59s');
  });
  it('shows minutes and seconds at or above 60s', () => {
    expect(formatElapsed(60_000)).toBe('1m 0s');
    expect(formatElapsed(125_000)).toBe('2m 5s');
    expect(formatElapsed(318_000)).toBe('5m 18s');
  });
});

// A fake runner that serves the host's .env on `cat`, then canned values for the
// credential-retrieval commands. Records every command so we can assert behavior.
function makeRunner(envContent: string): Runner & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    ssh: vi.fn(async (_host: string, cmd: string) => {
      calls.push(cmd);
      if (cmd.includes('cat -- "$f"')) return { code: 0, stdout: envContent, stderr: '' };
      if (cmd.includes('admin-api-key')) return { code: 0, stdout: 'key-abc', stderr: '' };
      if (cmd.includes('Hola admin setup')) return { code: 0, stdout: 'https://auth.example.com/if/flow/recovery/xyz', stderr: '' };
      if (cmd.includes('AUTHENTIK_BOOTSTRAP_PASSWORD')) return { code: 0, stdout: 'akadmin-secret', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    }),
    local: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
  } as Runner & { calls: string[] };
}

async function withTmp(run: (tmp: string) => Promise<void>) {
  const tmp = await mkdtemp(join(tmpdir(), 'hola-creds-'));
  try { await run(tmp); } finally { await rm(tmp, { recursive: true, force: true }); }
}

const NAMED_ADMIN_ENV =
  'HOLA_DOMAIN=apps.example.com\nHOLA_USE_AUTH=true\nHOLA_API_KEY=\nHOLA_AUTH_MODE=authentik\nHOLA_ADMIN_EMAIL=me@example.com\nHOLA_AUTHENTIK_DOMAIN=auth.example.com\n';
const AKADMIN_ENV =
  'HOLA_DOMAIN=apps.example.com\nHOLA_USE_AUTH=true\nHOLA_API_KEY=pinned\nHOLA_AUTH_MODE=authentik\nHOLA_ADMIN_EMAIL=\nHOLA_AUTHENTIK_DOMAIN=auth.example.com\n';

describe('hola credentials', () => {
  beforeEach(() => { process.exitCode = 0; });
  afterEach(() => { process.exitCode = 0; });

  it('requires --host', async () => {
    const res = await runCredentials({}, { prompter: scriptedPrompter({}), runner: makeRunner('') });
    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(1);
  });

  it('errors when the host has no Hola .env', async () => {
    const res = await runCredentials({ host: 'paul@vm' }, { prompter: scriptedPrompter({}), runner: makeRunner('') });
    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(1);
  });

  it('saves the CLI creds file and surfaces the named-admin recovery link', async () => {
    await withTmp(async (tmp) => {
      const runner = makeRunner(NAMED_ADMIN_ENV);
      const res = await runCredentials(
        { host: 'paul@vm' },
        { prompter: scriptedPrompter({}), runner, credsDir: tmp },
      );
      expect(res?.recoveryLink).toBe('https://auth.example.com/if/flow/recovery/xyz');
      expect(res?.adminEmail).toBe('me@example.com');
      const creds = await readFile(join(tmp, 'hola-paul-vm.env'), 'utf8');
      expect(creds).toContain('export HOLA_API_URL=https://apps.example.com');
      expect(creds).toContain('export HOLA_TOKEN=key-abc');
      // The akadmin password is never read when there's a named admin.
      expect(runner.calls.some((c) => c.includes('AUTHENTIK_BOOTSTRAP_PASSWORD'))).toBe(false);
    });
  });

  it('keeps polling (no timeout) until the recovery link is provisioned', async () => {
    await withTmp(async (tmp) => {
      let attempts = 0;
      const runner: Runner & { calls: string[] } = {
        calls: [],
        ssh: vi.fn(async (_h: string, cmd: string) => {
          if (cmd.includes('cat -- "$f"')) return { code: 0, stdout: NAMED_ADMIN_ENV, stderr: '' };
          if (cmd.includes('admin-api-key')) return { code: 0, stdout: 'key-abc', stderr: '' };
          if (cmd.includes('Hola admin setup')) {
            attempts += 1;
            // Not provisioned for the first few polls, then the link appears.
            return attempts < 4
              ? { code: 0, stdout: '', stderr: '' }
              : { code: 0, stdout: 'https://auth.example.com/if/flow/recovery/late', stderr: '' };
          }
          return { code: 0, stdout: '', stderr: '' };
        }),
        local: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
      } as Runner & { calls: string[] };
      const res = await runCredentials(
        { host: 'paul@vm' },
        { prompter: scriptedPrompter({}), runner, credsDir: tmp, sleep: async () => {} },
      );
      // It kept polling past the early empty results — no fixed attempt budget.
      expect(attempts).toBe(4);
      expect(res?.recoveryLink).toBe('https://auth.example.com/if/flow/recovery/late');
    });
  });

  it('stops waiting (no hang) when the server reports it gave up provisioning the link', async () => {
    await withTmp(async (tmp) => {
      const runner: Runner & { calls: string[] } = {
        calls: [],
        ssh: vi.fn(async (_h: string, cmd: string) => {
          if (cmd.includes('cat -- "$f"')) return { code: 0, stdout: NAMED_ADMIN_ENV, stderr: '' };
          if (cmd.includes('admin-api-key')) return { code: 0, stdout: 'key-abc', stderr: '' };
          // The poll's log grab finds the server's "gave up" sentinel, no link.
          if (cmd.includes('Hola admin setup')) return { code: 0, stdout: '__HOLA_PROVISION_FAILED__\n', stderr: '' };
          return { code: 0, stdout: '', stderr: '' };
        }),
        local: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
      } as Runner & { calls: string[] };
      const res = await runCredentials(
        { host: 'paul@vm' },
        { prompter: scriptedPrompter({}), runner, credsDir: tmp, sleep: async () => {} },
      );
      // Returned (did not hang on the unbounded poll) and surfaced no link.
      expect(res?.recoveryLink).toBeUndefined();
      expect(res?.adminEmail).toBe('me@example.com');
    });
  });

  it('reveals the akadmin password with --show-password (no prompt)', async () => {
    await withTmp(async (tmp) => {
      const runner = makeRunner(AKADMIN_ENV);
      await runCredentials(
        { host: 'paul@vm', showPassword: true },
        { prompter: scriptedPrompter({}), runner, credsDir: tmp },
      );
      expect(runner.calls.some((c) => c.includes('AUTHENTIK_BOOTSTRAP_PASSWORD'))).toBe(true);
      // Pinned key → no fetch from the server.
      expect(runner.calls.some((c) => c.includes('admin-api-key'))).toBe(false);
    });
  });

  it('does not read the akadmin password unless opted in', async () => {
    await withTmp(async (tmp) => {
      const runner = makeRunner(AKADMIN_ENV);
      await runCredentials(
        { host: 'paul@vm' },
        { prompter: scriptedPrompter({ _show_akadmin_pw: 'false' }), runner, credsDir: tmp },
      );
      expect(runner.calls.some((c) => c.includes('AUTHENTIK_BOOTSTRAP_PASSWORD'))).toBe(false);
    });
  });

  it('returns a structured result under --json', async () => {
    await withTmp(async (tmp) => {
      const runner = makeRunner(NAMED_ADMIN_ENV);
      const res = await runCredentials(
        { host: 'paul@vm', json: true },
        { prompter: scriptedPrompter({}), runner, credsDir: tmp },
      );
      expect(res?.credsPath).toContain('hola-paul-vm.env');
      expect(res?.apiUrl).toBe('https://apps.example.com');
    });
  });
});

describe('hola credentials: reading the host .env (#604)', () => {
  beforeEach(() => { process.exitCode = 0; });
  afterEach(() => { process.exitCode = 0; });

  const readOf = async (r: { code: number; stdout?: string; stderr?: string }, opts: { dir?: string } = {}) => {
    const runner = makeRunner('');
    (runner.ssh as ReturnType<typeof vi.fn>).mockImplementation(async (_h: string, cmd: string) => {
      runner.calls.push(cmd);
      return { code: r.code, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    });
    const errs: string[] = [];
    const logs: string[] = [];
    const e = vi.spyOn(console, 'error').mockImplementation((m?: unknown) => { errs.push(String(m)); });
    const l = vi.spyOn(console, 'log').mockImplementation((m?: unknown) => { logs.push(String(m)); });
    try {
      const res = await runCredentials({ host: 'paul@vm', json: true, ...opts }, { prompter: scriptedPrompter({}), runner });
      expect(res).toBeUndefined();
      expect(process.exitCode).toBe(1);
    } finally { e.mockRestore(); l.mockRestore(); }
    return { err: errs.join('\n'), logs: logs.join('\n'), runner };
  };

  it('a non-255 failure is a failed step with the stderr tail, never "Could not connect" or stdout', async () => {
    const { err, logs } = await readOf({ code: 2, stdout: 'POSTGRES_PASSWORD=hunter2\n', stderr: 'cat: I/O error' });
    expect(err).toContain('"Read install config" failed on paul@vm (exit 2): cat: I/O error');
    expect(err).not.toContain('Could not connect');
    expect(err + logs).not.toContain('hunter2');
  });

  it('exit 255 is still a connection failure', async () => {
    const { err } = await readOf({ code: 255, stderr: 'Connection timed out' });
    expect(err).toContain('Could not connect to paul@vm (ssh exit 255): Connection timed out');
  });

  it('an unreadable .env names the file, the user and the chown fix', async () => {
    const { err, logs } = await readOf({
      code: 45,
      stdout: 'POSTGRES_PASSWORD=hunter2\n',
      stderr: '__HOLA_ENV_UNREADABLE__ user=paul group=users\n',
    });
    expect(err).toContain('Could not read /opt/hola/.env on paul@vm: permission denied for paul.');
    expect(err).toContain('sudo chown -R paul:users /opt/hola');
    expect(err).not.toContain('Could not connect');
    expect(err + logs).not.toContain('hunter2');
  });

  it('quotes an install dir with a space, in both the read command and the chown', async () => {
    const { err, runner } = await readOf(
      { code: 45, stderr: '__HOLA_ENV_UNREADABLE__ user=paul group=users' },
      { dir: '/srv/my hola' },
    );
    expect(runner.calls[0]).toContain("d='/srv/my hola'");
    expect(err).toContain("sudo chown -R paul:users '/srv/my hola'");
  });

  it('a missing .env keeps the "No Hola .env found" message', async () => {
    const { err } = await readOf({ code: 44 });
    expect(err).toContain('No Hola .env found at /opt/hola/.env on paul@vm. Install first with: hola bootstrap --host paul@vm');
    expect(err).not.toContain('Could not connect');
  });
});

describe('credentials .env read under a real shell (#604)', () => {
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSyncFs(join(os.tmpdir(), 'hola-creds-sh-')); });
  afterEach(() => {
    spawnSync('chmod', ['-R', 'u+rwx', tmp]);
    rmSync(tmp, { recursive: true, force: true });
  });
  const run = (dir: string) =>
    spawnSync('sh', ['-c', buildReadEnvCommand(dir)], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' });

  it('reads a readable .env in a dir with a space', () => {
    const dir = join(tmp, 'my hola');
    mkdirSync(dir);
    writeFileSync(join(dir, '.env'), 'HOLA_DOMAIN=x\n');
    const r = run(dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('HOLA_DOMAIN=x\n');
  });

  it('reports a missing .env as 44', () => {
    expect(run(tmp).status).toBe(44);
  });

  it.skipIf(isRoot)('reports an unreadable .env as 45 with the user and group, and prints nothing on stdout', () => {
    writeFileSync(join(tmp, '.env'), 'SECRET=hunter2\n');
    chmodSync(join(tmp, '.env'), 0o000);
    const r = run(tmp);
    expect(r.status).toBe(45);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^__HOLA_ENV_UNREADABLE__ user=\S+ group=\S+/);
    expect(r.stderr).not.toContain('hunter2');
  });

  it.skipIf(isRoot)('reports an unsearchable install dir as 45, not as a missing .env', () => {
    writeFileSync(join(tmp, '.env'), 'SECRET=hunter2\n');
    chmodSync(tmp, 0o600);
    expect(run(tmp).status).toBe(45);
  });
});
