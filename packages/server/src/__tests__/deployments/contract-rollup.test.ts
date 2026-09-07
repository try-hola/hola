/**
 * The contract rollup (ADR 0004 Phase 4) — the read side of capability contracts.
 *
 * Phases 1–3 made the roles real: declared in the manifest, gated on consent, and
 * acted on by the broker. None of it was *visible*, which is the gap that let
 * immich sit uncovered for a year with nothing to notice it. These tests cover the
 * platform-wide answer to "who provides backup, and which installed apps does it
 * cover?", plus the same facts per install.
 *
 * Runs against RealDeploymentService with a per-app catalog stub, so the roles come
 * out of each deployment's own finalized release manifest — the release it is
 * actually running, not the app's newest catalog version.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { RealDeploymentService } from '../../services/core/deployment';
import { RealDraftService } from '../../services/core/draft';
import { RealStorageService } from '../../services/core/storage';
import { RealRoutingService } from '../../services/core/routing';
import { RealDatabaseService } from '../../services/core/database';
import { RealLoggingService } from '../../services/core/logging';
import { RealJobService } from '../../services/core/jobs';
import { MockDockerService } from '../../services/core/docker';
import { NoneProvisionerService } from '../../services/core/provisioner';
import type { AppBackupConfig, AppBackupDeclaration, AppProfileConfig, ContractRollup, GetDeploymentResponse } from '@hola/shared';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

const COMPOSE = 'services:\n  app:\n    image: nginx:1.27\n';

const PG_BACKUP: AppBackupConfig = {
  preHook: { service: 'db', command: ['sh', '-c', 'pg_dump -U app app > /backups/app.sql'] },
  postHook: { service: 'db', command: ['rm', '-f', '/backups/app.sql'] },
};

/** What each app's manifest declares, keyed by app id. */
type AppShape = {
  provides?: string[];
  accepts?: string[];
  backup?: AppBackupConfig | AppBackupDeclaration;
  profiles?: AppProfileConfig[];
};

/** A postiz-shaped compose: two postgres services plus the app's own image. */
const POSTIZ_COMPOSE =
  'services:\n' +
  '  postiz:\n' +
  '    image: ghcr.io/gitroomhq/postiz-app:v1.0.0\n' +
  '  postiz-postgres:\n' +
  '    image: postgres:17-alpine\n' +
  '  temporal-postgres:\n' +
  '    image: postgres:17-alpine\n';

const POSTIZ_ONE_PARTICIPATION: AppBackupDeclaration = [
  { id: 'default', preHook: { service: 'postiz-postgres', command: ['pg_dump', 'app'] } },
];

const POSTIZ_TWO_PARTICIPATIONS: AppBackupDeclaration = [
  { id: 'app-db', preHook: { service: 'postiz-postgres', command: ['pg_dump', 'app'] } },
  { id: 'temporal-db', preHook: { service: 'temporal-postgres', command: ['pg_dump', 'temporal'] } },
];

function makeCatalog(apps: Record<string, AppShape>): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: appId, icon: '📦' }),
    getVersionDetail: async (appId: string) => ({
      defaultEnv: [],
      defaults: { ports: [], volumes: [] },
      ...(apps[appId] ?? {}),
    }),
  } as unknown as CatalogArg;
}

function makeValidation(): ValidationArg {
  return {
    validateDraft: async () => ({ ok: true, errors: [], warnings: [] }),
    preflightCheck: async () => ({ ok: true, checks: [] }),
  } as unknown as ValidationArg;
}

async function waitForJob(jobs: RealJobService, id: string, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const job = await jobs.getJob(id);
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    if (Date.now() - start > timeoutMs) throw new Error(`Job ${id} did not finish (last: ${job?.status})`);
    await new Promise(r => setTimeout(r, 10));
  }
}

describe('contract rollup', () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-rollup-'));
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  function makeSystem(apps: Record<string, AppShape>) {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage);
    const logging = new RealLoggingService(storage);
    const jobs = new RealJobService(database, logging);
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const drafts = new RealDraftService(storage, makeCatalog(apps), makeValidation());
    const deployments = new RealDeploymentService(
      storage, jobs, new MockDockerService(), drafts, routing, logging, new NoneProvisionerService(),
    );
    return { storage, jobs, drafts, deployments };
  }

  async function install(
    sys: ReturnType<typeof makeSystem>,
    appId: string,
    grants?: string[],
    extra: { compose?: string; profiles?: string[] } = {},
  ): Promise<string> {
    const { draftId } = await sys.drafts.createDraft({ appId, version: '1.0.0' });
    await sys.drafts.updateDraft(draftId, { composeOverride: extra.compose ?? COMPOSE });
    await sys.drafts.finalizeDraft(draftId);
    const created = await sys.deployments.createFromDraft({ draftId, name: appId, grants, profiles: extra.profiles });
    expect((await waitForJob(sys.jobs, created.jobId!)).status).toBe('completed');
    return created.deploymentId;
  }

  const backupOf = (items: ContractRollup[]): ContractRollup => items.find(i => i.ref === 'backup@1')!;

  test('reports every contract with empty buckets when nothing is installed', async () => {
    // "No backup provider is installed" has to be a thing the platform can SAY.
    // A rollup that only listed filled roles would answer it with silence, which
    // is indistinguishable from a page that failed to load.
    const sys = makeSystem({});
    const { items } = await sys.deployments.getContracts();

    expect(items.map(i => i.ref)).toContain('backup@1');
    expect(backupOf(items)).toMatchObject({ providers: [], acceptors: [], unaffiliated: [] });
  });

  test('sorts installs by the role their own release declares', async () => {
    const sys = makeSystem({
      backrest: { provides: ['backup@1'] },
      paperless: { accepts: ['backup@1'], backup: PG_BACKUP },
      'uptime-kuma': { accepts: ['backup@1'] },
      immich: {},
    });
    const backrest = await install(sys, 'backrest', ['backup@1']);
    const paperless = await install(sys, 'paperless');
    const kuma = await install(sys, 'uptime-kuma');
    const immich = await install(sys, 'immich');

    const rollup = backupOf((await sys.deployments.getContracts()).items);

    expect(rollup.providers).toEqual([
      expect.objectContaining({ deploymentId: backrest, granted: true, status: 'running' }),
    ]);
    // Both are covered; only one needs anything run around the copy.
    expect(rollup.acceptors.find(a => a.deploymentId === paperless)?.hooks).toBe(true);
    expect(rollup.acceptors.find(a => a.deploymentId === kuma)?.hooks).toBe(false);
    // The answer the whole phase exists to produce.
    expect(rollup.unaffiliated.map(a => a.deploymentId)).toEqual([immich]);
  });

  test('a provider that is installed but stopped is still reported, with its status', async () => {
    // "Backrest is installed" and "backups are running" are different facts, and
    // the difference is exactly what an operator needs when nothing has been
    // captured for a week.
    const sys = makeSystem({ backrest: { provides: ['backup@1'] } });
    const backrest = await install(sys, 'backrest', ['backup@1']);
    const action = await sys.deployments.executeAction(backrest, { action: 'stop' });
    expect((await waitForJob(sys.jobs, action.jobId!)).status).toBe('completed');

    const rollup = backupOf((await sys.deployments.getContracts()).items);
    expect(rollup.providers).toEqual([expect.objectContaining({ deploymentId: backrest, status: 'stopped' })]);
  });

  test('hooks declared without accepting the contract do not count as coverage', async () => {
    // The same rule the broker enforces (ADR 0004 §2), stated where an operator can
    // see it: a manifest that predates the contract keeps its pre-upgrade hooks and
    // still reads as *not covered* by the fleet backup, rather than quietly passing.
    const sys = makeSystem({ legacy: { backup: PG_BACKUP } });
    const legacy = await install(sys, 'legacy');

    const rollup = backupOf((await sys.deployments.getContracts()).items);
    expect(rollup.acceptors).toEqual([]);
    expect(rollup.unaffiliated.map(a => a.deploymentId)).toEqual([legacy]);
  });

  test('a deployment reports its own roles on its detail response', async () => {
    const sys = makeSystem({ paperless: { accepts: ['backup@1'], backup: PG_BACKUP } });
    const paperless = await install(sys, 'paperless');

    const detail: GetDeploymentResponse = await sys.deployments.getDeployment(paperless);
    // The stub compose runs no recognised database image, so coverage is
    // `quiesced` off the one declared participation with nothing to target.
    expect(detail.contracts).toEqual({
      accepts: ['backup@1'],
      hooks: ['backup@1'],
      coverage: {
        'backup@1': {
          state: 'quiesced',
          targeted: 0,
          recognised: 0,
          participations: [{ id: 'default', service: 'db' }],
          databases: [],
        },
      },
    });
  });

  test('a provider install reports the grant it actually holds', async () => {
    const sys = makeSystem({ backrest: { provides: ['backup@1'] } });
    const backrest = await install(sys, 'backrest', ['backup@1']);

    const detail = await sys.deployments.getDeployment(backrest);
    expect(detail.contracts).toEqual({ provides: ['backup@1'], granted: ['backup@1'] });
  });

  test('an app with no contract roles carries no contracts field at all', async () => {
    // Absent rather than an empty object: the overwhelming majority of apps fill no
    // role, and a client shouldn't have to distinguish `{}` from "not reported".
    const sys = makeSystem({ immich: {} });
    const immich = await install(sys, 'immich');

    expect((await sys.deployments.getDeployment(immich)).contracts).toBeUndefined();
  });

  describe('backup coverage (spec 004, US2)', () => {
    test('the postiz shape — one participation, two recognised databases — is partial 1/2', async () => {
      const sys = makeSystem({ postiz: { accepts: ['backup@1'], backup: POSTIZ_ONE_PARTICIPATION } });
      const postiz = await install(sys, 'postiz', undefined, { compose: POSTIZ_COMPOSE });

      const detail = await sys.deployments.getDeployment(postiz);
      expect(detail.contracts?.coverage?.['backup@1']).toEqual({
        state: 'partial',
        targeted: 1,
        recognised: 2,
        participations: [{ id: 'default', service: 'postiz-postgres' }],
        databases: ['postiz-postgres', 'temporal-postgres'],
      });

      const rollup = backupOf((await sys.deployments.getContracts()).items);
      const acceptor = rollup.acceptors.find((a) => a.deploymentId === postiz);
      expect(acceptor?.coverage).toEqual(detail.contracts?.coverage?.['backup@1']);
    });

    test('two participations covering both recognised databases is quiesced', async () => {
      const sys = makeSystem({ postiz: { accepts: ['backup@1'], backup: POSTIZ_TWO_PARTICIPATIONS } });
      const postiz = await install(sys, 'postiz', undefined, { compose: POSTIZ_COMPOSE });

      const detail = await sys.deployments.getDeployment(postiz);
      expect(detail.contracts?.coverage?.['backup@1']).toMatchObject({ state: 'quiesced', targeted: 2, recognised: 2 });
    });

    test('accepts, no participations, no recognised database is covered as-is', async () => {
      const sys = makeSystem({ uptime: { accepts: ['backup@1'] } });
      const uptime = await install(sys, 'uptime');

      const detail = await sys.deployments.getDeployment(uptime);
      expect(detail.contracts?.coverage?.['backup@1']).toMatchObject({ state: 'as-is', targeted: 0, recognised: 0 });
    });

    test('accepts, no participations, one recognised database is partial 0/1', async () => {
      const compose = 'services:\n  app:\n    image: mysql:8\n';
      const sys = makeSystem({ solo: { accepts: ['backup@1'] } });
      const solo = await install(sys, 'solo', undefined, { compose });

      const detail = await sys.deployments.getDeployment(solo);
      expect(detail.contracts?.coverage?.['backup@1']).toMatchObject({ state: 'partial', targeted: 0, recognised: 1 });
    });

    test('a database service behind an unselected profile is not counted', async () => {
      const compose =
        'services:\n' +
        '  app:\n' +
        '    image: nginx:1.27\n' +
        '  optional-db:\n' +
        '    image: postgres:17-alpine\n' +
        '    profiles: ["extra"]\n';
      const sys = makeSystem({
        profiled: { accepts: ['backup@1'], profiles: [{ key: 'extra', label: 'Extra DB', default: false }] },
      });
      const profiled = await install(sys, 'profiled', undefined, { compose }); // profiles NOT selected

      const detail = await sys.deployments.getDeployment(profiled);
      expect(detail.contracts?.coverage?.['backup@1']).toMatchObject({ state: 'as-is', targeted: 0, recognised: 0 });
    });

    test('not accepting the contract carries no coverage for it', async () => {
      const sys = makeSystem({ immich: {} });
      const immich = await install(sys, 'immich');

      expect((await sys.deployments.getDeployment(immich)).contracts).toBeUndefined();
    });
  });

  describe('the implicit container-logs@1 rollup (spec 004, US6)', () => {
    test('every non-provider install is a subject, none unaffiliated', async () => {
      const sys = makeSystem({
        alloy: { provides: ['container-logs@1'] },
        appA: {},
        appB: {},
        appC: {},
      });
      await install(sys, 'alloy', ['container-logs@1']);
      const a = await install(sys, 'appA');
      const b = await install(sys, 'appB');
      const c = await install(sys, 'appC');

      const items = (await sys.deployments.getContracts()).items;
      const rollup = items.find((i) => i.ref === 'container-logs@1')!;
      expect(rollup.participation).toBe('implicit');
      expect(rollup.acceptors.map((p) => p.deploymentId).sort()).toEqual([a, b, c].sort());
      expect(rollup.unaffiliated).toEqual([]);
    });
  });
});
