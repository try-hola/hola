import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { runCredentials } from '../commands/credentials/credentials';
import { scriptedPrompter } from '../install/prompter';
import type { Runner } from '../lib/runner';

// A fake runner that serves the host's .env on `cat`, then canned values for the
// credential-retrieval commands. Records every command so we can assert behavior.
function makeRunner(envContent: string): Runner & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    ssh: vi.fn(async (_host: string, cmd: string) => {
      calls.push(cmd);
      if (cmd.startsWith('cat ')) return { code: 0, stdout: envContent, stderr: '' };
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
          if (cmd.startsWith('cat ')) return { code: 0, stdout: NAMED_ADMIN_ENV, stderr: '' };
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
          if (cmd.startsWith('cat ')) return { code: 0, stdout: NAMED_ADMIN_ENV, stderr: '' };
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
