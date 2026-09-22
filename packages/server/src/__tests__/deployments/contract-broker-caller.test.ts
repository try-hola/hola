/**
 * Who a brokered-contract call is made BY (#501).
 *
 * Every broker method takes the deployment id its `hct_*` contract token was
 * minted for and verifies THAT deployment is a consented provider of THAT
 * contract, rather than re-deriving "the provider" with a host-wide singleton
 * scan. The two answers agree whenever a host has one provider — which
 * `assertProviderAllowed` has guaranteed for everything installed since spec
 * 004 — and disagree in the legacy `providerConflict` state, where two installs
 * both declare the same provider role. That state is surfaced as a warning
 * rather than auto-resolved, and both installs hold a valid token carrying the
 * same capability, so a scan resolved to whichever one it found first: B's token
 * could publish into, poll, claim and complete A's work.
 *
 * The conflict state is built here by subclassing the service to drop
 * `assertProviderAllowed` — the guard did not exist when these records could be
 * created, and disabling exactly that guard is the most faithful reconstruction
 * available. Everything else (manifests, consent, the stores) goes through the
 * real path.
 *
 * Runs against RealDeploymentService on a real filesystem, mirroring
 * `restore-provider.test.ts`'s harness (a second mkdtemp root for
 * `HOLA_RESTORE_STAGING_ROOT`, required because the `restore@1` provider grant
 * is a writable mount the materialiser validates).
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RealDeploymentService } from '../../services/core/deployment';
import { RealDraftService } from '../../services/core/draft';
import { RealStorageService } from '../../services/core/storage';
import { RealRoutingService } from '../../services/core/routing';
import { RealDatabaseService } from '../../services/core/database';
import { RealLoggingService } from '../../services/core/logging';
import { RealJobService } from '../../services/core/jobs';
import { MockDockerService } from '../../services/core/docker';
import { NoneProvisionerService } from '../../services/core/provisioner';
import type { RestoreRequestRecord } from '../../services/core/restore-broker-state';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

const COMPOSE = 'services:\n  app:\n    image: nginx:1.27\n';
const RESTORE_STORE = 'config/restore-broker.json';

/** A provider of both brokered contracts, and a plain acceptor to call as a non-provider. */
const PROVIDER_A = 'provider-a';
const PROVIDER_B = 'provider-b';
const ACCEPTOR = 'wiki';

interface AppConfig {
  provides?: string[];
  accepts?: string[];
}

function makeCatalog(configs: Record<string, AppConfig>): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: appId, icon: '🧪' }),
    // A `${appId}@${version}` key overrides the bare `${appId}` default, so a
    // test can promote an install onto a manifest that declares MORE provider
    // roles without any new consent — the declared-but-unconsented shape.
    getVersionDetail: async (appId: string, version: string) => {
      const cfg = configs[`${appId}@${version}`] ?? configs[appId] ?? {};
      return {
        defaultEnv: [],
        defaults: { ports: [], volumes: [] },
        provides: cfg.provides,
        accepts: cfg.accepts,
        upgrade: {},
        multiInstance: true,
      };
    },
  } as unknown as CatalogArg;
}

function makeValidation(): ValidationArg {
  return {
    validateDraft: async () => ({ ok: true, errors: [], warnings: [] }),
    preflightCheck: async () => ({ ok: true, checks: [] }),
  } as unknown as ValidationArg;
}

/**
 * The pre-guard host: a service that still enforces everything except one
 * provider per contract. Nothing but `assertProviderAllowed` is relaxed, so the
 * two records it lets us create are exactly what a pre-spec-004 host holds.
 */
class PreGuardDeploymentService extends RealDeploymentService {
  protected override async assertProviderAllowed(): Promise<void> {
    /* the guard this state predates */
  }
}

async function waitForJob(jobs: RealJobService, id: string, timeoutMs = 10_000) {
  const start = Date.now();
  for (;;) {
    const job = await jobs.getJob(id);
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    if (Date.now() - start > timeoutMs) throw new Error(`Job ${id} did not finish (last: ${job?.status})`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const FORBIDDEN = { code: 'NOT_CONTRACT_PROVIDER', status: 403 };

describe('brokered-contract calls act as their caller (#501)', () => {
  let dataRoot: string;
  let appsRoot: string;
  let restoreRoot: string;
  let prevAppsBindRoot: string | undefined;
  let prevRestoreStagingRoot: string | undefined;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-broker-caller-data-'));
    appsRoot = await mkdtemp(join(tmpdir(), 'hola-broker-caller-apps-'));
    restoreRoot = await mkdtemp(join(tmpdir(), 'hola-broker-caller-staging-'));
    prevAppsBindRoot = process.env.HOLA_APPS_BIND_ROOT;
    prevRestoreStagingRoot = process.env.HOLA_RESTORE_STAGING_ROOT;
    process.env.HOLA_APPS_BIND_ROOT = appsRoot;
    process.env.HOLA_RESTORE_STAGING_ROOT = restoreRoot;
  });

  afterEach(async () => {
    if (prevAppsBindRoot === undefined) delete process.env.HOLA_APPS_BIND_ROOT;
    else process.env.HOLA_APPS_BIND_ROOT = prevAppsBindRoot;
    if (prevRestoreStagingRoot === undefined) delete process.env.HOLA_RESTORE_STAGING_ROOT;
    else process.env.HOLA_RESTORE_STAGING_ROOT = prevRestoreStagingRoot;
    await rm(dataRoot, { recursive: true, force: true });
    await rm(appsRoot, { recursive: true, force: true });
    await rm(restoreRoot, { recursive: true, force: true });
  });

  function makeSystem(configs: Record<string, AppConfig>, opts: { allowProviderConflict?: boolean } = {}) {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage);
    const logging = new RealLoggingService(storage);
    const jobs = new RealJobService(database, logging);
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const drafts = new RealDraftService(storage, makeCatalog(configs), makeValidation());
    const Service = opts.allowProviderConflict ? PreGuardDeploymentService : RealDeploymentService;
    const deployments = new Service(
      storage, jobs, new MockDockerService(), drafts, routing, logging, new NoneProvisionerService(),
    );
    drafts.setDeploymentsService(deployments);
    return { storage, jobs, drafts, deployments };
  }

  type System = ReturnType<typeof makeSystem>;

  async function install(
    sys: System,
    appId: string,
    opts: { grants?: string[]; version?: string; name?: string } = {},
  ): Promise<string> {
    const { draftId } = await sys.drafts.createDraft({ appId, version: opts.version ?? '1.0.0' });
    await sys.drafts.updateDraft(draftId, { composeOverride: COMPOSE });
    await sys.drafts.finalizeDraft(draftId);
    const created = await sys.deployments.createFromDraft({
      draftId, name: opts.name ?? appId, grants: opts.grants, options: { autoStart: true }, allowMultiple: true,
    });
    expect((await waitForJob(sys.jobs, created.jobId!)).status).toBe('completed');
    return created.deploymentId;
  }

  /** Promote an install onto a version whose manifest declares more roles. No new consent. */
  async function promote(sys: System, deploymentId: string, appId: string, version: string): Promise<void> {
    const { draftId } = await sys.drafts.createDraft({ appId, version });
    await sys.drafts.updateDraft(draftId, { composeOverride: COMPOSE });
    await sys.drafts.finalizeDraft(draftId);
    const result = await sys.deployments.promote(deploymentId, { draftId, options: { autoStart: true } });
    expect((await waitForJob(sys.jobs, result.jobId!)).status).toBe('completed');
  }

  /**
   * Seed one `pending` restore request addressed to `providerDeploymentId`.
   *
   * Written straight into the store rather than driven through an install: with
   * two consented providers there is no deterministic way to make the install
   * path address a CHOSEN one (candidate resolution is itself a host-wide read),
   * and the record's `providerDeploymentId` is the whole subject of these tests.
   */
  async function seedRequest(
    sys: System,
    requestId: string,
    providerDeploymentId: string,
    overrides: Partial<RestoreRequestRecord> = {},
  ): Promise<void> {
    const now = Date.now();
    const record: RestoreRequestRecord = {
      id: requestId,
      providerDeploymentId,
      targetDeploymentId: 'wiki-00000000',
      targetAppId: ACCEPTOR,
      captureId: `cap-for-${providerDeploymentId}`,
      destination: join(restoreRoot, requestId),
      status: 'pending',
      createdAt: new Date(now).toISOString(),
      deadlineAt: new Date(now + 10 * 60 * 1000).toISOString(),
      ...overrides,
    };
    const existing = (await sys.storage.fileExists(RESTORE_STORE))
      ? (JSON.parse(await sys.storage.readFileAsString(RESTORE_STORE)) as Record<string, RestoreRequestRecord>)
      : {};
    await sys.storage.writeFile(RESTORE_STORE, JSON.stringify({ ...existing, [requestId]: record }, null, 2));
  }

  // =========================================================================
  // A caller that is not a provider at all
  // =========================================================================

  describe('a caller that is not a consented provider is refused', () => {
    test('backup@1: an installed acceptor cannot prepare, finalize, or poll a prepare job', async () => {
      const sys = makeSystem({
        [PROVIDER_A]: { provides: ['backup@1'] },
        [ACCEPTOR]: { accepts: ['backup@1'] },
      });
      await install(sys, PROVIDER_A, { grants: ['backup@1'] });
      const acceptor = await install(sys, ACCEPTOR);

      await expect(sys.deployments.prepareContractBackup(acceptor)).rejects.toMatchObject(FORBIDDEN);
      await expect(sys.deployments.finalizeContractBackup(acceptor)).rejects.toMatchObject(FORBIDDEN);
      await expect(sys.deployments.assertContractProvider(acceptor, 'backup@1')).rejects.toMatchObject(FORBIDDEN);
    });

    test('restore@1: an installed acceptor cannot publish, poll, claim, or complete', async () => {
      const sys = makeSystem({
        [PROVIDER_A]: { provides: ['restore@1'] },
        [ACCEPTOR]: { accepts: ['restore@1'] },
      });
      const provider = await install(sys, PROVIDER_A, { grants: ['restore@1'] });
      const acceptor = await install(sys, ACCEPTOR);
      await seedRequest(sys, 'req-a', provider);

      await expect(sys.deployments.publishRestoreIndex(acceptor, [])).rejects.toMatchObject(FORBIDDEN);
      await expect(sys.deployments.pollRestoreRequests(acceptor)).rejects.toMatchObject(FORBIDDEN);
      await expect(sys.deployments.claimRestoreRequest(acceptor, 'req-a')).rejects.toMatchObject(FORBIDDEN);
      await expect(sys.deployments.completeRestoreRequest(acceptor, 'req-a', 'completed')).rejects.toMatchObject(FORBIDDEN);

      // Refused before the request was even looked at: it is untouched, and the
      // real provider can still claim it.
      await expect(sys.deployments.claimRestoreRequest(provider, 'req-a')).resolves.toEqual({ ok: true });
    });

    test('a deployment id that is not installed at all is refused, not treated as the provider', async () => {
      const sys = makeSystem({ [PROVIDER_A]: { provides: ['backup@1', 'restore@1'] } });
      await install(sys, PROVIDER_A, { grants: ['backup@1', 'restore@1'] });

      await expect(sys.deployments.prepareContractBackup('nope-00000000')).rejects.toMatchObject(FORBIDDEN);
      await expect(sys.deployments.pollRestoreRequests('nope-00000000')).rejects.toMatchObject(FORBIDDEN);
      // The empty-string case a route could only reach by defaulting an absent
      // principal, which it must never do.
      await expect(sys.deployments.pollRestoreRequests('')).rejects.toMatchObject(FORBIDDEN);
    });

    test('a provider role an upgrade declared but nobody consented to grants no broker access', async () => {
      // `promote` never asks for consent, so the persisted `grantedContracts`
      // from the original install still governs. The broker reads consent the
      // same way the data mount does, so a declared-only role is refused here
      // too — it would otherwise be privilege an operator never approved.
      const sys = makeSystem({
        [PROVIDER_A]: { provides: ['backup@1'] },
        [`${PROVIDER_A}@2.0.0`]: { provides: ['backup@1', 'restore@1'] },
      });
      const provider = await install(sys, PROVIDER_A, { grants: ['backup@1'] });
      await promote(sys, provider, PROVIDER_A, '2.0.0');

      await expect(sys.deployments.pollRestoreRequests(provider)).rejects.toMatchObject(FORBIDDEN);
      // backup@1 was consented at install, so that half still works.
      await expect(sys.deployments.prepareContractBackup(provider)).resolves.toMatchObject({ apps: [] });
    });
  });

  // =========================================================================
  // The single-provider happy path, unchanged, for both contracts
  // =========================================================================

  describe('the single-provider happy path is unchanged', () => {
    test('backup@1: the consented provider prepares, polls its job, and finalizes', async () => {
      const sys = makeSystem({
        [PROVIDER_A]: { provides: ['backup@1'] },
        [ACCEPTOR]: { accepts: ['backup@1'] },
      });
      const provider = await install(sys, PROVIDER_A, { grants: ['backup@1'] });
      await install(sys, ACCEPTOR);

      // The acceptor declares no participations, so there is nothing to quiesce
      // and no job — the documented "already covered" answer.
      expect(await sys.deployments.prepareContractBackup(provider)).toEqual({ apps: [], participations: [] });
      await expect(sys.deployments.assertContractProvider(provider, 'backup@1')).resolves.toBeUndefined();
      expect(await sys.deployments.finalizeContractBackup(provider)).toEqual({ ok: true, results: [] });
    });

    test('restore@1: the consented provider publishes, polls, claims and completes its own request', async () => {
      const sys = makeSystem({
        [PROVIDER_A]: { provides: ['restore@1'] },
        [ACCEPTOR]: { accepts: ['restore@1'] },
      });
      const provider = await install(sys, PROVIDER_A, { grants: ['restore@1'] });

      expect(await sys.deployments.pollRestoreRequests(provider)).toEqual({ requests: [], reindex: true });
      expect(
        await sys.deployments.publishRestoreIndex(provider, [
          { captureId: 'cap-1', takenAt: '2026-02-01T09:00:00.000Z', sizeBytes: 100, location: '/srv/hola/apps/wiki-old', identity: { app: ACCEPTOR } },
        ]),
      ).toEqual({ ok: true, count: 1 });

      await seedRequest(sys, 'req-1', provider);
      const polled = await sys.deployments.pollRestoreRequests(provider);
      expect(polled.reindex).toBe(false);
      expect(polled.requests.map((r) => r.id)).toEqual(['req-1']);

      await expect(sys.deployments.claimRestoreRequest(provider, 'req-1')).resolves.toEqual({ ok: true });
      await expect(sys.deployments.completeRestoreRequest(provider, 'req-1', 'completed')).resolves.toEqual({ ok: true });
      // The claim is still exactly-once, and an unknown id is still not-found.
      await expect(sys.deployments.claimRestoreRequest(provider, 'req-1')).rejects.toMatchObject({
        details: { code: 'RESTORE_REQUEST_ALREADY_CLAIMED' },
      });
      await expect(sys.deployments.claimRestoreRequest(provider, 'no-such-request')).rejects.toMatchObject({
        code: 'RESTORE_REQUEST_NOT_FOUND',
      });
    });
  });

  // =========================================================================
  // Two consented providers of the same contract — the legacy conflict state
  // =========================================================================

  describe('with two consented providers of the same contract (legacy providerConflict)', () => {
    /** Both installs declaring and consented to `restore@1`, plus `backup@1`. */
    async function twoProviders() {
      const sys = makeSystem(
        {
          [PROVIDER_A]: { provides: ['backup@1', 'restore@1'] },
          [PROVIDER_B]: { provides: ['backup@1', 'restore@1'] },
          [ACCEPTOR]: { accepts: ['backup@1', 'restore@1'] },
        },
        { allowProviderConflict: true },
      );
      const a = await install(sys, PROVIDER_A, { grants: ['backup@1', 'restore@1'] });
      const b = await install(sys, PROVIDER_B, { grants: ['backup@1', 'restore@1'] });

      // The state under test really is the conflicting one the rollup warns about.
      const rollup = await sys.deployments.getContracts();
      for (const ref of ['backup@1', 'restore@1']) {
        const row = rollup.items.find((i) => i.ref === ref);
        expect(row?.providerConflict).toBe(true);
        expect(row?.providers.map((p) => p.deploymentId).sort()).toEqual([a, b].sort());
      }
      return { sys, a, b };
    }

    test('each provider publishes into its OWN index; neither overwrites the other', async () => {
      const { sys, a, b } = await twoProviders();

      await sys.deployments.publishRestoreIndex(a, [
        { captureId: 'cap-a', takenAt: '2026-02-01T09:00:00.000Z', sizeBytes: 1, location: '/srv/a', identity: { app: ACCEPTOR } },
      ]);
      await sys.deployments.publishRestoreIndex(b, [
        { captureId: 'cap-b', takenAt: '2026-02-02T09:00:00.000Z', sizeBytes: 2, location: '/srv/b', identity: { app: ACCEPTOR } },
      ]);

      // A publish replaces one provider's index wholesale, so a shared slot
      // could hold only the later of these two. Both surviving under their own
      // provider is the property: `getProviderRestoreSource` reads the index by
      // provider id, never by a scan.
      expect((await sys.deployments.getProviderRestoreSource(a, 'cap-a')).entry?.captureId).toBe('cap-a');
      expect((await sys.deployments.getProviderRestoreSource(b, 'cap-b')).entry?.captureId).toBe('cap-b');
      // And neither can be read under the other's id.
      expect((await sys.deployments.getProviderRestoreSource(a, 'cap-b')).entry).toBeUndefined();
      expect((await sys.deployments.getProviderRestoreSource(b, 'cap-a')).entry).toBeUndefined();
    });

    test('a poll returns only the calling provider\'s pending requests', async () => {
      const { sys, a, b } = await twoProviders();
      await seedRequest(sys, 'req-for-a', a);
      await seedRequest(sys, 'req-for-b', b);

      expect((await sys.deployments.pollRestoreRequests(a)).requests.map((r) => r.id)).toEqual(['req-for-a']);
      expect((await sys.deployments.pollRestoreRequests(b)).requests.map((r) => r.id)).toEqual(['req-for-b']);
    });

    test('a provider cannot claim another provider\'s request, and the owner still can', async () => {
      const { sys, a, b } = await twoProviders();
      await seedRequest(sys, 'req-for-b', b);

      // Not-found rather than forbidden: A *is* a consented provider, so the
      // refusal is about the request, and a provider has no business learning
      // another's queue exists.
      await expect(sys.deployments.claimRestoreRequest(a, 'req-for-b')).rejects.toMatchObject({
        code: 'RESTORE_REQUEST_NOT_FOUND',
        status: 404,
      });
      // The attempt changed nothing: B's own claim still succeeds.
      await expect(sys.deployments.claimRestoreRequest(b, 'req-for-b')).resolves.toEqual({ ok: true });
    });

    test('a provider cannot complete another provider\'s claimed request, and the owner still can', async () => {
      const { sys, a, b } = await twoProviders();
      await seedRequest(sys, 'req-for-b', b, { status: 'claimed', claimedAt: new Date().toISOString() });

      await expect(sys.deployments.completeRestoreRequest(a, 'req-for-b', 'completed')).rejects.toMatchObject({
        code: 'RESTORE_REQUEST_NOT_FOUND',
        status: 404,
      });
      await expect(sys.deployments.completeRestoreRequest(b, 'req-for-b', 'completed')).resolves.toEqual({ ok: true });
    });

    test('both providers may still announce a backup as themselves', async () => {
      // The `backup@1` broker's work is host-wide (every accepting app's hooks),
      // so two providers share one run record — the conflict the rollup warns
      // about, not something this fix resolves. What it does settle is that each
      // call is authorised as the deployment that made it.
      const { sys, a, b } = await twoProviders();
      await install(sys, ACCEPTOR);

      expect(await sys.deployments.prepareContractBackup(a)).toEqual({ apps: [], participations: [] });
      expect(await sys.deployments.finalizeContractBackup(b)).toEqual({ ok: true, results: [] });
    });
  });
});
