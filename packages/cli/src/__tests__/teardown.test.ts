import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { runTeardown } from '../commands/teardown/teardown';
import { scriptedPrompter } from '../install/prompter';
import type { Runner } from '../lib/runner';

function makeRunner(): Runner & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    ssh: vi.fn(async (_host: string, cmd: string) => {
      calls.push(cmd);
      if (cmd.includes('command -v docker')) return { code: 0, stdout: 'ok', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    }),
    local: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
  } as Runner & { calls: string[] };
}

const has = (calls: string[], re: RegExp) => calls.some((c) => re.test(c));

describe('hola teardown', () => {
  beforeEach(() => { process.exitCode = 0; });
  afterEach(() => { process.exitCode = 0; });

  it('requires --host', async () => {
    const res = await runTeardown({ yes: true }, { prompter: scriptedPrompter({}), runner: makeRunner() });
    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(1);
  });

  it('full teardown removes containers, network, volumes, dirs (with --yes)', async () => {
    const runner = makeRunner();
    const res = await runTeardown({ host: 'me@vm', yes: true }, { prompter: scriptedPrompter({}), runner });
    expect(res?.host).toBe('me@vm');
    expect(has(runner.calls, /docker compose down -v --remove-orphans/)).toBe(true);
    expect(has(runner.calls, /docker rm -f/)).toBe(true);
    expect(has(runner.calls, /docker network rm hola/)).toBe(true);
    expect(has(runner.calls, /docker volume ls .*hola.*docker volume rm/)).toBe(true);
    expect(has(runner.calls, /rm -rf \/opt\/hola/)).toBe(true);
    // No image removal unless --images.
    expect(has(runner.calls, /docker rmi/)).toBe(false);
    expect(process.exitCode).toBe(0);
  });

  it('--keep-data stops containers but preserves volumes and dirs', async () => {
    const runner = makeRunner();
    await runTeardown({ host: 'me@vm', keepData: true, yes: true }, { prompter: scriptedPrompter({}), runner });
    // down WITHOUT -v
    expect(has(runner.calls, /docker compose down\s+--remove-orphans/)).toBe(true);
    expect(has(runner.calls, /docker compose down -v/)).toBe(false);
    expect(has(runner.calls, /docker volume rm/)).toBe(false);
    expect(has(runner.calls, /rm -rf/)).toBe(false);
  });

  it('--images also removes the try-hola images', async () => {
    const runner = makeRunner();
    await runTeardown({ host: 'me@vm', images: true, yes: true }, { prompter: scriptedPrompter({}), runner });
    expect(has(runner.calls, /ghcr\.io\/try-hola\/.*docker rmi -f/)).toBe(true);
  });

  it('preserves the Let’s Encrypt cert store by default', async () => {
    const runner = makeRunner();
    await runTeardown({ host: 'me@vm', yes: true }, { prompter: scriptedPrompter({}), runner });
    const rmStep = runner.calls.find((c) => c.includes('rm -rf /opt/hola'))!;
    // The dir is still wiped, but acme.json is copied aside and restored.
    expect(rmStep).toMatch(/traefik\/acme\/acme\.json/);
    expect(rmStep).toMatch(/cp "\$acme" "\$tmp"/);
    expect(rmStep).toMatch(/mv "\$tmp" "\$acme"/);
  });

  it('--include-certs wipes the cert store too (no preserve dance)', async () => {
    const runner = makeRunner();
    await runTeardown({ host: 'me@vm', includeCerts: true, yes: true }, { prompter: scriptedPrompter({}), runner });
    const rmStep = runner.calls.find((c) => c.includes('rm -rf /opt/hola'))!;
    expect(rmStep).not.toMatch(/traefik\/acme/);
  });

  it('--dry-run prints the plan and connects to nothing', async () => {
    const runner = makeRunner();
    const res = await runTeardown({ host: 'me@vm', dryRun: true }, { prompter: scriptedPrompter({}), runner });
    expect(runner.calls).toHaveLength(0);
    expect(res?.steps.length).toBeGreaterThan(0);
    expect(process.exitCode).toBe(0);
  });

  it('full teardown requires typing the host to confirm', async () => {
    const runner = makeRunner();
    // Wrong confirmation → scriptedPrompter throws via the validator → abort, no ssh.
    const res = await runTeardown(
      { host: 'me@vm' },
      { prompter: scriptedPrompter({ _confirm: 'nope' }), runner }
    );
    expect(res).toBeUndefined();
    expect(runner.calls).toHaveLength(0);
    expect(process.exitCode).toBe(1);
  });

  it('proceeds when the typed host matches', async () => {
    const runner = makeRunner();
    const res = await runTeardown(
      { host: 'me@vm' },
      { prompter: scriptedPrompter({ _confirm: 'me@vm' }), runner }
    );
    expect(res?.host).toBe('me@vm');
    expect(has(runner.calls, /docker compose down -v/)).toBe(true);
  });

  it('aborts when --keep-data confirmation is declined', async () => {
    const runner = makeRunner();
    const res = await runTeardown(
      { host: 'me@vm', keepData: true },
      { prompter: scriptedPrompter({ _confirm: 'false' }), runner }
    );
    expect(res).toBeUndefined();
    expect(runner.calls).toHaveLength(0);
    expect(process.exitCode).toBe(1);
  });
});
