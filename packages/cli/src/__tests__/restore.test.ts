import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { runInstall, parseAcks } from '../commands/install/install';
import { reportDeployError } from '../lib/deploy-flow';
import { HolaApiError } from '@hola/sdk';
import type { HolaSdk } from '@hola/sdk';
import type { ListRestoreCandidatesResponse } from '@hola/shared';

function candidate(id: string, lineageId: string, carriesEnv = true) {
  return {
    candidateId: id,
    deploymentId: id,
    source: 'deployment' as const,
    confidence: 'marker' as const,
    lineageId,
    app: 'mealie',
    name: id,
    subdomain: id,
    host: `${id}.example.com`,
    appVersion: '1.0.0',
    channel: 'stable',
    carriesEnv,
    capturedAt: '2026-01-01T00:00:00.000Z',
    hasIdentityRecord: true,
    skew: { kind: 'ok' as const },
    requiredAcknowledgements: [],
    warnings: [],
  };
}

function makeSdk(overrides: { drafts?: Record<string, unknown>; restoreCandidatesResp?: ListRestoreCandidatesResponse } = {}) {
  const calls: string[] = [];
  const oneLineage: ListRestoreCandidatesResponse = {
    appId: 'mealie',
    lineages: [{ lineageId: 'l1', candidates: [candidate('mealie-aaa', 'l1')] }],
    defaultCandidateId: 'mealie-aaa',
    requiresExplicitChoice: false,
  };
  return {
    calls,
    drafts: {
      create: vi.fn(async () => { calls.push('create'); return { draftId: 'd1' }; }),
      byId: vi.fn(async () => { calls.push('byId'); return { draftId: 'd1', appEnv: [] }; }),
      update: vi.fn(async () => { calls.push('update'); return { ok: true }; }),
      validate: vi.fn(async () => { calls.push('validate'); return { ok: true, errors: [], warnings: [] }; }),
      preflight: vi.fn(async () => { calls.push('preflight'); return { ok: true, checks: [] }; }),
      finalize: vi.fn(async () => { calls.push('finalize'); return { spec: {}, checksum: 'x' }; }),
      ...(overrides.drafts ?? {}),
    },
    deployments: {
      create: vi.fn(async () => { calls.push('deploy'); return { deploymentId: 'dep1', releaseId: 'r1', jobId: 'j1' }; }),
    },
    jobs: { byId: vi.fn(async () => ({ status: 'completed' })) },
    restoreCandidates: vi.fn(async () => overrides.restoreCandidatesResp ?? oneLineage),
  };
}

describe('restore-on-install CLI (spec 007)', () => {
  beforeEach(() => { process.exitCode = 0; });
  afterEach(() => { process.exitCode = 0; vi.restoreAllMocks(); });

  // ---- parseAcks mirrors parseGrants exactly (scenario 52) ----
  it('scenario 52: parseAcks parses repeated and comma-separated values exactly like --grant', () => {
    expect(parseAcks(undefined)).toBeUndefined();
    expect(parseAcks('a')).toEqual(['a']);
    expect(parseAcks(['a', 'b'])).toEqual(['a', 'b']);
    expect(parseAcks('a,b, c')).toEqual(['a', 'b', 'c']);
    expect(parseAcks(['a,b', 'b'])).toEqual(['a', 'b']); // deduped
  });

  // ---- scenario 49: each flag behaves as specified ----
  it('scenario 49: --restore-from <id> resolves that exact candidate and sends restoreFrom on create', async () => {
    const sdk = makeSdk();
    await runInstall('mealie', { restoreFrom: 'mealie-aaa', ack: 'restore-env-not-carried', noStream: true }, { sdk: sdk as unknown as HolaSdk });

    expect(sdk.restoreCandidates).toHaveBeenCalledWith('mealie', 'latest', undefined, undefined);
    expect(sdk.drafts.create).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'mealie',
      restoreFrom: { candidateId: 'mealie-aaa', carryEnv: true, acknowledge: ['restore-env-not-carried'] },
    }));
  });

  it('scenario 49: --restore-from latest refuses across two-or-more unrelated lineages', async () => {
    const sdk = makeSdk({
      restoreCandidatesResp: {
        appId: 'mealie',
        lineages: [
          { lineageId: 'l1', candidates: [candidate('mealie-aaa', 'l1')] },
          { lineageId: 'l2', candidates: [candidate('mealie-bbb', 'l2')] },
        ],
        defaultCandidateId: null,
        requiresExplicitChoice: true,
      },
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await runInstall('mealie', { restoreFrom: 'latest', noStream: true }, { sdk: sdk as unknown as HolaSdk });

    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('ambiguous'));
    expect(sdk.drafts.create).not.toHaveBeenCalled();
  });

  // spec 008, T111: --restore-from and --restore-list keep working unchanged
  // as opaque-string passthroughs now that a candidate id may be a composite
  // `<providerDeploymentId>:<captureId>` rather than a bare deployment id.
  it('spec 008: --restore-from accepts a composite provider:capture id verbatim', async () => {
    const providerCandidate = {
      ...candidate('backrest-91a2c3d4:cap_20260201T090000Z', 'l1', false),
      source: 'provider' as const,
      confidence: 'path' as const,
      deploymentId: undefined,
    };
    const sdk = makeSdk({
      restoreCandidatesResp: {
        appId: 'mealie',
        lineages: [{ lineageId: 'l1', candidates: [providerCandidate] }],
        defaultCandidateId: null,
        requiresExplicitChoice: true,
      },
    });
    await runInstall(
      'mealie',
      { restoreFrom: 'backrest-91a2c3d4:cap_20260201T090000Z', ack: ['restore-inferred-identity', 'restore-env-not-carried'], noStream: true },
      { sdk: sdk as unknown as HolaSdk },
    );

    expect(sdk.drafts.create).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'mealie',
      restoreFrom: {
        candidateId: 'backrest-91a2c3d4:cap_20260201T090000Z',
        carryEnv: false,
        acknowledge: ['restore-inferred-identity', 'restore-env-not-carried'],
      },
    }));
  });

  it('spec 008: --restore-list prints a composite candidate id verbatim as Default: <id>', async () => {
    const providerCandidate = {
      ...candidate('backrest-91a2c3d4:cap_20260201T090000Z', 'l1', false),
      source: 'provider' as const,
      confidence: 'path' as const,
      deploymentId: undefined,
    };
    const sdk = makeSdk({
      restoreCandidatesResp: {
        appId: 'mealie',
        lineages: [{ lineageId: 'l1', candidates: [providerCandidate] }],
        defaultCandidateId: 'backrest-91a2c3d4:cap_20260201T090000Z',
        requiresExplicitChoice: false,
      },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runInstall('mealie', { restoreList: true, noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Default: backrest-91a2c3d4:cap_20260201T090000Z'));
    logSpy.mockRestore();
  });

  // The trailer line above was the ONLY thing asserted about a provider
  // candidate's id, and it comes from `defaultCandidateId` — the server's
  // string, echoed. The per-candidate ROW is what an operator copies into
  // `--restore-from`, and it printed `c.deploymentId`, which is `undefined`
  // for a provider-held capture (it has no deployment on this host). So
  // `--restore-list` rendered every provider candidate as `undefined` and
  // gave the operator nothing to select — US1 was unreachable from the CLI.
  it('spec 008: the --restore-list ROW prints the candidate id, never an undefined deploymentId', async () => {
    const providerCandidate = {
      ...candidate('backrest-91a2c3d4:cap_20260201T090000Z', 'l1', false),
      source: 'provider' as const,
      confidence: 'path' as const,
      deploymentId: undefined,
    };
    const sdk = makeSdk({
      restoreCandidatesResp: {
        appId: 'mealie',
        lineages: [{ lineageId: 'l1', candidates: [providerCandidate] }],
        defaultCandidateId: null,
        requiresExplicitChoice: true,
      },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runInstall('mealie', { restoreList: true, noStream: true }, { sdk: sdk as unknown as HolaSdk });

    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    logSpy.mockRestore();

    const row = output.split('\n').find(l => l.trimStart().startsWith('backrest-91a2c3d4:cap_20260201T090000Z'));
    expect(row).toBeDefined();
    expect(output).not.toContain('undefined');
    // The origin is visible, and the acknowledgement the operator will need
    // is named on screen rather than discovered by a failed install.
    expect(output).toContain('backup provider');
    expect(output).toContain('--ack restore-inferred-identity');
  });

  // FR-052a: a single lineage can arrive with no default because its top
  // candidate's identity was INFERRED. Reporting that as "1 unrelated
  // lineages match" points the operator at a problem they do not have.
  it('spec 008: --restore-from latest explains an inferred-identity suppression, not a phantom ambiguity', async () => {
    const providerCandidate = {
      ...candidate('backrest-91a2c3d4:cap_20260201T090000Z', 'l1', false),
      source: 'provider' as const,
      confidence: 'path' as const,
      deploymentId: undefined,
    };
    const sdk = makeSdk({
      restoreCandidatesResp: {
        appId: 'mealie',
        lineages: [{ lineageId: 'l1', candidates: [providerCandidate] }],
        defaultCandidateId: null,
        requiresExplicitChoice: true,
      },
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runInstall('mealie', { restoreFrom: 'latest', noStream: true }, { sdk: sdk as unknown as HolaSdk });
    const output = errSpy.mock.calls.map(c => String(c[0])).join('\n');
    errSpy.mockRestore();

    expect(output).toMatch(/identity was inferred/i);
    expect(output).toContain('--ack restore-inferred-identity');
    expect(output).not.toMatch(/1 unrelated lineages/);
    expect(sdk.drafts.create).not.toHaveBeenCalled();
  });

  it('scenario 49: --restore-list lists candidates and creates no draft', async () => {
    const sdk = makeSdk();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await runInstall('mealie', { restoreList: true, noStream: true }, { sdk: sdk as unknown as HolaSdk });

    expect(res).toBeUndefined();
    expect(sdk.restoreCandidates).toHaveBeenCalledWith('mealie', 'latest', undefined, undefined);
    expect(sdk.drafts.create).not.toHaveBeenCalled();
    expect(sdk.deployments.create).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('mealie-aaa'));
    logSpy.mockRestore();
  });

  it('scenario 49: --no-restore is a no-op — same outcome as no flag at all', async () => {
    const sdk = makeSdk();
    await runInstall('mealie', { restore: false, noStream: true }, { sdk: sdk as unknown as HolaSdk });

    expect(sdk.restoreCandidates).not.toHaveBeenCalled();
    expect(sdk.drafts.create).toHaveBeenCalledWith({ appId: 'mealie', version: 'latest' });
  });

  // ---- scenario 50: no restore flag at all -> no restore, even with candidates present ----
  it('scenario 50: with no restore flag, no restore happens even when candidates exist (FR-044)', async () => {
    const sdk = makeSdk(); // restoreCandidates would report a candidate if asked
    await runInstall('mealie', { noStream: true }, { sdk: sdk as unknown as HolaSdk });

    // The candidates route is never even consulted — silence must never guess.
    expect(sdk.restoreCandidates).not.toHaveBeenCalled();
    expect(sdk.drafts.create).toHaveBeenCalledWith({ appId: 'mealie', version: 'latest' });
  });

  // ---- scenario 51 (HIGHEST-adjacent): every hint is built from details, never the message ----
  it('scenario 51: every RESTORE_* hint is built from details alone, with the message blanked', () => {
    const cases: Array<{ code: string; details: Record<string, unknown>; expect: string }> = [
      { code: 'RESTORE_SOURCE_NEWER', details: { candidateVersion: '2.0.0', targetVersion: '1.0.0' }, expect: '2.0.0' },
      { code: 'RESTORE_UPGRADE_PATH', details: { suggestedVersion: '1.5.0' }, expect: '1.5.0' },
      { code: 'RESTORE_ENV_REQUIRED', details: { missingKeys: ['DB_PASSWORD'] }, expect: 'DB_PASSWORD' },
      { code: 'RESTORE_ACK_REQUIRED', details: { required: ['restore-env-not-carried'] }, expect: '--ack restore-env-not-carried' },
      { code: 'RESTORE_CANDIDATE_GONE', details: {}, expect: '--restore-list' },
      { code: 'RESTORE_CANDIDATE_BUSY', details: {}, expect: '--restore-list' },
      { code: 'RESTORE_NOT_SUPPORTED', details: {}, expect: 'install-by-ref' },
      // #490: the hint names the candidate and the address it still holds, and
      // asks for --name — it never invents a suffixed address as the answer.
      { code: 'RESTORE_ADDRESS_REQUIRED', details: { candidateId: 'mealie-aaa', candidateName: 'Recipes', subdomain: 'recipes' }, expect: '--name' },
    ];

    for (const c of cases) {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      // Message deliberately blank — the hint must not depend on it at all.
      const err = new HolaApiError('', 409, { details: { code: c.code, ...c.details } });
      reportDeployError(err);
      const hintCall = errSpy.mock.calls.find(call => String(call[0]).startsWith('Hint:'));
      expect(hintCall, `no Hint printed for ${c.code}`).toBeTruthy();
      expect(String(hintCall![0])).toContain(c.expect);
      errSpy.mockRestore();
    }
  });

  // ---- #490: the RESTORE_ADDRESS_REQUIRED hint names what is in the way ----
  it('the RESTORE_ADDRESS_REQUIRED hint names the candidate and the address it holds', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    reportDeployError(
      new HolaApiError('', 409, {
        details: { code: 'RESTORE_ADDRESS_REQUIRED', candidateId: 'mealie-aaa', candidateName: 'Recipes', subdomain: 'recipes' },
      }),
    );
    const hint = String(errSpy.mock.calls.find(call => String(call[0]).startsWith('Hint:'))?.[0] ?? '');
    expect(hint).toContain('Recipes');
    expect(hint).toContain('recipes');
    expect(hint).toContain('--name');
    errSpy.mockRestore();
  });
});
