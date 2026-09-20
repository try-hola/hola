/**
 * Restore-on-install from a live deployment (spec 007).
 *
 * Two groups:
 *  - "Pure resolver": `restore-candidates.ts`'s exported functions, exercised
 *    directly with fabricated data — no filesystem, no server. Covers the
 *    scenarios quickstart.md marks mode "U".
 *  - "Real filesystem harness": `RealDeploymentService` + `RealDraftService`
 *    over `RealStorageService` in two `mkdtemp` roots, `MockDockerService`
 *    (records `composeUp` calls — plan.md's "Known trap") and
 *    `MockProvisionerService`. Copied from `install-markers.test.ts:116-142`
 *    / `snapshot.test.ts:99-125`. `MockStorageService` cannot be used here —
 *    it discards file modes (#475) — and `MockDockerService` starts no real
 *    containers, so anything asserting on real files or real ordering needs
 *    this harness. Covers the scenarios marked "U-fs".
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type {
  AppEnvVar,
  AppBackupDeclaration,
  AppRestoreDeclaration,
  AppAuthConfig,
  AppUpgradeMeta,
  RestoreCandidate,
  RestoreChoice,
} from '@hola/shared';
import { checkUpgradePath, slugifySubdomain } from '@hola/shared';

import { RealDeploymentService } from '../../services/core/deployment';
import { MockProvisionerService } from '../../services/core/provisioner';
import { RealDraftService } from '../../services/core/draft';
import { RealStorageService } from '../../services/core/storage';
import { RealRoutingService } from '../../services/core/routing';
import { RealDatabaseService } from '../../services/core/database';
import { RealLoggingService } from '../../services/core/logging';
import { RealJobService } from '../../services/core/jobs';
import { MockDockerService } from '../../services/core/docker';
import { dirHasContents } from '../../services/core/snapshot-fs';
import { coerceManifestRestore } from '../../services/core/manifest-restore';
import {
  isEligibleCandidate,
  describeCandidate,
  groupIntoLineages,
  computeSkewVerdict,
  deriveEnvNotCarriedKeys,
  deriveRequiredAcknowledgements,
  validateRestoreChoice,
  checkCandidateStillEligible,
  judgeRestoreChoice,
  resolveRestoreNameDefaults,
  type CandidateSource,
} from '../../services/core/restore-candidates';

// ---------------------------------------------------------------------------
// Pure resolver — no filesystem, no server (quickstart.md scenarios marked "U")
// ---------------------------------------------------------------------------

/** A settled, well-formed deployment record, only the fields the resolver reads. */
function fakeDeployment(overrides: Partial<CandidateSource['deployment']> = {}): CandidateSource['deployment'] {
  return {
    id: 'demoapp-aaaaaaaa',
    name: 'Demo',
    app: 'demoapp',
    icon: '📦',
    status: 'running',
    resources: { cpu: '0%', memory: '0MB' },
    ports: [],
    lastUpdated: new Date().toISOString(),
    lifecycleState: 'active',
    rollbackAvailable: false,
    metadata: { createdAt: new Date().toISOString(), owner: 'system', tags: [] },
    ...overrides,
  } as CandidateSource['deployment'];
}

function fakeSource(overrides: Partial<CandidateSource> = {}): CandidateSource {
  return {
    deployment: fakeDeployment(),
    identity: null,
    hasData: true,
    carriesEnv: false,
    ...overrides,
  };
}

describe('Restore-on-install (spec 007) — pure resolver', () => {
  // ---- Scenario 5: lineage grouping/ordering, default/explicit choice ----
  test('scenario 5: candidates group by lineage, newest-first; two lineages need an explicit pick', () => {
    const c = (id: string, lineageId: string, capturedAt: string | null): RestoreCandidate => ({
      deploymentId: id,
      lineageId,
      app: 'demoapp',
      name: id,
      subdomain: null,
      host: null,
      appVersion: '1.0.0',
      channel: 'stable',
      carriesEnv: false,
      capturedAt,
      hasIdentityRecord: true,
      skew: { kind: 'ok' },
      requiredAcknowledgements: [],
      warnings: [],
    });

    // Two lineages: no default, explicit choice required.
    const twoLineages = groupIntoLineages([
      c('a1', 'lineage-a', '2026-01-01T00:00:00.000Z'),
      c('a2', 'lineage-a', '2026-01-02T00:00:00.000Z'),
      c('b1', 'lineage-b', '2026-01-01T00:00:00.000Z'),
    ]);
    expect(twoLineages.lineages).toHaveLength(2);
    expect(twoLineages.requiresExplicitChoice).toBe(true);
    expect(twoLineages.defaultCandidateId).toBeNull();
    // Newest-first within the lineage.
    expect(twoLineages.lineages.find(l => l.lineageId === 'lineage-a')!.candidates.map(x => x.deploymentId)).toEqual(['a2', 'a1']);

    // One lineage: newest supplies the default.
    const oneLineage = groupIntoLineages([
      c('x1', 'lineage-x', '2026-01-01T00:00:00.000Z'),
      c('x2', 'lineage-x', '2026-01-03T00:00:00.000Z'),
    ]);
    expect(oneLineage.requiresExplicitChoice).toBe(false);
    expect(oneLineage.defaultCandidateId).toBe('x2');
  });

  // ---- Scenario 7: empty list is 200, not 404 (answered by the shape, not a status code here) ----
  test('scenario 7: no candidates yields an empty-but-valid grouping, not an error', () => {
    const result = groupIntoLineages([]);
    expect(result.lineages).toEqual([]);
    expect(result.defaultCandidateId).toBeNull();
    expect(result.requiresExplicitChoice).toBe(false);
  });

  // ---- Scenario 34 (HIGHEST VALUE): checkUpgradePath cannot express "refuse a newer source" ----
  test('scenario 34 (highest value): checkUpgradePath(newer, older, meta) returns ok — the rule this feature adds independently', () => {
    const meta: AppUpgradeMeta = { minFromVersion: '1.0.0' };
    // Documents WHY FR-029 is a rule of this feature's own, not delegated:
    // checkUpgradePath treats a "from" newer than "to" as a downgrade, which
    // it deliberately allows through for the promote path it was built for.
    expect(checkUpgradePath('2.0.0', '1.0.0', meta)).toEqual({ ok: true });

    // computeSkewVerdict evaluates the newer-than-target rule FIRST and
    // therefore refuses exactly the case checkUpgradePath alone would miss.
    const verdict = computeSkewVerdict('2.0.0', '1.0.0', meta);
    expect(verdict).toMatchObject({ kind: 'refused', code: 'RESTORE_SOURCE_NEWER' });
  });

  // ---- Scenario 35: a guarded older→target hop refuses with suggestedVersion ----
  test('scenario 35: a guarded upgrade path refuses with RESTORE_UPGRADE_PATH and a suggestedVersion', () => {
    const meta: AppUpgradeMeta = { waypoints: ['1.5.0'] };
    const verdict = computeSkewVerdict('1.0.0', '2.0.0', meta);
    expect(verdict).toMatchObject({ kind: 'refused', code: 'RESTORE_UPGRADE_PATH', suggestedVersion: '1.5.0' });
  });

  // ---- Scenario 36: equal versions, and a clean older path, both proceed ----
  test('scenario 36: equal versions and a clean older-than-target path both verdict ok', () => {
    const meta: AppUpgradeMeta = {};
    expect(computeSkewVerdict('1.0.0', '1.0.0', meta)).toEqual({ kind: 'ok' });
    expect(computeSkewVerdict('1.0.0', '2.0.0', meta)).toEqual({ kind: 'ok' });
  });

  // ---- Scenario 37: unknown candidate version proceeds only with the acknowledgement ----
  test('scenario 37: an unknown version verdicts "unknown"; proceeding needs restore-version-unknown', () => {
    expect(computeSkewVerdict(null, '1.0.0', {})).toEqual({ kind: 'unknown' });
    expect(computeSkewVerdict('1.0.0', undefined, {})).toEqual({ kind: 'unknown' });
    expect(computeSkewVerdict('1.0.0', '1.0.0', undefined)).toEqual({ kind: 'unknown' });

    const required = deriveRequiredAcknowledgements({ skew: { kind: 'unknown' }, carryEnv: true, carriesEnv: true });
    expect(required).toEqual(['restore-version-unknown']);

    const candidate: RestoreCandidate = {
      deploymentId: 'x', lineageId: 'x', app: 'demoapp', name: 'x', subdomain: null, host: null,
      appVersion: null, channel: null, carriesEnv: true, capturedAt: null, hasIdentityRecord: true,
      skew: { kind: 'unknown' }, requiredAcknowledgements: [], warnings: [],
    };
    const withoutAck = validateRestoreChoice({ candidate, choice: { candidateId: 'x', carryEnv: true }, requiresEnv: false, envNotCarriedKeys: [] });
    expect(withoutAck).toMatchObject({ ok: false, code: 'RESTORE_ACK_REQUIRED', details: { required: ['restore-version-unknown'] } });

    const withAck = validateRestoreChoice({ candidate, choice: { candidateId: 'x', carryEnv: true, acknowledge: ['restore-version-unknown'] }, requiresEnv: false, envNotCarriedKeys: [] });
    expect(withAck).toEqual({ ok: true, requiredAcknowledgements: ['restore-version-unknown'] });
  });

  // ---- Scenario 39: requiresEnv refuses rather than warns ----
  test('scenario 39: requiresEnv + no environment record refuses (RESTORE_ENV_REQUIRED), never just warns', () => {
    const candidate: RestoreCandidate = {
      deploymentId: 'x', lineageId: 'x', app: 'demoapp', name: 'x', subdomain: null, host: null,
      appVersion: '1.0.0', channel: null, carriesEnv: false, capturedAt: null, hasIdentityRecord: true,
      skew: { kind: 'ok' }, requiredAcknowledgements: [], warnings: [],
    };
    const result = validateRestoreChoice({
      candidate,
      choice: { candidateId: 'x', carryEnv: true },
      requiresEnv: true,
      envNotCarriedKeys: ['DB_PASSWORD'],
    });
    expect(result).toMatchObject({ ok: false, code: 'RESTORE_ENV_REQUIRED', details: { missingKeys: ['DB_PASSWORD'] } });
    // Not acknowledgeable — no `acknowledge` array satisfies it.
    const withAckAnyway = validateRestoreChoice({
      candidate,
      choice: { candidateId: 'x', carryEnv: true, acknowledge: ['restore-env-not-carried', 'restore-version-unknown'] },
      requiresEnv: true,
      envNotCarriedKeys: ['DB_PASSWORD'],
    });
    expect(withAckAnyway).toMatchObject({ ok: false, code: 'RESTORE_ENV_REQUIRED' });
  });

  // ---- Scenario 41: every refusal carries details.code (+ suggestedVersion where applicable) ----
  test('scenario 41: every refusal path carries details.code, in the same shape', () => {
    const base: RestoreCandidate = {
      deploymentId: 'x', lineageId: 'x', app: 'demoapp', name: 'x', subdomain: null, host: null,
      appVersion: '2.0.0', channel: null, carriesEnv: true, capturedAt: null, hasIdentityRecord: true,
      skew: { kind: 'refused', code: 'RESTORE_SOURCE_NEWER', message: 'newer' }, requiredAcknowledgements: [], warnings: [],
    };
    const r1 = validateRestoreChoice({ candidate: base, choice: { candidateId: 'x', carryEnv: true }, requiresEnv: false, envNotCarriedKeys: [], targetVersion: '1.0.0' });
    expect(r1).toMatchObject({ ok: false, code: 'RESTORE_SOURCE_NEWER' });

    const guarded: RestoreCandidate = { ...base, skew: { kind: 'refused', code: 'RESTORE_UPGRADE_PATH', message: 'guarded', suggestedVersion: '1.5.0' } };
    const r2 = validateRestoreChoice({ candidate: guarded, choice: { candidateId: 'x', carryEnv: true }, requiresEnv: false, envNotCarriedKeys: [] });
    expect(r2).toMatchObject({ ok: false, code: 'RESTORE_UPGRADE_PATH', details: { suggestedVersion: '1.5.0' } });

    // Candidate gone / busy.
    expect(checkCandidateStillEligible(undefined, 'demoapp', 'target-id')).toEqual({ ok: false, code: 'RESTORE_CANDIDATE_GONE' });
    expect(checkCandidateStillEligible(fakeSource({ deployment: fakeDeployment({ status: 'installing' }) }), 'demoapp', 'target-id')).toEqual({ ok: false, code: 'RESTORE_CANDIDATE_BUSY' });
  });

  // ---- Scenario 23 (HIGHEST VALUE): MockDockerService records services/wait ----
  test('scenario 23 (highest value): MockDockerService.composeUp records services + wait; a scoped call starts nothing else', async () => {
    const docker = new MockDockerService();
    await docker.composeUp('/tmp/proj', 'proj', undefined, undefined, { services: ['db'], wait: true, timeoutMs: 900_000 });
    expect(docker.composeUpCalls).toHaveLength(1);
    expect(docker.composeUpCalls[0]).toEqual({ projectName: 'proj', services: ['db'], wait: true, timeoutMs: 900_000 });

    // A full (unscoped) call — no services filter, no wait — is recorded distinctly.
    await docker.composeUp('/tmp/proj', 'proj', undefined, undefined);
    expect(docker.composeUpCalls).toHaveLength(2);
    expect(docker.composeUpCalls[1].services).toBeUndefined();
    expect(docker.composeUpCalls[1].wait).toBeUndefined();
  });

  // ---- Scenario 31: the restore hook shape is AppBackupHook verbatim; manifest-restore coercion is additive ----
  test('scenario 31: coerceManifestRestore accepts AppBackupHook-shaped hooks and drops malformed entries', () => {
    const good = coerceManifestRestore([
      { id: 'default', discard: ['postgres'], hook: { service: 'db', command: ['sh', '-c', 'psql -f /backups/x.sql'] }, requiresEnv: true },
    ]);
    expect(good).toEqual([
      { id: 'default', discard: ['postgres'], hook: { service: 'db', command: ['sh', '-c', 'psql -f /backups/x.sql'] }, requiresEnv: true },
    ]);

    // No `id` -> dropped. Malformed hook (no command) -> hook dropped, declaration survives.
    const mixed = coerceManifestRestore([
      { discard: ['x'] },
      { id: 'ok', hook: { service: 'db' } },
    ]);
    expect(mixed).toEqual([{ id: 'ok' }]);

    // Not an array at all -> undefined (no legacy singular form for `restore`).
    expect(coerceManifestRestore({ id: 'default' })).toBeUndefined();
    expect(coerceManifestRestore(undefined)).toBeUndefined();
  });

  // ---- Scenario 4 (partial, pure half): settled-status filtering ----
  test('scenario 4 (pure half): only running/stopped deployments are eligible, never installing/updating/error', () => {
    for (const status of ['installing', 'updating', 'error'] as const) {
      expect(isEligibleCandidate(fakeSource({ deployment: fakeDeployment({ status }) }), 'demoapp')).toBe(false);
    }
    for (const status of ['running', 'stopped'] as const) {
      expect(isEligibleCandidate(fakeSource({ deployment: fakeDeployment({ status }) }), 'demoapp')).toBe(true);
    }
  });

  // ---- Scenarios 54, 55: the scope boundary (FR-047, research R19) ----
  test('scenario 54: CONTRACTS is unchanged — exactly auth@1/backup@1/push@1/container-logs@1, no new grant kind', async () => {
    const { CONTRACTS } = await import('@hola/shared/contracts');
    expect(CONTRACTS.map((c) => `${c.id}@${c.version}`).sort()).toEqual(
      ['auth@1', 'backup@1', 'container-logs@1', 'push@1'].sort(),
    );
  });

  test('scenario 55: the pre-existing dead restore stub is untouched — nothing in this feature imports RestoreBackupRequest', async () => {
    // Mechanical form of quickstart.md §9's grep: this feature's own new
    // modules (not the pre-existing stub route itself, which legitimately
    // names the type) must never reference it.
    const featureModules = [
      new URL('../../services/core/restore-candidates.ts', import.meta.url),
      new URL('../../services/core/manifest-restore.ts', import.meta.url),
    ];
    for (const url of featureModules) {
      const source = await readFile(url, 'utf8');
      expect(source).not.toContain('RestoreBackupRequest');
      expect(source).not.toContain('RestoreBackupResponse');
    }
  });

  // ---- Description fallback (research R5, FR-003): identity record wins, deployment record falls back ----
  test('describeCandidate: identity record fields win; absence falls back to the deployment record', () => {
    const withIdentity = describeCandidate(fakeSource({
      identity: { lineageId: 'lineage-1', app: 'demoapp', appVersion: '2.0.0', channel: 'stable', subdomain: 'demo', host: 'demo.example.com', writtenAt: '2026-01-01T00:00:00.000Z' },
    }));
    expect(withIdentity).toMatchObject({ lineageId: 'lineage-1', appVersion: '2.0.0', subdomain: 'demo', host: 'demo.example.com', hasIdentityRecord: true });

    const withoutIdentity = describeCandidate(fakeSource({ identity: null, deployment: fakeDeployment({ version: '1.2.3' }) }));
    expect(withoutIdentity).toMatchObject({ lineageId: 'demoapp-aaaaaaaa', appVersion: '1.2.3', host: null, hasIdentityRecord: false });
  });

  // ---- env-not-carried keys: exactly isSecret && generate ----
  test('scenario 38 (pure half): env-not-carried names exactly isSecret+generate keys, nothing else', () => {
    const appEnv: AppEnvVar[] = [
      { key: 'PLAIN', value: '', isSecret: false },
      { key: 'SECRET_NO_GEN', value: 'x', isSecret: true },
      { key: 'GENERATED_SECRET', value: '', isSecret: true, generate: { kind: 'hex' } },
    ];
    expect(deriveEnvNotCarriedKeys(appEnv)).toEqual(['GENERATED_SECRET']);
  });

  // ---- Scenario 54: scope boundary — judgeRestoreChoice composes the whole judgement from already-fetched state ----
  test('judgeRestoreChoice composes eligibility + skew + acknowledgement into one verdict', () => {
    const source = fakeSource({ identity: { appVersion: '1.0.0' }, carriesEnv: true });
    const okResult = judgeRestoreChoice({
      source, appId: 'demoapp', excludeDeploymentId: 'target-1',
      choice: { candidateId: source.deployment.id, carryEnv: true },
      targetVersion: '1.0.0', meta: {}, requiresEnv: false, envNotCarriedKeys: [],
    });
    expect(okResult.ok).toBe(true);

    const goneResult = judgeRestoreChoice({
      source: undefined, appId: 'demoapp', excludeDeploymentId: 'target-1',
      choice: { candidateId: 'nope', carryEnv: true },
      targetVersion: '1.0.0', meta: {}, requiresEnv: false, envNotCarriedKeys: [],
    });
    expect(goneResult).toMatchObject({ ok: false, code: 'RESTORE_CANDIDATE_GONE' });
  });
});

// ---------------------------------------------------------------------------
// Real filesystem harness (quickstart.md scenarios marked "U-fs")
// ---------------------------------------------------------------------------

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

const APP_ID = 'demoapp';
const COMPOSE_WITH_DATA =
  'services:\n  demoapp:\n    image: demoapp:latest\n    volumes:\n      - ${HOLA_APP_DATA}:/data\n';

let defaultEnv: AppEnvVar[];
let acceptsConfig: string[] | undefined;
let backupConfig: AppBackupDeclaration | undefined;
let restoreConfig: AppRestoreDeclaration[] | undefined;
let authConfig: AppAuthConfig | undefined;
// Present-but-empty by default (`{}`, not `undefined`): every install in this
// suite requests the SAME version as the source it restores from, so with
// upgrade metadata PRESENT, `computeSkewVerdict` reads an equal-version hop as
// `ok` rather than `unknown` — matching what a real catalog entry (which
// always has SOME upgrade block, even an empty one) would report. Tests that
// specifically exercise the unknown-version path set this to `undefined`.
let upgradeConfig: AppUpgradeMeta | undefined = {};

function makeCatalog(): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'Demo App', icon: '🧪' }),
    getVersionDetail: async () => ({
      defaultEnv,
      defaults: { ports: [], volumes: [] },
      accepts: acceptsConfig,
      backup: backupConfig,
      restore: restoreConfig,
      auth: authConfig,
      upgrade: upgradeConfig,
      multiInstance: true, // lets these tests install a second copy of the same app freely
    }),
  } as unknown as CatalogArg;
}

function makeValidation(): ValidationArg {
  return {
    validateDraft: async () => ({ ok: true, errors: [], warnings: [] }),
    preflightCheck: async () => ({ ok: true, checks: [] }),
  } as unknown as ValidationArg;
}

async function waitForJob(jobs: RealJobService, id: string, timeoutMs = 10_000) {
  const start = Date.now();
  for (;;) {
    const job = await jobs.getJob(id);
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    if (Date.now() - start > timeoutMs) throw new Error(`Job ${id} did not finish (last status: ${job?.status})`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('Restore-on-install (spec 007) — real filesystem harness', () => {
  let dataRoot: string;
  let appsRoot: string;
  let prevAppsBindRoot: string | undefined;
  let docker: MockDockerService;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-restore-data-'));
    appsRoot = await mkdtemp(join(tmpdir(), 'hola-restore-apps-'));
    prevAppsBindRoot = process.env.HOLA_APPS_BIND_ROOT;
    process.env.HOLA_APPS_BIND_ROOT = appsRoot;
    defaultEnv = [];
    // Every app in this suite is restorable by default (declares `restore@1`)
    // — the one scenario that needs "not declared" overrides this itself.
    acceptsConfig = ['restore@1'];
    backupConfig = undefined;
    restoreConfig = undefined;
    authConfig = undefined;
    upgradeConfig = {};
    docker = new MockDockerService();
  });

  afterEach(async () => {
    if (prevAppsBindRoot === undefined) delete process.env.HOLA_APPS_BIND_ROOT;
    else process.env.HOLA_APPS_BIND_ROOT = prevAppsBindRoot;
    await rm(dataRoot, { recursive: true, force: true });
    await rm(appsRoot, { recursive: true, force: true });
  });

  function makeSystem() {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage);
    const logging = new RealLoggingService(storage);
    const jobs = new RealJobService(database, logging);
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const drafts = new RealDraftService(storage, makeCatalog(), makeValidation());
    const deployments = new RealDeploymentService(storage, jobs, docker, drafts, routing, logging, new MockProvisionerService());
    // Restore-on-install (spec 007): the same post-construction wiring
    // simple-factory.ts does — drafts needs deployments to resolve/validate a
    // restoreFrom choice, and deployments takes drafts as a constructor arg,
    // so this can't be threaded through either constructor.
    drafts.setDeploymentsService(deployments);
    return { storage, jobs, drafts, deployments };
  }

  async function install(
    system: ReturnType<typeof makeSystem>,
    opts: { name: string; version?: string; restoreFrom?: RestoreChoice; allowMultiple?: boolean },
  ) {
    const { drafts, deployments, jobs } = system;
    const { draftId } = await drafts.createDraft({
      appId: APP_ID,
      version: opts.version ?? '1.0.0',
      ...(opts.restoreFrom ? { restoreFrom: opts.restoreFrom } : {}),
    });
    await drafts.updateDraft(draftId, { composeOverride: COMPOSE_WITH_DATA });
    await drafts.finalizeDraft(draftId);
    const created = await deployments.createFromDraft({
      draftId,
      name: opts.name,
      options: { autoStart: true },
      allowMultiple: opts.allowMultiple ?? true,
    });
    const job = created.jobId ? await waitForJob(jobs, created.jobId) : undefined;
    return { ...created, job, draftId };
  }

  /** Write an extra file into a deployment's data root — the thing that makes
   *  it eligible as a restore candidate (data root holding more than `.hola`). */
  async function writeExtraData(deploymentId: string, name: string, content: string) {
    const dir = join(appsRoot, deploymentId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), content);
  }
  async function readExtraData(deploymentId: string, name: string): Promise<string> {
    return readFile(join(appsRoot, deploymentId, name), 'utf8');
  }
  async function readInstanceRecord(deploymentId: string): Promise<Record<string, unknown>> {
    const raw = await readFile(join(appsRoot, deploymentId, '.hola', 'instance.json'), 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  }

  // =========================================================================
  // 1. Candidate discovery (scenarios 1-4, 6)
  // =========================================================================

  test('scenario 1: one installed copy holding data lists as exactly one candidate, fully described', async () => {
    const system = makeSystem();
    const source = await install(system, { name: 'source' });
    await writeExtraData(source.deploymentId, 'note.txt', 'hello');

    const sources = await system.deployments.listRestoreSources(APP_ID);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.deployment.id).toBe(source.deploymentId);
    expect(sources[0]!.hasData).toBe(true);
  });

  test('scenario 2: with the identity record deleted, the candidate is still listed, described from the deployment record', async () => {
    const system = makeSystem();
    const source = await install(system, { name: 'source' });
    await writeExtraData(source.deploymentId, 'note.txt', 'hello');
    await rm(join(appsRoot, source.deploymentId, '.hola', 'instance.json'), { force: true });

    const sources = await system.deployments.listRestoreSources(APP_ID);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.identity).toBeNull();
    const described = describeCandidate(sources[0]!);
    expect(described.hasIdentityRecord).toBe(false);
    expect(described.lineageId).toBe(source.deploymentId); // degrades to the deployment id
  });

  test('scenario 3: a data root holding only .hola is not listed (the ignore-list rule)', async () => {
    const system = makeSystem();
    const source = await install(system, { name: 'source' });
    // No writeExtraData — the data root holds only what materializeCompose wrote.

    const sources = await system.deployments.listRestoreSources(APP_ID);
    expect(sources.map(s => s.deployment.id)).not.toContain(source.deploymentId);
  });

  test('scenario 4: an in-flight or error-state deployment is excluded; running/stopped are included', async () => {
    const system = makeSystem();
    const source = await install(system, { name: 'source' });
    await writeExtraData(source.deploymentId, 'note.txt', 'hello');

    expect((await system.deployments.listRestoreSources(APP_ID)).map(s => s.deployment.id)).toContain(source.deploymentId);

    await system.deployments.executeAction(source.deploymentId, { action: 'stop' });
    expect((await system.deployments.listRestoreSources(APP_ID)).map(s => s.deployment.id)).toContain(source.deploymentId);
  });

  test('scenario 6: the candidates route answers with no backup provider installed anywhere on the host', async () => {
    const system = makeSystem();
    const source = await install(system, { name: 'source' });
    await writeExtraData(source.deploymentId, 'note.txt', 'hello');
    // No backupConfig/acceptsConfig set — no backup@1 anywhere on the host.
    const sources = await system.deployments.listRestoreSources(APP_ID);
    expect(sources).toHaveLength(1);
  });

  // =========================================================================
  // 2. Entering the choice (scenarios 8, 9, 11, 12, 13, 14)
  // =========================================================================

  test('scenario 8: restoreFrom is accepted on the catalog path and refused on install-by-ref with RESTORE_NOT_SUPPORTED', async () => {
    const system = makeSystem();
    const source = await install(system, { name: 'source' });
    await writeExtraData(source.deploymentId, 'note.txt', 'hello');

    // Catalog path: accepted (does not throw).
    const { draftId } = await system.drafts.createDraft({
      appId: APP_ID,
      version: '1.0.0',
      restoreFrom: { candidateId: source.deploymentId, carryEnv: false, acknowledge: ['restore-env-not-carried'] },
    });
    expect(draftId).toBeTruthy();

    // Install-by-ref refuses — createDraftFromRef is exercised via ociRef.
    await expect(
      system.drafts.createDraft({ appId: undefined, ociRef: 'ghcr.io/acme/demoapp:1.0.0', restoreFrom: { candidateId: source.deploymentId, carryEnv: false } } as never),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { code: 'RESTORE_NOT_SUPPORTED' } });
  });

  // ---- data-model.md §7: "no restore@1 in accepts" is NOT the same as "restore@1 with no block" ----
  test('an app that has not declared restore@1 at all refuses restoreFrom, distinct from a plain-copy declaration', async () => {
    const system = makeSystem();
    const source = await install(system, { name: 'source' });
    await writeExtraData(source.deploymentId, 'note.txt', 'hello');

    acceptsConfig = ['backup@1']; // declares backup, but never considered restore
    await expect(
      system.drafts.createDraft({
        appId: APP_ID, version: '1.0.0',
        restoreFrom: { candidateId: source.deploymentId, carryEnv: false, acknowledge: ['restore-env-not-carried'] },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { code: 'RESTORE_NOT_ACCEPTED' } });
  });

  test('scenario 11: two finalizes differing only in restoreFrom produce the SAME checksum', async () => {
    const system = makeSystem();
    const source = await install(system, { name: 'source' });
    await writeExtraData(source.deploymentId, 'note.txt', 'hello');

    const plain = await system.drafts.createDraft({ appId: APP_ID, version: '1.0.0' });
    await system.drafts.updateDraft(plain.draftId, { composeOverride: COMPOSE_WITH_DATA });
    const plainFinal = await system.drafts.finalizeDraft(plain.draftId);

    const restoring = await system.drafts.createDraft({
      appId: APP_ID, version: '1.0.0',
      restoreFrom: { candidateId: source.deploymentId, carryEnv: false, acknowledge: ['restore-env-not-carried'] },
    });
    await system.drafts.updateDraft(restoring.draftId, { composeOverride: COMPOSE_WITH_DATA });
    const restoringFinal = await system.drafts.finalizeDraft(restoring.draftId);

    // `spec` (the finalized manifest) already includes `draftId` —
    // pre-existing, unrelated to this feature — so two DIFFERENT drafts can
    // never hash equal regardless of `restoreFrom`. `restoreFrom` itself DOES
    // appear on the returned manifest (it rides outside canonicalSpec,
    // alongside `channel`) but must NOT be part of what got HASHED. Prove
    // that narrower, stronger claim directly: with `draftId`, `checksum`,
    // `finalizedAt` and `restoreFrom` itself stripped (the fields that
    // legitimately/expectedly differ), everything else — the actual
    // canonicalSpec content the checksum was computed over — matches exactly.
    const strip = (spec: unknown) => {
      const rest = { ...(spec as Record<string, unknown>) };
      delete rest.draftId;
      delete rest.checksum;
      delete rest.finalizedAt;
      delete rest.restoreFrom;
      return rest;
    };
    expect(strip(restoringFinal.spec)).toEqual(strip(plainFinal.spec));
    expect((restoringFinal.spec as { restoreFrom?: unknown }).restoreFrom).toBeTruthy();
    expect((plainFinal.spec as { restoreFrom?: unknown }).restoreFrom).toBeUndefined();
  });

  test('scenario 12, 13: the record carries restoreFrom + lineageId; a fresh install\'s lineageId is its own id, a restored one is the candidate\'s', async () => {
    const system = makeSystem();
    const source = await install(system, { name: 'source' });
    await writeExtraData(source.deploymentId, 'note.txt', 'hello');

    const fresh = await install(system, { name: 'fresh' });
    const freshDetail = await system.deployments.getDeployment(fresh.deploymentId);
    expect(freshDetail.lineageId).toBe(fresh.deploymentId);
    expect(freshDetail.restoreFrom).toBeUndefined();

    const restored = await install(system, {
      name: 'restored',
      restoreFrom: { candidateId: source.deploymentId, carryEnv: false, acknowledge: ['restore-env-not-carried'] },
    });
    expect(restored.job?.status).toBe('completed');
    const restoredDetail = await system.deployments.getDeployment(restored.deploymentId);
    expect(restoredDetail.lineageId).toBe(source.deploymentId);
    expect(restoredDetail.restoreFrom).toMatchObject({ candidateId: source.deploymentId });

    // Confirm by reading .hola/instance.json too (FR-011, SC-007).
    const identity = await readInstanceRecord(restored.deploymentId);
    expect(identity.lineageId).toBe(source.deploymentId);
  });

  test('scenario 14: a restored deployment sets restoredAt; a later restart leaves it unchanged and quiesces nothing', async () => {
    const system = makeSystem();
    const source = await install(system, { name: 'source' });
    await writeExtraData(source.deploymentId, 'note.txt', 'hello');

    const restored = await install(system, {
      name: 'restored',
      restoreFrom: { candidateId: source.deploymentId, carryEnv: false, acknowledge: ['restore-env-not-carried'] },
    });
    const detail1 = await system.deployments.getDeployment(restored.deploymentId);
    expect(detail1.restoredAt).toBeTruthy();

    const { jobId } = await system.deployments.executeAction(restored.deploymentId, { action: 'restart' });
    await waitForJob(system.jobs, jobId!);
    const detail2 = await system.deployments.getDeployment(restored.deploymentId);
    expect(detail2.restoredAt).toBe(detail1.restoredAt); // unchanged — restart never re-enters the restore sequence

    // The source's data is untouched by the restart.
    expect(await readExtraData(source.deploymentId, 'note.txt')).toBe('hello');
  });

  // =========================================================================
  // 3. Executing the restore (scenarios 15, 16, 16a, 18, 19, 20, 21, 22, 25, 26, 27)
  // =========================================================================

  test('scenario 15: the restore runs between composePull and the final composeUp (Mock call ordering)', async () => {
    const system = makeSystem();
    const source = await install(system, { name: 'source' });
    await writeExtraData(source.deploymentId, 'note.txt', 'hello');
    acceptsConfig = ['restore@1'];
    restoreConfig = undefined; // plain-file-copy: no hook, so composeUp is called exactly once (the final one)

    // The SOURCE's own install already issued one composeUp on this shared
    // Mock — only count calls made by the RESTORE install itself.
    const before = docker.composeUpCalls.length;
    const restored = await install(system, {
      name: 'restored',
      restoreFrom: { candidateId: source.deploymentId, carryEnv: false, acknowledge: ['restore-env-not-carried'] },
    });
    expect(restored.job?.status).toBe('completed');
    // Exactly one composeUp — the restore's own extraction step runs
    // between composePull and this call, never issuing its own composeUp
    // when there's no hook to start.
    const calls = docker.composeUpCalls.slice(before);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.services).toBeUndefined();
  });

  test('scenario 16: a non-empty target refuses RESTORE_TARGET_NOT_EMPTY; a marker-only root proceeds', async () => {
    const system = makeSystem();
    const source = await install(system, { name: 'source' });
    await writeExtraData(source.deploymentId, 'note.txt', 'hello');

    // A marker-only target (freshly materialized, no extra data) proceeds —
    // proven by every other restore test in this suite succeeding. The
    // REFUSAL half is driven end-to-end below rather than by asserting the
    // guard primitive: `autoStart: false` hands back the deployment id with
    // NO job queued, which is the only window in which the target's data root
    // can be seeded before `performRestoreOnInstall` looks at it. The deploy
    // job is then enqueued by hand in exactly the shape `maybeStartJob`
    // builds (`type: 'start'`, `action: 'deploy'`), so this is the real
    // lifecycle path, not a re-implementation of it.
    const { draftId } = await system.drafts.createDraft({
      appId: APP_ID, version: '1.0.0',
      restoreFrom: { candidateId: source.deploymentId, carryEnv: false, acknowledge: ['restore-env-not-carried'] },
    });
    await system.drafts.updateDraft(draftId, { composeOverride: COMPOSE_WITH_DATA });
    await system.drafts.finalizeDraft(draftId);
    const created = await system.deployments.createFromDraft({
      draftId, name: 'target', options: { autoStart: false }, allowMultiple: true,
    });
    expect(created.jobId).toBeUndefined();

    // Pre-existing app data in the target's own root — the thing FR-014
    // exists to protect. `restoreTarGzInto` would `rm -rf` this whole tree.
    await mkdir(join(appsRoot, created.deploymentId), { recursive: true });
    await writeFile(join(appsRoot, created.deploymentId, 'pre-existing.txt'), 'do not clobber me');

    const job = await system.jobs.createJob({
      type: 'start', deploymentId: created.deploymentId, payload: { releaseId: created.releaseId, action: 'deploy' },
    });
    const finished = await waitForJob(system.jobs, job.id);
    expect(finished.status).toBe('failed');
    expect(finished.error).toMatch(/already holds app data/i);

    // The refusal happened BEFORE extraction: the operator's data is intact
    // and the source was never captured into the target.
    expect(await readExtraData(created.deploymentId, 'pre-existing.txt')).toBe('do not clobber me');
    expect(existsSync(join(appsRoot, created.deploymentId, 'note.txt'))).toBe(false);
    const detail = await system.deployments.getDeployment(created.deploymentId);
    expect(detail.status).toBe('error');
    expect(detail.restoredAt).toBeUndefined();

    const emptyRoot = join(appsRoot, 'marker-only');
    await mkdir(join(emptyRoot, '.hola'), { recursive: true });
    expect(await dirHasContents(emptyRoot, ['.hola'])).toBe(false);
  });

  // =========================================================================
  // Restore hook service names are APP-SUPPLIED (review, spec 007 target A)
  // =========================================================================

  test('a hostile restore hook service name never reaches a shell: coercion drops it, composeUp is argv-only', async () => {
    // Source half: `coerceManifestRestore` refuses anything that could not
    // name a real Compose service, so a manifest carrying a metacharacter
    // degrades to "no hook" rather than an executable payload.
    for (const hostile of ['db"; touch /tmp/pwned; echo "', 'db$(id)', 'db`id`', 'db; rm -rf /', 'db && id', 'db|id']) {
      const coerced = coerceManifestRestore([{ id: 'default', hook: { service: hostile, command: ['true'] } }]);
      expect(coerced?.[0]?.hook).toBeUndefined();
    }
    // A legitimate name still survives.
    expect(
      coerceManifestRestore([{ id: 'default', hook: { service: 'db-1.primary_x', command: ['true'] } }])?.[0]?.hook,
    ).toEqual({ service: 'db-1.primary_x', command: ['true'] });

    // Sink half: even handed a name the coercion would have dropped,
    // `composeUp` passes it as ONE argv element — never a shell string.
    // `RealDockerService` is exercised here (the Mock cannot prove argv-ness);
    // `docker` is absent in CI, so only the failure shape is asserted — what
    // matters is that no side effect of the metacharacters is possible.
    const { RealDockerService } = await import('../../services/core/docker');
    const real = new RealDockerService();
    const composeDir = join(appsRoot, 'argv-probe');
    await mkdir(composeDir, { recursive: true });
    await writeFile(join(composeDir, 'docker-compose.yml'), 'services: {}\n');
    const marker = join(appsRoot, 'argv-probe-pwned');
    const res = await real.composeUp(composeDir, 'probe', undefined, undefined, {
      services: [`x"; touch ${marker}; echo "`],
    });
    expect(res.success).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });

  test('scenario 16a: a candidate deleted between draft and deploy fails the install with RESTORE_CANDIDATE_GONE', async () => {
    const system = makeSystem();
    const source = await install(system, { name: 'source' });
    await writeExtraData(source.deploymentId, 'note.txt', 'hello');

    const { draftId } = await system.drafts.createDraft({
      appId: APP_ID, version: '1.0.0',
      restoreFrom: { candidateId: source.deploymentId, carryEnv: false, acknowledge: ['restore-env-not-carried'] },
    });
    await system.drafts.updateDraft(draftId, { composeOverride: COMPOSE_WITH_DATA });
    await system.drafts.finalizeDraft(draftId);

    // Delete the source deployment entirely between draft and deploy.
    await system.deployments.deleteDeployment(source.deploymentId);

    // createFromDraft's OWN re-validation (T018) already re-resolves the
    // candidate before creating any state, so this throws synchronously
    // rather than failing inside the job.
    await expect(
      system.deployments.createFromDraft({ draftId, name: 'target', options: { autoStart: true }, allowMultiple: true }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { code: 'RESTORE_CANDIDATE_GONE' } });
  });

  test('scenario 18 (HIGHEST VALUE): FR-016 is a post-condition — an emptied source archive fails RESTORE_PAYLOAD_EMPTY, not a subtree search', async () => {
    const system = makeSystem();
    const source = await install(system, { name: 'source' });
    // Made eligible, then the extra data is removed — simulating a candidate
    // that looked fine when chosen but whose data root holds only the
    // platform marker by the time the job actually captures it. Neither
    // draft-time nor job-time re-validation re-checks `hasData` (only
    // existence/app/settledness), so this reaches the capture step for real.
    await writeExtraData(source.deploymentId, 'note.txt', 'hello');
    await rm(join(appsRoot, source.deploymentId, 'note.txt'), { force: true });
    expect(await dirHasContents(join(appsRoot, source.deploymentId), ['.hola'])).toBe(false);

    const restored = await install(system, {
      name: 'restored',
      restoreFrom: { candidateId: source.deploymentId, carryEnv: false, acknowledge: ['restore-env-not-carried'] },
    });
    expect(restored.job?.status).toBe('failed');
    expect(restored.job?.error).toMatch(/empty/i);

    const detail = await system.deployments.getDeployment(restored.deploymentId);
    expect(detail.status).toBe('error');
  });

  test('scenario 19: staging lives under the TARGET, not the source, and is gone after success and failure', async () => {
    const system = makeSystem();
    const source = await install(system, { name: 'source' });
    await writeExtraData(source.deploymentId, 'note.txt', 'hello');

    const restored = await install(system, {
      name: 'restored',
      restoreFrom: { candidateId: source.deploymentId, carryEnv: false, acknowledge: ['restore-env-not-carried'] },
    });
    expect(restored.job?.status).toBe('completed');
    const stagingPath = join(dataRoot, 'deployments', restored.deploymentId, 'restore-staging', 'data.tar.gz');
    expect(existsSync(stagingPath)).toBe(false);
    // Never appears in the SOURCE's own snapshot listing.
    expect(existsSync(join(dataRoot, 'deployments', source.deploymentId, 'snapshots'))).toBe(false);

    // Failure case too.
    const source2 = await install(system, { name: 'source2' });
    await writeExtraData(source2.deploymentId, 'note.txt', 'hello');
    await rm(join(appsRoot, source2.deploymentId, 'note.txt'), { force: true });
    const failed = await install(system, {
      name: 'restored2',
      restoreFrom: { candidateId: source2.deploymentId, carryEnv: false, acknowledge: ['restore-env-not-carried'] },
    });
    expect(failed.job?.status).toBe('failed');
    expect(existsSync(join(dataRoot, 'deployments', failed.deploymentId, 'restore-staging', 'data.tar.gz'))).toBe(false);
  });

  test('scenario 20: discard paths are removed before any container starts; an escaping path refuses the restore', async () => {
    const system = makeSystem();
    const source = await install(system, { name: 'source' });
    await writeExtraData(source.deploymentId, 'note.txt', 'hello');
    await mkdir(join(appsRoot, source.deploymentId, 'postgres'), { recursive: true });
    await writeFile(join(appsRoot, source.deploymentId, 'postgres', 'PG_VERSION'), '16');

    acceptsConfig = ['restore@1', 'backup@1'];
    restoreConfig = [{ id: 'default', discard: ['postgres'] }];

    const restored = await install(system, {
      name: 'restored',
      restoreFrom: { candidateId: source.deploymentId, carryEnv: false, acknowledge: ['restore-env-not-carried'] },
    });
    expect(restored.job?.status).toBe('completed');
    expect(existsSync(join(appsRoot, restored.deploymentId, 'postgres'))).toBe(false);
    expect(existsSync(join(appsRoot, restored.deploymentId, 'note.txt'))).toBe(true);

    // An escaping discard path refuses the restore.
    const source2 = await install(system, { name: 'source3' });
    await writeExtraData(source2.deploymentId, 'note.txt', 'hello');
    restoreConfig = [{ id: 'default', discard: ['../escape'] }];
    const escaping = await install(system, {
      name: 'restored3',
      restoreFrom: { candidateId: source2.deploymentId, carryEnv: false, acknowledge: ['restore-env-not-carried'] },
    });
    expect(escaping.job?.status).toBe('failed');
  });

  test('scenario 21: after a restore, .hola/instance.json describes the NEW install while lineageId is the source\'s', async () => {
    const system = makeSystem();
    const source = await install(system, { name: 'source' });
    await writeExtraData(source.deploymentId, 'note.txt', 'hello');

    const restored = await install(system, {
      name: 'restored',
      restoreFrom: { candidateId: source.deploymentId, carryEnv: false, acknowledge: ['restore-env-not-carried'] },
    });
    const identity = await readInstanceRecord(restored.deploymentId);
    expect(identity.deploymentId).toBe(restored.deploymentId);
    expect(identity.name).toBe('restored');
    expect(identity.lineageId).toBe(source.deploymentId);
  });

  test('scenario 22 (HIGHEST VALUE): the OIDC ordering trap — oidc.json exists after a restore, written AFTER extraction', async () => {
    authConfig = {
      mode: 'native-oidc',
      oidc: { redirectPath: '/oidc/callback', scopes: ['openid'], credentialsFile: { path: 'oidc.json' } },
    };
    const system = makeSystem();
    const source = await install(system, { name: 'source' });
    await writeExtraData(source.deploymentId, 'note.txt', 'hello');

    const restored = await install(system, {
      name: 'restored',
      restoreFrom: { candidateId: source.deploymentId, carryEnv: false, acknowledge: ['restore-env-not-carried'] },
    });
    expect(restored.job?.status).toBe('completed');
    // If the write were still at its original pre-restore position, this
    // file would have been destroyed by the restore's `rm -rf` extraction —
    // it only survives because T022 moved the write to AFTER extraction.
    expect(existsSync(join(appsRoot, restored.deploymentId, 'oidc.json'))).toBe(true);
    const creds = JSON.parse(await readFile(join(appsRoot, restored.deploymentId, 'oidc.json'), 'utf8')) as { clientId?: string };
    expect(creds.clientId).toBeTruthy();
    // And the restored payload landed too — proving both writes coexist.
    expect(existsSync(join(appsRoot, restored.deploymentId, 'note.txt'))).toBe(true);
  });

  test('scenario 25, 26: every restore failure leaves a failed install in error state with its data root intact, excluded from candidacy', async () => {
    const system = makeSystem();
    const source = await install(system, { name: 'source' });
    await writeExtraData(source.deploymentId, 'note.txt', 'hello');
    await rm(join(appsRoot, source.deploymentId, 'note.txt'), { force: true }); // forces RESTORE_PAYLOAD_EMPTY

    const failed = await install(system, {
      name: 'restored',
      restoreFrom: { candidateId: source.deploymentId, carryEnv: false, acknowledge: ['restore-env-not-carried'] },
    });
    expect(failed.job?.status).toBe('failed');
    const detail = await system.deployments.getDeployment(failed.deploymentId);
    expect(detail.status).toBe('error');

    // Data root is intact (nothing deleted automatically) — it still exists
    // (holding only `.hola`, since the payload never landed).
    expect(existsSync(join(appsRoot, failed.deploymentId))).toBe(true);

    // Excluded from candidacy thereafter.
    const sources = await system.deployments.listRestoreSources(APP_ID);
    expect(sources.map(s => s.deployment.id)).not.toContain(failed.deploymentId);
  });

  test('scenario 27 (HIGHEST VALUE, regression guard): with no restoreFrom, the deploy job is byte-for-byte what ran before this feature', async () => {
    authConfig = {
      mode: 'native-oidc',
      oidc: { redirectPath: '/oidc/callback', scopes: ['openid'], credentialsFile: { path: 'oidc.json' } },
    };
    const system = makeSystem();
    const plain = await install(system, { name: 'plain' });
    expect(plain.job?.status).toBe('completed');

    // Exactly ONE composeUp — the full, unscoped start. If the restore
    // sequence had run (it must not, with no restoreFrom), there would be a
    // SECOND, hook-scoped composeUp call before this one.
    expect(docker.composeUpCalls).toHaveLength(1);
    expect(docker.composeUpCalls[0]!.services).toBeUndefined();
    expect(docker.composeUpCalls[0]!.wait).toBeUndefined();

    // writeOidcCredentialsFile ran at its ORIGINAL, unconditional position —
    // unaffected by the restore feature's presence.
    expect(existsSync(join(appsRoot, plain.deploymentId, 'oidc.json'))).toBe(true);

    const detail = await system.deployments.getDeployment(plain.deploymentId);
    expect(detail.restoreFrom).toBeUndefined();
    expect(detail.restoredAt).toBeUndefined();
    expect(detail.lineageId).toBe(plain.deploymentId);
  });

  // =========================================================================
  // 4. App declaration (scenarios 29, 30)
  // =========================================================================

  test('scenario 29: a restore block keyed by participation id drives discards + hook for that participation', async () => {
    const system = makeSystem();
    const source = await install(system, { name: 'source' });
    await writeExtraData(source.deploymentId, 'note.txt', 'hello');
    await mkdir(join(appsRoot, source.deploymentId, 'pgdata'), { recursive: true });
    await writeFile(join(appsRoot, source.deploymentId, 'pgdata', 'PG_VERSION'), '16');

    acceptsConfig = ['restore@1', 'backup@1'];
    restoreConfig = [{ id: 'default', discard: ['pgdata'], hook: { service: 'demoapp', command: ['echo', 'restored'] } }];

    const before = docker.composeUpCalls.length;
    const restored = await install(system, {
      name: 'restored',
      restoreFrom: { candidateId: source.deploymentId, carryEnv: false, acknowledge: ['restore-env-not-carried'] },
    });
    expect(restored.job?.status).toBe('completed');
    expect(existsSync(join(appsRoot, restored.deploymentId, 'pgdata'))).toBe(false);
    // The hook's service was started scoped (services:['demoapp'], wait:true)
    // BEFORE the final full composeUp.
    const calls = docker.composeUpCalls.slice(before);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0]).toMatchObject({ services: ['demoapp'], wait: true });
  });

  test('scenario 30: accepts restore@1 with NO block restores by plain file copy — nothing discarded, no hook runs', async () => {
    const system = makeSystem();
    const source = await install(system, { name: 'source' });
    await writeExtraData(source.deploymentId, 'note.txt', 'hello');
    await mkdir(join(appsRoot, source.deploymentId, 'anydir'), { recursive: true });
    await writeFile(join(appsRoot, source.deploymentId, 'anydir', 'x'), 'y');

    acceptsConfig = ['restore@1'];
    restoreConfig = undefined; // no block at all — the meaningful middle state

    const before = docker.composeUpCalls.length;
    const restored = await install(system, {
      name: 'restored',
      restoreFrom: { candidateId: source.deploymentId, carryEnv: false, acknowledge: ['restore-env-not-carried'] },
    });
    expect(restored.job?.status).toBe('completed');
    // Nothing discarded — the whole tree landed.
    expect(existsSync(join(appsRoot, restored.deploymentId, 'anydir', 'x'))).toBe(true);
    // No hook-scoped composeUp — exactly one (the final, full) call.
    expect(docker.composeUpCalls.slice(before)).toHaveLength(1);
  });

  // =========================================================================
  // 5. Refusals and warnings (scenarios 38, 40, 42, 43)
  // =========================================================================

  test('scenario 38: with no environment record, the warning names exactly the isSecret+generate keys', async () => {
    defaultEnv = [
      { key: 'PLAIN', value: 'x', isSecret: false },
      { key: 'API_TOKEN', value: 'x', isSecret: true },
      { key: 'ADMIN_PASSWORD', value: '', isSecret: true, generate: { kind: 'hex' } },
    ];
    const system = makeSystem();
    const source = await install(system, { name: 'source' });
    await writeExtraData(source.deploymentId, 'note.txt', 'hello');

    expect(deriveEnvNotCarriedKeys(defaultEnv)).toEqual(['ADMIN_PASSWORD']);
  });

  test('scenario 40: name/subdomain default from the candidate (pure); a divergent choice warns host-divergence (end-to-end)', async () => {
    // The pure half: defaulting itself, isolated from the routing/collision
    // machinery a real install exercises (which a SECOND live copy of the
    // SAME app at the SAME address would correctly refuse — that's Traefik
    // routing working as intended, not this rule failing).
    const defaults = resolveRestoreNameDefaults({
      requestedName: undefined,
      candidateName: 'Recipes',
      candidateSubdomain: 'recipes',
      appId: 'demoapp',
      deriveSubdomain: (name, appId) => slugifySubdomain(name || appId),
    });
    expect(defaults).toEqual({ name: 'Recipes', subdomain: 'recipes', warnings: [] });

    const diverging = resolveRestoreNameDefaults({
      requestedName: 'a-totally-different-name',
      candidateName: 'Recipes',
      candidateSubdomain: 'recipes',
      appId: 'demoapp',
      deriveSubdomain: (name, appId) => slugifySubdomain(name || appId),
    });
    expect(diverging.subdomain).toBe('a-totally-different-name');
    expect(diverging.warnings).toEqual([{ code: 'host-divergence', from: 'recipes', to: 'a-totally-different-name' }]);

    // End-to-end half: an explicit, divergent name against a real install
    // produces the SAME warning on the actual create response.
    const system = makeSystem();
    const source = await install(system, { name: 'source-recipes' });
    await writeExtraData(source.deploymentId, 'note.txt', 'hello');
    const { draftId: draftId2 } = await system.drafts.createDraft({
      appId: APP_ID, version: '1.0.0',
      restoreFrom: { candidateId: source.deploymentId, carryEnv: false, acknowledge: ['restore-env-not-carried'] },
    });
    await system.drafts.updateDraft(draftId2, { composeOverride: COMPOSE_WITH_DATA });
    await system.drafts.finalizeDraft(draftId2);
    const diverged = await system.deployments.createFromDraft({ draftId: draftId2, name: 'a-totally-different-name', options: { autoStart: true }, allowMultiple: true });
    expect(diverged.warnings).toBeTruthy();
    expect(diverged.warnings?.[0]).toMatchObject({ code: 'host-divergence' });
    await waitForJob(system.jobs, diverged.jobId!);
  });

  test('scenario 42: a required-and-absent acknowledgement fails the create with RESTORE_ACK_REQUIRED', async () => {
    const system = makeSystem();
    const source = await install(system, { name: 'source' });
    await writeExtraData(source.deploymentId, 'note.txt', 'hello');

    // carryEnv: false with NO acknowledge -> RESTORE_ACK_REQUIRED (restore-env-not-carried required).
    await expect(
      system.drafts.createDraft({
        appId: APP_ID, version: '1.0.0',
        restoreFrom: { candidateId: source.deploymentId, carryEnv: false },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { code: 'RESTORE_ACK_REQUIRED', required: ['restore-env-not-carried'] } });
  });

  test('scenario 43: declining available configuration still warns and still requires the acknowledgement', async () => {
    defaultEnv = [{ key: 'ADMIN_PASSWORD', value: '', isSecret: true, generate: { kind: 'hex' } }];
    const system = makeSystem();
    const source = await install(system, { name: 'source' });
    await writeExtraData(source.deploymentId, 'note.txt', 'hello');
    // Write an env record so the candidate DOES carry configuration.
    await mkdir(join(appsRoot, '.hola', source.deploymentId), { recursive: true, mode: 0o700 });
    await writeFile(join(appsRoot, '.hola', source.deploymentId, 'env.json'), JSON.stringify({ schema: 1, writtenAt: new Date().toISOString(), deploymentId: source.deploymentId, env: { ADMIN_PASSWORD: 'carried-value' } }), { mode: 0o600 });

    // Decline it explicitly (carryEnv: false) despite it being available —
    // still requires the acknowledgement.
    await expect(
      system.drafts.createDraft({
        appId: APP_ID, version: '1.0.0',
        restoreFrom: { candidateId: source.deploymentId, carryEnv: false },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { code: 'RESTORE_ACK_REQUIRED', required: ['restore-env-not-carried'] } });

    // With the acknowledgement, it proceeds — and the value is NOT carried
    // (the operator's decline is honoured).
    const { draftId } = await system.drafts.createDraft({
      appId: APP_ID, version: '1.0.0',
      restoreFrom: { candidateId: source.deploymentId, carryEnv: false, acknowledge: ['restore-env-not-carried'] },
    });
    const draft = await system.drafts.getDraft(draftId);
    expect(draft.appEnv.find(e => e.key === 'ADMIN_PASSWORD')?.value).not.toBe('carried-value');
  });

  // =========================================================================
  // US2: carrying configuration (scenario 10)
  // =========================================================================

  test('scenario 10: the three-case merge — carried wins, a new generate-recipe key mints, another rides through', async () => {
    defaultEnv = [{ key: 'ADMIN_PASSWORD', value: '', isSecret: true, generate: { kind: 'hex' } }];
    const system = makeSystem();
    const source = await install(system, { name: 'source' });
    await writeExtraData(source.deploymentId, 'note.txt', 'hello');
    await mkdir(join(appsRoot, '.hola', source.deploymentId), { recursive: true, mode: 0o700 });
    await writeFile(
      join(appsRoot, '.hola', source.deploymentId, 'env.json'),
      JSON.stringify({ schema: 1, writtenAt: new Date().toISOString(), deploymentId: source.deploymentId, env: { ADMIN_PASSWORD: 'carried-secret-value' } }),
      { mode: 0o600 },
    );

    const { draftId } = await system.drafts.createDraft({
      appId: APP_ID, version: '1.0.0',
      restoreFrom: { candidateId: source.deploymentId, carryEnv: true },
    });
    const draft = await system.drafts.getDraft(draftId);
    // Carried value equals the source's exactly (SC-003).
    expect(draft.appEnv.find(e => e.key === 'ADMIN_PASSWORD')?.value).toBe('carried-secret-value');
  });
});
