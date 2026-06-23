import { describe, it, expect, vi, afterEach } from 'vitest';

import { updateNoticeLine, maybeNotifyUpdate } from '../lib/update-notice';
import { CLI_VERSION } from '../version';
import type { HolaSdk } from '@hola/sdk';

function fakeSdk(updateCheck: () => Promise<unknown>): HolaSdk {
  return { system: { updateCheck } } as unknown as HolaSdk;
}

describe('updateNoticeLine', () => {
  it('announces a newer release when one is available', () => {
    const line = updateNoticeLine({ current: '0.6.20', latest: '0.6.25', updateAvailable: true, releaseUrl: null });
    expect(line).toContain('0.6.25');
    expect(line).toContain('hola update');
  });

  it('flags CLI↔server skew when the CLI is ahead and no newer release exists', () => {
    const line = updateNoticeLine({ current: '0.0.1', latest: '0.0.1', updateAvailable: false, releaseUrl: null });
    expect(line).toContain('newer than the server');
    expect(line).toContain('hola update');
  });

  it('says nothing when the CLI matches the server and no update is available', () => {
    const line = updateNoticeLine({ current: CLI_VERSION, latest: CLI_VERSION, updateAvailable: false, releaseUrl: null });
    expect(line).toBeNull();
  });
});

describe('maybeNotifyUpdate', () => {
  afterEach(() => { delete process.env.HOLA_NO_UPDATE_NOTICE; vi.restoreAllMocks(); });

  it('does not call the server under --json', async () => {
    const updateCheck = vi.fn(async () => ({ current: '0.6.20', latest: '0.6.25', updateAvailable: true, releaseUrl: null }));
    await maybeNotifyUpdate(fakeSdk(updateCheck), { json: true });
    expect(updateCheck).not.toHaveBeenCalled();
  });

  it('respects HOLA_NO_UPDATE_NOTICE', async () => {
    process.env.HOLA_NO_UPDATE_NOTICE = '1';
    const updateCheck = vi.fn(async () => ({ current: '0.6.20', latest: '0.6.25', updateAvailable: true, releaseUrl: null }));
    await maybeNotifyUpdate(fakeSdk(updateCheck), {});
    expect(updateCheck).not.toHaveBeenCalled();
  });

  it('prints a notice to stderr when an update is available', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const updateCheck = vi.fn(async () => ({ current: '0.6.20', latest: '0.6.25', updateAvailable: true, releaseUrl: null }));
    await maybeNotifyUpdate(fakeSdk(updateCheck), {});
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).toContain('0.6.25');
  });

  it('swallows server errors without throwing', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const updateCheck = vi.fn(async () => { throw new Error('network down'); });
    await expect(maybeNotifyUpdate(fakeSdk(updateCheck), {})).resolves.toBeUndefined();
    expect(err).not.toHaveBeenCalled();
  });

  it('is silent when there is nothing to report', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const updateCheck = vi.fn(async () => ({ current: CLI_VERSION, latest: CLI_VERSION, updateAvailable: false, releaseUrl: null }));
    await maybeNotifyUpdate(fakeSdk(updateCheck), {});
    expect(err).not.toHaveBeenCalled();
  });
});
