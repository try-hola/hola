/**
 * Capability contracts (ADR 0004) — the `provides`/`accepts` vocabulary and its
 * coercion. Mirrors the manifest-auth/manifest-backup coercion tests: anything
 * malformed or from a newer vocabulary is dropped with a warning, never thrown,
 * so a sloppy or newer manifest degrades to "fills no role" instead of failing
 * the bundle load.
 */
import { describe, test, expect } from 'bun:test';

import {
  CONTRACTS,
  formatContractRef,
  grantKindsFor,
  resolveGrantKinds,
  missingGrantConsents,
  parseContractRef,
  providerGrantsFor,
  backupParticipations,
  isDatabaseImage,
  judgeBackupCoverage,
  judgeRestoreCoverage,
} from '@hola/shared/contracts';

import type { ContractDefinition } from '@hola/shared/contracts';
import type { ContractParticipant, ContractRollup } from '@hola/shared';

import {
  acceptorBlocksPresent,
  buildContractRollup,
  coerceAccepts,
  coerceProvides,
  findUndeclaredAcceptorBlocks,
} from '../../services/core/contracts';
import type { ContractRollupEntry } from '../../services/core/contracts';
import type { Logger, LogContext } from '../../lib/logger';

/** Captures warn() calls so tests can assert on forward-compat degrade logging. */
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

describe('the contract table', () => {
  test('every entry has a unique id@version ref', () => {
    const refs = CONTRACTS.map(formatContractRef);
    expect(new Set(refs).size).toBe(refs.length);
  });

  test('models the five contracts ADR 0004/spec 008 name, with their shapes', () => {
    // The shape is the ADR's load-bearing distinction — broker an operation,
    // provision a connection. auth was always provisioned; naming it here is what
    // stops a future contract from being brokered by default.
    expect(parseContractRef('auth@1')).toMatchObject({ shape: 'provisioned', providerKind: 'platform' });
    expect(parseContractRef('backup@1')).toMatchObject({ shape: 'brokered', providerKind: 'app' });
    expect(parseContractRef('push@1')).toMatchObject({ shape: 'brokered', providerKind: 'platform' });
    expect(parseContractRef('container-logs@1')).toMatchObject({
      shape: 'provisioned',
      providerKind: 'app',
      participation: 'implicit',
    });
    // spec 008: restore@1 promoted from a participation marker to a real,
    // brokered, app-provided contract (FR-001).
    expect(parseContractRef('restore@1')).toMatchObject({
      shape: 'brokered',
      providerKind: 'app',
      participation: 'declared',
      acceptorBlock: 'restore',
    });
    expect(parseContractRef('restore@1')?.providerGrant?.kind).toBe('restore-staging');
  });

  test('every entry declares a participation mode (spec 004)', () => {
    for (const def of CONTRACTS) {
      expect(['declared', 'implicit']).toContain(def.participation);
    }
    expect(parseContractRef('auth@1')?.participation).toBe('declared');
    expect(parseContractRef('backup@1')?.participation).toBe('declared');
    expect(parseContractRef('push@1')?.participation).toBe('declared');
    expect(parseContractRef('container-logs@1')?.participation).toBe('implicit');
    expect(parseContractRef('restore@1')?.participation).toBe('declared');
  });
});

describe('parseContractRef', () => {
  test('resolves a known id@version', () => {
    expect(parseContractRef('backup@1')).toMatchObject({ id: 'backup', version: 1 });
  });

  test('requires an explicit version — a bare id never resolves', () => {
    // `backup` alone is ambiguous the moment backup@2 exists; reading it as @1
    // would drift an old manifest into obligations that changed underneath it.
    expect(parseContractRef('backup')).toBeUndefined();
    expect(parseContractRef('backup@')).toBeUndefined();
    expect(parseContractRef('@1')).toBeUndefined();
  });

  test('rejects a non-integer or unknown version', () => {
    expect(parseContractRef('backup@1.5')).toBeUndefined();
    expect(parseContractRef('backup@x')).toBeUndefined();
    expect(parseContractRef('backup@2')).toBeUndefined();
  });
});

describe('coerceAccepts / coerceProvides', () => {
  test('returns undefined when absent, empty, or the wrong type', () => {
    const { logger } = makeSpyLogger();
    expect(coerceAccepts(undefined, logger, ctx)).toBeUndefined();
    expect(coerceAccepts([], logger, ctx)).toBeUndefined();
    expect(coerceAccepts({}, logger, ctx)).toBeUndefined();
    expect(coerceAccepts(42, logger, ctx)).toBeUndefined();
  });

  test('accepts a bare string as well as an array, and trims', () => {
    const { logger } = makeSpyLogger();
    expect(coerceAccepts('backup@1', logger, ctx)).toEqual(['backup@1']);
    expect(coerceAccepts(['  backup@1  '], logger, ctx)).toEqual(['backup@1']);
  });

  test('de-duplicates while preserving declaration order', () => {
    const { logger } = makeSpyLogger();
    expect(coerceAccepts(['push@1', 'backup@1', 'push@1'], logger, ctx)).toEqual(['push@1', 'backup@1']);
  });

  test('drops an unknown contract with a warning instead of failing (forward-compat)', () => {
    // ADR 0003's rule: the catalog and the server release on separate cadences,
    // so a stale server meeting a newer vocabulary word must degrade, not brick.
    const { logger, warnings } = makeSpyLogger();
    expect(coerceAccepts(['backup@1', 'telemetry@1'], logger, ctx)).toEqual(['backup@1']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.context).toMatchObject({ ref: 'telemetry@1', role: 'accepts', appId: 'fixtureapp' });
  });

  test('drops `provides` for a platform-provided contract', () => {
    // Authentik is deployed by the platform, not installed from the catalog, so
    // no app can claim to provide auth. Keeping `provides` to mean exactly "this
    // app performs the capability for others" is what makes the rollup readable.
    const { logger, warnings } = makeSpyLogger();
    expect(coerceProvides(['auth@1', 'backup@1'], logger, ctx)).toEqual(['backup@1']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.context).toMatchObject({ ref: 'auth@1' });
  });

  test('the same platform contract is still acceptable', () => {
    const { logger, warnings } = makeSpyLogger();
    expect(coerceAccepts(['auth@1'], logger, ctx)).toEqual(['auth@1']);
    expect(warnings).toHaveLength(0);
  });

  test('drops `accepts` for an implicit contract with a warning naming implicit participation (spec 004)', () => {
    const { logger, warnings } = makeSpyLogger();
    expect(coerceAccepts(['container-logs@1', 'backup@1'], logger, ctx)).toEqual(['backup@1']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toMatch(/implicit/i);
    expect(warnings[0]?.context).toMatchObject({ ref: 'container-logs@1' });
  });

  test('`provides` for an implicit contract is unaffected — only `accepts` is dropped', () => {
    const { logger, warnings } = makeSpyLogger();
    expect(coerceProvides(['container-logs@1'], logger, ctx)).toEqual(['container-logs@1']);
    expect(warnings).toHaveLength(0);
  });
});

describe('findUndeclaredAcceptorBlocks', () => {
  test('reports a block whose contract is not accepted', () => {
    // A manifest that predates ADR 0004, or an author who filled in the hooks and
    // forgot the declaration.
    expect(findUndeclaredAcceptorBlocks({ backup: { preHook: {} } }, undefined)).toEqual(['backup@1']);
  });

  test('says nothing when the block and the declaration agree', () => {
    expect(findUndeclaredAcceptorBlocks({ backup: { preHook: {} } }, ['backup@1'])).toEqual([]);
  });

  test('does not infer acceptance — accepting without a block is legitimate', () => {
    // The whole point of the explicit field: a SQLite or flat-file app accepts
    // backup@1 and needs no hooks at all, and must stay distinguishable from an
    // app nobody ever considered.
    expect(findUndeclaredAcceptorBlocks({}, ['backup@1'])).toEqual([]);
  });

  test('reports each mismatched block independently', () => {
    expect(findUndeclaredAcceptorBlocks({ backup: {}, push: [], auth: {} }, ['auth@1'])).toEqual([
      'backup@1',
      'push@1',
    ]);
  });
});

describe('provider grants (ADR 0004 §4)', () => {
  test('backup@1 carries the apps-data grant; the other contracts carry none', () => {
    expect(providerGrantsFor(['backup@1'])).toEqual([
      { ref: 'backup@1', grant: expect.objectContaining({ kind: 'apps-data' }) },
    ]);
    expect(providerGrantsFor(['auth@1', 'push@1'])).toEqual([]);
    expect(providerGrantsFor(undefined)).toEqual([]);
  });

  test('every grant states a risk the operator can actually act on', () => {
    // The consent row is only meaningful if it says what is being handed over —
    // the same rule the `security` block enforces by dropping a permission with
    // no `reason`.
    for (const def of CONTRACTS) {
      if (!def.providerGrant) continue;
      expect(def.providerGrant.label.length).toBeGreaterThan(0);
      expect(def.providerGrant.risk.length).toBeGreaterThan(20);
    }
  });

  test('missingGrantConsents names exactly what was declared but not consented to', () => {
    expect(missingGrantConsents(['backup@1'], undefined)).toEqual(['backup@1']);
    expect(missingGrantConsents(['backup@1'], [])).toEqual(['backup@1']);
    expect(missingGrantConsents(['backup@1'], ['backup@1'])).toEqual([]);
  });

  test('consenting to a contract the app never declared grants nothing', () => {
    // Consent is an answer to a declaration, not a way to ask for privilege: the
    // manifest is what bounds the grant.
    expect(missingGrantConsents(undefined, ['backup@1'])).toEqual([]);
    expect(grantKindsFor([])).toEqual([]);
  });

  test('grantKindsFor keys off the contract, not the ref string', () => {
    expect(grantKindsFor(['backup@1'])).toEqual(['apps-data']);
    expect(grantKindsFor(['auth@1', 'push@1'])).toEqual([]);
    expect(grantKindsFor(['telemetry@1'])).toEqual([]);
  });

  test('container-logs@1 carries its own grant kind', () => {
    expect(providerGrantsFor(['container-logs@1'])).toEqual([
      { ref: 'container-logs@1', grant: expect.objectContaining({ kind: 'container-logs' }) },
    ]);
    expect(grantKindsFor(['container-logs@1'])).toEqual(['container-logs']);
    expect(grantKindsFor(['backup@1'])).not.toContain('container-logs');
  });
});

// #496: consent is recorded per REF, but the privilege that reaches a container
// is a KIND. These are the pure half of the fix — the enforcement rule itself.
describe('resolveGrantKinds (#496) — recorded kinds bound the live table', () => {
  /** The shipped table with `backup@1`'s grant swapped for a DIFFERENT kind. */
  const widenedTable: readonly ContractDefinition[] = CONTRACTS.map((c) =>
    c.id === 'backup'
      ? { ...c, providerGrant: { ...c.providerGrant!, kind: 'container-logs' as const } }
      : c,
  );

  /** The shipped table with a `providerGrant` bolted onto a contract that had none. */
  const bolusTable: readonly ContractDefinition[] = CONTRACTS.map((c) =>
    c.id === 'push'
      ? { ...c, providerGrant: { kind: 'apps-data' as const, label: 'x', risk: 'y' } }
      : c,
  );

  test('the happy path: a consented ref whose live kind is recorded is granted', () => {
    expect(resolveGrantKinds(['backup@1'], ['apps-data'])).toEqual({
      kinds: ['apps-data'],
      widened: [],
    });
  });

  test('a kind newly attached to an already-consented ref is NOT granted, and is reported', () => {
    const res = resolveGrantKinds(['backup@1'], ['apps-data'], widenedTable);
    expect(res.kinds).toEqual([]);
    expect(res.widened).toEqual([{ ref: 'backup@1', kind: 'container-logs' }]);
  });

  test('a providerGrant bolted onto a contract that had none is NOT granted', () => {
    const res = resolveGrantKinds(['push@1'], [], bolusTable);
    expect(res.kinds).toEqual([]);
    expect(res.widened).toEqual([{ ref: 'push@1', kind: 'apps-data' }]);
  });

  test('a kind removed from the table is not granted either — both directions fail closed', () => {
    const strippedTable = CONTRACTS.map((c) =>
      c.id === 'backup' ? { ...c, providerGrant: undefined } : c,
    );
    const res = resolveGrantKinds(['backup@1'], ['apps-data'], strippedTable);
    expect(res.kinds).toEqual([]);
    // Withdrawal is deliberate and needs no operator action, so it stays silent.
    expect(res.widened).toEqual([]);
  });

  test('a recorded kind no longer implied by any consented ref is silently dropped, not warned', () => {
    // An upgrade that drops `provides: backup@1` loses the ref upstream; warning
    // here would fire on every materialisation for ordinary operation.
    const res = resolveGrantKinds([], ['apps-data']);
    expect(res).toEqual({ kinds: [], widened: [] });
  });

  test('grantKindsFor is the snapshot: de-duplicated, in ref order', () => {
    expect(grantKindsFor(['backup@1', 'restore@1', 'backup@1'])).toEqual([
      'apps-data',
      'restore-staging',
    ]);
  });
});

describe('backupParticipations (spec 004, FR-001)', () => {
  test('the singular legacy object becomes a one-element list named "default"', () => {
    expect(backupParticipations({ preHook: { service: 'db', command: ['pg_dump'] } })).toEqual([
      { id: 'default', preHook: { service: 'db', command: ['pg_dump'] } },
    ]);
    expect(backupParticipations({ postHook: { service: 'db', command: ['rm'] } })).toEqual([
      { id: 'default', postHook: { service: 'db', command: ['rm'] } },
    ]);
  });

  test('a singular object with neither hook yields no participations', () => {
    expect(backupParticipations({})).toEqual([]);
    expect(backupParticipations(undefined)).toEqual([]);
    expect(backupParticipations(null)).toEqual([]);
    expect(backupParticipations('nonsense')).toEqual([]);
  });

  test('the plural array is kept in declaration order', () => {
    const plural = [
      { id: 'app-db', preHook: { service: 'postiz-postgres', command: ['pg_dump'] } },
      { id: 'temporal-db', preHook: { service: 'temporal-postgres', command: ['pg_dump'] } },
    ];
    expect(backupParticipations(plural).map((p) => p.id)).toEqual(['app-db', 'temporal-db']);
  });

  test('an entry with a missing or blank id is dropped', () => {
    const plural = [
      { preHook: { service: 'db', command: ['x'] } },
      { id: '   ', preHook: { service: 'db', command: ['x'] } },
      { id: 'kept', preHook: { service: 'db', command: ['x'] } },
    ];
    expect(backupParticipations(plural).map((p) => p.id)).toEqual(['kept']);
  });

  test('a duplicate id keeps the first occurrence', () => {
    const plural = [
      { id: 'x', preHook: { service: 'a', command: ['1'] } },
      { id: 'x', preHook: { service: 'b', command: ['2'] } },
    ];
    const result = backupParticipations(plural);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'x', preHook: { service: 'a' } });
  });

  test('an entry with neither hook is dropped', () => {
    const plural = [{ id: 'empty' }, { id: 'kept', postHook: { service: 'db', command: ['rm'] } }];
    expect(backupParticipations(plural).map((p) => p.id)).toEqual(['kept']);
  });

  test('junk input yields an empty list', () => {
    expect(backupParticipations(42)).toEqual([]);
    expect(backupParticipations([1, 2, 'x', null])).toEqual([]);
  });
});

describe('isDatabaseImage (spec 004, FR-015)', () => {
  test.each([
    ['postgres:17-alpine', true],
    ['bitnami/postgresql:16', true],
    ['ghcr.io/immich-app/postgres:14-vectorchord0.3.0', true],
    ['mysql/mysql-server:8', true],
    ['timescale/timescaledb-ha:pg16', true],
    ['mongodb/mongodb-community-server:7', true],
    ['nginx:1.27', false],
    ['redis:7', false],
    ['postgrest/postgrest:v12', false],
    ['ghcr.io/org/app@sha256:abcdef1234567890', false],
  ])('%s -> %s', (ref, expected) => {
    expect(isDatabaseImage(ref)).toBe(expected);
  });

  test('never matches on app id, only image family', () => {
    expect(isDatabaseImage('postiz')).toBe(false);
    expect(isDatabaseImage('')).toBe(false);
  });

  // Regression pin: the images the live catalog actually runs. `pgautoupgrade`
  // is the Postgres image every catalog app but immich uses, and it was absent
  // from DATABASE_IMAGE_FAMILIES — so guacamole, mealie, paperless-ngx and
  // postiz each reported `recognised: 0` and rendered `quiesced` (the all-clear)
  // instead of being judged. A database image the catalog ships that this list
  // does not know is not a near-miss; it silently disables FR-019 for that app.
  test.each([
    // guacamole, mealie, paperless-ngx, postiz
    ['pgautoupgrade/pgautoupgrade:18-alpine', true],
    // immich
    ['ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0', true],
    // caches the catalog runs, which must stay unrecognised
    ['docker.io/valkey/valkey:9-alpine', false],
    ['redis:7.4-alpine', false],
  ])('live catalog image %s -> %s', (ref, expected) => {
    expect(isDatabaseImage(ref)).toBe(expected);
  });

  // A companion that merely TALKS to a database holds none of the data. Counting
  // one as a recognised database reports a fully quiesced app as `partial`, which
  // teaches operators to ignore the single warning FR-019 exists to raise.
  test.each([
    ['mongo-express:1.0', false],
    ['prometheuscommunity/postgres-exporter:v0.15', false],
    ['mysql-exporter:latest', false],
    ['mariadb-backup:11', false],
    ['dpage/pgadmin4:8', false],
    // …while a real database whose name merely has extra words still matches.
    ['mysql/mysql-server:8', true],
    ['timescale/timescaledb-ha:pg16', true],
    ['mongodb/mongodb-community-server:7', true],
  ])('companion vs database: %s -> %s', (ref, expected) => {
    expect(isDatabaseImage(ref)).toBe(expected);
  });
});

describe('judgeBackupCoverage (spec 004, FR-016)', () => {
  test('not accepting is always uncovered, regardless of databases/participations', () => {
    expect(
      judgeBackupCoverage({ accepts: false, participations: [], databaseServices: ['db'] }),
    ).toMatchObject({ state: 'uncovered' });
  });

  test('accepts, no databases, at least one participation -> quiesced', () => {
    expect(
      judgeBackupCoverage({
        accepts: true,
        participations: [{ id: 'default', preHook: { service: 'redis', command: ['x'] } }],
        databaseServices: [],
      }),
    ).toMatchObject({ state: 'quiesced', targeted: 0, recognised: 0 });
  });

  test('accepts, no databases, no participations -> as-is', () => {
    expect(judgeBackupCoverage({ accepts: true, participations: [], databaseServices: [] })).toMatchObject({
      state: 'as-is',
      targeted: 0,
      recognised: 0,
    });
  });

  test('accepts, one database, no participations -> partial 0/1', () => {
    expect(
      judgeBackupCoverage({ accepts: true, participations: [], databaseServices: ['app-db'] }),
    ).toMatchObject({ state: 'partial', targeted: 0, recognised: 1 });
  });

  test('the postiz shape: one participation of two recognised databases -> partial 1/2', () => {
    const result = judgeBackupCoverage({
      accepts: true,
      participations: [{ id: 'default', preHook: { service: 'postiz-postgres', command: ['pg_dump'] } }],
      databaseServices: ['postiz-postgres', 'temporal-postgres'],
    });
    expect(result).toMatchObject({ state: 'partial', targeted: 1, recognised: 2 });
    expect(result.participations).toEqual([{ id: 'default', service: 'postiz-postgres' }]);
    expect(result.databases).toEqual(['postiz-postgres', 'temporal-postgres']);
  });

  test('every recognised database targeted -> quiesced', () => {
    expect(
      judgeBackupCoverage({
        accepts: true,
        participations: [
          { id: 'app-db', preHook: { service: 'postiz-postgres', command: ['x'] } },
          { id: 'temporal-db', preHook: { service: 'temporal-postgres', command: ['x'] } },
        ],
        databaseServices: ['postiz-postgres', 'temporal-postgres'],
      }),
    ).toMatchObject({ state: 'quiesced', targeted: 2, recognised: 2 });
  });

  test('a post-hook-only participation targets nothing', () => {
    expect(
      judgeBackupCoverage({
        accepts: true,
        participations: [{ id: 'cleanup', postHook: { service: 'postiz-postgres', command: ['rm'] } }],
        databaseServices: ['postiz-postgres'],
      }),
    ).toMatchObject({ state: 'partial', targeted: 0, recognised: 1 });
  });

  test('two pre-hooks naming the same service count it once', () => {
    expect(
      judgeBackupCoverage({
        accepts: true,
        participations: [
          { id: 'a', preHook: { service: 'db', command: ['1'] } },
          { id: 'b', preHook: { service: 'db', command: ['2'] } },
        ],
        databaseServices: ['db'],
      }),
    ).toMatchObject({ state: 'quiesced', targeted: 1, recognised: 1 });
  });
});

describe('judgeRestoreCoverage (spec 008, FR-053-FR-055)', () => {
  const dbParticipation = (id: string, service: string) => ({ id, preHook: { service, command: ['pg_dump'] } });

  // Quickstart scenario 54
  test('every recognised database participation has a matching hook-bearing restore declaration -> restorable', () => {
    const result = judgeRestoreCoverage({
      accepts: true,
      participations: [dbParticipation('default', 'db')],
      restoreDeclarations: [{ id: 'default', hook: { service: 'db', command: ['psql'] } }],
      databaseServices: ['db'],
    });
    expect(result.state).toBe('restorable');
    expect(result.targeted).toBe(1);
    expect(result.recognised).toBe(1);
  });

  // Quickstart scenario 55: a genuinely COMPLETE verdict, distinct in MEANING
  // from backup's structurally-parallel 'as-is' even though both describe
  // "no recognised database, nothing to quiesce".
  test('zero recognised database participations -> copy-back, not merely "not incomplete"', () => {
    const result = judgeRestoreCoverage({
      accepts: true,
      participations: [],
      restoreDeclarations: [],
      databaseServices: [],
    });
    expect(result.state).toBe('copy-back');
    expect(result.state).not.toBe('incomplete');
  });

  // `copy-back` is only honest when the author ALSO declared nothing to do on
  // the way back in. An app that declared a reload hook has said explicitly
  // that a plain file copy is NOT sufficient for it — and its hook runs at
  // restore time whether or not this build recognises the image behind its
  // database. Reporting it as `copy-back` tells the operator no reload is
  // needed when the author said one is, which is exactly the dishonesty US4
  // exists to remove. Mirrors judgeBackupCoverage's own quiesced/as-is split.
  test('zero recognised databases but a declared reload hook -> restorable, never copy-back', () => {
    const result = judgeRestoreCoverage({
      accepts: true,
      participations: [dbParticipation('default', 'db')],
      restoreDeclarations: [{ id: 'default', hook: { service: 'db', command: ['psql'] } }],
      databaseServices: [], // the image family is unrecognised
    });
    expect(result.state).toBe('restorable');
    expect(result.state).not.toBe('copy-back');

    // ...and the backup judgement over the same shape agrees in spirit.
    expect(judgeBackupCoverage({
      accepts: true,
      participations: [dbParticipation('default', 'db')],
      databaseServices: [],
    }).state).toBe('quiesced');
  });

  test('a DISCARD-only declaration with nothing recognised stays copy-back — only a hook changes the verdict', () => {
    const result = judgeRestoreCoverage({
      accepts: true,
      participations: [dbParticipation('default', 'db')],
      restoreDeclarations: [{ id: 'default', discard: ['db/data'] }],
      databaseServices: [],
    });
    expect(result.state).toBe('copy-back');
  });

  // Quickstart scenario 56: a discard-only declaration (no `hook`) does not count.
  test('two recognised database participations, only one with a hook-bearing restore declaration -> incomplete', () => {
    const result = judgeRestoreCoverage({
      accepts: true,
      participations: [dbParticipation('a', 'db-a'), dbParticipation('b', 'db-b')],
      restoreDeclarations: [
        { id: 'a', hook: { service: 'db-a', command: ['psql'] } },
        { id: 'b', discard: ['b-data'] }, // no `hook` -> does NOT cover its participation
      ],
      databaseServices: ['db-a', 'db-b'],
    });
    expect(result.state).toBe('incomplete');
    expect(result.targeted).toBe(1);
    expect(result.recognised).toBe(2);
  });

  test('not accepting restore@1 -> undeclared, regardless of participations or hooks', () => {
    const result = judgeRestoreCoverage({
      accepts: false,
      participations: [dbParticipation('default', 'db')],
      restoreDeclarations: [{ id: 'default', hook: { service: 'db', command: ['psql'] } }],
      databaseServices: ['db'],
    });
    expect(result.state).toBe('undeclared');
  });

  // Quickstart scenario 58: purity, mirroring judgeBackupCoverage's own check.
  test('contains no per-app or per-datastore name in its source', () => {
    const source = judgeRestoreCoverage.toString();
    expect(source.toLowerCase()).not.toMatch(/postgres|mealie|immich|gitea|paperless|backrest/);
  });
});

describe('the restore-staging grant (spec 008, FR-010, FR-016, scenario 67)', () => {
  test('restore@1 declares a providerGrant with non-empty, jargon-free copy distinct from the other grant rows', () => {
    const restore = parseContractRef('restore@1');
    expect(restore?.providerGrant?.kind).toBe('restore-staging');
    const grant = restore!.providerGrant!;
    expect(grant.label.length).toBeGreaterThan(0);
    expect(grant.risk.length).toBeGreaterThan(0);
    // No camelCase/snake_case identifier-shaped token in the operator-facing copy.
    expect(grant.label).not.toMatch(/[a-z][A-Z]|_[a-z]/);
    expect(grant.risk).not.toMatch(/[a-z][A-Z]|providerGrant|grantedContracts/);

    for (const other of CONTRACTS.filter((c) => c.id !== 'restore' && c.providerGrant)) {
      expect(grant.label).not.toBe(other.providerGrant!.label);
      expect(grant.risk).not.toBe(other.providerGrant!.risk);
    }
  });
});

describe('acceptorBlocksPresent', () => {
  test('reports every typed block present, regardless of what is accepted', () => {
    // Deliberately independent of `accepts` — this answers "does work need to run
    // around the operation?", not "does the app participate?". The rollup pairs the
    // two so "covered, nothing to run" doesn't read as "hooks are missing".
    expect(acceptorBlocksPresent({ backup: { preHook: {} } })).toEqual(['backup@1']);
    expect(acceptorBlocksPresent({})).toEqual([]);
  });
});

describe('buildContractRollup (ADR 0004 Phase 4)', () => {
  const app = (id: string, over: Partial<ContractParticipant> = {}): ContractRollupEntry['deployment'] => ({
    deploymentId: id,
    name: id,
    app: id,
    icon: '📦',
    status: 'running',
    ...over,
  });
  const backup = (items: ContractRollup[]) => items.find((i) => i.ref === 'backup@1')!;

  test('returns every contract in the table, even one nobody fills', () => {
    // The empty buckets are the feature: "no backup provider is installed" is an
    // answer a client can render, where a missing row is just absence of data.
    const items = buildContractRollup([]);
    expect(items.map((i) => i.ref)).toEqual(CONTRACTS.map(formatContractRef));
    expect(backup(items)).toMatchObject({ providers: [], acceptors: [], unaffiliated: [], shape: 'brokered' });
  });

  test('sorts installs into provider, acceptor, and neither', () => {
    const items = buildContractRollup([
      { deployment: app('backrest'), contracts: { provides: ['backup@1'], granted: ['backup@1'] } },
      { deployment: app('paperless'), contracts: { accepts: ['backup@1'], hooks: ['backup@1'] } },
      { deployment: app('immich'), contracts: {} },
    ]);

    expect(backup(items).providers).toEqual([expect.objectContaining({ deploymentId: 'backrest', granted: true })]);
    expect(backup(items).acceptors).toEqual([expect.objectContaining({ deploymentId: 'paperless', hooks: true })]);
    // The whole point of the third bucket: immich is *not covered*, and saying so
    // takes a list of the apps filling no role — not the absence of a row.
    expect(backup(items).unaffiliated.map((p) => p.deploymentId)).toEqual(['immich']);
  });

  test('an accepting app with no typed block is covered as-is, not missing hooks', () => {
    const items = buildContractRollup([
      { deployment: app('uptime-kuma'), contracts: { accepts: ['backup@1'] } },
    ]);
    expect(backup(items).acceptors).toEqual([expect.objectContaining({ deploymentId: 'uptime-kuma', hooks: false })]);
    expect(backup(items).unaffiliated).toEqual([]);
  });

  test('an app doing both jobs fills both roles and neither bucket calls it uninvolved', () => {
    const items = buildContractRollup([
      { deployment: app('backrest'), contracts: { provides: ['backup@1'], accepts: ['backup@1'], granted: ['backup@1'] } },
    ]);
    expect(backup(items).providers).toHaveLength(1);
    expect(backup(items).acceptors).toHaveLength(1);
    expect(backup(items).unaffiliated).toEqual([]);
  });

  test('a declared provider role the operator never consented to reads as ungranted', () => {
    // The case an upgrade creates: a new release declares a role the old consent
    // never covered, so the app performs nothing. An operator asking "why did
    // nothing back up?" has to be able to see that, which is why `granted` is
    // reported separately from `provides` rather than filtering the row out.
    const items = buildContractRollup([
      { deployment: app('backrest'), contracts: { provides: ['backup@1'] } },
    ]);
    expect(backup(items).providers).toEqual([expect.objectContaining({ deploymentId: 'backrest', granted: false })]);
  });

  test('a role in a contract this build does not know about is simply absent', () => {
    // Coercion already dropped the unknown ref; the rollup enumerates the table, so
    // there is no way for a bundle to invent a row here either.
    const items = buildContractRollup([
      { deployment: app('mystery'), contracts: { provides: ['telemetry@1'], accepts: ['telemetry@1'] } },
    ]);
    expect(items.some((i) => i.ref === 'telemetry@1')).toBe(false);
    expect(backup(items).unaffiliated.map((p) => p.deploymentId)).toEqual(['mystery']);
  });

  test('providerConflict is set when more than one deployment provides the same contract (spec 004)', () => {
    const items = buildContractRollup([
      { deployment: app('backrest-1'), contracts: { provides: ['backup@1'], granted: ['backup@1'] } },
      { deployment: app('backrest-2'), contracts: { provides: ['backup@1'], granted: ['backup@1'] } },
    ]);
    expect(backup(items).providerConflict).toBe(true);
    expect(backup(items).providers).toHaveLength(2);
  });

  test('providerConflict is absent when there is exactly one provider', () => {
    const items = buildContractRollup([
      { deployment: app('backrest'), contracts: { provides: ['backup@1'], granted: ['backup@1'] } },
    ]);
    expect(backup(items).providerConflict).toBeUndefined();
  });

  test('carries each contract\'s shape and provider kind through to the client', () => {
    // A platform-provided contract has no app provider by definition; a client that
    // knows this renders "provided by Hola" instead of "none installed".
    const items = buildContractRollup([{ deployment: app('mealie'), contracts: { accepts: ['auth@1'] } }]);
    const auth = items.find((i) => i.ref === 'auth@1')!;
    expect(auth).toMatchObject({ shape: 'provisioned', providerKind: 'platform', providers: [] });
    expect(auth.acceptors.map((p) => p.deploymentId)).toEqual(['mealie']);
  });

  test('every rollup item carries its participation mode', () => {
    const items = buildContractRollup([]);
    expect(items.find((i) => i.ref === 'backup@1')?.participation).toBe('declared');
    expect(items.find((i) => i.ref === 'push@1')?.participation).toBe('declared');
    expect(items.find((i) => i.ref === 'auth@1')?.participation).toBe('declared');
    expect(items.find((i) => i.ref === 'container-logs@1')?.participation).toBe('implicit');
  });

  describe('implicit participation: container-logs@1 (spec 004, US6)', () => {
    const containerLogsOf = (items: ContractRollup[]) => items.find((i) => i.ref === 'container-logs@1')!;

    test('a provider plus three other installs: all three are acceptors, none unaffiliated', () => {
      const items = buildContractRollup([
        { deployment: app('alloy'), contracts: { provides: ['container-logs@1'], granted: ['container-logs@1'] } },
        { deployment: app('appA'), contracts: {} },
        { deployment: app('appB'), contracts: {} },
        { deployment: app('appC'), contracts: {} },
      ]);
      const rollup = containerLogsOf(items);
      expect(rollup.providers.map((p) => p.deploymentId)).toEqual(['alloy']);
      expect(rollup.acceptors.map((p) => p.deploymentId).sort()).toEqual(['appA', 'appB', 'appC']);
      expect(rollup.unaffiliated).toEqual([]);
    });

    test('a manifest declaring accepts for the implicit contract does not double-list it — coercion already dropped it', () => {
      // buildContractRollup trusts coerceRefs to have stripped a stray
      // `accepts: ['container-logs@1']` already; this proves the rollup itself
      // is also implicit-aware (defence in depth) — the app appears exactly once.
      const items = buildContractRollup([
        { deployment: app('alloy'), contracts: { provides: ['container-logs@1'] } },
        { deployment: app('sneaky'), contracts: { accepts: ['container-logs@1'] } },
      ]);
      const rollup = containerLogsOf(items);
      expect(rollup.acceptors.filter((p) => p.deploymentId === 'sneaky')).toHaveLength(1);
      expect(rollup.acceptors[0]).not.toHaveProperty('hooks');
      expect(rollup.acceptors[0]).not.toHaveProperty('coverage');
    });

    test('a provider that is itself a subject appears once, under providers only', () => {
      const items = buildContractRollup([
        { deployment: app('alloy'), contracts: { provides: ['container-logs@1'], granted: ['container-logs@1'] } },
      ]);
      const rollup = containerLogsOf(items);
      expect(rollup.providers.map((p) => p.deploymentId)).toEqual(['alloy']);
      expect(rollup.acceptors).toEqual([]);
    });

    test('backup@1 buckets are unchanged by this feature — declared participation, unaffiliated apps still listed', () => {
      const items = buildContractRollup([
        { deployment: app('backrest'), contracts: { provides: ['backup@1'], granted: ['backup@1'] } },
        { deployment: app('immich'), contracts: {} },
      ]);
      const backup = items.find((i) => i.ref === 'backup@1')!;
      expect(backup.participation).toBe('declared');
      expect(backup.unaffiliated.map((p) => p.deploymentId)).toEqual(['immich']);
    });
  });
});

/**
 * Participation markers (spec 007). Regression tests for a defect that shipped
 * and was found only on a live host: `coerceRefs` resolves every `accepts` entry
 * through `parseContractRef`, `restore@1` deliberately has no `CONTRACTS` entry
 * (it is a marker, not a brokered contract), so it was silently stripped from
 * every manifest on catalog read. `createDraft` then refused every restore with
 * `RESTORE_NOT_ACCEPTED` and restore-on-install could not work at all.
 *
 * Every spec-007 unit test passed throughout, because they construct manifests
 * directly and never traverse this function. These tests close that gap.
 */
describe('restore@1 promoted to a real brokered contract (spec 008, supersedes spec 007 FR-047)', () => {
  const silent = { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as never;

  // Quickstart scenario 1 — ★ HIGHEST VALUE. Exercises the REAL manifest
  // coercion path (`coerceAccepts`), not a hand-built fixture, and asserts
  // `restore@1` resolves to a real CONTRACTS entry with a provider/acceptor
  // shape. FR-002, FR-003.
  //
  // Verified manually during implementation (not re-run automatically, since
  // the carve-out no longer exists in source to reintroduce at test time):
  // temporarily restoring `services/core/contracts.ts`'s deleted
  // `if (role === 'accepts' && isParticipationMarker(ref)) { out.push(ref); continue; }`
  // carve-out made this exact test fail, because `parseContractRef('restore@1')`
  // was never reached — confirming the test exercises the deletion, not merely
  // the presence of a table row.
  test('scenario 1: accepts resolves restore@1 through the real CONTRACTS table, not a marker carve-out', () => {
    expect(parseContractRef('restore@1')).toMatchObject({
      id: 'restore',
      version: 1,
      shape: 'brokered',
      providerKind: 'app',
      participation: 'declared',
      acceptorBlock: 'restore',
    });
    expect(coerceAccepts(['backup@1', 'restore@1'], silent)).toEqual(['backup@1', 'restore@1']);
    expect(coerceAccepts(['restore@1'], silent)).toEqual(['restore@1']);
    // The discriminating assertion: the deleted carve-out pushed the raw ref
    // unconditionally (`out.push(ref); continue;`), skipping the real path's
    // `if (!out.includes(canonical))` dedup guard — so a duplicate ref
    // survives coercion under the carve-out but not under real resolution.
    // Manually confirmed this line fails when the carve-out is reintroduced.
    expect(coerceAccepts(['restore@1', 'restore@1'], silent)).toEqual(['restore@1']);
  });

  // FR-006: every app that already declares provides no manifest change.
  test('scenario 4: restore@1 with no accompanying block still coerces (a plain-file-copy declaration, unchanged from spec 007)', () => {
    expect(coerceAccepts(['restore@1'], silent)).toEqual(['restore@1']);
  });

  test('provides now resolves restore@1 — an app CAN declare the provider role (spec 008, unlike spec 007)', () => {
    expect(coerceProvides(['restore@1'], silent)).toEqual(['restore@1']);
  });

  test('a genuinely unknown ref is still dropped (ADR 0003 forward-compat intact)', () => {
    expect(coerceAccepts(['restore@2'], silent)).toBeUndefined();
    expect(coerceAccepts(['nonsense@1'], silent)).toBeUndefined();
    expect(coerceAccepts(['restore'], silent)).toBeUndefined();
  });

  // FR-002: the marker mechanism no longer exists as exports at all.
  test('scenario 2: PARTICIPATION_MARKERS / RESTORE_PARTICIPATION_REF / isParticipationMarker no longer exist', async () => {
    const contracts = await import('@hola/shared/contracts');
    expect('PARTICIPATION_MARKERS' in contracts).toBe(false);
    expect('RESTORE_PARTICIPATION_REF' in contracts).toBe(false);
    expect('isParticipationMarker' in contracts).toBe(false);
  });
});
