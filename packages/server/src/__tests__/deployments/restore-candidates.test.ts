/**
 * Pure-function coverage for the provider half of `restore-candidates.ts`
 * (spec 008): `parseCandidateId`, `describeProviderCandidate`,
 * `judgeProviderRestoreChoice`, `suppressInferredDefault`, and the
 * inferred-identity acknowledgement/no-default rules (US5). No I/O — see
 * `restore-provider.test.ts` for the real-filesystem, end-to-end coverage.
 */
import { describe, test, expect } from 'bun:test';

import {
  parseCandidateId,
  describeProviderCandidate,
  resolveListedProviderCandidate,
  judgeProviderRestoreChoice,
  suppressInferredDefault,
  groupIntoLineages,
  inferInstallNameFromLocation,
} from '../../services/core/restore-candidates';
import type { AppEnvVar, RestoreIndexEntry, RestoreCandidate } from '@hola/shared';

/**
 * The version-being-installed's declared environment. Only the `isSecret` +
 * `generate` rows are platform-minted, so only those are re-minted when
 * nothing is carried — which is every provider restore (FR-052).
 */
const appEnv: AppEnvVar[] = [
  { key: 'TZ', value: 'UTC', isSecret: false },
  { key: 'OPERATOR_TOKEN', value: 'set-by-hand', isSecret: true },
  { key: 'DB_PASSWORD', value: '', isSecret: true, generate: { kind: 'hex' } },
  { key: 'SESSION_SECRET', value: '', isSecret: true, generate: { kind: 'hex' } },
];

const entry = (overrides: Partial<RestoreIndexEntry> = {}): RestoreIndexEntry => ({
  captureId: 'cap-1',
  takenAt: '2026-02-01T09:00:00.000Z',
  sizeBytes: 1024,
  location: '/srv/hola/apps/wiki-1a2b3c4d',
  identity: null,
  ...overrides,
});

describe('parseCandidateId (spec 008, data-model.md §6c)', () => {
  test('no colon -> a local deployment id', () => {
    expect(parseCandidateId('mealie-3f2a9c11')).toEqual({ kind: 'deployment', deploymentId: 'mealie-3f2a9c11' });
  });

  test('splits on the FIRST colon -> provider deployment id + capture id', () => {
    expect(parseCandidateId('backrest-91a2c3d4:cap_20260201T090000Z')).toEqual({
      kind: 'provider',
      providerDeploymentId: 'backrest-91a2c3d4',
      captureId: 'cap_20260201T090000Z',
    });
  });

  test('a capture id that itself contains a colon is preserved whole (first-colon split)', () => {
    expect(parseCandidateId('backrest-1:cap:with:colons')).toEqual({
      kind: 'provider', providerDeploymentId: 'backrest-1', captureId: 'cap:with:colons',
    });
  });
});

describe('inferInstallNameFromLocation (research R19, FR-049)', () => {
  test('a location whose last segment matches <slug>-<8hex> yields the slug', () => {
    expect(inferInstallNameFromLocation('/srv/hola/apps/wiki-1a2b3c4d')).toBe('wiki');
    expect(inferInstallNameFromLocation('/srv/hola/apps/my-cool-wiki-deadbeef')).toBe('my-cool-wiki');
  });

  test('a location whose last segment does NOT match the shape yields no installName', () => {
    expect(inferInstallNameFromLocation('/srv/hola/apps/not-a-deployment-id')).toBeUndefined();
    expect(inferInstallNameFromLocation('/srv/hola/apps/short-abc')).toBeUndefined();
  });
});

describe('describeProviderCandidate (data-model.md §6b — the app-matching rule)', () => {
  test('identity.app equal to the queried appId -> included, confidence marker', () => {
    const d = describeProviderCandidate({
      entry: entry({ identity: { app: 'mealie', appVersion: '3.20.1' } }),
      providerDeploymentId: 'backrest-1',
      queriedAppId: 'mealie',
    });
    expect(d).toMatchObject({ source: 'provider', confidence: 'marker', app: 'mealie', candidateId: 'backrest-1:cap-1' });
  });

  test('identity.app different from the queried appId -> excluded entirely (null)', () => {
    const d = describeProviderCandidate({
      entry: entry({ identity: { app: 'immich' } }),
      providerDeploymentId: 'backrest-1',
      queriedAppId: 'mealie',
    });
    expect(d).toBeNull();
  });

  test('identity null -> included for the queried appId, confidence path, app from the ROUTE not the capture', () => {
    const d = describeProviderCandidate({ entry: entry({ identity: null }), providerDeploymentId: 'backrest-1', queriedAppId: 'mealie' });
    expect(d).toMatchObject({ source: 'provider', confidence: 'path', app: 'mealie', hasIdentityRecord: false });
  });

  // Quickstart scenario 50
  test('an inferred installName equal to a real app id is never treated as that app\'s identity', () => {
    const d = describeProviderCandidate({
      entry: entry({ location: '/srv/hola/apps/mealie-deadbeef', identity: null }),
      providerDeploymentId: 'backrest-1',
      queriedAppId: 'someotherapp',
    });
    // Offered for the QUERIED app (someotherapp), never silently as 'mealie'.
    expect(d?.app).toBe('someotherapp');
    expect(d?.hasIdentityRecord).toBe(false);
    expect(d?.confidence).toBe('path');
  });
});

describe('resolveListedProviderCandidate (FR-051)', () => {
  test('a confidence: path candidate REQUIRES restore-inferred-identity in requiredAcknowledgements', () => {
    const candidate = resolveListedProviderCandidate(entry({ identity: null }), 'backrest-1', 'mealie', undefined, undefined, []);
    expect(candidate?.requiredAcknowledgements).toContain('restore-inferred-identity');
  });

  test('a confidence: marker candidate does not require restore-inferred-identity', () => {
    const candidate = resolveListedProviderCandidate(entry({ identity: { app: 'mealie', appVersion: '1.0.0' } }), 'backrest-1', 'mealie', '1.0.0', {}, []);
    expect(candidate?.requiredAcknowledgements).not.toContain('restore-inferred-identity');
  });

  test('a provider candidate always assumes carryEnv: false — there is no environment record to carry (FR-052)', () => {
    const candidate = resolveListedProviderCandidate(entry({ identity: { app: 'mealie' } }), 'backrest-1', 'mealie', undefined, undefined, []);
    expect(candidate?.carriesEnv).toBe(false);
  });

  // #503: FR-052 makes "nothing is carried" unconditional for this origin, so
  // the keys that get re-minted are knowable at listing time — and were being
  // withheld by a hard-coded empty list.
  test('a provider candidate NAMES the platform-minted secrets its restore will re-mint', () => {
    const candidate = resolveListedProviderCandidate(entry({ identity: { app: 'mealie' } }), 'backrest-1', 'mealie', undefined, undefined, appEnv);
    expect(candidate?.warnings).toContainEqual({ code: 'env-not-carried', keys: ['DB_PASSWORD', 'SESSION_SECRET'] });
    // Exactly `isSecret && generate` — an operator-supplied secret is not the
    // platform's to re-mint, and a plain value is not a secret at all.
    const envWarning = candidate?.warnings.find((w) => w.code === 'env-not-carried');
    expect(envWarning?.code === 'env-not-carried' && envWarning.keys).not.toContain('OPERATOR_TOKEN');
    expect(envWarning?.code === 'env-not-carried' && envWarning.keys).not.toContain('TZ');
    // The acknowledgement was always required; now it can say what for.
    expect(candidate?.requiredAcknowledgements).toContain('restore-env-not-carried');
  });

  test('an app with no platform-minted secrets warns about no keys at all', () => {
    const candidate = resolveListedProviderCandidate(
      entry({ identity: { app: 'mealie' } }), 'backrest-1', 'mealie', undefined, undefined,
      [{ key: 'TZ', value: 'UTC', isSecret: false }],
    );
    expect(candidate?.warnings.some((w) => w.code === 'env-not-carried')).toBe(false);
  });

  // #503: a provider capture has no deployment on this host, so the local
  // wording ("described from the deployment record alone") names a fallback
  // that does not exist. The code stays the same; `source` is what lets a
  // renderer tell the operator the truth.
  test('a provider candidate with no identity record carries no warning that references a deployment record', () => {
    const candidate = resolveListedProviderCandidate(entry({ identity: null }), 'backrest-1', 'mealie', undefined, undefined, appEnv);
    expect(candidate?.hasIdentityRecord).toBe(false);
    expect(candidate?.warnings).toContainEqual({ code: 'no-identity-record', source: 'provider' });
    const identityWarning = candidate?.warnings.find((w) => w.code === 'no-identity-record');
    expect(identityWarning?.code === 'no-identity-record' && identityWarning.source).toBe('provider');
    expect(identityWarning?.code === 'no-identity-record' && identityWarning.source).not.toBe('deployment');
  });

  test('a provider candidate WITH an identity record emits no no-identity-record warning at all', () => {
    const candidate = resolveListedProviderCandidate(
      entry({ identity: { app: 'mealie', appVersion: '1.0.0' } }), 'backrest-1', 'mealie', undefined, undefined, appEnv,
    );
    expect(candidate?.warnings.some((w) => w.code === 'no-identity-record')).toBe(false);
  });
});

describe('judgeProviderRestoreChoice (FR-046 — provider origin weakens nothing)', () => {
  test('a gone entry (pruned from the index) refuses RESTORE_CANDIDATE_GONE', () => {
    const result = judgeProviderRestoreChoice({
      entry: undefined, providerDeploymentId: 'backrest-1', providerStillConsented: true, queriedAppId: 'mealie',
      choice: { candidateId: 'backrest-1:cap-1', carryEnv: false }, targetVersion: '1.0.0', meta: {}, requiresEnv: false, envNotCarriedKeys: [],
    });
    expect(result).toMatchObject({ ok: false, code: 'RESTORE_CANDIDATE_GONE' });
  });

  test('consent revoked (providerStillConsented: false) refuses RESTORE_CANDIDATE_GONE even with a live entry', () => {
    const result = judgeProviderRestoreChoice({
      entry: entry(), providerDeploymentId: 'backrest-1', providerStillConsented: false, queriedAppId: 'mealie',
      choice: { candidateId: 'backrest-1:cap-1', carryEnv: false }, targetVersion: '1.0.0', meta: {}, requiresEnv: false, envNotCarriedKeys: [],
    });
    expect(result).toMatchObject({ ok: false, code: 'RESTORE_CANDIDATE_GONE' });
  });

  // Quickstart scenario 46 — same refusal vocabulary as the local path.
  test('a candidate newer than the target refuses RESTORE_SOURCE_NEWER; unacknowledged env-carry refuses RESTORE_ACK_REQUIRED', () => {
    const newer = judgeProviderRestoreChoice({
      entry: entry({ identity: { app: 'mealie', appVersion: '9.0.0' } }), providerDeploymentId: 'backrest-1', providerStillConsented: true, queriedAppId: 'mealie',
      choice: { candidateId: 'backrest-1:cap-1', carryEnv: false, acknowledge: ['restore-inferred-identity'] },
      targetVersion: '1.0.0', meta: {}, requiresEnv: false, envNotCarriedKeys: [],
    });
    expect(newer).toMatchObject({ ok: false, code: 'RESTORE_SOURCE_NEWER' });

    const noAck = judgeProviderRestoreChoice({
      entry: entry({ identity: null }), providerDeploymentId: 'backrest-1', providerStillConsented: true, queriedAppId: 'mealie',
      choice: { candidateId: 'backrest-1:cap-1', carryEnv: false }, // no acknowledge at all
      targetVersion: '1.0.0', meta: {}, requiresEnv: false, envNotCarriedKeys: [],
    });
    expect(noAck).toMatchObject({ ok: false, code: 'RESTORE_ACK_REQUIRED' });
  });

  // Quickstart scenario 51
  test('supplying restore-inferred-identity proceeds for an inferred candidate', () => {
    const result = judgeProviderRestoreChoice({
      entry: entry({ identity: null }), providerDeploymentId: 'backrest-1', providerStillConsented: true, queriedAppId: 'mealie',
      choice: { candidateId: 'backrest-1:cap-1', carryEnv: false, acknowledge: ['restore-inferred-identity', 'restore-version-unknown', 'restore-env-not-carried'] },
      targetVersion: '1.0.0', meta: {}, requiresEnv: false, envNotCarriedKeys: [],
    });
    expect(result.ok).toBe(true);
  });
});

describe('suppressInferredDefault (FR-052a, SC-017) — quickstart scenario 53, ★ highest value', () => {
  function markerCandidate(id: string, lineageId: string): RestoreCandidate {
    return {
      candidateId: id, deploymentId: id, source: 'deployment', confidence: 'marker', lineageId,
      app: 'mealie', name: id, subdomain: null, host: null, appVersion: '1.0.0', channel: 'stable',
      carriesEnv: false, capturedAt: '2026-01-01T00:00:00.000Z', hasIdentityRecord: true,
      skew: { kind: 'ok' }, requiredAcknowledgements: [], warnings: [],
    };
  }
  function pathCandidate(id: string, lineageId: string): RestoreCandidate {
    return { ...markerCandidate(id, lineageId), deploymentId: undefined, source: 'provider', confidence: 'path' };
  }

  test('a single lineage whose top candidate is confidence: path suppresses the default', () => {
    const grouped = groupIntoLineages([pathCandidate('backrest-1:cap-1', 'lost-install')]);
    expect(grouped.defaultCandidateId).toBe('backrest-1:cap-1'); // groupIntoLineages itself is unchanged
    const suppressed = suppressInferredDefault(grouped);
    expect(suppressed.defaultCandidateId).toBeNull();
    expect(suppressed.requiresExplicitChoice).toBe(true);
  });

  test('isolation: the SAME lineage input with confidence: marker instead DOES produce a non-null default', () => {
    const grouped = groupIntoLineages([markerCandidate('mealie-aaaaaaaa', 'mealie-aaaaaaaa')]);
    const result = suppressInferredDefault(grouped);
    expect(result.defaultCandidateId).toBe('mealie-aaaaaaaa'); // unaffected — proves suppression is confidence-scoped
  });

  test('two-or-more lineages already have no default regardless of confidence — suppression is a no-op there', () => {
    const grouped = groupIntoLineages([pathCandidate('backrest-1:cap-1', 'a'), pathCandidate('backrest-1:cap-2', 'b')]);
    expect(suppressInferredDefault(grouped).defaultCandidateId).toBeNull();
  });
});

describe('candidateId back-compat (FR-045) — quickstart scenario 45', () => {
  test('a stale client\'s deploymentId-based find() never matches a provider-origin candidate', () => {
    const providerOnly: RestoreCandidate[] = [{
      candidateId: 'backrest-1:cap-1', source: 'provider', confidence: 'path', lineageId: 'x',
      app: 'mealie', name: 'x', subdomain: null, host: null, appVersion: null, channel: null,
      carriesEnv: false, capturedAt: null, hasIdentityRecord: false, skew: { kind: 'unknown' },
      requiredAcknowledgements: [], warnings: [],
    }];
    // Simulated OLD client logic.
    const found = providerOnly.find((c) => c.deploymentId === 'backrest-1:cap-1');
    expect(found).toBeUndefined(); // never a false match, never a crash
  });
});
