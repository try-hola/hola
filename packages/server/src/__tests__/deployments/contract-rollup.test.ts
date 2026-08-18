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
import type { AppBackupConfig, ContractRollup, GetDeploymentResponse } from '@hola/shared';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

const COMPOSE = 'services:\n  app:\n    image: nginx:1.27\n';

const PG_BACKUP: AppBackupConfig = {
  preHook: { service: 'db', command: ['sh', '-c', 'pg_dump -U app app > /backups/app.sql'] },
  postHook: { service: 'db', command: ['rm', '-f', '/backups/app.sql'] },
};

/** What each app's manifest declares, keyed by app id. */
type AppShape = { provides?: string[]; accepts?: string[]; backup?: AppBackupConfig };

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

  async function install(sys: ReturnType<typeof makeSystem>, appId: string, grants?: string[]): Promise<string> {
    const { draftId } = await sys.drafts.createDraft({ appId, version: '1.0.0' });
    await sys.drafts.updateDraft(draftId, { composeOverride: COMPOSE });
    await sys.drafts.finalizeDraft(draftId);
    const created = await sys.deployments.createFromDraft({ draftId, name: appId, grants });
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
    expect(detail.contracts).toEqual({ accepts: ['backup@1'], hooks: ['backup@1'] });
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
});
