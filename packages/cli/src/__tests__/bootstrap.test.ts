import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

const OK_PREFLIGHT = 'docker=ok\ngit=ok\ncompose=ok\ndockerperm=ok\n';

function makeRunner(preflight = OK_PREFLIGHT): Runner & { calls: { cmd: string; input?: string }[] } {
  const calls: { cmd: string; input?: string }[] = [];
  return {
    calls,
    ssh: vi.fn(async (_host: string, cmd: string, opts?: { input?: string }) => {
      calls.push({ cmd, input: opts?.input });
      if (cmd.includes('command -v')) return { code: 0, stdout: preflight, stderr: '' };
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
      'Fetch Hola cli-v0.2.0 into ~/hola',
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

  it('clones the repo at the requested ref and writes .env to packages/compose', async () => {
    const runner = makeRunner();
    await runBootstrap(
      { host: 'me@vm', ref: 'main', dir: '/opt/hola', skipChecks: true, json: true },
      { prompter: scriptedPrompter(answers), runner }
    );
    expect(runner.calls.some((c) => /git clone .*--branch main .*\/opt\/hola/.test(c.cmd))).toBe(true);
    expect(runner.calls.some((c) => c.cmd.includes('cat > /opt/hola/packages/compose/.env'))).toBe(true);
    expect(runner.calls.some((c) => c.cmd.includes('cd /opt/hola/packages/compose && ./scripts/install.sh'))).toBe(true);
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
    const runner = makeRunner('docker=missing\ngit=ok\ncompose=missing\ndockerperm=fail\n');
    const res = await runBootstrap(
      { host: 'me@vm', skipChecks: true, json: true },
      { prompter: scriptedPrompter(answers), runner }
    );
    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(runner.calls.some((c) => c.cmd.includes('install.sh'))).toBe(false);
  });

  it('requires --host', async () => {
    const res = await runBootstrap({ skipChecks: true, json: true }, { prompter: scriptedPrompter(answers), runner: makeRunner() });
    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(1);
  });
});
