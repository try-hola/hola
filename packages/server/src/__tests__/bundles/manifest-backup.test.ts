/**
 * coerceManifestBackup — narrow-shape coercion of the bundle manifest's optional
 * `backup` block (#121). A hook survives only with a service + non-empty exec-form
 * command; malformed hooks are dropped, and an all-empty block → undefined.
 */
import { describe, test, expect } from 'bun:test';

import { coerceManifestBackup } from '../../services/core/manifest-backup';

describe('coerceManifestBackup', () => {
  test('returns undefined for non-objects / empty', () => {
    expect(coerceManifestBackup(undefined)).toBeUndefined();
    expect(coerceManifestBackup(null)).toBeUndefined();
    expect(coerceManifestBackup('x')).toBeUndefined();
    expect(coerceManifestBackup({})).toBeUndefined();
  });

  test('carries a full pre/post hook pair', () => {
    expect(
      coerceManifestBackup({
        preHook: { service: 'db', command: ['sh', '-c', 'pg_dump > /backups/dump.sql'] },
        postHook: { service: 'db', command: ['rm', '-f', '/backups/dump.sql'] },
      }),
    ).toEqual({
      preHook: { service: 'db', command: ['sh', '-c', 'pg_dump > /backups/dump.sql'] },
      postHook: { service: 'db', command: ['rm', '-f', '/backups/dump.sql'] },
    });
  });

  test('keeps a valid preHook and drops a malformed postHook', () => {
    expect(
      coerceManifestBackup({
        preHook: { service: 'db', command: ['pg_dump'] },
        postHook: { service: 'db' }, // no command
      }),
    ).toEqual({ preHook: { service: 'db', command: ['pg_dump'] } });
  });

  test('drops a hook missing its service or with an empty/non-string command', () => {
    expect(coerceManifestBackup({ preHook: { command: ['pg_dump'] } })).toBeUndefined(); // no service
    expect(coerceManifestBackup({ preHook: { service: 'db', command: [] } })).toBeUndefined(); // empty
    expect(coerceManifestBackup({ preHook: { service: 'db', command: 'pg_dump' } })).toBeUndefined(); // not array
    expect(coerceManifestBackup({ preHook: { service: 'db', command: ['ok', 42] } })).toBeUndefined(); // non-string arg
  });
});
