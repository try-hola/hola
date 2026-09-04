import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { runDeploymentAction, runRollback, runUninstall, runUpgrade } from '../commands/deployments/actions';
import type { HolaSdk } from '@hola/sdk';
import { scriptedPrompter } from '../install/prompter';

function makeSdk(overrides: { deployments?: Record<string, unknown>; jobs?: Record<string, unknown> } = {}) {
  const calls: string[] = [];
  return {
    calls,
    deployments: {
      action: vi.fn(async () => { calls.push('action'); return { ok: true, jobId: 'j1' }; }),
      rollback: vi.fn(async () => {
        calls.push('rollback');
        return { jobId: 'j1', targetReleaseId: 'r0', previousReleaseId: 'r1' };
      }),
      promote: vi.fn(async () => { calls.push('promote'); return { deploymentId: 'dep1', releaseId: 'r2', jobId: 'j1' }; }),
      byId: vi.fn(async () => { calls.push('byId'); return { id: 'dep1', name: 'Gitea' }; }),
      delete: vi.fn(async () => { calls.push('delete'); }),
      ...(overrides.deployments ?? {}),
    },
    jobs: { byId: vi.fn(async () => ({ status: 'completed' })), ...(overrides.jobs ?? {}) },
  };
}

describe('deployment lifecycle actions', () => {
  beforeEach(() => {
    process.exitCode = 0;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); process.exitCode = 0; });

  it('stop calls the action endpoint with action=stop and watches the job', async () => {
    const sdk = makeSdk();
    const res = await runDeploymentAction('stop', 'dep1', { noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.deployments.action).toHaveBeenCalledWith('dep1', { action: 'stop' });
    expect(sdk.jobs.byId).toHaveBeenCalledWith('j1');
    expect(res?.status).toBe('completed');
    expect(process.exitCode).toBe(0);
  });

  it('restart calls the action endpoint with action=restart', async () => {
    const sdk = makeSdk();
    await runDeploymentAction('restart', 'dep1', { noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.deployments.action).toHaveBeenCalledWith('dep1', { action: 'restart' });
  });

  it('sets exit code 1 when the action job fails', async () => {
    const sdk = makeSdk({ jobs: { byId: vi.fn(async () => ({ status: 'failed' })) } });
    await runDeploymentAction('stop', 'dep1', { noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(process.exitCode).toBe(1);
  });

  it('reports a friendly error and exits 1 when the action throws', async () => {
    const sdk = makeSdk({
      deployments: { action: vi.fn(async () => { throw new Error('HTTP 401 Unauthorized'); }) },
    });
    const res = await runDeploymentAction('stop', 'dep1', { noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(1);
  });

  it('rollback passes --to and --reason through to the rollback endpoint', async () => {
    const sdk = makeSdk();
    const res = await runRollback('dep1', { to: 'r0', reason: 'bad deploy', noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.deployments.rollback).toHaveBeenCalledWith('dep1', { targetReleaseId: 'r0', reason: 'bad deploy' });
    expect(res?.targetReleaseId).toBe('r0');
    expect(process.exitCode).toBe(0);
  });

  it('rollback without --to omits targetReleaseId (server uses the previous release)', async () => {
    const sdk = makeSdk();
    await runRollback('dep1', { noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.deployments.rollback).toHaveBeenCalledWith('dep1', {});
  });

  it('uninstall deletes after confirmation', async () => {
    const sdk = makeSdk();
    const res = await runUninstall('dep1', {}, {
      sdk: sdk as unknown as HolaSdk,
      prompter: scriptedPrompter({ confirm: 'true' }),
    });
    expect(sdk.deployments.byId).toHaveBeenCalledWith('dep1');
    expect(sdk.deployments.delete).toHaveBeenCalledWith('dep1');
    expect(res?.uninstalled).toBe('dep1');
    expect(process.exitCode).toBe(0);
  });

  it('uninstall aborts (no delete) when the confirmation is declined', async () => {
    const sdk = makeSdk();
    const res = await runUninstall('dep1', {}, {
      sdk: sdk as unknown as HolaSdk,
      prompter: scriptedPrompter({ confirm: 'false' }),
    });
    expect(sdk.deployments.delete).not.toHaveBeenCalled();
    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(0);
  });

  it('uninstall --yes skips the prompt and deletes', async () => {
    const sdk = makeSdk();
    await runUninstall('dep1', { yes: true }, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.deployments.delete).toHaveBeenCalledWith('dep1');
  });

  it('upgrade passes --app-version through to promote', async () => {
    const sdk = makeSdk();
    const res = await runUpgrade('dep1', { appVersion: '1.3.0', noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.deployments.promote).toHaveBeenCalledWith('dep1', { version: '1.3.0' });
    expect(res?.deploymentId).toBe('dep1');
    expect(process.exitCode).toBe(0);
  });

  // #428: no new CLI flag for channels — the server's default upgrade target is
  // already channel-filtered, and an explicit --app-version outside the
  // deployment's channel comes back as the server's VERSION_NOT_ON_CHANNEL
  // message, printed verbatim (with its PATCH hint) through the existing
  // reportDeployError path.
  it('upgrade surfaces the server\'s VERSION_NOT_ON_CHANNEL message verbatim and exits 1', async () => {
    const message =
      "Version 1.3.0-rc.1 is on channel 'rc'; deployment dep1 follows 'stable'. " +
      'Change the deployment\'s channel first (dashboard → Channel, or PATCH /api/deployments/dep1 {"channel":"rc"}), then upgrade.';
    const sdk = makeSdk({
      deployments: { promote: vi.fn(async () => { throw new Error(message); }) },
    });
    const res = await runUpgrade('dep1', { appVersion: '1.3.0-rc.1', noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(message));
  });

  it('uninstall fails fast (exit 1, no delete) on an unknown deployment', async () => {
    const sdk = makeSdk({
      deployments: { byId: vi.fn(async () => { throw new Error('HTTP 404 Not Found'); }) },
    });
    const res = await runUninstall('nope', { yes: true }, { sdk: sdk as unknown as HolaSdk });
    expect(res).toBeUndefined();
    expect(sdk.deployments.delete).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
