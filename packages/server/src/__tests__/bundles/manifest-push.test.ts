/**
 * coerceManifestPush — narrow-shape coercion of the bundle manifest's optional
 * `push` block (#409). A target survives only with an id, a label, and a usable
 * data-root-relative path; bad enums and malformed hooks are dropped from an
 * otherwise-valid target, and an all-empty block → undefined.
 *
 * The path rules here are syntactic defence-in-depth in front of
 * `resolveContainedDir` (see push-targets.test.ts), plus a whitespace ban so a
 * resolved path can't word-split when the CLI interpolates it into a remote
 * shell command.
 */
import { describe, test, expect } from 'bun:test';

import { coerceManifestPush } from '../../services/core/manifest-push';

describe('coerceManifestPush', () => {
  test('returns undefined for non-arrays / empty', () => {
    expect(coerceManifestPush(undefined)).toBeUndefined();
    expect(coerceManifestPush(null)).toBeUndefined();
    expect(coerceManifestPush('books')).toBeUndefined();
    expect(coerceManifestPush({ id: 'library' })).toBeUndefined();
    expect(coerceManifestPush([])).toBeUndefined();
  });

  test('carries a full target through unchanged', () => {
    expect(
      coerceManifestPush([
        {
          id: 'library',
          label: 'Calibre library',
          description: 'The directory holding metadata.db.',
          path: 'books',
          mode: 'mirror',
          quiesce: 'stop',
          postHook: { service: 'calibre-web', command: ['sh', '-c', 'reconnect'] },
        },
      ]),
    ).toEqual([
      {
        id: 'library',
        label: 'Calibre library',
        description: 'The directory holding metadata.db.',
        path: 'books',
        mode: 'mirror',
        quiesce: 'stop',
        postHook: { service: 'calibre-web', command: ['sh', '-c', 'reconnect'] },
      },
    ]);
  });

  test('keeps a minimal target and leaves mode/quiesce for the server to default', () => {
    expect(coerceManifestPush([{ id: 'media', label: 'Media', path: 'data/media' }])).toEqual([
      { id: 'media', label: 'Media', path: 'data/media' },
    ]);
  });

  test('drops a target missing id, label or path', () => {
    expect(coerceManifestPush([{ label: 'No id', path: 'books' }])).toBeUndefined();
    expect(coerceManifestPush([{ id: 'library', path: 'books' }])).toBeUndefined();
    expect(coerceManifestPush([{ id: 'library', label: 'Library' }])).toBeUndefined();
    expect(coerceManifestPush([{ id: '  ', label: 'Library', path: 'books' }])).toBeUndefined();
  });

  test('drops a target whose path is absolute, traverses, or carries whitespace', () => {
    const bad = ['/etc', '../../elsewhere', 'books/../../etc', '..', 'my books', 'books\ttmp'];
    for (const path of bad) {
      expect(coerceManifestPush([{ id: 'library', label: 'Library', path }])).toBeUndefined();
    }
  });

  test('a path merely containing dots is fine', () => {
    expect(coerceManifestPush([{ id: 'cfg', label: 'Config', path: '.config/app' }])).toEqual([
      { id: 'cfg', label: 'Config', path: '.config/app' },
    ]);
  });

  test('drops a bad enum value rather than the whole target', () => {
    expect(coerceManifestPush([{ id: 'library', label: 'Library', path: 'books', mode: 'sync', quiesce: 'pause' }])).toEqual([
      { id: 'library', label: 'Library', path: 'books' },
    ]);
  });

  test('drops a malformed postHook but keeps the target', () => {
    expect(
      coerceManifestPush([{ id: 'library', label: 'Library', path: 'books', postHook: { service: 'app' } }]),
    ).toEqual([{ id: 'library', label: 'Library', path: 'books' }]);
    expect(
      coerceManifestPush([{ id: 'library', label: 'Library', path: 'books', postHook: { service: 'app', command: 'reindex' } }]),
    ).toEqual([{ id: 'library', label: 'Library', path: 'books' }]);
  });

  test('keeps the first of duplicate ids', () => {
    expect(
      coerceManifestPush([
        { id: 'library', label: 'First', path: 'books' },
        { id: 'library', label: 'Second', path: 'other' },
      ]),
    ).toEqual([{ id: 'library', label: 'First', path: 'books' }]);
  });

  test('drops only the invalid entries in a mixed array', () => {
    expect(
      coerceManifestPush([
        { id: 'bad', label: 'Escapes', path: '../..' },
        'nonsense',
        { id: 'good', label: 'Good', path: 'books' },
      ]),
    ).toEqual([{ id: 'good', label: 'Good', path: 'books' }]);
  });
});
