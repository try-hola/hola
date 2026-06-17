import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { runDeploymentAction, runRollback } from '../commands/deployments/actions';
import type { HolaSdk } from '@hola/sdk';

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
});
