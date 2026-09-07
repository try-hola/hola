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
  grantsInclude,
  missingGrantConsents,
  parseContractRef,
  providerGrantsFor,
  backupParticipations,
  isDatabaseImage,
  judgeBackupCoverage,
} from '@hola/shared/contracts';

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

  test('models the four contracts ADR 0004 names, with their shapes', () => {
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
  });

  test('every entry declares a participation mode (spec 004)', () => {
    for (const def of CONTRACTS) {
      expect(['declared', 'implicit']).toContain(def.participation);
    }
    expect(parseContractRef('auth@1')?.participation).toBe('declared');
    expect(parseContractRef('backup@1')?.participation).toBe('declared');
    expect(parseContractRef('push@1')?.participation).toBe('declared');
    expect(parseContractRef('container-logs@1')?.participation).toBe('implicit');
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
    expect(grantsInclude([], 'apps-data')).toBe(false);
  });

  test('grantsInclude keys off the contract, not the ref string', () => {
    expect(grantsInclude(['backup@1'], 'apps-data')).toBe(true);
    expect(grantsInclude(['auth@1', 'push@1'], 'apps-data')).toBe(false);
    expect(grantsInclude(['telemetry@1'], 'apps-data')).toBe(false);
  });

  test('container-logs@1 carries its own grant kind', () => {
    expect(providerGrantsFor(['container-logs@1'])).toEqual([
      { ref: 'container-logs@1', grant: expect.objectContaining({ kind: 'container-logs' }) },
    ]);
    expect(grantsInclude(['container-logs@1'], 'container-logs')).toBe(true);
    expect(grantsInclude(['backup@1'], 'container-logs')).toBe(false);
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
