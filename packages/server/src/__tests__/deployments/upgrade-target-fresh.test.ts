/**
 * Resolving an upgrade target against a cached catalog (#464).
 *
 * `latestVersion` is derived from the cached catalog index (24h refresh
 * interval by default), so "there is nothing newer" is indistinguishable from
 * "we haven't looked recently". These pin the retry: refresh once, but only on
 * the path where the answer would otherwise be "nothing to do".
 */

import { describe, test, expect } from 'bun:test';
import type { GetDeploymentResponse } from '@hola/shared';

import { resolveUpgradeTargetFresh } from '../../services/core/upgrade-target';

type Deployments = Parameters<typeof resolveUpgradeTargetFresh>[0]['deployments'];
type Catalog = Parameters<typeof resolveUpgradeTargetFresh>[0]['catalog'];

const detailFor = (version: string, latestVersion?: string): GetDeploymentResponse =>
  ({ id: 'dep1', app: 'calibre-web', version, latestVersion, channel: 'stable' }) as unknown as GetDeploymentResponse;

/**
 * Stub whose catalog view changes when refreshed — the whole point of the
 * retry. `latestAfterRefresh` is what a fresh index would report.
 */
function makeServices(opts: { installed: string; latestCached?: string; latestAfterRefresh?: string; refreshThrows?: boolean }) {
  const calls = { resolves: [] as Array<string | undefined>, refreshes: 0, reads: 0 };
  let latest = opts.latestCached;
  const deployments = {
    resolveUpgradeTarget: async (_id: string, requested?: string, options?: { detail?: GetDeploymentResponse }) => {
      calls.resolves.push(requested);
      return { version: requested ?? options?.detail?.latestVersion, channel: 'stable' };
    },
    getDeployment: async () => {
      calls.reads += 1;
      return detailFor(opts.installed, latest);
    },
  } as unknown as Deployments;
  const catalog = {
    refresh: async () => {
      calls.refreshes += 1;
      if (opts.refreshThrows) throw new Error('catalog unreachable');
      latest = opts.latestAfterRefresh;
      return [];
    },
  } as unknown as Catalog;
  return { services: { deployments, catalog }, calls };
}

describe('resolveUpgradeTargetFresh', () => {
  test('a real update needs no refresh — the common path stays free', async () => {
    const { services, calls } = makeServices({ installed: '1.2.1', latestCached: '1.2.2' });
    const res = await resolveUpgradeTargetFresh(services, 'dep1', undefined, detailFor('1.2.1', '1.2.2'));
    expect(res.version).toBe('1.2.2');
    expect(res.refreshed).toBe(false);
    expect(calls.refreshes).toBe(0);
  });

  test('a stale cache that hides a new version is refreshed and re-resolved (#464)', async () => {
    // Exactly the calibre-web case: 1.2.2 published minutes ago, cache says 1.2.1.
    const { services, calls } = makeServices({ installed: '1.2.1', latestCached: '1.2.1', latestAfterRefresh: '1.2.2' });
    const res = await resolveUpgradeTargetFresh(services, 'dep1', undefined, detailFor('1.2.1', '1.2.1'));
    expect(res.version).toBe('1.2.2');
    expect(res.refreshed).toBe(true);
    expect(calls.refreshes).toBe(1);
    // The second resolution must use the RE-READ detail, not the stale one.
    expect(res.detail.latestVersion).toBe('1.2.2');
  });

  test('genuinely up to date: refreshed once, still nothing newer', async () => {
    const { services, calls } = makeServices({ installed: '1.2.2', latestCached: '1.2.2', latestAfterRefresh: '1.2.2' });
    const res = await resolveUpgradeTargetFresh(services, 'dep1', undefined, detailFor('1.2.2', '1.2.2'));
    expect(res.version).toBe('1.2.2');
    expect(calls.refreshes).toBe(1);
  });

  test('no known latest at all also triggers the refresh', async () => {
    const { services, calls } = makeServices({ installed: '1.0.0', latestCached: undefined, latestAfterRefresh: '1.1.0' });
    const res = await resolveUpgradeTargetFresh(services, 'dep1', undefined, detailFor('1.0.0', undefined));
    expect(res.version).toBe('1.1.0');
    expect(calls.refreshes).toBe(1);
  });

  test('an explicitly requested version never refreshes — including the one already running', async () => {
    const { services, calls } = makeServices({ installed: '1.2.1', latestCached: '1.2.1' });
    const res = await resolveUpgradeTargetFresh(services, 'dep1', '1.2.1', detailFor('1.2.1', '1.2.1'));
    expect(res.version).toBe('1.2.1');
    expect(calls.refreshes).toBe(0);
    expect(res.refreshed).toBe(false);
  });

  test('an unreachable catalog degrades to the cached answer rather than failing', async () => {
    const { services, calls } = makeServices({ installed: '1.2.1', latestCached: '1.2.1', refreshThrows: true });
    const res = await resolveUpgradeTargetFresh(services, 'dep1', undefined, detailFor('1.2.1', '1.2.1'));
    expect(res.version).toBe('1.2.1');
    expect(res.refreshed).toBe(false);
    expect(calls.refreshes).toBe(1);
  });

  test('reports why it refreshed, for the log line', async () => {
    const reasons: string[] = [];
    const { services } = makeServices({ installed: '1.2.1', latestCached: '1.2.1', latestAfterRefresh: '1.2.2' });
    await resolveUpgradeTargetFresh(services, 'dep1', undefined, detailFor('1.2.1', '1.2.1'), (r) => reasons.push(r));
    expect(reasons[0]).toContain('equals the installed version');
  });
});
