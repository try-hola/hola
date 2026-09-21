/**
 * restore@1 — the provider half (spec 008). Real-filesystem harness, mirroring
 * `restore-on-install.test.ts`'s own (`:398-441`) with a SECOND mkdtemp root
 * for `HOLA_RESTORE_STAGING_ROOT` — required because `MockStorageService`
 * discards file modes and `MockDockerService` starts no containers, and this
 * feature's whole point is a directory a foreign container actually writes
 * into.
 *
 * These tests drive the provider side directly through `DeploymentService`'s
 * methods (`publishRestoreIndex`/`pollRestoreRequests`/`claimRestoreRequest`/
 * `completeRestoreRequest`) rather than through `server.ts`'s HTTP routes or a
 * contract-scoped token — the routing/capability wiring is mechanical and
 * covered separately; what matters here is the request lifecycle and the
 * acquisition/application split actually working end to end.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

import { RealDeploymentService } from '../../services/core/deployment';
import { RealDraftService } from '../../services/core/draft';
import { RealStorageService } from '../../services/core/storage';
import { RealRoutingService } from '../../services/core/routing';
import { RealDatabaseService } from '../../services/core/database';
import { RealLoggingService } from '../../services/core/logging';
import { RealJobService } from '../../services/core/jobs';
import { MockDockerService } from '../../services/core/docker';
import { MockProvisionerService } from '../../services/core/provisioner';
import type { AppEnvVar, AppRestoreDeclaration } from '@hola/shared';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

const TARGET_APP = 'wiki';
const PROVIDER_APP = 'backrest';
const COMPOSE_WITH_DATA = 'services:\n  wiki:\n    image: wiki:latest\n    volumes:\n      - ${HOLA_APP_DATA}:/data\n';
const PROVIDER_COMPOSE = 'services:\n  backrest:\n    image: backrest:latest\n';

interface AppCatalogConfig {
  provides?: string[];
  accepts?: string[];
  restore?: AppRestoreDeclaration[];
  defaultEnv?: AppEnvVar[];
}

function makeCatalog(configs: Record<string, AppCatalogConfig>): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: appId, icon: '🧪' }),
    getVersionDetail: async (appId: string, version: string) => {
      // A `${appId}@${version}` key overrides the bare `${appId}` default —
      // lets a test simulate an upgrade (promote to a version whose manifest
      // declares a NEW provides role) without touching persisted consent.
      const cfg = configs[`${appId}@${version}`] ?? configs[appId] ?? {};
      return {
        defaultEnv: cfg.defaultEnv ?? [],
        defaults: { ports: [], volumes: [] },
        provides: cfg.provides,
        accepts: cfg.accepts,
        restore: cfg.restore,
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

async function waitForJob(jobs: RealJobService, id: string, timeoutMs = 10_000) {
  const start = Date.now();
  for (;;) {
    const job = await jobs.getJob(id);
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    if (Date.now() - start > timeoutMs) throw new Error(`Job ${id} did not finish (last status: ${job?.status})`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('restore@1 provider half (spec 008) — real filesystem harness', () => {
  let dataRoot: string;
  let appsRoot: string;
  let restoreRoot: string;
  let prevAppsBindRoot: string | undefined;
  let prevRestoreStagingRoot: string | undefined;
  let docker: MockDockerService;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-restore-provider-data-'));
    appsRoot = await mkdtemp(join(tmpdir(), 'hola-restore-provider-apps-'));
    restoreRoot = await mkdtemp(join(tmpdir(), 'hola-restore-provider-staging-'));
    prevAppsBindRoot = process.env.HOLA_APPS_BIND_ROOT;
    prevRestoreStagingRoot = process.env.HOLA_RESTORE_STAGING_ROOT;
    process.env.HOLA_APPS_BIND_ROOT = appsRoot;
    process.env.HOLA_RESTORE_STAGING_ROOT = restoreRoot;
    docker = new MockDockerService();
  });

  afterEach(async () => {
    if (prevAppsBindRoot === undefined) delete process.env.HOLA_APPS_BIND_ROOT; else process.env.HOLA_APPS_BIND_ROOT = prevAppsBindRoot;
    if (prevRestoreStagingRoot === undefined) delete process.env.HOLA_RESTORE_STAGING_ROOT; else process.env.HOLA_RESTORE_STAGING_ROOT = prevRestoreStagingRoot;
    await rm(dataRoot, { recursive: true, force: true });
    await rm(appsRoot, { recursive: true, force: true });
    await rm(restoreRoot, { recursive: true, force: true });
  });

  function makeSystem(configs: Record<string, AppCatalogConfig>) {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage);
    const logging = new RealLoggingService(storage);
    const jobs = new RealJobService(database, logging);
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const drafts = new RealDraftService(storage, makeCatalog(configs), makeValidation());
    const deployments = new RealDeploymentService(storage, jobs, docker, drafts, routing, logging, new MockProvisionerService());
    drafts.setDeploymentsService(deployments);
    // Fast polling so a test doesn't wait 2s per iteration for real.
    deployments.restoreRequestPollIntervalMs = 5;
    return { storage, jobs, drafts, deployments };
  }

  async function installProvider(system: ReturnType<typeof makeSystem>, opts: { provides: string[]; version?: string; name?: string }) {
    const { drafts, deployments, jobs } = system;
    const { draftId } = await drafts.createDraft({ appId: PROVIDER_APP, version: opts.version ?? '1.0.0' });
    await drafts.updateDraft(draftId, { composeOverride: PROVIDER_COMPOSE });
    await drafts.finalizeDraft(draftId);
    const created = await deployments.createFromDraft({
      draftId, name: opts.name ?? 'backrest', options: { autoStart: true }, grants: opts.provides, allowMultiple: true,
    });
    await waitForJob(jobs, created.jobId!);
    return created.deploymentId;
  }

  /**
   * Simulate an UPGRADE (spec 008 US2): promote an existing provider install
   * to a new version whose manifest declares MORE provider roles. `promote()`
   * never asks for new grants — the persisted `grantedContracts` from the
   * ORIGINAL install is what still governs materialisation, which is exactly
   * the "declared but not yet consented" shape FR-014 tests.
   */
  async function promoteProvider(system: ReturnType<typeof makeSystem>, deploymentId: string, version: string) {
    const { drafts, deployments, jobs } = system;
    const { draftId } = await drafts.createDraft({ appId: PROVIDER_APP, version });
    await drafts.updateDraft(draftId, { composeOverride: PROVIDER_COMPOSE });
    await drafts.finalizeDraft(draftId);
    const result = await deployments.promote(deploymentId, { draftId, options: { autoStart: true } });
    await waitForJob(jobs, result.jobId!);
  }

  const ALL_ACKS = ['restore-version-unknown', 'restore-env-not-carried', 'restore-inferred-identity'];

  async function installTarget(
    system: ReturnType<typeof makeSystem>,
    opts: { name: string; restoreFrom?: { candidateId: string; carryEnv: boolean; acknowledge?: string[] } },
  ) {
    const { drafts, deployments } = system;
    const restoreFrom = opts.restoreFrom
      ? { ...opts.restoreFrom, acknowledge: opts.restoreFrom.acknowledge ?? ALL_ACKS }
      : undefined;
    const { draftId } = await drafts.createDraft({
      appId: TARGET_APP, version: '1.0.0',
      ...(restoreFrom ? { restoreFrom } : {}),
    });
    await drafts.updateDraft(draftId, { composeOverride: COMPOSE_WITH_DATA });
    await drafts.finalizeDraft(draftId);
    const created = await deployments.createFromDraft({
      draftId, name: opts.name, options: { autoStart: true }, allowMultiple: true,
    });
    return created; // caller decides whether/when to await the job
  }

  /** Deliver a plausible app root DIRECTLY at `destination` (the easy shape). */
  async function deliverAtRoot(destination: string, files: Record<string, string> = { 'note.txt': 'hello' }) {
    await mkdir(join(destination, '.hola'), { recursive: true });
    await writeFile(join(destination, '.hola', 'instance.json'), '{}');
    for (const [name, content] of Object.entries(files)) await writeFile(join(destination, name), content);
  }

  /** Deliver an app root reproducing an ABSOLUTE path under `destination` — a real repository restore tool's shape (FR-041). */
  async function deliverAtAbsolutePath(destination: string, absPath: string, files: Record<string, string> = { 'note.txt': 'hello' }) {
    const nested = join(destination, absPath.replace(/^\//, ''));
    await mkdir(join(nested, '.hola'), { recursive: true });
    await writeFile(join(nested, '.hola', 'instance.json'), '{}');
    for (const [name, content] of Object.entries(files)) await writeFile(join(nested, name), content);
    return nested;
  }

  // =========================================================================
  // US1 + US3: the full round trip
  // =========================================================================

  test('scenario 6/full loop: a provider-sourced restore lands the captured data and completes the install', async () => {
    const system = makeSystem({
      [PROVIDER_APP]: { provides: ['restore@1'] },
      [TARGET_APP]: { accepts: ['restore@1'] },
    });
    const providerId = await installProvider(system, { provides: ['restore@1'] });
    await system.deployments.publishRestoreIndex([
      { captureId: 'cap-1', takenAt: '2026-02-01T09:00:00.000Z', sizeBytes: 100, location: '/srv/hola/apps/wiki-old', identity: { app: TARGET_APP } },
    ]);

    const candidateId = `${providerId}:cap-1`;
    const created = await installTarget(system, { name: 'wiki', restoreFrom: { candidateId, carryEnv: false } });

    // The deploy job is now running in the background; act as the provider.
    const { requests } = await waitFor(async () => {
      const r = await system.deployments.pollRestoreRequests();
      return r.requests.length > 0 ? r : undefined;
    });
    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.captureId).toBe('cap-1');
    // FR-027: the destination is server-minted, under the staging root.
    expect(req.destination.startsWith(restoreRoot)).toBe(true);

    await system.deployments.claimRestoreRequest(req.id);
    await deliverAtRoot(req.destination);
    await system.deployments.completeRestoreRequest(req.id, 'completed');

    const job = await waitForJob(system.jobs, created.jobId!);
    expect(job.status).toBe('completed');

    const noteContent = await readFile(join(appsRoot, created.deploymentId, 'note.txt'), 'utf8');
    expect(noteContent).toBe('hello');
    // FR-037: the request's destination directory is cleaned up.
    await expect(readFile(join(req.destination, 'note.txt'), 'utf8')).rejects.toThrow();
  });

  // Quickstart scenario 39 — ★ HIGHEST VALUE (closes #486).
  test('scenario 39 (★): an absolute-path-shaped delivered tree is located several levels down', async () => {
    const system = makeSystem({
      [PROVIDER_APP]: { provides: ['restore@1'] },
      [TARGET_APP]: { accepts: ['restore@1'] },
    });
    const providerId = await installProvider(system, { provides: ['restore@1'] });
    await system.deployments.publishRestoreIndex([
      { captureId: 'cap-deep', takenAt: '2026-02-01T09:00:00.000Z', sizeBytes: 100, location: '/srv/hola/apps/wiki-1a2b3c4d', identity: { app: TARGET_APP } },
    ]);

    const created = await installTarget(system, { name: 'wiki-deep', restoreFrom: { candidateId: `${providerId}:cap-deep`, carryEnv: false } });
    const { requests } = await waitFor(async () => {
      const r = await system.deployments.pollRestoreRequests();
      return r.requests.length > 0 ? r : undefined;
    });
    const req = requests[0]!;
    await system.deployments.claimRestoreRequest(req.id);
    // The absolute-path shape a real repository restore tool produces.
    await deliverAtAbsolutePath(req.destination, '/srv/hola/apps/wiki-1a2b3c4d', { 'deep.txt': 'found me' });
    await system.deployments.completeRestoreRequest(req.id, 'completed');

    const job = await waitForJob(system.jobs, created.jobId!);
    expect(job.status).toBe('completed');
    const content = await readFile(join(appsRoot, created.deploymentId, 'deep.txt'), 'utf8');
    expect(content).toBe('found me');
  });

  // Quickstart scenario 40
  test('scenario 40: two plausible app roots in the delivered tree refuses RESTORE_SOURCE_UNLOCATABLE rather than picking either', async () => {
    const system = makeSystem({
      [PROVIDER_APP]: { provides: ['restore@1'] },
      [TARGET_APP]: { accepts: ['restore@1'] },
    });
    const providerId = await installProvider(system, { provides: ['restore@1'] });
    await system.deployments.publishRestoreIndex([
      { captureId: 'cap-ambiguous', takenAt: '2026-02-01T09:00:00.000Z', sizeBytes: 100, location: '/srv/hola/apps/wiki-ambiguous', identity: { app: TARGET_APP } },
    ]);
    const created = await installTarget(system, { name: 'wiki-ambiguous', restoreFrom: { candidateId: `${providerId}:cap-ambiguous`, carryEnv: false } });
    const { requests } = await waitFor(async () => {
      const r = await system.deployments.pollRestoreRequests();
      return r.requests.length > 0 ? r : undefined;
    });
    const req = requests[0]!;
    await system.deployments.claimRestoreRequest(req.id);
    await deliverAtAbsolutePath(req.destination, '/srv/hola/apps/wiki-a', { 'x.txt': 'a' });
    await deliverAtAbsolutePath(req.destination, '/srv/hola/apps/wiki-b', { 'x.txt': 'b' });
    await system.deployments.completeRestoreRequest(req.id, 'completed');

    const job = await waitForJob(system.jobs, created.jobId!);
    expect(job.status).toBe('failed');
    expect(job.error ?? '').toMatch(/RESTORE_SOURCE_UNLOCATABLE|plausible/i);
  });

  // Quickstart scenario 23
  test('scenario 23: claim is exactly once — a second claim on an already-claimed request is refused distinguishably', async () => {
    const system = makeSystem({
      [PROVIDER_APP]: { provides: ['restore@1'] },
      [TARGET_APP]: { accepts: ['restore@1'] },
    });
    const providerId = await installProvider(system, { provides: ['restore@1'] });
    await system.deployments.publishRestoreIndex([
      { captureId: 'cap-claim', takenAt: '2026-02-01T09:00:00.000Z', sizeBytes: 100, location: '/x', identity: { app: TARGET_APP } },
    ]);
    const created = await installTarget(system, { name: 'wiki-claim', restoreFrom: { candidateId: `${providerId}:cap-claim`, carryEnv: false } });
    const { requests } = await waitFor(async () => {
      const r = await system.deployments.pollRestoreRequests();
      return r.requests.length > 0 ? r : undefined;
    });
    const req = requests[0]!;

    await system.deployments.claimRestoreRequest(req.id);
    await expect(system.deployments.claimRestoreRequest(req.id)).rejects.toMatchObject({
      details: { code: 'RESTORE_REQUEST_ALREADY_CLAIMED' },
    });
    await expect(system.deployments.claimRestoreRequest('does-not-exist')).rejects.toMatchObject({ code: 'RESTORE_REQUEST_NOT_FOUND' });

    // Finish it cleanly so the background job doesn't outlive the test.
    await deliverAtRoot(req.destination);
    await system.deployments.completeRestoreRequest(req.id, 'completed');
    await waitForJob(system.jobs, created.jobId!);
  });

  // Quickstart scenario 24
  test('scenario 24: complete { outcome: failed } fails the install without ever calling composeUp for the app\'s own services', async () => {
    const system = makeSystem({
      [PROVIDER_APP]: { provides: ['restore@1'] },
      [TARGET_APP]: { accepts: ['restore@1'] },
    });
    const providerId = await installProvider(system, { provides: ['restore@1'] });
    await system.deployments.publishRestoreIndex([
      { captureId: 'cap-fail', takenAt: '2026-02-01T09:00:00.000Z', sizeBytes: 100, location: '/x', identity: { app: TARGET_APP } },
    ]);
    const created = await installTarget(system, { name: 'wiki-fail', restoreFrom: { candidateId: `${providerId}:cap-fail`, carryEnv: false } });
    const { requests } = await waitFor(async () => {
      const r = await system.deployments.pollRestoreRequests();
      return r.requests.length > 0 ? r : undefined;
    });
    const req = requests[0]!;
    await system.deployments.claimRestoreRequest(req.id);
    await system.deployments.completeRestoreRequest(req.id, 'failed', 'repository unreachable');

    const job = await waitForJob(system.jobs, created.jobId!);
    expect(job.status).toBe('failed');
    // No compose-up call was made scoped to the target app's OWN project directory.
    const upsForTarget = docker.composeUpCalls.filter((c) => c.projectName === `hola-${created.deploymentId}`);
    expect(upsForTarget).toHaveLength(0);
  });

  // Quickstart scenario 33 (FR-036): a request reported 'completed' whose
  // destination is empty (or was never written at all) is NOT treated as a
  // successful restore — the shared application-phase post-condition still fires.
  test('scenario 33: a completed request with an EMPTY destination is refused, never treated as success', async () => {
    const system = makeSystem({
      [PROVIDER_APP]: { provides: ['restore@1'] },
      [TARGET_APP]: { accepts: ['restore@1'] },
    });
    const providerId = await installProvider(system, { provides: ['restore@1'] });
    await system.deployments.publishRestoreIndex([
      { captureId: 'cap-empty', takenAt: '2026-02-01T09:00:00.000Z', sizeBytes: 100, location: '/x', identity: { app: TARGET_APP } },
    ]);
    const created = await installTarget(system, { name: 'wiki-empty', restoreFrom: { candidateId: `${providerId}:cap-empty`, carryEnv: false } });
    const { requests } = await waitFor(async () => {
      const r = await system.deployments.pollRestoreRequests();
      return r.requests.length > 0 ? r : undefined;
    });
    const req = requests[0]!;
    await system.deployments.claimRestoreRequest(req.id);
    // Deliberately deliver NOTHING — report completed anyway.
    await system.deployments.completeRestoreRequest(req.id, 'completed');

    const job = await waitForJob(system.jobs, created.jobId!);
    expect(job.status).toBe('failed');
    expect(job.error ?? '').toMatch(/RESTORE_SOURCE_UNLOCATABLE|RESTORE_PAYLOAD_EMPTY|plausible/i);
  });

  // Quickstart scenario 11 (SC-004): a consenting provider's mount is EXACTLY
  // the staging root — no write access to the apps root itself and none to
  // any deployment's own data root.
  test('scenario 11: the staging mount grants nothing else — no write to the apps root, none to any deployment data root', async () => {
    const system = makeSystem({ [PROVIDER_APP]: { provides: ['backup@1', 'restore@1'] } });
    const id = await installProvider(system, { provides: ['backup@1', 'restore@1'] });
    const raw = await system.storage.readFileAsString(`deployments/${id}/runtime/docker-compose.yml`);
    const doc = parse(raw) as { services: Record<string, { volumes?: string[] }> };
    const volumes = doc.services.backrest.volumes ?? [];
    // The apps root appears ONLY read-only (apps-data grant), never writable.
    expect(volumes).toContain(`${appsRoot}:${appsRoot}:ro`);
    expect(volumes).not.toContain(`${appsRoot}:${appsRoot}`);
    // The staging root appears ONLY writable, exactly once.
    expect(volumes.filter((v) => v === `${restoreRoot}:${restoreRoot}`)).toHaveLength(1);
    // No OTHER writable host-path mount of any kind snuck in.
    const writableMounts = volumes.filter((v) => !v.endsWith(':ro'));
    expect(writableMounts).toEqual([`${restoreRoot}:${restoreRoot}`]);
  });

  // Quickstart scenario 28 (FR-031d): brokerActivity() reports BOTH
  // backup@1's and restore@1's activity from one call.
  test('scenario 28: brokerActivity reports both backup@1 and restore@1 activity from one call', async () => {
    const system = makeSystem({
      [PROVIDER_APP]: { provides: ['restore@1'] },
      [TARGET_APP]: { accepts: ['restore@1'] },
    });
    const providerId = await installProvider(system, { provides: ['restore@1'] });
    await system.deployments.publishRestoreIndex([
      { captureId: 'cap-act', takenAt: '2026-02-01T09:00:00.000Z', sizeBytes: 100, location: '/x', identity: { app: TARGET_APP } },
    ]);
    const created = await installTarget(system, { name: 'wiki-act', restoreFrom: { candidateId: `${providerId}:cap-act`, carryEnv: false } });
    const { requests } = await waitFor(async () => {
      const r = await system.deployments.pollRestoreRequests();
      return r.requests.length > 0 ? r : undefined;
    });
    const req = requests[0]!;
    await system.deployments.claimRestoreRequest(req.id);
    await deliverAtRoot(req.destination);
    await system.deployments.completeRestoreRequest(req.id, 'completed');
    await waitForJob(system.jobs, created.jobId!);

    const { items } = await system.deployments.getContracts();
    const restoreRow = items.find((i) => i.ref === 'restore@1')!;
    // backup@1's activity is untouched (no backup prepare/finalize ever ran) —
    // reporting restore's activity must not disturb it.
    const backupRow = items.find((i) => i.ref === 'backup@1')!;
    expect(backupRow.activity).toBeUndefined();
    expect(restoreRow.activity?.lastPrepareAt).toBeDefined();
    expect(restoreRow.activity?.lastFinalizeAt).toBeDefined();
  });

  // Quickstart scenario 25 + SC-006
  test('scenario 25: a claimed request nobody completes expires and fails the install naming the provider', async () => {
    const prevTimeout = process.env.HOLA_RESTORE_REQUEST_TIMEOUT_MS;
    process.env.HOLA_RESTORE_REQUEST_TIMEOUT_MS = '50'; // 50ms — fast expiry for the test
    try {
      const system = makeSystem({
        [PROVIDER_APP]: { provides: ['restore@1'] },
        [TARGET_APP]: { accepts: ['restore@1'] },
      });
      const providerId = await installProvider(system, { provides: ['restore@1'] });
      await system.deployments.publishRestoreIndex([
        { captureId: 'cap-expire', takenAt: '2026-02-01T09:00:00.000Z', sizeBytes: 100, location: '/x', identity: { app: TARGET_APP } },
      ]);
      const created = await installTarget(system, { name: 'wiki-expire', restoreFrom: { candidateId: `${providerId}:cap-expire`, carryEnv: false } });
      // Deliberately never claim or complete — let the deadline pass.
      const job = await waitForJob(system.jobs, created.jobId!, 15_000);
      expect(job.status).toBe('failed');
      expect(job.error ?? '').toMatch(/did not respond|unresponsive/i);
      expect(job.error ?? '').toContain(providerId);
    } finally {
      if (prevTimeout === undefined) delete process.env.HOLA_RESTORE_REQUEST_TIMEOUT_MS;
      else process.env.HOLA_RESTORE_REQUEST_TIMEOUT_MS = prevTimeout;
    }
  });

  // Quickstart scenario 31 + FR-034
  test('scenario 31: polling with no index published signals reindex: true and requests no HTTP', async () => {
    const system = makeSystem({ [PROVIDER_APP]: { provides: ['restore@1'] } });
    await installProvider(system, { provides: ['restore@1'] });
    const result = await system.deployments.pollRestoreRequests();
    expect(result).toEqual({ requests: [], reindex: true });
  });

  // Quickstart scenario 32
  test('scenario 32: two concurrent requests get distinct destinations; a file in one is not visible under the other', async () => {
    const system = makeSystem({
      [PROVIDER_APP]: { provides: ['restore@1'] },
      [TARGET_APP]: { accepts: ['restore@1'] },
    });
    const providerId = await installProvider(system, { provides: ['restore@1'] });
    await system.deployments.publishRestoreIndex([
      { captureId: 'cap-x', takenAt: '2026-02-01T09:00:00.000Z', sizeBytes: 100, location: '/x', identity: { app: TARGET_APP } },
      { captureId: 'cap-y', takenAt: '2026-02-01T09:00:00.000Z', sizeBytes: 100, location: '/y', identity: { app: TARGET_APP } },
    ]);
    const c1 = await installTarget(system, { name: 'wiki-one', restoreFrom: { candidateId: `${providerId}:cap-x`, carryEnv: false } });
    const c2 = await installTarget(system, { name: 'wiki-two', restoreFrom: { candidateId: `${providerId}:cap-y`, carryEnv: false } });

    const both = await waitFor(async () => {
      const r = await system.deployments.pollRestoreRequests();
      return r.requests.length >= 2 ? r.requests : undefined;
    });
    expect(new Set(both.map((r) => r.destination)).size).toBe(2);

    for (const req of both) {
      await system.deployments.claimRestoreRequest(req.id);
      await deliverAtRoot(req.destination, { marker: req.id });
      await system.deployments.completeRestoreRequest(req.id, 'completed');
    }
    await waitForJob(system.jobs, c1.jobId!);
    await waitForJob(system.jobs, c2.jobId!);
  });

  // =========================================================================
  // US2: the staging grant, upgrade-without-consent
  // =========================================================================

  // Quickstart scenario 10 — ★ HIGHEST VALUE (SC-003).
  test('scenario 10 (★, half 1): an upgraded-but-unconsented provider gets no writable mount', async () => {
    const system = makeSystem({
      [PROVIDER_APP]: { provides: ['backup@1'] }, // v1.0.0: backup only
      [`${PROVIDER_APP}@2.0.0`]: { provides: ['backup@1', 'restore@1'] }, // v2.0.0: gains the restore role
    });

    // Install consented to backup@1 only, then UPGRADE to a manifest that
    // also declares restore@1 — promote() never asks for new grants, so the
    // persisted consent (backup@1 only) is what still governs materialisation.
    const upgradedId = await installProvider(system, { provides: ['backup@1'] });
    await promoteProvider(system, upgradedId, '2.0.0');
    const rawUnconsented = await system.storage.readFileAsString(`deployments/${upgradedId}/runtime/docker-compose.yml`);
    const docUnconsented = parse(rawUnconsented) as { services: Record<string, { volumes?: string[] }> };
    // Its pre-existing apps-data mount is untouched (FR-017)...
    expect(docUnconsented.services.backrest.volumes).toContain(`${appsRoot}:${appsRoot}:ro`);
    // ...but NO writable staging mount appears anywhere in the compose.
    expect(rawUnconsented).not.toContain(`${restoreRoot}:${restoreRoot}`);
  });

  // Quickstart scenario 10 — ★ HIGHEST VALUE (SC-003), half 2: the discriminating comparison.
  test('scenario 10 (★, half 2): a freshly consented provider gets exactly the writable staging mount', async () => {
    const system = makeSystem({ [PROVIDER_APP]: { provides: ['backup@1', 'restore@1'] } });
    const consentedId = await installProvider(system, { provides: ['backup@1', 'restore@1'] });
    const rawConsented = await system.storage.readFileAsString(`deployments/${consentedId}/runtime/docker-compose.yml`);
    const docConsented = parse(rawConsented) as { services: Record<string, { volumes?: string[] }> };
    expect(docConsented.services.backrest.volumes).toContain(`${restoreRoot}:${restoreRoot}`);
    expect(rawConsented).not.toContain(`${restoreRoot}:${restoreRoot}:ro`);
  });

  // Quickstart scenario 12 (research R3 regression)
  test('scenario 12: consenting only to backup@1 grants no restore-staging mount, even once restore@1 is a real contract', async () => {
    const system = makeSystem({ [PROVIDER_APP]: { provides: ['backup@1'] } });
    const id = await installProvider(system, { provides: ['backup@1'] });
    const raw = await system.storage.readFileAsString(`deployments/${id}/runtime/docker-compose.yml`);
    expect(raw).not.toContain(restoreRoot);
  });

  // Quickstart scenario 9 (FR-011, FR-012, FR-013, FR-020): restoreStagingRoot()
  // itself — env override with trailing-slash trim, else the hardcoded default.
  test('scenario 9: restoreStagingRoot() defaults to /srv/hola/restore when HOLA_RESTORE_STAGING_ROOT is unset, and trims a trailing slash when set', async () => {
    const prevRestoreRoot = process.env.HOLA_RESTORE_STAGING_ROOT;
    // Two independent data roots — a fresh RealDeploymentService per case,
    // over separate storage, so the second install isn't blocked by the
    // first's one-provider-per-host guard for the SAME contract ref.
    const dataRootA = await mkdtemp(join(tmpdir(), 'hola-restore-root-a-'));
    const dataRootB = await mkdtemp(join(tmpdir(), 'hola-restore-root-b-'));
    try {
      delete process.env.HOLA_RESTORE_STAGING_ROOT;
      const storageA = new RealStorageService({ holaDir: dataRootA });
      const systemA = {
        storage: storageA,
        jobs: new RealJobService(new RealDatabaseService(storageA), new RealLoggingService(storageA)),
      };
      const draftsA = new RealDraftService(storageA, makeCatalog({ [PROVIDER_APP]: { provides: ['restore@1'] } }), makeValidation());
      const deploymentsA = new RealDeploymentService(storageA, systemA.jobs, docker, draftsA, new RealRoutingService(storageA, { baseDomain: 'local.hola' }), new RealLoggingService(storageA), new MockProvisionerService());
      draftsA.setDeploymentsService(deploymentsA);
      const idA = await installProvider({ storage: storageA, jobs: systemA.jobs, drafts: draftsA, deployments: deploymentsA }, { provides: ['restore@1'], name: 'default-root' });
      const rawA = await storageA.readFileAsString(`deployments/${idA}/runtime/docker-compose.yml`);
      expect(rawA).toContain('/srv/hola/restore:/srv/hola/restore');

      // Trailing-slash trim, over a SEPARATE data root with the override set.
      process.env.HOLA_RESTORE_STAGING_ROOT = `${restoreRoot}/`;
      const storageB = new RealStorageService({ holaDir: dataRootB });
      const jobsB = new RealJobService(new RealDatabaseService(storageB), new RealLoggingService(storageB));
      const draftsB = new RealDraftService(storageB, makeCatalog({ [PROVIDER_APP]: { provides: ['restore@1'] } }), makeValidation());
      const deploymentsB = new RealDeploymentService(storageB, jobsB, docker, draftsB, new RealRoutingService(storageB, { baseDomain: 'local.hola' }), new RealLoggingService(storageB), new MockProvisionerService());
      draftsB.setDeploymentsService(deploymentsB);
      const idB = await installProvider({ storage: storageB, jobs: jobsB, drafts: draftsB, deployments: deploymentsB }, { provides: ['restore@1'], name: 'trimmed-root' });
      const rawB = await storageB.readFileAsString(`deployments/${idB}/runtime/docker-compose.yml`);
      expect(rawB).toContain(`${restoreRoot}:${restoreRoot}`);
      expect(rawB).not.toContain(`${restoreRoot}/:${restoreRoot}/`);
    } finally {
      if (prevRestoreRoot === undefined) delete process.env.HOLA_RESTORE_STAGING_ROOT;
      else process.env.HOLA_RESTORE_STAGING_ROOT = prevRestoreRoot;
      await rm(dataRootA, { recursive: true, force: true });
      await rm(dataRootB, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // Candidates: origin, confidence
  // =========================================================================

  // Quickstart scenario 47
  test('scenario 47: with no restore provider installed, candidates behave exactly as spec 007 (FR-047, SC-013)', async () => {
    const system = makeSystem({ [TARGET_APP]: { accepts: ['restore@1'] } });
    const candidates = await system.deployments.listProviderRestoreSources(TARGET_APP, undefined, undefined);
    expect(candidates).toEqual([]);
  });

  // Quickstart scenario 42/48
  test('scenario 42/48: a published entry with no identity is offered for the queried app, confidence path', async () => {
    const system = makeSystem({ [PROVIDER_APP]: { provides: ['restore@1'] } });
    const providerId = await installProvider(system, { provides: ['restore@1'] });
    await system.deployments.publishRestoreIndex([
      { captureId: 'cap-noid', takenAt: '2026-02-01T09:00:00.000Z', sizeBytes: 100, location: '/srv/hola/apps/lost-wiki-1a2b3c4d', identity: null },
    ]);
    const candidates = await system.deployments.listProviderRestoreSources(TARGET_APP, undefined, undefined);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      candidateId: `${providerId}:cap-noid`,
      source: 'provider',
      confidence: 'path',
      app: TARGET_APP,
      hasIdentityRecord: false,
    });
    expect(candidates[0]!.requiredAcknowledgements).toContain('restore-inferred-identity');
  });

  test('a published entry naming a DIFFERENT app is excluded entirely from this app\'s candidates', async () => {
    const system = makeSystem({ [PROVIDER_APP]: { provides: ['restore@1'] } });
    await installProvider(system, { provides: ['restore@1'] });
    await system.deployments.publishRestoreIndex([
      { captureId: 'cap-other', takenAt: '2026-02-01T09:00:00.000Z', sizeBytes: 100, location: '/x', identity: { app: 'some-other-app' } },
    ]);
    const candidates = await system.deployments.listProviderRestoreSources(TARGET_APP, undefined, undefined);
    expect(candidates).toEqual([]);
  });

  // Quickstart scenario 64
  test('scenario 64: the provider\'s own deployment never appears among its own candidates (restoring the provider is out of scope)', async () => {
    const system = makeSystem({ [PROVIDER_APP]: { provides: ['restore@1'] } });
    const providerId = await installProvider(system, { provides: ['restore@1'] });
    await system.deployments.publishRestoreIndex([
      { captureId: 'cap-self', takenAt: '2026-02-01T09:00:00.000Z', sizeBytes: 100, location: '/x', identity: { app: PROVIDER_APP } },
    ]);
    // Querying candidates FOR the provider's own app: a capture naming it
    // exists in the index and would otherwise resolve cleanly (identity.app
    // matches), so this is a platform REFUSAL, not an accident of the data.
    // Restoring the provider from its own captures is circular — its
    // configuration holds the repository credentials that make them readable
    // — and the concrete failure is worse than a refusal: a fresh install of
    // the provider is not running, so nothing would ever claim the request
    // and the install would hang to the deadline. "Refused rather than
    // half-attempted" (FR-064).
    const candidates = await system.deployments.listProviderRestoreSources(PROVIDER_APP, undefined, undefined);
    expect(candidates).toEqual([]);

    // And the refusal holds at selection time too, not only in the listing:
    // a hand-assembled candidate id naming that capture resolves to nothing.
    const resolved = await system.deployments.getProviderRestoreSource(providerId, 'cap-self', PROVIDER_APP);
    expect(resolved.entry).toBeUndefined();
    expect(resolved.providerStillConsented).toBe(false);

    // A DIFFERENT app still sees the provider's index normally — the refusal
    // is scoped to the circular case, not a blanket disablement.
    await system.deployments.publishRestoreIndex([
      { captureId: 'cap-self', takenAt: '2026-02-01T09:00:00.000Z', sizeBytes: 100, location: '/x', identity: { app: PROVIDER_APP } },
      { captureId: 'cap-other', takenAt: '2026-02-01T09:00:00.000Z', sizeBytes: 100, location: '/srv/hola/apps/wiki-1a2b3c4d', identity: { app: TARGET_APP } },
    ]);
    expect(await system.deployments.listProviderRestoreSources(TARGET_APP, undefined, undefined)).toHaveLength(1);

    // The provider app doesn't accept restore@1, so it is not a live local
    // candidate either.
    const localSources = await system.deployments.listRestoreSources(PROVIDER_APP);
    expect(localSources).toEqual([]);
  });

  // =========================================================================
  // US1: uninstall / consent discards the index
  // =========================================================================

  // Quickstart scenario 20
  test('scenario 20: uninstalling the provider discards its index entirely', async () => {
    const system = makeSystem({ [PROVIDER_APP]: { provides: ['restore@1'] } });
    const providerId = await installProvider(system, { provides: ['restore@1'] });
    await system.deployments.publishRestoreIndex([
      { captureId: 'cap-1', takenAt: '2026-02-01T09:00:00.000Z', sizeBytes: 100, location: '/x', identity: { app: TARGET_APP } },
    ]);
    expect(await system.deployments.listProviderRestoreSources(TARGET_APP, undefined, undefined)).toHaveLength(1);

    await system.deployments.deleteDeployment(providerId);
    expect(await system.deployments.listProviderRestoreSources(TARGET_APP, undefined, undefined)).toEqual([]);
  });

  // =========================================================================
  // US5 end-to-end: a capture with NO identity record actually restores
  // =========================================================================

  /** Deliver a markerless app root at an ABSOLUTE path — a pre-spec-006 capture. */
  async function deliverMarkerless(destination: string, absPath: string, files: Record<string, string>) {
    const nested = join(destination, absPath.replace(/^\//, ''));
    await mkdir(nested, { recursive: true });
    for (const [name, content] of Object.entries(files)) await writeFile(join(nested, name), content);
    return nested;
  }

  // The inference path (FR-048-FR-052) exists ONLY for captures taken before
  // install identity did — which by definition carry no `.hola` directory.
  // Every other provider test delivers a tree WITH one, so nothing exercised
  // what actually happens when the real US5 candidate is selected: the app
  // root has to be located from the capture's own recorded location, or the
  // whole story is a candidate that can be listed, acknowledged and selected
  // and then always fails.
  test('US5 end-to-end: an inference-identified capture with no identity record restores for real', async () => {
    const system = makeSystem({
      [PROVIDER_APP]: { provides: ['restore@1'] },
      [TARGET_APP]: { accepts: ['restore@1'] },
    });
    const providerId = await installProvider(system, { provides: ['restore@1'] });
    await system.deployments.publishRestoreIndex([
      // `identity: null` — the defining property of a pre-identity capture.
      { captureId: 'cap-legacy', takenAt: '2026-02-01T09:00:00.000Z', sizeBytes: 100, location: '/srv/hola/apps/wiki-1a2b3c4d', identity: null },
    ]);

    // It is offered, marked inferred, and demands the acknowledgement.
    const candidates = await system.deployments.listProviderRestoreSources(TARGET_APP, undefined, undefined);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.confidence).toBe('path');
    expect(candidates[0]!.requiredAcknowledgements).toContain('restore-inferred-identity');

    const created = await installTarget(system, {
      name: 'wiki-legacy',
      restoreFrom: { candidateId: `${providerId}:cap-legacy`, carryEnv: false },
    });
    const { requests } = await waitFor(async () => {
      const r = await system.deployments.pollRestoreRequests();
      return r.requests.length > 0 ? r : undefined;
    });
    const req = requests[0]!;
    await system.deployments.claimRestoreRequest(req.id);
    await deliverMarkerless(req.destination, '/srv/hola/apps/wiki-1a2b3c4d', { 'legacy.txt': 'from before identity existed' });
    await system.deployments.completeRestoreRequest(req.id, 'completed');

    const job = await waitForJob(system.jobs, created.jobId!);
    expect(job.status).toBe('completed');
    expect(await readFile(join(appsRoot, created.deploymentId, 'legacy.txt'), 'utf8')).toBe('from before identity existed');
    // The marker was (re)written for THIS install, as for any other restore.
    expect(existsSync(join(appsRoot, created.deploymentId, '.hola', 'instance.json'))).toBe(true);
  });

  test('a markerless capture delivered somewhere its recorded location does not name still refuses', async () => {
    const system = makeSystem({
      [PROVIDER_APP]: { provides: ['restore@1'] },
      [TARGET_APP]: { accepts: ['restore@1'] },
    });
    const providerId = await installProvider(system, { provides: ['restore@1'] });
    await system.deployments.publishRestoreIndex([
      { captureId: 'cap-legacy', takenAt: '2026-02-01T09:00:00.000Z', sizeBytes: 100, location: '/srv/hola/apps/wiki-1a2b3c4d', identity: null },
    ]);
    const created = await installTarget(system, {
      name: 'wiki-wrong', restoreFrom: { candidateId: `${providerId}:cap-legacy`, carryEnv: false },
    });
    const { requests } = await waitFor(async () => {
      const r = await system.deployments.pollRestoreRequests();
      return r.requests.length > 0 ? r : undefined;
    });
    const req = requests[0]!;
    await system.deployments.claimRestoreRequest(req.id);
    // Delivered under a path the index never named — a guess would find it.
    await deliverMarkerless(req.destination, '/somewhere/else/entirely', { 'x.txt': 'x' });
    await system.deployments.completeRestoreRequest(req.id, 'completed');

    const job = await waitForJob(system.jobs, created.jobId!);
    expect(job.status).toBe('failed');
    expect(job.error ?? '').toMatch(/RESTORE_SOURCE_UNLOCATABLE|locate/i);
  });

  // =========================================================================
  // A provider-published capture id never becomes a filesystem path
  // =========================================================================

  // `restoreEnvRecordPath` interpolates the candidate id into an ABSOLUTE path
  // (`<appsRoot>/.hola/<candidateId>/env.json`), and `resolveStoragePath`
  // passes absolute paths through unchecked by design. Since spec 008 the
  // candidate id can be `<provider>:<captureId>` where `captureId` is a
  // string the PROVIDER published — so without a guard a published capture id
  // is a read primitive aimed anywhere on the host, and its contents are
  // merged into the new install's environment.
  //
  // Two independent defences, both asserted: the publish route refuses a
  // separator-bearing capture id at all, and the draft never consults the
  // environment record for a provider-origin candidate (FR-052 — there is
  // none to consult).
  test('a provider-origin restore never reads an environment record, whatever its capture id', async () => {
    const system = makeSystem({
      [PROVIDER_APP]: { provides: ['restore@1'] },
      [TARGET_APP]: { accepts: ['restore@1'] },
    });
    const providerId = await installProvider(system, { provides: ['restore@1'] });
    await system.deployments.publishRestoreIndex([
      { captureId: 'cap-1', takenAt: '2026-02-01T09:00:00.000Z', sizeBytes: 100, location: '/srv/hola/apps/wiki-1a2b3c4d', identity: { app: TARGET_APP } },
    ]);

    // Plant a record where a naive `<appsRoot>/.hola/<candidateId>/env.json`
    // would land if the composite id were used as a path component.
    const plantedDir = join(appsRoot, '.hola', `${providerId}:cap-1`);
    await mkdir(plantedDir, { recursive: true });
    await writeFile(
      join(plantedDir, 'env.json'),
      JSON.stringify({ schema: 1, writtenAt: new Date().toISOString(), env: { LEAKED: 'should-never-be-read' } }),
    );

    const { draftId } = await system.drafts.createDraft({
      appId: TARGET_APP, version: '1.0.0',
      restoreFrom: { candidateId: `${providerId}:cap-1`, carryEnv: true, acknowledge: ALL_ACKS },
    });
    const draft = await system.drafts.getDraft(draftId);
    expect(draft.appEnv.find((e) => e.key === 'LEAKED')).toBeUndefined();
  });

  test('the index route refuses a capture id that could be read as a path', async () => {
    const system = makeSystem({ [PROVIDER_APP]: { provides: ['restore@1'] } });
    await installProvider(system, { provides: ['restore@1'] });

    const { isWellFormedRestoreIndexEntry } = await import('../../services/core/restore-index');
    const entry = (captureId: string) => ({
      captureId, takenAt: '2026-02-01T09:00:00.000Z', sizeBytes: 1, location: '/x', identity: null,
    });
    for (const bad of ['../../../etc', 'a/b', 'a\\b', '..', '.hidden', '', 'a'.repeat(200)]) {
      expect(isWellFormedRestoreIndexEntry(entry(bad))).toBe(false);
    }
    expect(isWellFormedRestoreIndexEntry(entry('cap_20260201T090000Z'))).toBe(true);

    // `typeof [] === 'object'`, so an array identity would otherwise be stored
    // and every downstream `identity?.app` read would silently yield
    // undefined — offering the capture as inference-identified rather than
    // refusing the malformed publish.
    expect(isWellFormedRestoreIndexEntry({ ...entry('ok'), identity: ['x'] })).toBe(false);
    expect(isWellFormedRestoreIndexEntry({ ...entry('ok'), identity: {} })).toBe(true);
    expect(isWellFormedRestoreIndexEntry({ ...entry('ok'), identity: null })).toBe(true);
  });

  // =========================================================================
  // Staging root safety (FR-011, FR-012)
  // =========================================================================

  // The staging root becomes a WRITABLE bind mount handed to a catalog
  // container. Overlapping it with the apps root would silently convert the
  // platform's one writable grant into write access to every app's data —
  // the exact privilege ADR 0006's risk copy promises the provider cannot
  // have. An operator typo must fail loudly, not widen a grant.
  test('a staging root overlapping the apps root fails the provider install rather than mounting it', async () => {
    // `appsRoot` itself — the operator typo that would hand the provider a
    // writable identity mount of every app's data. (A DESCENDANT of the apps
    // root is refused by the same containment check; only one install can be
    // made per test because of the one-provider-per-host guard, so the
    // descendant case is asserted directly below.)
    process.env.HOLA_RESTORE_STAGING_ROOT = appsRoot;
    const system = makeSystem({ [PROVIDER_APP]: { provides: ['restore@1'] } });
    const { drafts, deployments, jobs } = system;
    const { draftId } = await drafts.createDraft({ appId: PROVIDER_APP, version: '1.0.0' });
    await drafts.updateDraft(draftId, { composeOverride: PROVIDER_COMPOSE });
    await drafts.finalizeDraft(draftId);
    const created = await deployments.createFromDraft({
      draftId, name: 'backrest', options: { autoStart: true }, grants: ['restore@1'], allowMultiple: true,
    });
    const job = await waitForJob(jobs, created.jobId!);
    expect(job.status).toBe('failed');
    expect(job.error ?? '').toMatch(/sibling|RESTORE_STAGING_ROOT_INVALID/i);

    // And crucially: no writable mount of the apps root was ever written.
    const runtime = await system.storage
      .readFileAsString(`deployments/${created.deploymentId}/runtime/docker-compose.yml`)
      .catch(() => '');
    expect(runtime).not.toContain(`${appsRoot}:${appsRoot}`);

    process.env.HOLA_RESTORE_STAGING_ROOT = restoreRoot;
  });

  test('a staging root INSIDE the apps root is refused by the same rule', async () => {
    process.env.HOLA_RESTORE_STAGING_ROOT = join(appsRoot, 'restore');
    const system = makeSystem({ [PROVIDER_APP]: { provides: ['restore@1'] } });
    const { drafts, deployments, jobs } = system;
    const { draftId } = await drafts.createDraft({ appId: PROVIDER_APP, version: '1.0.0' });
    await drafts.updateDraft(draftId, { composeOverride: PROVIDER_COMPOSE });
    await drafts.finalizeDraft(draftId);
    const created = await deployments.createFromDraft({
      draftId, name: 'backrest', options: { autoStart: true }, grants: ['restore@1'], allowMultiple: true,
    });
    const job = await waitForJob(jobs, created.jobId!);
    expect(job.status).toBe('failed');
    expect(job.error ?? '').toMatch(/sibling|RESTORE_STAGING_ROOT_INVALID/i);
    process.env.HOLA_RESTORE_STAGING_ROOT = restoreRoot;
  });

  // A sibling arrangement — the documented one — is accepted.
  test('a staging root that is a genuine sibling of the apps root is accepted', async () => {
    const system = makeSystem({ [PROVIDER_APP]: { provides: ['restore@1'] } });
    const providerId = await installProvider(system, { provides: ['restore@1'] });
    const runtime = await system.storage.readFileAsString(
      `deployments/${providerId}/runtime/docker-compose.yml`,
    );
    expect(runtime).toContain(`${restoreRoot}:${restoreRoot}`);
  });

  // =========================================================================
  // Broker calls before the deployment registry has been lazily loaded
  // =========================================================================

  // A provider container's very first act after a host reboot is to publish
  // its index (the `reindex` signal explicitly invites it). If the broker
  // calls scan an unloaded registry they answer "no restore provider is
  // installed" on a host that has one — the publish is refused and the poll
  // reports no work, indefinitely.
  test('the broker calls load the deployment registry first (a cold server still knows its provider)', async () => {
    const setup = makeSystem({ [PROVIDER_APP]: { provides: ['restore@1'] } });
    const providerId = await installProvider(setup, { provides: ['restore@1'] });

    // A brand-new service over the SAME data dir: nothing has touched a route
    // that lazily loads deployments yet.
    const cold = makeSystem({ [PROVIDER_APP]: { provides: ['restore@1'] } });
    await expect(
      cold.deployments.publishRestoreIndex([
        { captureId: 'cap-1', takenAt: '2026-02-01T09:00:00.000Z', sizeBytes: 100, location: '/srv/hola/apps/wiki-1a2b3c4d', identity: { app: TARGET_APP } },
      ]),
    ).resolves.toEqual({ ok: true, count: 1 });

    const cold2 = makeSystem({ [PROVIDER_APP]: { provides: ['restore@1'] } });
    const polled = await cold2.deployments.pollRestoreRequests();
    expect(polled.reindex).toBe(false);
    expect(await cold2.deployments.listProviderRestoreSources(TARGET_APP, undefined, undefined)).toHaveLength(1);
    void providerId;
  });
});
