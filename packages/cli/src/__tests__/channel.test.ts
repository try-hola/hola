import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { HolaApiError } from '@hola/sdk';
import type { HolaSdk } from '@hola/sdk';

import { runChannel } from '../commands/deployments/channel';

type Detail = { id: string; name: string; app: string; icon: string; status: string; version?: string; channel?: string; versionChannel?: string };

function makeSdk(opts: { byId: Detail | Detail[]; update?: (id: string, data: unknown) => unknown }) {
  const byIdSequence = Array.isArray(opts.byId) ? [...opts.byId] : undefined;
  return {
    deployments: {
      byId: vi.fn(async () => (byIdSequence ? byIdSequence.shift() : opts.byId)),
      update: vi.fn(opts.update ?? (async () => ({ ok: true }))),
    },
  };
}

describe('hola channel', () => {
  let logs: string[];
  beforeEach(() => {
    process.exitCode = 0;
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => { logs.push(String(m)); });
    vi.spyOn(console, 'error').mockImplementation((m?: unknown) => { logs.push(String(m)); });
  });
  afterEach(() => { vi.restoreAllMocks(); process.exitCode = 0; });

  it('show: prints Follows and Running with the build channel when known', async () => {
    const sdk = makeSdk({ byId: { id: 'dep-1', name: 'gitea', app: 'gitea', icon: '🍵', status: 'running', version: '1.2.0', channel: 'stable', versionChannel: 'stable' } });
    await runChannel('dep-1', undefined, {}, { sdk: sdk as unknown as HolaSdk });
    expect(logs).toContain('Follows: stable');
    expect(logs).toContain('Running: 1.2.0 (stable build)');
  });

  it('show: prints Running with no parenthetical when versionChannel is unknown', async () => {
    const sdk = makeSdk({ byId: { id: 'dep-1', name: 'gitea', app: 'gitea', icon: '🍵', status: 'running', version: '1.2.0', channel: 'stable' } });
    await runChannel('dep-1', undefined, {}, { sdk: sdk as unknown as HolaSdk });
    expect(logs).toContain('Follows: stable');
    expect(logs).toContain('Running: 1.2.0');
    expect(logs).not.toContain('Running: 1.2.0 (stable build)');
  });

  it('set: calls sdk.deployments.update with the new channel and prints Now follows', async () => {
    const sdk = makeSdk({
      byId: { id: 'dep-1', name: 'gitea', app: 'gitea', icon: '🍵', status: 'running', version: '1.3.0-beta.1', channel: 'beta', versionChannel: 'beta' },
    });
    await runChannel('dep-1', 'beta', {}, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.deployments.update).toHaveBeenCalledWith('dep-1', { channel: 'beta' });
    expect(logs).toContain('Now follows: beta');
  });

  it('prints a Warning: line for each warnings[] entry from the update response', async () => {
    const sdk = makeSdk({
      byId: { id: 'dep-1', name: 'gitea', app: 'gitea', icon: '🍵', status: 'running', version: '1.2.0', channel: 'beta', versionChannel: 'stable' },
      update: async () => ({ ok: true, warnings: ['another single-instance copy already follows beta'] }),
    });
    await runChannel('dep-1', 'beta', {}, { sdk: sdk as unknown as HolaSdk });
    expect(logs).toContain('Warning: another single-instance copy already follows beta');
  });

  it('setting to stable when the re-read detail is still on a beta build prints the stays-on sentence', async () => {
    const sdk = makeSdk({
      byId: { id: 'dep-1', name: 'gitea', app: 'gitea', icon: '🍵', status: 'running', version: '1.3.0-beta.1', channel: 'stable', versionChannel: 'beta' },
    });
    await runChannel('dep-1', 'stable', {}, { sdk: sdk as unknown as HolaSdk });
    expect(logs).toContain('Now follows: stable');
    expect(logs).toContain('Stays on 1.3.0-beta.1 until a stable release at or above it is published.');
  });

  it('does not print the stays-on sentence when the re-read version is already eligible on the new channel', async () => {
    const sdk = makeSdk({
      byId: { id: 'dep-1', name: 'gitea', app: 'gitea', icon: '🍵', status: 'running', version: '1.2.0', channel: 'beta', versionChannel: 'stable' },
    });
    await runChannel('dep-1', 'beta', {}, { sdk: sdk as unknown as HolaSdk });
    expect(logs.some(l => l.startsWith('Stays on'))).toBe(false);
  });

  it('--json prints the JSON detail instead of the formatted text (show)', async () => {
    const detail = { id: 'dep-1', name: 'gitea', app: 'gitea', icon: '🍵', status: 'running', version: '1.2.0', channel: 'stable', versionChannel: 'stable' };
    const sdk = makeSdk({ byId: detail });
    await runChannel('dep-1', undefined, { json: true }, { sdk: sdk as unknown as HolaSdk });
    expect(logs).not.toContain('Follows: stable');
    const parsed = JSON.parse(logs.join(''));
    expect(parsed).toMatchObject({ id: 'dep-1', channel: 'stable' });
  });

  it('--json prints the JSON detail instead of the formatted text (set)', async () => {
    const detail = { id: 'dep-1', name: 'gitea', app: 'gitea', icon: '🍵', status: 'running', version: '1.3.0-beta.1', channel: 'beta', versionChannel: 'beta' };
    const sdk = makeSdk({ byId: detail });
    await runChannel('dep-1', 'beta', { json: true }, { sdk: sdk as unknown as HolaSdk });
    expect(logs).not.toContain('Now follows: beta');
    const parsed = JSON.parse(logs.join(''));
    expect(parsed).toMatchObject({ id: 'dep-1', channel: 'beta' });
  });

  it('a HolaApiError from the update call prints Failed: <message> and sets a non-zero exit code', async () => {
    const sdk = {
      deployments: {
        byId: vi.fn(async () => ({ id: 'dep-1', name: 'gitea', app: 'gitea', icon: '🍵', status: 'running', version: '1.2.0', channel: 'stable' })),
        update: vi.fn(async () => { throw new HolaApiError("channel 'nope' is not a valid channel name", 400, { code: 'INVALID_CHANNEL' }); }),
      },
    };
    await runChannel('dep-1', 'nope', {}, { sdk: sdk as unknown as HolaSdk });
    expect(logs.join('\n')).toContain("Failed: channel 'nope' is not a valid channel name");
    expect(process.exitCode).toBe(1);
  });
});
