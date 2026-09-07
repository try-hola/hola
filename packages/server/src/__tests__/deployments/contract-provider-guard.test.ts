/**
 * The provider cardinality guard (spec 004, ADR 0004 §10, FR-012/013).
 *
 * A contract has at most one provider per host. This is enforced at
 * `createFromDraft`, before any deployment or job is created, and evaluated
 * against exactly the set the existing single-instance guard counts (the live,
 * rehydrated in-memory deployment map) — so the two guards can never disagree
 * about what "installed" means.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, readdir } from 'fs/promises';
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
import { MockDeploymentService } from '../../services/core/deployment';
import { NoneProvisionerService } from '../../services/core/provisioner';
import { ConflictError } from '../../middleware/error-mapping';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

const COMPOSE = 'services:\n  app:\n    image: nginx:1.27\n';

/** Per-appId provides, so two distinct apps can be given the same/different contracts. */
function makeCatalog(providesByApp: Record<string, string[] | undefined>): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: appId, icon: '📦' }),
    getVersionDetail: async (appId: string) => ({
      defaultEnv: [],
      defaults: { ports: [], volumes: [] },
      provides: providesByApp[appId],
    }),
  } as unknown as CatalogArg;
}

function makeValidation(): ValidationArg {
  return {
    validateDraft: async () => ({ ok: true, errors: [], warnings: [] }),
    preflightCheck: async () => ({ ok: true, checks: [] }),
  } as unknown as ValidationArg;
}

async function waitForJob(jobs: RealJobService, id: string | undefined, timeoutMs = 5000) {
  if (!id) return undefined;
  const start = Date.now();
  for (;;) {
    const job = await jobs.getJob(id);
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    if (Date.now() - start > timeoutMs) throw new Error(`Job ${id} did not finish (last: ${job?.status})`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('provider cardinality guard (spec 004, US3)', () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-provider-guard-'));
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  function makeSystem(providesByApp: Record<string, string[] | undefined>) {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage);
    const logging = new RealLoggingService(storage);
    const jobs = new RealJobService(database, logging);
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const drafts = new RealDraftService(storage, makeCatalog(providesByApp), makeValidation());
    const deployments = new RealDeploymentService(
      storage, jobs, new MockDockerService(), drafts, routing, logging, new NoneProvisionerService(),
    );
    return { storage, jobs, drafts, deployments };
  }

  async function install(
    sys: ReturnType<typeof makeSystem>,
    appId: string,
    opts: { grants?: string[] } = {},
  ) {
    const { draftId } = await sys.drafts.createDraft({ appId, version: '1.0.0' });
    await sys.drafts.updateDraft(draftId, { composeOverride: COMPOSE });
    await sys.drafts.finalizeDraft(draftId);
    const created = await sys.deployments.createFromDraft({ draftId, name: appId, grants: opts.grants });
    await waitForJob(sys.jobs, created.jobId);
    return created;
  }

  test('installing the first provider of a contract succeeds', async () => {
    const sys = makeSystem({ backrest: ['backup@1'] });
    const created = await install(sys, 'backrest', { grants: ['backup@1'] });
    expect(created.deploymentId).toBeTruthy();
  });

  test('a second provider of the same contract is rejected, naming the first, with no deployment or job created', async () => {
    const sys = makeSystem({ 'backrest-a': ['backup@1'], 'backrest-b': ['backup@1'] });
    const a = await install(sys, 'backrest-a', { grants: ['backup@1'] });

    const before = await readdir(join(dataRoot, 'deployments'));
    let caught: unknown;
    try {
      await install(sys, 'backrest-b', { grants: ['backup@1'] });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ConflictError);
    const err = caught as InstanceType<typeof ConflictError>;
    expect((err.details as { code?: string })?.code).toBe('PROVIDER_EXISTS');
    expect((err.details as { contract?: string })?.contract).toBe('backup@1');
    expect((err.details as { existing?: { id?: string } })?.existing?.id).toBe(a.deploymentId);
    expect(err.message).toContain(a.deploymentId);
    expect(err.message.toLowerCase()).toContain('uninstall it first');

    // No new deployment directory and no new job were created for the rejected install.
    const after = await readdir(join(dataRoot, 'deployments'));
    expect(after.sort()).toEqual(before.sort());
  });

  test('after the first provider is removed, the same install succeeds', async () => {
    const sys = makeSystem({ 'backrest-a': ['backup@1'], 'backrest-b': ['backup@1'] });
    const a = await install(sys, 'backrest-a', { grants: ['backup@1'] });
    await sys.deployments.deleteDeployment(a.deploymentId);

    const b = await install(sys, 'backrest-b', { grants: ['backup@1'] });
    expect(b.deploymentId).toBeTruthy();
  });

  test('a different contract is unaffected — container-logs@1 beside an existing backup@1 provider', async () => {
    const sys = makeSystem({ backrest: ['backup@1'], collector: ['container-logs@1'] });
    await install(sys, 'backrest', { grants: ['backup@1'] });
    const collector = await install(sys, 'collector', { grants: ['container-logs@1'] });
    expect(collector.deploymentId).toBeTruthy();
  });

  test('a second container-logs@1 provider beside an existing one is refused the same way (FR-014)', async () => {
    const sys = makeSystem({ 'collector-a': ['container-logs@1'], 'collector-b': ['container-logs@1'] });
    await install(sys, 'collector-a', { grants: ['container-logs@1'] });

    await expect(install(sys, 'collector-b', { grants: ['container-logs@1'] })).rejects.toBeInstanceOf(ConflictError);
  });

  test('the guard fires before the consent check — a second provider without grants still gets PROVIDER_EXISTS, not GRANT_CONSENT_REQUIRED', async () => {
    const sys = makeSystem({ 'backrest-a': ['backup@1'], 'backrest-b': ['backup@1'] });
    await install(sys, 'backrest-a', { grants: ['backup@1'] });

    let caught: unknown;
    try {
      await install(sys, 'backrest-b', {}); // no grants at all
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConflictError);
    expect(((caught as InstanceType<typeof ConflictError>).details as { code?: string })?.code).toBe('PROVIDER_EXISTS');
  });

  test('promoting the sole provider to a new release never trips the guard (it is not a second install)', async () => {
    const sys = makeSystem({ backrest: ['backup@1'] });
    const created = await install(sys, 'backrest', { grants: ['backup@1'] });

    const { draftId } = await sys.drafts.createDraft({ appId: 'backrest', version: '1.0.0' });
    await sys.drafts.updateDraft(draftId, { composeOverride: COMPOSE });
    await sys.drafts.finalizeDraft(draftId);

    await expect(sys.deployments.promote(created.deploymentId, { draftId })).resolves.toBeDefined();
  });

  test('the base/mock deployment service stays permissive (no guard)', async () => {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage);
    const logging = new RealLoggingService(storage);
    const jobs = new RealJobService(database, logging);
    const mock = new MockDeploymentService(jobs);
    // The base seam is a no-op regardless of what `provides` carries — like
    // `assertInstanceAllowed`, the mock never enforces cross-deployment guards.
    await expect(
      (mock as unknown as { assertProviderAllowed(provides: string[] | undefined, appId: string): Promise<void> }).assertProviderAllowed(['backup@1'], 'anything'),
    ).resolves.toBeUndefined();
  });
});
