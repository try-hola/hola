/**
 * Update-check service + shared version comparison.
 *
 * The service does a cached, fail-safe GitHub release lookup. We drive it with an
 * injected `fetch` and clock so there's no real network or wall-clock dependency.
 */

import { describe, it, expect, vi } from 'vitest';
import { compareVersions, isNewerVersion } from '@hola/shared';
import { RealUpdateCheckService } from '../../services/core/update-check';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const RELEASES = [
  { tag_name: 'cli-v0.6.25', html_url: 'https://gh/0.6.25', draft: false, prerelease: false },
  { tag_name: 'cli-v0.7.0-rc.1', html_url: 'https://gh/0.7.0rc', draft: false, prerelease: true },
  { tag_name: 'cli-v0.6.20', html_url: 'https://gh/0.6.20', draft: false, prerelease: false },
  { tag_name: 'cli-v0.9.0', html_url: 'https://gh/0.9.0', draft: true, prerelease: false },
  { tag_name: 'v-not-a-cli-tag', html_url: 'https://gh/x', draft: false, prerelease: false },
];

describe('compareVersions / isNewerVersion', () => {
  it('orders numeric cores correctly', () => {
    expect(compareVersions('0.6.23', '0.6.20')).toBeGreaterThan(0);
    expect(compareVersions('0.6.2', '0.6.20')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareVersions('0.6.23', '0.6.23')).toBe(0);
  });

  it('treats a release as newer than its prerelease', () => {
    expect(isNewerVersion('1.2.0', '1.2.0-rc.1')).toBe(true);
    expect(isNewerVersion('1.2.0-rc.1', '1.2.0')).toBe(false);
  });

  it('tolerates leading v / cli-v and differing segment counts', () => {
    expect(compareVersions('cli-v0.6.23', 'v0.6.23')).toBe(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });
});

describe('RealUpdateCheckService', () => {
  it('reports an available update for the newest stable cli-v release', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(RELEASES));
    const svc = new RealUpdateCheckService('0.6.20', { fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await svc.check();
    expect(res).toEqual({
      current: '0.6.20',
      latest: '0.6.25', // skips the prerelease 0.7.0-rc.1 and the draft 0.9.0
      updateAvailable: true,
      releaseUrl: 'https://gh/0.6.25',
    });
  });

  it('reports up-to-date when current >= newest release', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(RELEASES));
    const svc = new RealUpdateCheckService('0.6.25', { fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await svc.check();
    expect(res.updateAvailable).toBe(false);
    expect(res.latest).toBe('0.6.25');
  });

  it('caches the result within the TTL (one outbound call)', async () => {
    let t = 1000;
    const fetchImpl = vi.fn(async () => jsonResponse(RELEASES));
    const svc = new RealUpdateCheckService('0.6.20', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      ttlMs: 60_000,
      now: () => t,
    });
    await svc.check();
    t += 30_000; // still within TTL
    await svc.check();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    t += 40_000; // past TTL → refetch
    await svc.check();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('is fail-safe on a network error', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
    const svc = new RealUpdateCheckService('0.6.20', { fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await svc.check();
    expect(res).toEqual({ current: '0.6.20', latest: null, updateAvailable: false, releaseUrl: null });
  });

  it('is fail-safe on a non-OK response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 403));
    const svc = new RealUpdateCheckService('0.6.20', { fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await svc.check();
    expect(res.updateAvailable).toBe(false);
    expect(res.latest).toBeNull();
  });
});
