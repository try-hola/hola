/**
 * #496 — consent is recorded per contract **ref**, but the privilege that
 * actually reaches a container is a **kind**. Before this fix the kind was
 * resolved live from the `CONTRACTS` table on every materialisation, so
 * attaching a new or wider `providerGrant` to an already-shipped contract would
 * hand that privilege to every install which consented to its ref months ago —
 * no wizard row, no `--grant` flag, no audit entry.
 *
 * These tests drive the whole path: install (freeze the kinds) → mutate the
 * contract table the service resolves against → re-materialise → assert what
 * the compose file actually grants. Mutating the table happens through the
 * service's own `contractTable` field, never by writing to the module-level
 * `CONTRACTS` const, which every other suite in this process shares.
 *
 * Real-filesystem harness, modelled on `restore-provider.test.ts`'s (`:97-135`)
 * — the mounts under test are host bind mounts, and `MockStorageService`
 * discards enough to make them unassertable.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
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
import { CONTRACTS } from '@hola/shared/contracts';
import type { ContractDefinition, ProviderGrantKind } from '@hola/shared/contracts';
import type { EnhancedDeploymentDetail } from '@hola/shared';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

const PROVIDER_APP = 'backrest';
const PROVIDER_COMPOSE = 'services:\n  backrest:\n    image: backrest:latest\n';
const PROXY_SERVICE = 'hola-docker-proxy';

function makeCatalog(provides: string[]): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: appId, icon: '🧪' }),
    getVersionDetail: async () => ({
      defaultEnv: [],
      defaults: { ports: [], volumes: [] },
      provides,
      upgrade: {},
      multiInstance: true,
    }),
  } as unknown as CatalogArg;
}

function makeValidation(): ValidationArg {
  return {
    validateDraft: async () => ({ ok: true, errors: [], warnings: [] }),
    preflightCheck: async () => ({ ok: true, checks: [] }),
  } as unknown as ValidationArg;
}

async function waitForJob(jobs: RealJobService, id: string, timeoutMs = 15_000) {
  const start = Date.now();
  for (;;) {
    const job = await jobs.getJob(id);
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    if (Date.now() - start > timeoutMs) throw new Error(`Job ${id} did not finish (last status: ${job?.status})`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** The shipped table with one contract's `providerGrant.kind` swapped out. */
function tableWithKind(contractId: string, kind: ProviderGrantKind): readonly ContractDefinition[] {
  return CONTRACTS.map((c) =>
    c.id === contractId
      ? { ...c, providerGrant: { label: 'x', risk: 'y', ...c.providerGrant, kind } }
      : c,
  );
}

describe('#496 — a shipped contract\'s providerGrant cannot widen an existing install', () => {
  let dataRoot: string;
  let appsRoot: string;
  let restoreRoot: string;
  let prevAppsBindRoot: string | undefined;
  let prevRestoreStagingRoot: string | undefined;
  let docker: MockDockerService;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-grantkinds-data-'));
    appsRoot = await mkdtemp(join(tmpdir(), 'hola-grantkinds-apps-'));
    restoreRoot = await mkdtemp(join(tmpdir(), 'hola-grantkinds-staging-'));
    prevAppsBindRoot = process.env.HOLA_APPS_BIND_ROOT;
    prevRestoreStagingRoot = process.env.HOLA_RESTORE_STAGING_ROOT;
    process.env.HOLA_APPS_BIND_ROOT = appsRoot;
    process.env.HOLA_RESTORE_STAGING_ROOT = restoreRoot;
    docker = new MockDockerService();
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

  function makeSystem(provides: string[]) {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage);
    const logging = new RealLoggingService(storage);
    const jobs = new RealJobService(database, logging);
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const drafts = new RealDraftService(storage, makeCatalog(provides), makeValidation());
    const deployments = new RealDeploymentService(storage, jobs, docker, drafts, routing, logging, new MockProvisionerService());
    drafts.setDeploymentsService(deployments);
    return { storage, jobs, drafts, deployments };
  }

  type System = ReturnType<typeof makeSystem>;

  async function installProvider(system: System, grants: string[]): Promise<string> {
    const { drafts, deployments, jobs } = system;
    const { draftId } = await drafts.createDraft({ appId: PROVIDER_APP, version: '1.0.0' });
    await drafts.updateDraft(draftId, { composeOverride: PROVIDER_COMPOSE });
    await drafts.finalizeDraft(draftId);
    const created = await deployments.createFromDraft({
      draftId, name: 'backrest', options: { autoStart: true }, grants, allowMultiple: true,
    });
    await waitForJob(jobs, created.jobId!);
    return created.deploymentId;
  }

  /** Re-materialise the compose file (the only path that consumes a grant). */
  async function rematerialise(system: System, id: string) {
    const action = await system.deployments.executeAction(id, { action: 'restart' });
    const job = await waitForJob(system.jobs, action.jobId!);
    expect(job.status).toBe('completed');
  }

  async function readCompose(system: System, id: string) {
    const raw = await system.storage.readFileAsString(`deployments/${id}/runtime/docker-compose.yml`);
    const doc = parse(raw) as { services: Record<string, { volumes?: string[] }> };
    return { raw, doc, volumes: doc.services[PROVIDER_APP]?.volumes ?? [] };
  }

  async function readMetadata(id: string): Promise<EnhancedDeploymentDetail> {
    return JSON.parse(await readFile(join(dataRoot, 'deployments', id, 'metadata.json'), 'utf8'));
  }

  /** Capture (and still forward) the service's own warn/info output. */
  function captureLogs(system: System) {
    const svc = system.deployments as unknown as {
      logger: {
        warn: (message: string, context?: unknown) => void;
        info: (message: string, context?: unknown) => void;
      };
    };
    const warnings: Array<{ message: string; context?: unknown }> = [];
    const infos: Array<{ message: string; context?: unknown }> = [];
    const originalWarn = svc.logger.warn.bind(svc.logger);
    const originalInfo = svc.logger.info.bind(svc.logger);
    svc.logger.warn = (message, context) => { warnings.push({ message, context }); return originalWarn(message, context); };
    svc.logger.info = (message, context) => { infos.push({ message, context }); return originalInfo(message, context); };
    return { warnings, infos };
  }

  /**
   * Strip `grantedPrivileges` from a record both in memory and on disk — the
   * exact shape of every install that exists today, read back by a server that
   * now knows about the field.
   */
  function makeLegacy(system: System, id: string): Promise<void> {
    const svc = system.deployments as unknown as { deployments: Map<string, EnhancedDeploymentDetail> };
    const record = svc.deployments.get(id);
    expect(record).toBeDefined();
    delete record!.grantedPrivileges;
    const onDisk = { ...record } as Record<string, unknown>;
    delete onDisk.grantedPrivileges;
    return writeFile(join(dataRoot, 'deployments', id, 'metadata.json'), JSON.stringify(onDisk, null, 2));
  }

  // =========================================================================
  // The defect itself
  // =========================================================================

  test('the consented kinds are frozen on the record at install', async () => {
    const system = makeSystem(['backup@1', 'container-logs@1', 'restore@1']);
    const id = await installProvider(system, ['backup@1', 'container-logs@1', 'restore@1']);
    const meta = await readMetadata(id);
    expect(meta.grantedContracts).toEqual(['backup@1', 'container-logs@1', 'restore@1']);
    expect(meta.grantedPrivileges).toEqual(['apps-data', 'container-logs', 'restore-staging']);
  });

  test('all three grant kinds still reach a fresh install end to end', async () => {
    const system = makeSystem(['backup@1', 'container-logs@1', 'restore@1']);
    const id = await installProvider(system, ['backup@1', 'container-logs@1', 'restore@1']);
    const { raw, doc, volumes } = await readCompose(system, id);
    // apps-data: read-only identity mount of the apps root.
    expect(volumes).toContain(`${appsRoot}:${appsRoot}:ro`);
    // container-logs: the redacting Docker-API proxy sidecar, never a raw socket
    // on the app's own service.
    expect(Object.keys(doc.services)).toContain(PROXY_SERVICE);
    expect(raw).toContain('DOCKER_HOST');
    // restore-staging: a writable mount of exactly the staging root.
    expect(volumes).toContain(`${restoreRoot}:${restoreRoot}`);
  });

  // ★ The regression. Before the fix, re-resolving the kind live from the table
  // meant this install silently gained `restore-staging` — a WRITABLE mount —
  // from a consent it gave to a read-only log source.
  test('a kind newly attached to an already-consented ref is NOT granted, and the untouched one still is', async () => {
    const system = makeSystem(['backup@1', 'container-logs@1']);
    const id = await installProvider(system, ['backup@1', 'container-logs@1']);

    // Sanity: before the table changes, both consented kinds are in force.
    const before = await readCompose(system, id);
    expect(before.volumes).toContain(`${appsRoot}:${appsRoot}:ro`);
    expect(Object.keys(before.doc.services)).toContain(PROXY_SERVICE);

    // A maintainer changes what `container-logs@1` grants. `backup@1` is untouched.
    system.deployments.contractTable = tableWithKind('container-logs', 'restore-staging');
    await rematerialise(system, id);

    const after = await readCompose(system, id);
    // The NEW kind is not granted — no writable staging mount anywhere.
    expect(after.raw).not.toContain(`${restoreRoot}:${restoreRoot}`);
    expect(after.volumes.filter((v) => !v.endsWith(':ro'))).toEqual([]);
    // The consented kind that no longer resolves is gone too (the other
    // fail-closed direction).
    expect(Object.keys(after.doc.services)).not.toContain(PROXY_SERVICE);
    // ...and the untouched contract's privilege is undisturbed.
    expect(after.volumes).toContain(`${appsRoot}:${appsRoot}:ro`);
  });

  test('a providerGrant bolted onto a contract that had none grants nothing', async () => {
    // `backup@1` is the only privileged ref this install consented to; the
    // operator also consented to `push@1`, which shipped with no grant at all.
    // Attaching one to it later must not reach this install. (`push@1` is
    // platform-provided, so the coercion layer would drop an app's `provides`
    // for it — this drives the table directly to isolate the grant rule.)
    const system = makeSystem(['backup@1']);
    const id = await installProvider(system, ['backup@1']);
    system.deployments.contractTable = tableWithKind('backup', 'restore-staging');
    const { warnings } = captureLogs(system);
    await rematerialise(system, id);

    const { raw, volumes } = await readCompose(system, id);
    expect(raw).not.toContain(restoreRoot);
    expect(volumes).not.toContain(`${appsRoot}:${appsRoot}:ro`);
    expect(warnings.some((w) => w.message.includes('never consented to'))).toBe(true);
  });

  test('the mismatch warns at warn level, naming the deployment, the ref and both kinds', async () => {
    const system = makeSystem(['backup@1']);
    const id = await installProvider(system, ['backup@1']);
    system.deployments.contractTable = tableWithKind('backup', 'container-logs');
    const { warnings } = captureLogs(system);
    await rematerialise(system, id);

    const hits = warnings.filter((w) => w.message.includes('never consented to'));
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain('backup@1');
    expect(hits[0]!.message).toContain('container-logs');
    expect(hits[0]!.context).toMatchObject({
      deploymentId: id,
      ref: 'backup@1',
      liveKind: 'container-logs',
      recordedKinds: ['apps-data'],
    });
  });

  test('no mismatch, no warning — a well-behaved install logs nothing about grants', async () => {
    const system = makeSystem(['backup@1']);
    const id = await installProvider(system, ['backup@1']);
    const { warnings } = captureLogs(system);
    await rematerialise(system, id);
    expect(warnings.filter((w) => w.message.includes('never consented to'))).toEqual([]);
  });

  // =========================================================================
  // Legacy records: every install that exists today
  // =========================================================================

  test('a legacy record keeps its mount, is backfilled once, and a later widening does not reach it', async () => {
    const system = makeSystem(['backup@1']);
    const id = await installProvider(system, ['backup@1']);
    await makeLegacy(system, id);
    expect((await readMetadata(id)).grantedPrivileges).toBeUndefined();

    const { infos } = captureLogs(system);
    await rematerialise(system, id);

    // Its existing privilege survives...
    expect((await readCompose(system, id)).volumes).toContain(`${appsRoot}:${appsRoot}:ro`);
    // ...and the kinds today's table implies are now persisted on the record.
    expect((await readMetadata(id)).grantedPrivileges).toEqual(['apps-data']);
    const backfills = infos.filter((i) => i.message.includes('Backfilled consented grant privileges'));
    expect(backfills).toHaveLength(1);
    expect(backfills[0]!.context).toMatchObject({ deploymentId: id, grantedPrivileges: ['apps-data'] });

    // The migration is one-time: a second materialisation re-derives nothing.
    await rematerialise(system, id);
    expect(infos.filter((i) => i.message.includes('Backfilled consented grant privileges'))).toHaveLength(1);

    // And now that the mapping is frozen, widening the table cannot reach it.
    system.deployments.contractTable = tableWithKind('backup', 'restore-staging');
    await rematerialise(system, id);
    const after = await readCompose(system, id);
    expect(after.raw).not.toContain(restoreRoot);
    expect(after.volumes.filter((v) => !v.endsWith(':ro'))).toEqual([]);
  });

  test('a legacy record materialised under an ALREADY-widened table freezes the widened mapping only once, then holds', async () => {
    // The unavoidable edge: a pre-#496 record read for the first time by a
    // server whose table has already changed has no earlier snapshot to
    // compare against, so the backfill necessarily takes the table at face
    // value. What matters is that it happens exactly once and the record is
    // immune from then on — the alternative (no backfill) would leave every
    // existing install permanently re-resolving, which is the bug.
    const system = makeSystem(['backup@1']);
    const id = await installProvider(system, ['backup@1']);
    await makeLegacy(system, id);

    system.deployments.contractTable = tableWithKind('backup', 'restore-staging');
    await rematerialise(system, id);
    expect((await readMetadata(id)).grantedPrivileges).toEqual(['restore-staging']);

    // A SECOND change now finds a recorded set and is refused.
    system.deployments.contractTable = tableWithKind('backup', 'container-logs');
    const { warnings } = captureLogs(system);
    await rematerialise(system, id);
    const { doc } = await readCompose(system, id);
    expect(Object.keys(doc.services)).not.toContain(PROXY_SERVICE);
    expect(warnings.some((w) => w.message.includes('never consented to'))).toBe(true);
  });

  test('a record with no consented refs is left alone — nothing to freeze, no write', async () => {
    const system = makeSystem([]);
    const id = await installProvider(system, []);
    const meta = await readMetadata(id);
    expect(meta.grantedContracts).toBeUndefined();
    expect(meta.grantedPrivileges).toBeUndefined();

    const { infos } = captureLogs(system);
    await rematerialise(system, id);
    expect(infos.filter((i) => i.message.includes('Backfilled consented grant privileges'))).toEqual([]);
    expect((await readMetadata(id)).grantedPrivileges).toBeUndefined();
    // And no privileged mount of any kind.
    const { raw } = await readCompose(system, id);
    expect(raw).not.toContain(appsRoot);
    expect(raw).not.toContain(restoreRoot);
  });
});
