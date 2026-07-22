import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { runConfig } from '../commands/deployments/config';
import type { HolaSdk } from '@hola/sdk';

function makeSdk(overrides: { deployments?: Record<string, unknown>; jobs?: Record<string, unknown> } = {}) {
  return {
    deployments: {
      update: vi.fn(async () => ({ ok: true, jobId: 'j1' })),
      config: vi.fn(async () => ({
        appEnv: [
          { key: 'MAX_CONNECTIONS', value: '10', isSecret: false },
          { key: 'API_TOKEN', value: 'sekret', isSecret: true },
        ],
        systemOverrides: { CUSTOM_DOMAIN: 'app.example.com' },
      })),
      ...(overrides.deployments ?? {}),
    },
    jobs: { byId: vi.fn(async () => ({ status: 'completed' })), ...(overrides.jobs ?? {}) },
  };
}

describe('hola config', () => {
  beforeEach(() => {
    process.exitCode = 0;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); process.exitCode = 0; });

  it('with no --set/--unset reads and prints the current config (masking secrets)', async () => {
    const sdk = makeSdk();
    const logs: string[] = [];
    (console.log as unknown as ReturnType<typeof vi.fn>).mockImplementation((m: string) => { logs.push(m); });

    await runConfig('dep1', {}, { sdk: sdk as unknown as HolaSdk });

    expect(sdk.deployments.config).toHaveBeenCalledWith('dep1');
    expect(sdk.deployments.update).not.toHaveBeenCalled();
    expect(logs).toContain('MAX_CONNECTIONS=10');
    expect(logs).toContain('API_TOKEN=***'); // secret masked
  });

  it('--set sends an env upsert (isSecret:false; server re-imposes spec) and watches the restart', async () => {
    const sdk = makeSdk();
    await runConfig('dep1', { set: 'LOG_LEVEL=debug', noStream: true }, { sdk: sdk as unknown as HolaSdk });

    expect(sdk.deployments.update).toHaveBeenCalledWith('dep1', {
      env: [{ key: 'LOG_LEVEL', value: 'debug', isSecret: false }],
    });
    expect(sdk.jobs.byId).toHaveBeenCalledWith('j1');
    expect(sdk.deployments.config).not.toHaveBeenCalled();
  });

  it('preserves = signs in the value and trims the key', async () => {
    const sdk = makeSdk();
    await runConfig('dep1', { set: ' DATABASE_URL =postgres://u:p@h/db?x=1', noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.deployments.update).toHaveBeenCalledWith('dep1', {
      env: [{ key: 'DATABASE_URL', value: 'postgres://u:p@h/db?x=1', isSecret: false }],
    });
  });

  it('--unset sends removeEnvKeys', async () => {
    const sdk = makeSdk();
    await runConfig('dep1', { unset: 'OLD_FLAG', noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.deployments.update).toHaveBeenCalledWith('dep1', { removeEnvKeys: ['OLD_FLAG'] });
  });

  it('combines multiple --set and --unset into one PATCH', async () => {
    const sdk = makeSdk();
    await runConfig(
      'dep1',
      { set: ['A=1', 'B=2'], unset: ['C', 'D'], noStream: true },
      { sdk: sdk as unknown as HolaSdk },
    );
    expect(sdk.deployments.update).toHaveBeenCalledWith('dep1', {
      env: [
        { key: 'A', value: '1', isSecret: false },
        { key: 'B', value: '2', isSecret: false },
      ],
      removeEnvKeys: ['C', 'D'],
    });
  });

  it('rejects a --set without = and does not call the API', async () => {
    const sdk = makeSdk();
    const res = await runConfig('dep1', { set: 'NOEQUALS', noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(res).toBeUndefined();
    expect(sdk.deployments.update).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('sets exit code 1 when the restart job fails', async () => {
    const sdk = makeSdk({ jobs: { byId: vi.fn(async () => ({ status: 'failed' })) } });
    await runConfig('dep1', { set: 'A=1', noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(process.exitCode).toBe(1);
  });
});
