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
function makeRunner(
  over: {
    statCode?: number;
    rsyncCode?: number;
    /** Make `chown` fail. `signal` reproduces #459: killed child, so the runner
     *  reports code 1 with nothing on either stream. */
    chown?: { code: number; stderr?: string; signal?: NodeJS.Signals };
    /** Ownership the re-probe reports after a failed chown (default: unchanged). */
    ownershipAfter?: string;
  } = {},
) {
  const ssh: string[] = [];
  const local: Array<{ cmd: string; args: string[] }> = [];
  let statCalls = 0;
  return {
    ssh,
    local,
    runner: {
      ssh: vi.fn(async (_host: string, cmd: string) => {
        ssh.push(cmd);
        if (cmd.includes('stat -c')) {
          statCalls += 1;
          // The second stat is the post-chown verification.
          if (statCalls > 1 && over.ownershipAfter !== undefined) {
            return { code: 0, stdout: `${over.ownershipAfter}\n`, stderr: '' };
          }
          return { code: over.statCode ?? 0, stdout: over.statCode ? '' : '911:911\n', stderr: over.statCode ? 'no such file' : '' };
        }
        if (cmd.includes('chown') && over.chown) {
          return { code: over.chown.code, stdout: '', stderr: over.chown.stderr ?? '', signal: over.chown.signal ?? null };
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
// --- ownership restore (#459) ----------------------------------------------

  it('a failed chown does not abort the push when the ownership is actually right', async () => {
    // The real case: rsync ran as root with -a, so the files already landed
    // owned correctly; only the chown call itself failed (silently killed ssh).
    const sdk = makeSdk([{ ...LIBRARY, hasPostHook: true }]);
    const { runner } = makeRunner({ chown: { code: 1, signal: 'SIGHUP' }, ownershipAfter: '911:911' });

    const res = await runAppDataPush('dep1', 'library', localDir, { host: 'me@vm', yes: true }, inject(sdk, runner));

    expect(res).toBeDefined();
    expect(process.exitCode).toBe(0);
    // The post-push hook is the thing the old abort threw away.
    expect(sdk.deployments.pushHook).toHaveBeenCalledWith('dep1', { targetId: 'library' });
    expect(sdk.actions).toEqual(['stop', 'start']);
  });

  it('reports the signal when a killed ssh leaves nothing on either stream', async () => {
    const sdk = makeSdk();
    const { runner } = makeRunner({ chown: { code: 1, signal: 'SIGHUP' }, ownershipAfter: '911:911' });
    const logged: string[] = [];
    (console.log as unknown as ReturnType<typeof vi.fn>).mockImplementation((m: string) => { logged.push(String(m)); });

    await runAppDataPush('dep1', 'library', localDir, { host: 'me@vm', yes: true }, inject(sdk, runner));

    expect(logged.join('\n')).toContain('SIGHUP');
  });

  it('a genuinely wrong ownership is reported, with the fix, but still starts the app', async () => {
    const sdk = makeSdk([{ ...LIBRARY, hasPostHook: true }]);
    const { runner } = makeRunner({ chown: { code: 1, stderr: 'chown: operation not permitted' }, ownershipAfter: '0:0' });
    const errors: string[] = [];
    (console.error as unknown as ReturnType<typeof vi.fn>).mockImplementation((m: string) => { errors.push(String(m)); });

    await runAppDataPush('dep1', 'library', localDir, { host: 'me@vm', yes: true }, inject(sdk, runner));

    const said = errors.join('\n');
    expect(said).toContain('operation not permitted');
    expect(said).toContain('is now 0:0');
    expect(said).toContain('sudo chown -R 911:911');
    expect(process.exitCode).toBe(1);
    // Still finished the job rather than leaving the app stopped mid-push.
    expect(sdk.deployments.pushHook).toHaveBeenCalled();
    expect(sdk.actions).toEqual(['stop', 'start']);
  });
});
