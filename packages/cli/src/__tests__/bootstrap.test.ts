import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { runBootstrap } from '../commands/bootstrap/bootstrap';
import { scriptedPrompter } from '../install/prompter';
import type { Runner } from '../lib/runner';

const answers: Record<string, string> = {
  HOLA_BASE_DOMAIN: 'hola.example.com',
  HOLA_DOMAIN: 'app.hola.example.com',
  TRAEFIK_DASHBOARD_DOMAIN: 'traefik.hola.example.com',
  LETSENCRYPT_EMAIL: 'admin@example.com',
  ACME_DNS_PROVIDER: 'route53',
  AWS_ACCESS_KEY_ID: 'AKIA123',
  AWS_SECRET_ACCESS_KEY: 'super-secret-value',
  AWS_REGION: 'us-east-1',
  HOLA_CATALOG_URL: 'https://example.com/catalog.json',
  HOLA_AUTH_MODE: 'none',
  HOLA_USE_AUTH: 'true',
  HOLA_API_KEY: '',
};

const OK_PREFLIGHT = 'docker=ok\ncurl=ok\ntar=ok\ncompose=ok\ndockerperm=ok\n';

function makeRunner(preflight = OK_PREFLIGHT): Runner & { calls: { cmd: string; input?: string }[] } {
  const calls: { cmd: string; input?: string }[] = [];
  return {
    calls,
    ssh: vi.fn(async (_host: string, cmd: string, opts?: { input?: string }) => {
      calls.push({ cmd, input: opts?.input });
      if (cmd.includes('command -v')) return { code: 0, stdout: preflight, stderr: '' };
      if (cmd.includes('admin-api-key')) return { code: 0, stdout: 'generated-key-123', stderr: '' };
      if (cmd.includes('Hola admin setup')) return { code: 0, stdout: 'https://auth.example.com/if/flow/recovery/abc', stderr: '' };
      if (cmd.includes('AUTHENTIK_BOOTSTRAP_PASSWORD')) return { code: 0, stdout: 'akadmin-pw-xyz', stderr: '' };
      if (cmd.includes('curl')) return { code: 0, stdout: '200', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    }),
    local: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
  } as Runner & { calls: { cmd: string; input?: string }[] };
}

describe('hola bootstrap', () => {
  beforeEach(() => { process.exitCode = 0; });
  afterEach(() => { process.exitCode = 0; });

  it('runs the remote steps in order and streams .env over stdin', async () => {
    const runner = makeRunner();
    const res = await runBootstrap(
      { host: 'me@vm', skipChecks: true, json: true, ref: 'cli-v0.2.0' },
      { prompter: scriptedPrompter(answers), runner }
    );

    expect(res?.steps).toEqual([
      'Preflight host',
      'Download Hola 0.2.0 stack into /opt/hola',
      'Write .env (over stdin)',
      'Run install.sh',
      'Verify https://app.hola.example.com',
    ]);

    // The .env is written via the `cat >` step's stdin, not via argv.
    const writeCall = runner.calls.find((c) => c.cmd.includes('cat >'))!;
    expect(writeCall.input).toContain('AWS_SECRET_ACCESS_KEY=super-secret-value');
    // The secret never appears in any command string.
    expect(runner.calls.every((c) => !c.cmd.includes('super-secret-value'))).toBe(true);
    expect(process.exitCode).toBe(0);
  });

  it('downloads the version-pinned bundle and writes .env to the install dir', async () => {
    const runner = makeRunner();
    await runBootstrap(
      { host: 'me@vm', ref: 'cli-v0.2.0', dir: '/opt/hola', skipChecks: true, json: true },
      { prompter: scriptedPrompter(answers), runner }
    );
    expect(
      runner.calls.some((c) =>
        /curl -fsSL \S*releases\/download\/cli-v0\.2\.0\/hola-compose-0\.2\.0\.tar\.gz.*tar xz -C \/opt\/hola/.test(c.cmd),
      ),
    ).toBe(true);
    expect(runner.calls.some((c) => c.cmd.includes('cat > /opt/hola/.env'))).toBe(true);
    expect(runner.calls.some((c) => c.cmd.includes('cd /opt/hola && HOLA_BOOTSTRAP=1 ./scripts/install.sh'))).toBe(true);
    // /opt is root-owned: the fetch step creates the dir with sudo + chown when
    // the parent isn't writable (and plain mkdir when it is).
    const fetch = runner.calls.find((c) => c.cmd.includes('tar xz -C /opt/hola'))!;
    expect(fetch.cmd).toContain('sudo mkdir -p /opt/hola');
    expect(fetch.cmd).toContain('chown');
  });

  it('honors --tarball-url for the bundle download', async () => {
    const runner = makeRunner();
    await runBootstrap(
      { host: 'me@vm', tarballUrl: 'https://example.com/custom.tar.gz', skipChecks: true, json: true },
      { prompter: scriptedPrompter(answers), runner }
    );
    expect(runner.calls.some((c) => c.cmd.includes('curl -fsSL https://example.com/custom.tar.gz'))).toBe(true);
  });

  it('--dry-run connects to nothing and exits 0', async () => {
    const runner = makeRunner();
    const res = await runBootstrap(
      { host: 'me@vm', dryRun: true, skipChecks: true, json: true },
      { prompter: scriptedPrompter(answers), runner }
    );
    expect(runner.calls).toHaveLength(0);
    expect(res?.steps.length).toBeGreaterThan(0);
    expect(process.exitCode).toBe(0);
  });

  it('aborts before install when preflight finds Docker missing', async () => {
    const runner = makeRunner('docker=missing\ncurl=ok\ntar=ok\ncompose=missing\ndockerperm=fail\n');
    const res = await runBootstrap(
      { host: 'me@vm', skipChecks: true, json: true },
      { prompter: scriptedPrompter(answers), runner }
    );
    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(runner.calls.some((c) => c.cmd.includes('install.sh'))).toBe(false);
  });

  // --- Fresh-install guard (#351) --------------------------------------------

  const EXISTING_PREFLIGHT =
    'docker=ok\ncurl=ok\ntar=ok\ncompose=ok\ndockerperm=ok\nexisting_env=present\nexisting_vol=present\n';

  it('refuses to re-run against an already-bootstrapped host and points at hola update (#351)', async () => {
    const runner = makeRunner(EXISTING_PREFLIGHT);
    const errs: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((m?: unknown) => { errs.push(String(m)); });
    try {
      const res = await runBootstrap(
        { host: 'me@vm', skipChecks: true, json: true, ref: 'cli-v0.2.0' },
        { prompter: scriptedPrompter(answers), runner }
      );
      expect(res).toBeUndefined();
      expect(process.exitCode).toBe(1);
      // The bug is a clobbering re-run: assert we neither rewrote .env nor ran the installer.
      expect(runner.calls.some((c) => c.cmd.includes('cat > '))).toBe(false);
      expect(runner.calls.some((c) => c.cmd.includes('install.sh'))).toBe(false);
      expect(errs.join('\n')).toContain('hola update --host me@vm');
      expect(errs.join('\n')).toContain('--reinstall');
    } finally {
      spy.mockRestore();
    }
  });

  it('--reinstall resets the stateful volumes before reinstalling (#351)', async () => {
    const runner = makeRunner(EXISTING_PREFLIGHT);
    const res = await runBootstrap(
      { host: 'me@vm', skipChecks: true, json: true, ref: 'cli-v0.2.0', reinstall: true },
      { prompter: scriptedPrompter(answers), runner }
    );
    expect(res?.steps).toContain('Reset existing install (down -v, remove Hola volumes)');
    // The reset must precede the .env write, so regenerated secrets meet fresh volumes.
    const resetIdx = runner.calls.findIndex((c) => c.cmd.includes('docker compose down -v'));
    const writeIdx = runner.calls.findIndex((c) => c.cmd.includes('cat > '));
    expect(resetIdx).toBeGreaterThanOrEqual(0);
    expect(writeIdx).toBeGreaterThan(resetIdx);
    expect(runner.calls.some((c) => c.cmd.includes('install.sh'))).toBe(true);
  });

  it('installs normally on a fresh host (no existing .env or volumes)', async () => {
    const runner = makeRunner('docker=ok\ncurl=ok\ntar=ok\ncompose=ok\ndockerperm=ok\nexisting_env=absent\nexisting_vol=absent\n');
    const res = await runBootstrap(
      { host: 'me@vm', skipChecks: true, json: true, ref: 'cli-v0.2.0' },
      { prompter: scriptedPrompter(answers), runner }
    );
    expect(res?.steps).not.toContain('Reset existing install (down -v, remove Hola volumes)');
    expect(runner.calls.some((c) => c.cmd.includes('install.sh'))).toBe(true);
  });

  // --- SSH connection multiplexing (#181) ------------------------------------

  it('shares one multiplexed SSH connection and tears the master down at the end (#181)', async () => {
    const runner = makeRunner();
    let extraSshArgs: string[] | undefined;
    const res = await runBootstrap(
      { host: 'me@vm', skipChecks: true, json: true, ref: 'cli-v0.2.0' },
      { prompter: scriptedPrompter(answers), makeRunner: (extra) => { extraSshArgs = extra; return runner; } }
    );
    expect(res?.host).toBe('me@vm');
    // The runner is built with OpenSSH connection-sharing options.
    expect(extraSshArgs).toContain('ControlMaster=auto');
    const controlPathArg = extraSshArgs?.find((a) => a.startsWith('ControlPath='));
    expect(controlPathArg).toBeTruthy();
    // The master is explicitly closed at the end via `ssh -O exit` (a local spawn).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exitCall = (runner.local as any).mock.calls.find(
      (c: unknown[]) => Array.isArray(c[1]) && (c[1] as string[]).includes('-O') && (c[1] as string[]).includes('exit'),
    );
    expect(exitCall).toBeTruthy();
    expect((exitCall[1] as string[]).some((a) => a === controlPathArg)).toBe(true);
  });

  it('does not multiplex under --dry-run (no connection is made) (#181)', async () => {
    let extraSshArgs: string[] | undefined;
    await runBootstrap(
      { host: 'me@vm', dryRun: true, skipChecks: true, json: true },
      { prompter: scriptedPrompter(answers), makeRunner: (extra) => { extraSshArgs = extra; return makeRunner(); } }
    );
    expect(extraSshArgs).toEqual([]);
  });

  it('requires --host', async () => {
    const res = await runBootstrap({ skipChecks: true, json: true }, { prompter: scriptedPrompter(answers), runner: makeRunner() });
    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(1);
  });

  // --- Credential handoff (interactive runs) ---------------------------------

  async function withEnv(content: string, run: (tmp: string, envPath: string) => Promise<void>) {
    const tmp = await mkdtemp(join(tmpdir(), 'hola-creds-'));
    const envPath = join(tmp, '.env');
    await writeFile(envPath, content);
    try { await run(tmp, envPath); } finally { await rm(tmp, { recursive: true, force: true }); }
  }

  it('saves the fetched admin API key to a local creds file', async () => {
    await withEnv(
      'HOLA_DOMAIN=apps.example.com\nHOLA_USE_AUTH=true\nHOLA_API_KEY=\nHOLA_AUTH_MODE=none\n',
      async (tmp, envPath) => {
        const runner = makeRunner();
        await runBootstrap(
          { host: 'paul@vm', envFile: envPath, skipChecks: true },
          { prompter: scriptedPrompter({}), runner, credsDir: tmp }
        );
        const creds = await readFile(join(tmp, 'hola-paul-vm.env'), 'utf8');
        expect(creds).toContain('export HOLA_API_URL=https://apps.example.com');
        expect(creds).toContain('export HOLA_TOKEN=generated-key-123');
        expect(runner.calls.some((c) => c.cmd.includes('admin-api-key'))).toBe(true);
      }
    );
  });

  it('uses a pinned HOLA_API_KEY without fetching it from the host', async () => {
    await withEnv(
      'HOLA_DOMAIN=apps.example.com\nHOLA_USE_AUTH=true\nHOLA_API_KEY=pinned-key\nHOLA_AUTH_MODE=none\n',
      async (tmp) => {
        const runner = makeRunner();
        await runBootstrap(
          { host: 'paul@vm', envFile: join(tmp, '.env'), skipChecks: true },
          { prompter: scriptedPrompter({}), runner, credsDir: tmp }
        );
        const creds = await readFile(join(tmp, 'hola-paul-vm.env'), 'utf8');
        expect(creds).toContain('export HOLA_TOKEN=pinned-key');
        expect(runner.calls.some((c) => c.cmd.includes('admin-api-key'))).toBe(false);
      }
    );
  });

  it('auto-surfaces the named-admin recovery link (no password prompt)', async () => {
    await withEnv(
      'HOLA_DOMAIN=apps.example.com\nHOLA_USE_AUTH=true\nHOLA_API_KEY=k\nHOLA_AUTH_MODE=authentik\nHOLA_ADMIN_EMAIL=me@example.com\nHOLA_AUTHENTIK_DOMAIN=auth.example.com\n',
      async (tmp) => {
        const runner = makeRunner();
        await runBootstrap(
          { host: 'paul@vm', envFile: join(tmp, '.env'), skipChecks: true },
          { prompter: scriptedPrompter({}), runner, credsDir: tmp }
        );
        // Recovery link is fetched; the akadmin password is never read.
        expect(runner.calls.some((c) => c.cmd.includes('Hola admin setup'))).toBe(true);
        expect(runner.calls.some((c) => c.cmd.includes('AUTHENTIK_BOOTSTRAP_PASSWORD'))).toBe(false);
      }
    );
  });

  it('reveals the akadmin password only when there is no named admin and the user opts in', async () => {
    await withEnv(
      'HOLA_DOMAIN=apps.example.com\nHOLA_USE_AUTH=true\nHOLA_API_KEY=k\nHOLA_AUTH_MODE=authentik\nHOLA_ADMIN_EMAIL=\nHOLA_AUTHENTIK_DOMAIN=auth.example.com\n',
      async (tmp) => {
        const runner = makeRunner();
        await runBootstrap(
          { host: 'paul@vm', envFile: join(tmp, '.env'), skipChecks: true },
          { prompter: scriptedPrompter({ _show_akadmin_pw: 'true' }), runner, credsDir: tmp }
        );
        expect(runner.calls.some((c) => c.cmd.includes('AUTHENTIK_BOOTSTRAP_PASSWORD'))).toBe(true);
        expect(runner.calls.some((c) => c.cmd.includes('Hola admin setup'))).toBe(false);
      }
    );
  });

  it('does not read the akadmin password when the reveal is declined', async () => {
    await withEnv(
      'HOLA_DOMAIN=apps.example.com\nHOLA_USE_AUTH=true\nHOLA_API_KEY=k\nHOLA_AUTH_MODE=authentik\nHOLA_ADMIN_EMAIL=\nHOLA_AUTHENTIK_DOMAIN=auth.example.com\n',
      async (tmp) => {
        const runner = makeRunner();
        await runBootstrap(
          { host: 'paul@vm', envFile: join(tmp, '.env'), skipChecks: true },
          { prompter: scriptedPrompter({ _show_akadmin_pw: 'false' }), runner, credsDir: tmp }
        );
        expect(runner.calls.some((c) => c.cmd.includes('AUTHENTIK_BOOTSTRAP_PASSWORD'))).toBe(false);
      }
    );
  });

  it('detects an init-produced .env and reuses it when the user opts in', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'hola-boot-'));
    const envPath = join(tmp, '.env');
    // A marker value the wizard would never produce, proving the file was reused.
    await writeFile(envPath, 'HOLA_DOMAIN=reused.example.com\nHOLA_API_KEY=from-the-file\n');
    const runner = makeRunner();
    try {
      const res = await runBootstrap(
        { host: 'me@vm', skipChecks: true }, // interactive: detection runs
        {
          // Reuse now defaults to NO, so opt in explicitly to skip the wizard.
          prompter: scriptedPrompter({ _use_env: 'true' }),
          runner,
          findEnvFile: async () => envPath,
        }
      );
      expect(res?.host).toBe('me@vm');
      const writeCall = runner.calls.find((c) => c.cmd.includes('cat >'))!;
      expect(writeCall.input).toContain('HOLA_DOMAIN=reused.example.com');
      expect(writeCall.input).toContain('HOLA_API_KEY=from-the-file');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('ignores a detected .env that is not a Hola config — never offers to reuse it (#345)', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'hola-boot-'));
    const envPath = join(tmp, '.env');
    // A foreign project's .env: no HOLA_ keys, so it is not a Hola install config.
    await writeFile(envPath, 'DATABASE_URL=postgres://user:pw@db/other\nPORT=3000\nSECRET=nope\n');
    const runner = makeRunner();
    try {
      // Even if the operator would say "yes" to a reuse prompt, the file must not
      // be offered: detection is skipped, so the wizard runs and aborts on the
      // first unanswered required field — the foreign file is never shipped.
      const res = await runBootstrap(
        { host: 'me@vm', skipChecks: true },
        { prompter: scriptedPrompter({ _use_env: 'true' }), runner, findEnvFile: async () => envPath }
      );
      expect(res).toBeUndefined();
      expect(process.exitCode).toBe(1);
      expect(runner.calls.some((c) => c.input?.includes('postgres://'))).toBe(false);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('does NOT reuse a detected .env by default — it runs the wizard instead', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'hola-boot-'));
    const envPath = join(tmp, '.env');
    await writeFile(envPath, 'HOLA_BASE_DOMAIN=stale.example.com\nHOLA_ADMIN_EMAIL=stale@example.com\n');
    const runner = makeRunner();
    try {
      // Default-no on reuse → the wizard runs; with empty answers a required field
      // throws (WizardError), so bootstrap aborts rather than shipping the stale file.
      const res = await runBootstrap(
        { host: 'me@vm', skipChecks: true },
        { prompter: scriptedPrompter({}), runner, findEnvFile: async () => envPath }
      );
      expect(res).toBeUndefined();
      expect(process.exitCode).toBe(1);
      // The stale file was never sent to the host.
      expect(runner.calls.some((c) => c.input?.includes('stale.example.com'))).toBe(false);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
