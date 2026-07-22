/**
 * coerceManifestProfiles — narrow-shape coercion of the bundle manifest's
 * optional `profiles` block (#162). Mirrors the manifest-upgrade coercion tests:
 * malformed/unknown entries are dropped, keys are grammar-checked, duplicates
 * collapse, and an empty result degrades to undefined (the app has no profiles).
 */
import { describe, test, expect } from 'bun:test';

import { coerceManifestProfiles } from '../../services/core/manifest-profiles';

describe('coerceManifestProfiles', () => {
  test('returns undefined for non-arrays', () => {
    expect(coerceManifestProfiles(undefined)).toBeUndefined();
    expect(coerceManifestProfiles(null)).toBeUndefined();
    expect(coerceManifestProfiles({ key: 'x' })).toBeUndefined();
    expect(coerceManifestProfiles('elasticsearch')).toBeUndefined();
  });

  test('returns undefined when no entry survives coercion', () => {
    expect(coerceManifestProfiles([])).toBeUndefined();
    // missing/blank key, non-object entries, and invalid key grammar are all dropped.
    expect(coerceManifestProfiles([{ label: 'no key' }, 'x', 42, null])).toBeUndefined();
    expect(coerceManifestProfiles([{ key: '   ' }, { key: '-bad' }, { key: 'has space' }])).toBeUndefined();
  });

  test('carries a full, valid entry and defaults label to key', () => {
    expect(
      coerceManifestProfiles([
        { key: 'elasticsearch', label: 'Elasticsearch advanced visibility', description: 'Heavier, opt-in', default: true },
        { key: 'metrics' },
      ]),
    ).toEqual([
      { key: 'elasticsearch', label: 'Elasticsearch advanced visibility', description: 'Heavier, opt-in', default: true },
      { key: 'metrics', label: 'metrics' },
    ]);
  });

  test('drops a non-true default and a blank description', () => {
    expect(coerceManifestProfiles([{ key: 'es', label: 'ES', default: 'yes', description: '  ' }])).toEqual([
      { key: 'es', label: 'ES' },
    ]);
  });

  test('collapses duplicate keys to the first occurrence and preserves order', () => {
    expect(
      coerceManifestProfiles([
        { key: 'a', label: 'first A' },
        { key: 'b', label: 'B' },
        { key: 'a', label: 'second A' },
      ]),
    ).toEqual([
      { key: 'a', label: 'first A' },
      { key: 'b', label: 'B' },
    ]);
  });
});
