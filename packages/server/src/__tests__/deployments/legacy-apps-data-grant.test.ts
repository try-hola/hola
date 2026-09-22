/**
 * F06 — the legacy `consumes: apps-data` branch was a self-service grant.
 *
 * Materialisation used to read the ADR 0002 declaration straight off the active
 * manifest, so ANY bundle — one published years ago or one installed this
 * minute — could take a read-only, identity-mapped mount of the entire apps root
 * by writing a single manifest line. That root holds every installed app's data
 * root AND the sibling `.hola/<id>/` environment records, which carry app
 * secrets (#478). Nothing was shown to the operator: no wizard row, no `--grant`,
 * no record on the deployment — only a server-side `warn`.
 *
 * The fix keeps the compatibility behaviour and takes away the self-service:
 *
 *  - a NEW install declaring the capability is refused outright at
 *    `createFromDraft` (`LEGACY_CAPABILITY_REFUSED`);
 *  - a PRE-EXISTING install is migrated once, at the first rehydration after the
 *    upgrade, into an explicit stamp on its own record — and the migration is
 *    then fenced off by a persisted marker so it can never run again;
 *  - the stamp only grants while the active release still declares the
 *    capability, so it decays the moment the app upgrades to a `provides`-based
 *    release.
 *
 * Real-filesystem harness (the thing under test is a host bind mount), modelled
 * on `grant-privileges.test.ts`. Two `makeSystem()` calls over the same data root
 * are a server restart: the second one rehydrates from disk, which is where the
 * migration runs.
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
import type { EnhancedDeploymentDetail } from '@hola/shared';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

const APP = 'backrest';
const COMPOSE = 'services:\n  backrest:\n    image: backrest:1.0.0\n';
const MARKER = 'config/legacy-apps-data-migration.json';

function makeCatalog(detail: { consumes?: string[]; provides?: string[] }): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: appId, icon: '🧪' }),
    getVersionDetail: async () => ({
      defaultEnv: [],
      defaults: { ports: [], volumes: [] },
      upgrade: {},
      multiInstance: true,
      ...detail,
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

describe('F06 — the legacy apps-data declaration is no longer a self-service grant', () => {
  let dataRoot: string;
  let appsRoot: string;
  let prevAppsBindRoot: string | undefined;
  let docker: MockDockerService;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-f06-data-'));
    appsRoot = await mkdtemp(join(tmpdir(), 'hola-f06-apps-'));
    prevAppsBindRoot = process.env.HOLA_APPS_BIND_ROOT;
    process.env.HOLA_APPS_BIND_ROOT = appsRoot;
    docker = new MockDockerService();
  });

  afterEach(async () => {
    if (prevAppsBindRoot === undefined) delete process.env.HOLA_APPS_BIND_ROOT;
    else process.env.HOLA_APPS_BIND_ROOT = prevAppsBindRoot;
    await rm(dataRoot, { recursive: true, force: true });
    await rm(appsRoot, { recursive: true, force: true });
  });

  /** One server process over `dataRoot`. Calling it twice is a restart. */
  function makeSystem(detail: { consumes?: string[]; provides?: string[] } = {}) {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage);
    const logging = new RealLoggingService(storage);
    const jobs = new RealJobService(database, logging);
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const drafts = new RealDraftService(storage, makeCatalog(detail), makeValidation());
    const deployments = new RealDeploymentService(storage, jobs, docker, drafts, routing, logging, new MockProvisionerService());
    drafts.setDeploymentsService(deployments);
    return { storage, jobs, drafts, deployments };
  }

  type System = ReturnType<typeof makeSystem>;

  async function install(system: System, grants: string[] = []): Promise<string> {
    const { drafts, deployments, jobs } = system;
    const { draftId } = await drafts.createDraft({ appId: APP, version: '1.0.0' });
    await drafts.updateDraft(draftId, { composeOverride: COMPOSE });
    await drafts.finalizeDraft(draftId);
    const created = await deployments.createFromDraft({
      draftId, name: APP, options: { autoStart: true }, grants, allowMultiple: true,
    });
    expect((await waitForJob(jobs, created.jobId!)).status).toBe('completed');
    return created.deploymentId;
  }

  /** Re-materialise — the only path that consumes a grant. */
  async function rematerialise(system: System, id: string): Promise<void> {
    const action = await system.deployments.executeAction(id, { action: 'restart' });
    expect((await waitForJob(system.jobs, action.jobId!)).status).toBe('completed');
  }

  async function volumesOf(system: System, id: string): Promise<string[]> {
    const raw = await system.storage.readFileAsString(`deployments/${id}/runtime/docker-compose.yml`);
    const doc = parse(raw) as { services: Record<string, { volumes?: string[] }> };
    return doc.services[APP]?.volumes ?? [];
  }

  async function readMetadata(id: string): Promise<EnhancedDeploymentDetail> {
    return JSON.parse(await readFile(join(dataRoot, 'deployments', id, 'metadata.json'), 'utf8'));
  }

  /**
   * Rewrite the active release's manifest to declare the retired capability —
   * what every record installed by a PRE-F06 server looks like on disk. Going
   * through the file (rather than the catalog stub) is the only honest way to
   * build one now that `createFromDraft` refuses the declaration.
   */
  async function makeManifestLegacy(id: string): Promise<void> {
    const releaseId = (await readFile(join(dataRoot, 'deployments', id, 'current'), 'utf8')).trim();
    const path = join(dataRoot, 'deployments', id, 'releases', releaseId, 'manifest.json');
    const manifest = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    manifest.consumes = ['apps-data'];
    await writeFile(path, JSON.stringify(manifest, null, 2));
  }

  /**
   * Remove the migration fence, so the next `makeSystem()` is the FIRST F06
   * server this host has ever run. Necessary because the harness builds its
   * "installed by an older server" state with a real (F06) service, which drops
   * the fence on its own first rehydration — on a real upgrade the records are
   * simply already on disk when the new server boots.
   */
  async function simulatePreF06Host(): Promise<void> {
    await rm(join(dataRoot, MARKER), { force: true });
  }

  /** Capture (and still forward) the service's own warn output. */
  function captureWarnings(system: System) {
    const svc = system.deployments as unknown as {
      logger: { warn: (message: string, context?: unknown) => void };
    };
    const warnings: Array<{ message: string; context?: unknown }> = [];
    const original = svc.logger.warn.bind(svc.logger);
    svc.logger.warn = (message, context) => { warnings.push({ message, context }); return original(message, context); };
    return warnings;
  }

  const appsDataMount = (): string => `${appsRoot}:${appsRoot}:ro`;

  // =========================================================================
  // The defect: a NEW install could grant itself the apps root
  // =========================================================================

  // ★ The regression. Before the fix this install completed and its compose
  // carried `<appsRoot>:<appsRoot>:ro` — read access to every app's data and
  // every stored environment record — from one manifest line, with no consent.
  test('a new install declaring only the legacy capability is refused, and creates no state', async () => {
    const system = makeSystem({ consumes: ['apps-data'] });
    const { draftId } = await system.drafts.createDraft({ appId: APP, version: '1.0.0' });
    await system.drafts.updateDraft(draftId, { composeOverride: COMPOSE });
    await system.drafts.finalizeDraft(draftId);

    await expect(
      system.deployments.createFromDraft({ draftId, name: APP, allowMultiple: true }),
    ).rejects.toThrow(/apps-data/);

    // Refused BEFORE any state exists — not installed-then-unprivileged.
    expect((await system.deployments.listDeployments({})).items).toHaveLength(0);
  });

  test('the refusal names the contract the bundle should declare instead', async () => {
    const system = makeSystem({ consumes: ['apps-data'] });
    const { draftId } = await system.drafts.createDraft({ appId: APP, version: '1.0.0' });
    await system.drafts.updateDraft(draftId, { composeOverride: COMPOSE });
    await system.drafts.finalizeDraft(draftId);

    // The operator of a third-party bundle written against ADR 0002 has exactly
    // one chance to be told what is wrong; a silent no-mount install would make
    // this a support ticket instead.
    const err = await system.deployments
      .createFromDraft({ draftId, name: APP, allowMultiple: true })
      .then(() => undefined, (e: unknown) => e as Error & { details?: Record<string, unknown> });
    expect(err?.message).toContain('backup@1');
    expect(err?.details).toMatchObject({ code: 'LEGACY_CAPABILITY_REFUSED', capability: 'apps-data' });
  });

  test('the sibling app-registry capability is untouched — it is not a cross-app privilege', async () => {
    const system = makeSystem({ consumes: ['app-registry'] });
    const id = await install(system);
    expect(await volumesOf(system, id)).not.toContain(appsDataMount());
    expect(JSON.parse(await readFile(join(appsRoot, id, 'registry.json'), 'utf8')).version).toBe(1);
  });

  // =========================================================================
  // The migration: identified pre-existing installs, once
  // =========================================================================

  test('a pre-existing legacy install is migrated once into an explicit stamp and keeps its mount', async () => {
    // Installed by a pre-F06 server: the record carries no grant of any kind and
    // its active manifest declares the retired capability.
    const first = makeSystem();
    const id = await install(first);
    await makeManifestLegacy(id);
    await simulatePreF06Host();
    expect((await readMetadata(id)).legacyGrantedPrivileges).toBeUndefined();

    // Restart onto the F06 server: rehydration migrates it.
    const second = makeSystem();
    const warnings = captureWarnings(second);
    await rematerialise(second, id);

    // The privilege it already had survives — a backup tool that silently stops
    // covering other apps is worse than one that fails loudly.
    expect(await volumesOf(second, id)).toContain(appsDataMount());
    // ...now as a recorded, auditable fact about THIS install.
    expect((await readMetadata(id)).legacyGrantedPrivileges).toEqual(['apps-data']);
    // ...and it is no longer consent-shaped silence: the migration says so.
    expect(warnings.filter((w) => w.message.includes('Migrated a pre-existing'))).toHaveLength(1);

    // The marker fences the migration for good.
    const marker = JSON.parse(await readFile(join(dataRoot, MARKER), 'utf8'));
    expect(marker.migration).toBe('legacy-apps-data@1');
    expect(marker.migrated).toEqual([{ id, app: APP, privileges: ['apps-data'] }]);

    // A third boot re-migrates nothing (and re-reads no manifest to decide).
    const third = makeSystem();
    const thirdWarnings = captureWarnings(third);
    await rematerialise(third, id);
    expect(await volumesOf(third, id)).toContain(appsDataMount());
    expect(thirdWarnings.filter((w) => w.message.includes('Migrated a pre-existing'))).toEqual([]);
  });

  // ★ The security-critical half: the migration must not be a signal a new
  // install can produce. A deployment created AFTER the fence — even one whose
  // active release later starts declaring the capability, which `promote` can do
  // with no consent step of its own — is never stamped.
  test('once the fence is down, a deployment that only later declares the capability is never stamped', async () => {
    // Boot once on an empty host: the fence goes down with nothing to migrate.
    const first = makeSystem();
    await first.deployments.listDeployments({});
    expect(await first.storage.fileExists(MARKER)).toBe(true);

    // Install cleanly, then make its active release legacy-declaring — the shape
    // a `promote` onto an older release produces, with no consent step anywhere.
    // The fence is deliberately left in place: this host has already migrated.
    const id = await install(first);
    await makeManifestLegacy(id);

    // Every subsequent boot: no stamp, and therefore no mount.
    const second = makeSystem();
    const warnings = captureWarnings(second);
    await rematerialise(second, id);

    expect((await readMetadata(id)).legacyGrantedPrivileges).toBeUndefined();
    expect(await volumesOf(second, id)).not.toContain(appsDataMount());
    expect(warnings.filter((w) => w.message.includes('Migrated a pre-existing'))).toEqual([]);
  });

  test('a stamped install that upgrades off the legacy declaration loses the legacy grant', async () => {
    const first = makeSystem();
    const id = await install(first);
    await makeManifestLegacy(id);
    await simulatePreF06Host();
    const second = makeSystem();
    await rematerialise(second, id);
    expect(await volumesOf(second, id)).toContain(appsDataMount());

    // The app ships a release that declares the contract instead (the upgrade the
    // migration's warning asks for). The stamp stays on the record, but it grants
    // nothing: consent is the only way back in.
    const releaseId = (await readFile(join(dataRoot, 'deployments', id, 'current'), 'utf8')).trim();
    const manifestPath = join(dataRoot, 'deployments', id, 'releases', releaseId, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    delete manifest.consumes;
    manifest.provides = ['backup@1'];
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    const third = makeSystem();
    await rematerialise(third, id);
    expect((await readMetadata(id)).legacyGrantedPrivileges).toEqual(['apps-data']);
    expect(await volumesOf(third, id)).not.toContain(appsDataMount());
  });

  // =========================================================================
  // What the operator can see
  // =========================================================================

  test('a migrated legacy privilege is reported on the deployment, separately from consented grants', async () => {
    const first = makeSystem();
    const id = await install(first);
    await makeManifestLegacy(id);
    await simulatePreF06Host();
    const second = makeSystem();
    await rematerialise(second, id);

    const detail = await second.deployments.getDeployment(id);
    // Its own field: nobody consented to this, so folding it into `granted`
    // would misreport it as something the operator approved.
    expect(detail.contracts?.legacyGranted).toEqual(['apps-data']);
    expect(detail.contracts?.granted).toBeUndefined();
  });

  test('an ordinary install reports no legacy grant at all', async () => {
    const system = makeSystem();
    const id = await install(system);
    expect((await system.deployments.getDeployment(id)).contracts?.legacyGranted).toBeUndefined();
  });

  // =========================================================================
  // The consented path must be undisturbed
  // =========================================================================

  test('a properly consented backup@1 provider still gets the apps-data mount', async () => {
    const system = makeSystem({ provides: ['backup@1'] });
    const id = await install(system, ['backup@1']);
    expect(await volumesOf(system, id)).toContain(appsDataMount());
    const meta = await readMetadata(id);
    expect(meta.grantedContracts).toEqual(['backup@1']);
    expect(meta.grantedPrivileges).toEqual(['apps-data']);
    expect(meta.legacyGrantedPrivileges).toBeUndefined();
  });
});
