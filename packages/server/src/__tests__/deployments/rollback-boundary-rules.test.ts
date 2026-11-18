/**
 * #584 follow-up: the pure boundary rule as a table. A release in a rollback's
 * range is a one-way boundary only when it declares one (`breaking: true` or
 * `preUpgradeBackup: "required"`) AND its upgrade block (same major) is not the
 * target's own — the catalog copies a major's block onto its patch bumps.
 */
import { describe, test, expect } from 'bun:test';

import { oneWayBoundaries, pickDefaultRollbackTarget, upgradeSignature, type VersionedUpgrade } from '../../services/core/rollback-boundary';

const req = { breaking: true, preUpgradeBackup: 'required' as const };
const rec = { breaking: true, preUpgradeBackup: 'recommended' as const };

describe('oneWayBoundaries', () => {
  const cases: Array<[string, VersionedUpgrade, VersionedUpgrade[], string[]]> = [
    ['uptime-kuma 2.0.3 -> 2.0.2, identical blocks', { version: '2.0.2', upgrade: req }, [{ version: '2.0.3', upgrade: req }], []],
    ['gitea 3.0.0 (required) -> 2.0.2 (recommended)', { version: '2.0.2', upgrade: rec }, [{ version: '3.0.0', upgrade: req }], ['3.0.0']],
    ['multi-hop 2.0.1 -> 1.0.0 across 2.0.0', { version: '1.0.0' }, [{ version: '2.0.0', upgrade: req }, { version: '2.0.1', upgrade: req }], ['2.0.0']],
    ['target with no block vs breaking', { version: '1.0.0' }, [{ version: '1.0.1', upgrade: { breaking: true } }], ['1.0.1']],
    ['same block, different major', { version: '3.0.0', upgrade: req }, [{ version: '4.0.0', upgrade: req }], ['4.0.0']],
    ['recommended only is never a boundary', { version: '1.0.0' }, [{ version: '2.0.0', upgrade: { preUpgradeBackup: 'recommended' } }], []],
    ['copy of the target across a block-less patch', { version: '2.0.2', upgrade: req }, [{ version: '2.0.4' }, { version: '2.0.5', upgrade: req }], []],
    ['a differing minFromVersion is a different migration', { version: '2.0.2', upgrade: req }, [{ version: '2.1.0', upgrade: { ...req, minFromVersion: '2.0.2' } }], ['2.1.0']],
  ];
  for (const [name, target, inRange, expected] of cases) {
    test(name, () => expect(oneWayBoundaries(target, inRange)).toEqual(expected));
  }
});

describe('upgradeSignature', () => {
  test('missing fields equal their defaults; notes URL and waypoint order are ignored', () => {
    expect(upgradeSignature(undefined)).toBe(upgradeSignature({ breaking: false, preUpgradeBackup: 'none', waypoints: [] }));
    expect(upgradeSignature({ ...req, upgradeNotesUrl: 'https://a' })).toBe(upgradeSignature(req));
    expect(upgradeSignature({ waypoints: ['2.0.0', '1.5.0'] })).toBe(upgradeSignature({ waypoints: ['1.5.0', '2.0.0'] }));
  });
});

describe('pickDefaultRollbackTarget', () => {
  const rel = (id: string, day: number, version?: string) => ({ id, createdAt: `2026-11-${String(day).padStart(2, '0')}T00:00:00Z`, version });

  test('upgrade -> rollback -> upgrade again: skips the earlier copy of the active version', () => {
    // r1 2.0.2, r2 3.0.0, (rolled back to r1), r3 3.0.0 active.
    expect(pickDefaultRollbackTarget([rel('r1', 1, '2.0.2'), rel('r2', 2, '3.0.0'), rel('r3', 3, '3.0.0')], 'r3', '3.0.0')).toBe('r1');
  });
  test('plain upgrade: the previous release', () => {
    expect(pickDefaultRollbackTarget([rel('r1', 1, '1.0.0'), rel('r2', 2, '2.0.0')], 'r2', '2.0.0')).toBe('r1');
  });
  test('the most recent differing release wins over an older one', () => {
    expect(pickDefaultRollbackTarget([rel('r1', 1, '1.0.0'), rel('r2', 2, '2.0.0'), rel('r3', 3, '3.0.0')], 'r3', '3.0.0')).toBe('r2');
  });
  test('active version unknown -> newest other release (pre-fix behaviour)', () => {
    expect(pickDefaultRollbackTarget([rel('r1', 1, '2.0.2'), rel('r2', 2, '3.0.0'), rel('r3', 3)], 'r3', undefined)).toBe('r2');
  });
  test('a candidate whose version is unknown counts as different', () => {
    expect(pickDefaultRollbackTarget([rel('r1', 1), rel('r2', 2, '3.0.0'), rel('r3', 3, '3.0.0')], 'r3', '3.0.0')).toBe('r1');
  });
  test('every other release shares the version -> newest other release', () => {
    expect(pickDefaultRollbackTarget([rel('r1', 1, '1.0.0'), rel('r2', 2, '1.0.0')], 'r2', '1.0.0')).toBe('r1');
  });
  test('no other release -> undefined', () => {
    expect(pickDefaultRollbackTarget([rel('r1', 1, '1.0.0')], 'r1', '1.0.0')).toBeUndefined();
  });
});
