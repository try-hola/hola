/**
 * coerceManifestUpgrade — narrow-shape coercion of the bundle manifest's
 * optional `upgrade` block (#284 Phase 0). Mirrors the manifest-auth coercion
 * tests: malformed/unknown fields are dropped, and an all-empty block degrades
 * to undefined (the app then has no upgrade restrictions).
 */
import { describe, test, expect } from 'bun:test';

import { coerceManifestUpgrade } from '../../services/core/manifest-upgrade';

describe('coerceManifestUpgrade', () => {
  test('returns undefined for non-objects', () => {
    expect(coerceManifestUpgrade(undefined)).toBeUndefined();
    expect(coerceManifestUpgrade(null)).toBeUndefined();
    expect(coerceManifestUpgrade('breaking')).toBeUndefined();
    expect(coerceManifestUpgrade(['1.0.0'])).toBeUndefined();
  });

  test('returns undefined when no field survives coercion', () => {
    expect(coerceManifestUpgrade({})).toBeUndefined();
    // breaking must be exactly true; falsey/odd values are dropped.
    expect(coerceManifestUpgrade({ breaking: false })).toBeUndefined();
    expect(coerceManifestUpgrade({ breaking: 'yes' })).toBeUndefined();
    // empty/blank strings and arrays don't count.
    expect(coerceManifestUpgrade({ minFromVersion: '   ', waypoints: [] })).toBeUndefined();
    // unknown preUpgradeBackup value is dropped.
    expect(coerceManifestUpgrade({ preUpgradeBackup: 'maybe' })).toBeUndefined();
  });

  test('carries a full, valid block', () => {
    expect(
      coerceManifestUpgrade({
        breaking: true,
        minFromVersion: '1.107.2',
        waypoints: ['1.132.3', '1.135.0'],
        upgradeNotesUrl: 'https://example.com/notes',
        preUpgradeBackup: 'required',
      }),
    ).toEqual({
      breaking: true,
      minFromVersion: '1.107.2',
      waypoints: ['1.132.3', '1.135.0'],
      upgradeNotesUrl: 'https://example.com/notes',
      preUpgradeBackup: 'required',
    });
  });

  test('trims strings and filters non-string waypoints', () => {
    expect(
      coerceManifestUpgrade({ minFromVersion: '  2.0.0 ', waypoints: ['  1.5.0 ', 42, '', '1.8.0'] }),
    ).toEqual({ minFromVersion: '2.0.0', waypoints: ['1.5.0', '1.8.0'] });
  });

  test('keeps only the valid subset of fields', () => {
    expect(coerceManifestUpgrade({ breaking: true, minFromVersion: 5, preUpgradeBackup: 'none' })).toEqual({
      breaking: true,
      preUpgradeBackup: 'none',
    });
  });
});
