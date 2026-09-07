/**
 * coerceManifestBackup — narrow-shape coercion of the bundle manifest's optional
 * `backup` block (#121). Spec 004 (FR-001–004): accepts either the legacy
 * singular object or a plural participation array, and always emits the
 * canonical `AppBackupParticipation[]` — the singular form becomes a
 * one-element list whose id is `default`. A hook survives only with a
 * service + non-empty exec-form command; malformed hooks are dropped, and an
 * all-empty result → undefined.
 */
import { describe, test, expect } from 'bun:test';

import { coerceManifestBackup } from '../../services/core/manifest-backup';
import type { Logger, LogContext } from '../../lib/logger';

/** Captures warn() calls so tests can assert on drop logging. */
function makeSpyLogger(): { logger: Logger; warnings: Array<{ message: string; context?: LogContext }> } {
  const warnings: Array<{ message: string; context?: LogContext }> = [];
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: (message, context) => warnings.push({ message, context }),
    error: () => {},
    child: () => logger,
  };
  return { logger, warnings };
}

const ctx = { appId: 'fixtureapp', version: '1.0.0' };

describe('coerceManifestBackup — singular legacy form', () => {
  test('returns undefined for non-objects / empty', () => {
    expect(coerceManifestBackup(undefined)).toBeUndefined();
    expect(coerceManifestBackup(null)).toBeUndefined();
    expect(coerceManifestBackup('x')).toBeUndefined();
    expect(coerceManifestBackup({})).toBeUndefined();
  });

  test('a full pre/post hook pair becomes one participation named "default"', () => {
    expect(
      coerceManifestBackup({
        preHook: { service: 'db', command: ['sh', '-c', 'pg_dump > /backups/dump.sql'] },
        postHook: { service: 'db', command: ['rm', '-f', '/backups/dump.sql'] },
      }),
    ).toEqual([
      {
        id: 'default',
        preHook: { service: 'db', command: ['sh', '-c', 'pg_dump > /backups/dump.sql'] },
        postHook: { service: 'db', command: ['rm', '-f', '/backups/dump.sql'] },
      },
    ]);
  });

  test('keeps a valid preHook and drops a malformed postHook', () => {
    expect(
      coerceManifestBackup({
        preHook: { service: 'db', command: ['pg_dump'] },
        postHook: { service: 'db' }, // no command
      }),
    ).toEqual([{ id: 'default', preHook: { service: 'db', command: ['pg_dump'] } }]);
  });

  test('drops a hook missing its service or with an empty/non-string command', () => {
    expect(coerceManifestBackup({ preHook: { command: ['pg_dump'] } })).toBeUndefined(); // no service
    expect(coerceManifestBackup({ preHook: { service: 'db', command: [] } })).toBeUndefined(); // empty
    expect(coerceManifestBackup({ preHook: { service: 'db', command: 'pg_dump' } })).toBeUndefined(); // not array
    expect(coerceManifestBackup({ preHook: { service: 'db', command: ['ok', 42] } })).toBeUndefined(); // non-string arg
  });
});

describe('coerceManifestBackup — plural participations (spec 004)', () => {
  test('keeps every well-formed entry in declaration order', () => {
    const { logger, warnings } = makeSpyLogger();
    const result = coerceManifestBackup(
      [
        { id: 'app-db', preHook: { service: 'postiz-postgres', command: ['pg_dump', 'app'] }, postHook: { service: 'postiz-postgres', command: ['rm', 'app.sql'] } },
        { id: 'temporal-db', preHook: { service: 'temporal-postgres', command: ['pg_dump', 'temporal'] } },
      ],
      logger,
      ctx,
    );
    expect(result?.map((p) => p.id)).toEqual(['app-db', 'temporal-db']);
    expect(warnings).toHaveLength(0);
  });

  test('a plural entry with a missing or blank id is dropped with a warning', () => {
    const { logger, warnings } = makeSpyLogger();
    const result = coerceManifestBackup(
      [
        { preHook: { service: 'db', command: ['x'] } },
        { id: '  ', preHook: { service: 'db', command: ['x'] } },
        { id: 'kept', preHook: { service: 'db', command: ['x'] } },
      ],
      logger,
      ctx,
    );
    expect(result?.map((p) => p.id)).toEqual(['kept']);
    expect(warnings.length).toBeGreaterThanOrEqual(2);
    expect(warnings[0]?.message).toMatch(/missing or blank id/i);
  });

  test('a duplicate id keeps the first and drops the second, with a warning naming the app and id', () => {
    const { logger, warnings } = makeSpyLogger();
    const result = coerceManifestBackup(
      [
        { id: 'x', preHook: { service: 'a', command: ['1'] } },
        { id: 'x', preHook: { service: 'b', command: ['2'] } },
      ],
      logger,
      ctx,
    );
    expect(result).toHaveLength(1);
    expect(result?.[0]).toMatchObject({ id: 'x', preHook: { service: 'a' } });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.context).toMatchObject({ appId: 'fixtureapp', id: 'x' });
  });

  test('an entry with no well-formed hook is dropped with a warning', () => {
    const { logger, warnings } = makeSpyLogger();
    const result = coerceManifestBackup(
      [{ id: 'empty' }, { id: 'kept', postHook: { service: 'db', command: ['rm'] } }],
      logger,
      ctx,
    );
    expect(result?.map((p) => p.id)).toEqual(['kept']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.context).toMatchObject({ id: 'empty' });
  });

  test('a hook-shape violation inside a plural entry drops only that hook, not the whole entry', () => {
    const result = coerceManifestBackup([
      { id: 'kept', preHook: { service: 'db', command: ['ok'] }, postHook: { service: 'db' } }, // malformed postHook only
    ]);
    expect(result).toEqual([{ id: 'kept', preHook: { service: 'db', command: ['ok'] } }]);
  });

  test('an all-dropped plural block becomes undefined', () => {
    expect(coerceManifestBackup([{ preHook: {} }, { id: '' }])).toBeUndefined();
    expect(coerceManifestBackup([])).toBeUndefined();
  });

  test('a logger is optional — drops still happen silently without one', () => {
    const result = coerceManifestBackup([
      { id: 'kept', preHook: { service: 'db', command: ['ok'] } },
      { preHook: { service: 'db', command: ['dropped'] } },
    ]);
    expect(result?.map((p) => p.id)).toEqual(['kept']);
  });
});
