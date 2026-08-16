import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { runAppDataPush } from '../commands/deployments/data-push';
import { scriptedPrompter } from '../install/prompter';
import type { HolaSdk } from '@hola/sdk';
import type { GetDeploymentPushTargetsResponse } from '@hola/shared';
import type { Runner } from '../lib/runner';

type Target = GetDeploymentPushTargetsResponse['targets'][number];

const LIBRARY: Target = {
  id: 'library',
  label: 'Calibre library',
  description: 'metadata.db plus the book folders',
  destPath: '/srv/hola/apps/calibre-web-ab12cd34/books',
  mode: 'mirror',
  quiesce: 'stop',
  hasPostHook: false,
};

const MEDIA: Target = {
  id: 'media',
  label: 'Media',
  destPath: '/srv/hola/apps/jelly-ab12cd34/media',
  mode: 'additive',
  quiesce: 'none',
  hasPostHook: false,
};

function makeSdk(targets: Target[] = [LIBRARY], overrides: Record<string, unknown> = {}) {
  const actions: string[] = [];
  return {
    actions,
    deployments: {
      pushTargets: vi.fn(async () => ({ targets })),
      // No jobId: the action is synchronous as far as the CLI is concerned, so
      // these tests don't exercise (or wait on) the job stream.
      action: vi.fn(async (_id: string, req: { action: string }) => { actions.push(req.action); return { ok: true }; }),
      pushHook: vi.fn(async () => ({ ok: true })),
      ...overrides,
    },
    jobs: { byId: vi.fn(async () => ({ status: 'completed' })) },
  };
}

/** Fake runner: records ssh commands and local argv; the stat probe answers 911:911. */
function makeRunner(over: { statCode?: number; rsyncCode?: number } = {}) {
  const ssh: string[] = [];
  const local: Array<{ cmd: string; args: string[] }> = [];
  return {
    ssh,
    local,
    runner: {
      ssh: vi.fn(async (_host: string, cmd: string) => {
        ssh.push(cmd);
        if (cmd.includes('stat -c')) {
          return { code: over.statCode ?? 0, stdout: over.statCode ? '' : '911:911\n', stderr: over.statCode ? 'no such file' : '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      }),
      local: vi.fn(async (cmd: string, args: string[]) => {
        local.push({ cmd, args });
        if (cmd === 'rsync') return { code: over.rsyncCode ?? 0, stdout: 'sent 12 bytes', stderr: over.rsyncCode ? 'rsync error' : '' };
        return { code: 0, stdout: '', stderr: '' };
      }),
    } as unknown as Runner,
  };
}

const rsyncCall = (local: Array<{ cmd: string; args: string[] }>) => local.find((c) => c.cmd === 'rsync');

describe('hola app data push', () => {
  let localDir: string;

  beforeEach(async () => {
    process.exitCode = 0;
    localDir = await mkdtemp(path.join(os.tmpdir(), 'hola-push-test-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = 0;
    await rm(localDir, { recursive: true, force: true });
  });

  const inject = (sdk: ReturnType<typeof makeSdk>, runner: Runner, answers: Record<string, string> = {}) => ({
    sdk: sdk as unknown as HolaSdk,
    runner,
    prompter: scriptedPrompter(answers),
  });

  // --- listing ---------------------------------------------------------------

  it('--list prints the declared targets and moves no bytes', async () => {
    const sdk = makeSdk();
    const { runner, local } = makeRunner();

    await runAppDataPush('dep1', undefined, undefined, { list: true }, inject(sdk, runner));

    expect(sdk.deployments.pushTargets).toHaveBeenCalledWith('dep1');
    expect(local).toHaveLength(0);
    expect(process.exitCode).toBe(0);
  });

  it('omitting the target behaves as --list', async () => {
    const sdk = makeSdk();
    const { runner, local } = makeRunner();

    await runAppDataPush('dep1', undefined, undefined, {}, inject(sdk, runner));

    expect(sdk.deployments.pushTargets).toHaveBeenCalled();
    expect(local).toHaveLength(0);
  });

  it('an unknown target id fails without connecting', async () => {
    const sdk = makeSdk();
    const { runner, ssh, local } = makeRunner();

    const res = await runAppDataPush('dep1', 'nope', localDir, { host: 'me@vm', yes: true }, inject(sdk, runner));

    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(ssh).toHaveLength(0);
    expect(local).toHaveLength(0);
  });

  // --- guards ----------------------------------------------------------------

  it('requires --host', async () => {
    const sdk = makeSdk();
    const { runner, local } = makeRunner();

    const res = await runAppDataPush('dep1', 'library', localDir, { yes: true }, inject(sdk, runner));

    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(local).toHaveLength(0);
  });

  it('rejects a local path that is not a directory', async () => {
    const sdk = makeSdk();
    const { runner, local } = makeRunner();

    const res = await runAppDataPush('dep1', 'library', path.join(localDir, 'missing'), { host: 'me@vm', yes: true }, inject(sdk, runner));

    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(local).toHaveLength(0);
  });

  it('--dry-run prints the plan and issues no commands at all', async () => {
    const sdk = makeSdk();
    const { runner, ssh, local } = makeRunner();

    const res = await runAppDataPush('dep1', 'library', localDir, { host: 'me@vm', dryRun: true }, inject(sdk, runner));

    expect(res?.destPath).toBe(LIBRARY.destPath);
    expect(ssh).toHaveLength(0);
    expect(local).toHaveLength(0);
    expect(sdk.deployments.action).not.toHaveBeenCalled();
  });

  // --- mirror confirmation ---------------------------------------------------

  it('a mirror push declined at the prompt transfers nothing', async () => {
    const sdk = makeSdk();
    const { runner, local } = makeRunner();

    const res = await runAppDataPush('dep1', 'library', localDir, { host: 'me@vm' }, inject(sdk, runner, { _confirm: 'false' }));

    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(rsyncCall(local)).toBeUndefined();
    expect(sdk.deployments.action).not.toHaveBeenCalled();
  });

  it('a mirror push confirmed at the prompt proceeds', async () => {
    const sdk = makeSdk();
    const { runner, local } = makeRunner();

    const res = await runAppDataPush('dep1', 'library', localDir, { host: 'me@vm' }, inject(sdk, runner, { _confirm: 'true' }));

    expect(res?.targetId).toBe('library');
    expect(rsyncCall(local)).toBeDefined();
  });

  // --- transfer --------------------------------------------------------------

  it('mirrors with --delete, to the server-supplied destPath, with trailing slashes on both sides', async () => {
    const sdk = makeSdk();
    const { runner, local } = makeRunner();

    await runAppDataPush('dep1', 'library', localDir, { host: 'me@vm', yes: true }, inject(sdk, runner));

    const call = rsyncCall(local)!;
    expect(call.args).toContain('--delete');
    expect(call.args).toContain('-az');
    expect(call.args).toContain('--rsync-path=sudo -n rsync');
    // Source and destination are the last two args, both directory-suffixed.
    expect(call.args.at(-2)).toBe(`${localDir}/`);
    expect(call.args.at(-1)).toBe(`me@vm:${LIBRARY.destPath}/`);
  });

  it('an additive target does not pass --delete', async () => {
    const sdk = makeSdk([MEDIA]);
    const { runner, local } = makeRunner();

    await runAppDataPush('dep1', 'media', localDir, { host: 'me@vm' }, inject(sdk, runner));

    expect(rsyncCall(local)!.args).not.toContain('--delete');
    // additive ⇒ no confirmation prompt was needed to get here.
    expect(process.exitCode).toBe(0);
  });

  it('reads ownership before transferring and restores it after', async () => {
    const sdk = makeSdk();
    const { runner, ssh } = makeRunner();

    await runAppDataPush('dep1', 'library', localDir, { host: 'me@vm', yes: true }, inject(sdk, runner));

    expect(ssh[0]).toContain(`stat -c '%u:%g' '${LIBRARY.destPath}'`);
    expect(ssh.some((c) => c === `sudo -n chown -R 911:911 '${LIBRARY.destPath}'`)).toBe(true);
  });

  it('a failing ownership probe aborts before any bytes move', async () => {
    const sdk = makeSdk();
    const { runner, local } = makeRunner({ statCode: 1 });

    const res = await runAppDataPush('dep1', 'library', localDir, { host: 'me@vm', yes: true }, inject(sdk, runner));

    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(rsyncCall(local)).toBeUndefined();
    // The app was never stopped, so there is nothing to start again.
    expect(sdk.actions).toEqual([]);
  });

  // --- quiesce ---------------------------------------------------------------

  it('stops the app before transferring and starts it after', async () => {
    const sdk = makeSdk();
    const { runner } = makeRunner();

    await runAppDataPush('dep1', 'library', localDir, { host: 'me@vm', yes: true }, inject(sdk, runner));

    expect(sdk.actions).toEqual(['stop', 'start']);
  });

  it('a quiesce:none target is never stopped', async () => {
    const sdk = makeSdk([MEDIA]);
    const { runner } = makeRunner();

    await runAppDataPush('dep1', 'media', localDir, { host: 'me@vm' }, inject(sdk, runner));

    expect(sdk.actions).toEqual([]);
  });

  it('starts the app again even when the transfer fails', async () => {
    const sdk = makeSdk();
    const { runner } = makeRunner({ rsyncCode: 23 });

    const res = await runAppDataPush('dep1', 'library', localDir, { host: 'me@vm', yes: true }, inject(sdk, runner));

    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(sdk.actions).toEqual(['stop', 'start']);
  });

  // --- postHook --------------------------------------------------------------

  it('runs the declared postHook after the transfer', async () => {
    const sdk = makeSdk([{ ...MEDIA, hasPostHook: true }]);
    const { runner } = makeRunner();

    const res = await runAppDataPush('dep1', 'media', localDir, { host: 'me@vm' }, inject(sdk, runner));

    expect(sdk.deployments.pushHook).toHaveBeenCalledWith('dep1', { targetId: 'media' });
    expect(res?.hookRan).toBe(true);
    expect(process.exitCode).toBe(0);
  });

  it('a failing postHook sets a non-zero exit code but still starts the app', async () => {
    const sdk = makeSdk([{ ...LIBRARY, hasPostHook: true }], {
      pushHook: vi.fn(async () => ({ ok: false, output: 'reindex blew up' })),
    });
    const { runner } = makeRunner();

    await runAppDataPush('dep1', 'library', localDir, { host: 'me@vm', yes: true }, inject(sdk, runner));

    expect(process.exitCode).toBe(1);
    expect(sdk.actions).toEqual(['stop', 'start']);
  });

  it('a target with no hook never calls the hook endpoint', async () => {
    const sdk = makeSdk([MEDIA]);
    const { runner } = makeRunner();

    await runAppDataPush('dep1', 'media', localDir, { host: 'me@vm' }, inject(sdk, runner));

    expect(sdk.deployments.pushHook).not.toHaveBeenCalled();
  });
});
