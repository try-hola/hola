/**
 * Release-channel helpers (#428) — isValidChannelName, isEligibleOnChannel,
 * newestEligibleVersion. Pure @hola/shared helpers, exercised from the server
 * suite (same arrangement as compareVersions/checkUpgradePath — @hola/shared
 * has no test runner of its own).
 */
import { describe, test, expect } from 'bun:test';

import { isValidChannelName, isEligibleOnChannel, newestEligibleVersion, STABLE_CHANNEL } from '@hola/shared';

describe('isValidChannelName', () => {
  test('accepts well-formed lowercase identifiers', () => {
    expect(isValidChannelName('stable')).toBe(true);
    expect(isValidChannelName('rc')).toBe(true);
    expect(isValidChannelName('a')).toBe(true);
    expect(isValidChannelName('release-candidate-2')).toBe(true);
    expect(isValidChannelName('a'.repeat(32))).toBe(true);
  });

  test('rejects uppercase', () => {
    expect(isValidChannelName('RC')).toBe(false);
    expect(isValidChannelName('Stable')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(isValidChannelName('')).toBe(false);
  });

  test('rejects a name longer than 32 characters', () => {
    expect(isValidChannelName('a'.repeat(33))).toBe(false);
  });

  test('rejects a leading digit', () => {
    expect(isValidChannelName('1rc')).toBe(false);
  });

  test('rejects spaces', () => {
    expect(isValidChannelName('bad name')).toBe(false);
  });

  test('rejects non-string values', () => {
    expect(isValidChannelName(undefined)).toBe(false);
    expect(isValidChannelName(null)).toBe(false);
    expect(isValidChannelName(42)).toBe(false);
    expect(isValidChannelName({})).toBe(false);
    expect(isValidChannelName(['rc'])).toBe(false);
  });
});

describe('isEligibleOnChannel', () => {
  test('a version is eligible on its own channel', () => {
    expect(isEligibleOnChannel('rc', 'rc')).toBe(true);
    expect(isEligibleOnChannel('beta', 'beta')).toBe(true);
  });

  test('a stable version is eligible on every channel', () => {
    expect(isEligibleOnChannel('stable', 'stable')).toBe(true);
    expect(isEligibleOnChannel('stable', 'rc')).toBe(true);
    expect(isEligibleOnChannel('stable', 'beta')).toBe(true);
  });

  test('a non-stable version is not eligible on a different channel', () => {
    expect(isEligibleOnChannel('rc', 'stable')).toBe(false);
    expect(isEligibleOnChannel('rc', 'beta')).toBe(false);
  });

  test('there is no ordering among non-stable channels', () => {
    expect(isEligibleOnChannel('beta', 'rc')).toBe(false);
    expect(isEligibleOnChannel('rc', 'beta')).toBe(false);
  });
});

describe('newestEligibleVersion', () => {
  const entries = [
    { version: '1.2.0', channel: 'stable' },
    { version: '1.3.0-rc.1', channel: 'rc' },
    { version: '1.3.0-rc.2', channel: 'rc' },
  ];

  test('resolves the newest stable-eligible entry on the stable channel', () => {
    expect(newestEligibleVersion(entries, 'stable')?.version).toBe('1.2.0');
  });

  test('resolves the newest rc-eligible entry (including stable) on the rc channel', () => {
    expect(newestEligibleVersion(entries, 'rc')?.version).toBe('1.3.0-rc.2');
  });

  test('once a stable release outranks every rc build, both channels resolve to it', () => {
    const withGraduatedStable = [...entries, { version: '1.3.0', channel: 'stable' }];
    expect(newestEligibleVersion(withGraduatedStable, 'stable')?.version).toBe('1.3.0');
    expect(newestEligibleVersion(withGraduatedStable, 'rc')?.version).toBe('1.3.0');
  });

  test('returns undefined for an empty list', () => {
    expect(newestEligibleVersion([], 'stable')).toBeUndefined();
  });

  test('returns undefined when nothing is eligible', () => {
    const onlyRc = [{ version: '1.3.0-rc.1', channel: 'rc' }];
    expect(newestEligibleVersion(onlyRc, 'beta')).toBeUndefined();
  });

  test('a double-digit rc build outranks a single-digit one', () => {
    const rcs = [
      { version: '1.3.0-rc.9', channel: 'rc' },
      { version: '1.3.0-rc.10', channel: 'rc' },
    ];
    expect(newestEligibleVersion(rcs, 'rc')?.version).toBe('1.3.0-rc.10');
    // …and independently of the order the catalog happens to list them in.
    expect(newestEligibleVersion([...rcs].reverse(), 'rc')?.version).toBe('1.3.0-rc.10');
  });

  test('versions with no comparable precedence fall back to list position (last wins)', () => {
    // `main`/`edge` both parse to core 0 with no prerelease tag, so
    // compareVersions rates them equal — the pre-#428 behaviour for a
    // non-semver list was "the catalog's last entry", which this preserves.
    expect(newestEligibleVersion([{ version: 'main' }, { version: 'edge' }])?.version).toBe('edge');
  });

  test('an entry without a channel counts as stable', () => {
    const noChannel = [{ version: '1.0.0' }, { version: '1.1.0-rc.1', channel: 'rc' }];
    expect(newestEligibleVersion(noChannel, 'stable')?.version).toBe('1.0.0');
    expect(newestEligibleVersion(noChannel, 'rc')?.version).toBe('1.1.0-rc.1');
  });

  test('defaults to the stable channel when none is given', () => {
    expect(newestEligibleVersion(entries)?.version).toBe('1.2.0');
    expect(newestEligibleVersion(entries)?.channel).toBe(STABLE_CHANNEL);
  });
});
