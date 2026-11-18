/**
 * #584 follow-up: the pure boundary rule as a table. A release in a rollback's
 * range is a one-way boundary only when it declares one (`breaking: true` or
 * `preUpgradeBackup: "required"`) AND its upgrade block (same major) is not the
 * target's own — the catalog copies a major's block onto its patch bumps.
 */
import { describe, test, expect } from 'bun:test';

import { oneWayBoundaries, upgradeSignature, type VersionedUpgrade } from '../../services/core/rollback-boundary';

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
