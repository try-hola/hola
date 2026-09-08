import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { HolaSdk } from '@hola/sdk';

import { runSettingsPrerelease } from '../commands/settings/prerelease';

function makeSdk(showPrerelease: boolean) {
  return {
    settings: {
      get: vi.fn(async () => ({ systemEnv: [], channels: { showPrerelease } })),
      update: vi.fn(async (data: unknown) => ({ systemEnv: [], ...(data as object) })),
    },
  };
}

describe('hola settings prerelease', () => {
  let logs: string[];
  beforeEach(() => {
    process.exitCode = 0;
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => { logs.push(String(m)); });
    vi.spyOn(console, 'error').mockImplementation((m?: unknown) => { logs.push(String(m)); });
  });
  afterEach(() => { vi.restoreAllMocks(); process.exitCode = 0; });

  it('no value: reads settings and prints off', async () => {
    const sdk = makeSdk(false);
    await runSettingsPrerelease(undefined, {}, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.settings.get).toHaveBeenCalled();
    expect(sdk.settings.update).not.toHaveBeenCalled();
    expect(logs).toContain('Show pre-release channels: off');
  });

  it('no value: reads settings and prints on', async () => {
    const sdk = makeSdk(true);
    await runSettingsPrerelease(undefined, {}, { sdk: sdk as unknown as HolaSdk });
    expect(logs).toContain('Show pre-release channels: on');
  });

  it('"on": patches channels.showPrerelease true and echoes on', async () => {
    const sdk = makeSdk(false);
    await runSettingsPrerelease('on', {}, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.settings.update).toHaveBeenCalledWith({ channels: { showPrerelease: true } });
    expect(sdk.settings.get).not.toHaveBeenCalled();
    expect(logs).toContain('Show pre-release channels: on');
  });

  it('"off": patches channels.showPrerelease false and echoes off', async () => {
    const sdk = makeSdk(true);
    await runSettingsPrerelease('off', {}, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.settings.update).toHaveBeenCalledWith({ channels: { showPrerelease: false } });
    expect(logs).toContain('Show pre-release channels: off');
  });

  it('any other value prints the usage line and sets exit code 1 without calling the SDK', async () => {
    const sdk = makeSdk(false);
    await runSettingsPrerelease('maybe', {}, { sdk: sdk as unknown as HolaSdk });
    expect(logs.join('\n')).toContain('Usage: hola settings prerelease [on|off]');
    expect(process.exitCode).toBe(1);
    expect(sdk.settings.get).not.toHaveBeenCalled();
    expect(sdk.settings.update).not.toHaveBeenCalled();
  });
});
