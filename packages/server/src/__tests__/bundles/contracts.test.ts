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
} from '@hola/shared/contracts';

import { coerceAccepts, coerceProvides, findUndeclaredAcceptorBlocks } from '../../services/core/contracts';
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

  test('models the three contracts ADR 0004 names, with their shapes', () => {
    // The shape is the ADR's load-bearing distinction — broker an operation,
    // provision a connection. auth was always provisioned; naming it here is what
    // stops a future contract from being brokered by default.
    expect(parseContractRef('auth@1')).toMatchObject({ shape: 'provisioned', providerKind: 'platform' });
    expect(parseContractRef('backup@1')).toMatchObject({ shape: 'brokered', providerKind: 'app' });
    expect(parseContractRef('push@1')).toMatchObject({ shape: 'brokered', providerKind: 'platform' });
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
});
