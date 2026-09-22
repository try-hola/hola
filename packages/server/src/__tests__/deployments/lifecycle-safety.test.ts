/**
 * Lifecycle safety: destructive transitions prove they are safe, and work for
 * one deployment never overlaps (F09 + F10).
 *
 * These two findings are one piece of work and this suite treats them as one.
 * F09 adds the missing proofs — a teardown whose result is checked, a restore
 * staged and validated before the original is touched, a rollback that refuses
 * rather than silently restoring nothing. Every one of those proofs is
 * POINT-IN-TIME: a `composeDown` that succeeded says nothing about whether the
 * containers are still down by the time the data root is wiped. F10's
 * per-deployment serialization is what makes the interval between the check and
 * the act uninterruptible. Neither half is sound alone, so neither is tested
 * alone here.
 *
 * The harness is `install-markers.test.ts`'s (real storage/database/logging/
 * job/routing/draft services over `mkdtemp` dirs, `MockDockerService` +
 * `MockProvisionerService`) with one addition: a Docker mock whose calls can be
 * held open, which is how the finding's own reproduction — "hold a mocked stop
 * operation open, submit start, observe start complete while stop was still
 * executing" — becomes an assertion rather than an anecdote.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { spawn } from 'child_process';
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { RealDeploymentService } from '../../services/core/deployment';
import { MockProvisionerService } from '../../services/core/provisioner';
import { RealDraftService } from '../../services/core/draft';
import { RealStorageService } from '../../services/core/storage';
import { RealRoutingService } from '../../services/core/routing';
import { RealDatabaseService } from '../../services/core/database';
import { RealLoggingService } from '../../services/core/logging';
import { RealJobService } from '../../services/core/jobs';
import { MockDockerService } from '../../services/core/docker';
import { restoreTarGzInto, tarGzipDir } from '../../services/core/snapshot-fs';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

const APP_ID = 'demoapp';
// `${HOLA_APP_DATA}` must stay LITERAL text — never JS-interpolated — or the
// deployment never gets a data root and half this suite asserts nothing.
const COMPOSE_WITH_DATA =
  'services:\n  demoapp:\n    image: demoapp:latest\n    volumes:\n      - ${HOLA_APP_DATA}:/data\n';

/** One compose call, as `<op>:<phase>` — the ordering evidence F10 needs. */
type ComposeEvent = string;

/**
 * `tar -czf` with no post-condition — the pre-F15 `tarGzipDir`, kept here only
 * so a test can still build the degenerate archives the restore side must
 * refuse. Production code must never use this: proving the archive is the point.
 */
function rawTarGzip(srcDir: string, destFile: string): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn('tar', ['-czf', destFile, '-C', srcDir, '.'], { stdio: 'ignore' });
    child.on('error', rej);
    child.on('close', (code) => (code === 0 ? res() : rej(new Error(`tar exited ${code}`))));
  });
}

/**
 * A Docker mock that can be told to fail a call, or to HOLD one open until the
 * test releases it. Holding is the whole point: concurrency bugs are invisible
 * against a mock that returns instantly, because the racing window is a few
 * microseconds wide and the test wins it by luck. This widens the window to
 * "however long the test likes", so an unserialized second job has all the time
 * in the world to interleave — and is therefore observed when it does.
 */
class GatedDockerService extends MockDockerService {
  readonly events: ComposeEvent[] = [];
  /** Project names whose `composeDown` must report failure. */
  failDownFor = new Set<string>();
  /** Resolves when the test releases a held call; undefined = never held. */
  private gate?: { promise: Promise<void>; release: () => void };
  private gateOn?: { op: 'down' | 'up'; project: string };

  hold(op: 'down' | 'up', project: string): () => void {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => { release = resolve; });
    this.gate = { promise, release };
    this.gateOn = { op, project };
    return release;
  }

  private async maybeHold(op: 'down' | 'up', project: string): Promise<void> {
    if (this.gateOn?.op === op && this.gateOn.project === project && this.gate) {
      const { promise } = this.gate;
      this.gateOn = undefined; // hold the FIRST matching call only
      await promise;
    }
  }

  override async composeDown(projectPath: string, projectName: string, profiles?: string[]) {
    this.events.push(`down:start:${projectName}`);
    await this.maybeHold('down', projectName);
    this.events.push(`down:end:${projectName}`);
    if (this.failDownFor.has(projectName)) {
      return { success: false, output: `[test] refusing to stop ${projectName}` };
    }
    return super.composeDown(projectPath, projectName, profiles);
  }

  override async composeUp(
    projectPath: string,
    projectName: string,
    registryAuth?: Parameters<MockDockerService['composeUp']>[2],
    profiles?: string[],
    options?: Parameters<MockDockerService['composeUp']>[4],
  ) {
    this.events.push(`up:start:${projectName}`);
    await this.maybeHold('up', projectName);
    this.events.push(`up:end:${projectName}`);
    return super.composeUp(projectPath, projectName, registryAuth, profiles, options);
  }
}

function makeCatalog(): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'Demo App', icon: '🧪' }),
    getVersionDetail: async () => ({ defaultEnv: [], defaults: { ports: [], volumes: [] } }),
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
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Give the event loop room for anything that WOULD have raced to do so. */
async function settle(ms = 120) {
  await new Promise((r) => setTimeout(r, ms));
}

describe('Lifecycle safety (F09 + F10)', () => {
  let dataRoot: string;
  let appsRoot: string;
  let prevAppsBindRoot: string | undefined;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-ls-data-'));
    appsRoot = await mkdtemp(join(tmpdir(), 'hola-ls-apps-'));
    prevAppsBindRoot = process.env.HOLA_APPS_BIND_ROOT;
    process.env.HOLA_APPS_BIND_ROOT = appsRoot;
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
    const docker = new GatedDockerService();
    const deployments = new RealDeploymentService(storage, jobs, docker, drafts, routing, logging, new MockProvisionerService());
    return { storage, jobs, drafts, deployments, docker };
  }

  async function finalizedDraft(drafts: RealDraftService, version = '1.0.0', appId = APP_ID): Promise<string> {
    const { draftId } = await drafts.createDraft({ appId, version });
    await drafts.updateDraft(draftId, { composeOverride: COMPOSE_WITH_DATA });
    await drafts.finalizeDraft(draftId);
    return draftId;
  }

  async function install(
    deployments: RealDeploymentService,
    drafts: RealDraftService,
    jobs: RealJobService,
    name = APP_ID,
    version = '1.0.0',
    // A distinct app id, not just a distinct name: the single-instance guard
    // (#246) refuses a second copy of the same app, so the parallelism test
    // below needs two genuinely different apps.
    appId = APP_ID,
  ) {
    const created = await deployments.createFromDraft({
      draftId: await finalizedDraft(drafts, version, appId),
      name,
      options: { autoStart: true },
    });
    await waitForJob(jobs, created.jobId!);
    return created;
  }

  function appDataFile(deploymentId: string) {
    return join(appsRoot, deploymentId, 'data', 'app.db');
  }

  async function writeAppData(deploymentId: string, content: string) {
    await mkdir(join(appsRoot, deploymentId, 'data'), { recursive: true });
    await writeFile(appDataFile(deploymentId), content);
  }

  // ---------------------------------------------------------------- F10 ----

  /**
   * The finding's own reproduction, made into an assertion: "an isolated real-
   * service test deliberately held a mocked stop operation open, submitted
   * start, and observed start complete while stop was still executing."
   *
   * This is the revert-proof test for the whole of F10. Remove the partition in
   * `RealJobService.tick` (or the lock release in `runJob`) and `up:start`
   * appears between `down:start` and `down:end` — a second job driving the same
   * Compose project while the first is mid-flight.
   */
  test('a second job for the SAME deployment cannot start while the first is still running', async () => {
    const { deployments, drafts, jobs, docker } = makeSystem();
    const dep = await install(deployments, drafts, jobs);
    const project = docker.composeCalls.at(-1)!.projectName;
    docker.events.length = 0;

    const release = docker.hold('down', project);
    const stop = await deployments.executeAction(dep.deploymentId, { action: 'stop' });
    const start = await deployments.executeAction(dep.deploymentId, { action: 'start' });

    // The stop is parked inside `composeDown`. Give the start every chance to
    // overtake it; with the partition in place it is not even dispatched.
    await settle();
    expect(docker.events).toEqual([`down:start:${project}`]);

    release();
    await waitForJob(jobs, stop.jobId!);
    await waitForJob(jobs, start.jobId!);

    // Strictly sequential, with no interleaving anywhere in between.
    expect(docker.events.indexOf(`down:end:${project}`)).toBeLessThan(docker.events.indexOf(`up:start:${project}`));
    expect(docker.events.filter((e) => e.startsWith('up:')).length).toBeGreaterThan(0);
  });

  /**
   * The other half, and the one a naive fix fails: serializing per HOST rather
   * than per deployment would pass the test above while destroying throughput
   * on a host with more than one app. A blocked job for A must not hold B.
   */
  test('work for a DIFFERENT deployment still runs in parallel', async () => {
    const { deployments, drafts, jobs, docker } = makeSystem();
    const a = await install(deployments, drafts, jobs, 'app-a', '1.0.0', 'appa');
    const b = await install(deployments, drafts, jobs, 'app-b', '1.0.0', 'appb');
    const projectA = `hola-${a.deploymentId}`;
    const projectB = `hola-${b.deploymentId}`;
    docker.events.length = 0;

    const release = docker.hold('down', projectA);
    const stopA = await deployments.executeAction(a.deploymentId, { action: 'stop' });
    const stopB = await deployments.executeAction(b.deploymentId, { action: 'stop' });

    // B completes while A is still parked — the parallelism a global lock loses.
    const doneB = await waitForJob(jobs, stopB.jobId!, 5000);
    expect(doneB.status).toBe('completed');
    expect(docker.events).toContain(`down:end:${projectB}`);
    expect(docker.events).not.toContain(`down:end:${projectA}`);

    release();
    expect((await waitForJob(jobs, stopA.jobId!)).status).toBe('completed');
  });

  /**
   * Which operations refuse and which queue, asserted as the deliberate split
   * it is: promote/rollback/delete carry or destroy state decided against the
   * current release, so they refuse; start/stop/restart name no release and
   * destroy nothing, so they queue.
   */
  test('promote, rollback and delete refuse while a job is in flight; stop queues behind it', async () => {
    const { deployments, drafts, jobs, docker } = makeSystem();
    const dep = await install(deployments, drafts, jobs);
    const project = `hola-${dep.deploymentId}`;

    const release = docker.hold('down', project);
    const stop = await deployments.executeAction(dep.deploymentId, { action: 'stop' });
    await settle(30);

    await expect(deployments.rollback(dep.deploymentId, { restoreData: true })).rejects.toThrow(/already running/);
    await expect(deployments.deleteDeployment(dep.deploymentId)).rejects.toThrow(/already running/);
    await expect(
      deployments.promote(dep.deploymentId, { draftId: await finalizedDraft(drafts, '2.0.0') }),
    ).rejects.toThrow(/already running/);

    // …but a second stop is accepted and simply runs afterwards.
    const second = await deployments.executeAction(dep.deploymentId, { action: 'stop' });
    expect(second.jobId).toBeTruthy();

    release();
    expect((await waitForJob(jobs, stop.jobId!)).status).toBe('completed');
    expect((await waitForJob(jobs, second.jobId!)).status).toBe('completed');
  });

  // ---------------------------------------------------------------- F09 ----

  /**
   * Uninstall used to log `compose down reported a failure during delete;
   * continuing with teardown` and then remove the storage tree and the app data
   * root — deleting a live database's files out from under it, in writing.
   */
  test('uninstall refuses when the containers cannot be stopped, and keeps the data and the record', async () => {
    const { deployments, drafts, jobs, docker } = makeSystem();
    const dep = await install(deployments, drafts, jobs);
    await writeAppData(dep.deploymentId, 'precious');
    docker.failDownFor.add(`hola-${dep.deploymentId}`);

    await expect(deployments.deleteDeployment(dep.deploymentId)).rejects.toThrow(/could not be stopped/);

    // Recoverable state: the data is intact AND the record that makes the
    // containers findable again still exists.
    expect(await readFile(appDataFile(dep.deploymentId), 'utf8')).toBe('precious');
    expect((await deployments.getDeployment(dep.deploymentId)).id).toBe(dep.deploymentId);
  });

  /**
   * …and the escape hatch that keeps the refusal from converting a data-loss
   * bug into an unremovable deployment. Deliberately a separate, explicit
   * operation, never a retry of the same one.
   */
  test('a FORCED uninstall removes the deployment even when the stop fails', async () => {
    const { deployments, drafts, jobs, docker } = makeSystem();
    const dep = await install(deployments, drafts, jobs);
    await writeAppData(dep.deploymentId, 'precious');
    docker.failDownFor.add(`hola-${dep.deploymentId}`);

    await deployments.deleteDeployment(dep.deploymentId, { force: true });

    expect(existsSync(join(appsRoot, dep.deploymentId))).toBe(false);
    await expect(deployments.getDeployment(dep.deploymentId)).rejects.toThrow();
  });

  /**
   * The rollback's own invariant, which its comment asserted and its code did
   * not: `composeDown`'s result was discarded entirely, and the next statement
   * wiped and replaced the data root.
   */
  test('a data-aware rollback refuses to touch the data when the stop fails', async () => {
    const { deployments, drafts, jobs, docker } = makeSystem();
    const dep = await install(deployments, drafts, jobs);
    await writeAppData(dep.deploymentId, 'v1');
    const v1 = dep.releaseId;

    const promoted = await deployments.promote(dep.deploymentId, {
      draftId: await finalizedDraft(drafts, '2.0.0'),
      snapshot: true,
      options: { autoStart: true },
    });
    await waitForJob(jobs, promoted.jobId!);
    await writeAppData(dep.deploymentId, 'v2-migrated');

    docker.failDownFor.add(`hola-${dep.deploymentId}`);
    const rb = await deployments.rollback(dep.deploymentId, { targetReleaseId: v1, restoreData: true });
    const job = await waitForJob(jobs, rb.jobId);

    expect(job.status).toBe('failed');
    // Nothing was changed — not a partially restored root, not an empty one.
    expect(await readFile(appDataFile(dep.deploymentId), 'utf8')).toBe('v2-migrated');
  });

  /**
   * #524, the live defect. A rollback that finds no snapshot used to log at
   * `error` and report `completed`: the operator is told their data was rolled
   * back when none of it was, and the old image then boots against the newer
   * release's forward-migrated data.
   *
   * The promote here is deliberately WITHOUT `snapshot: true`, which is exactly
   * how an operator ends up with no capture to roll back to.
   */
  test('a data-aware rollback with no snapshot FAILS rather than reporting success (#524)', async () => {
    const { deployments, drafts, jobs } = makeSystem();
    const dep = await install(deployments, drafts, jobs);
    await writeAppData(dep.deploymentId, 'v1');
    const v1 = dep.releaseId;

    const promoted = await deployments.promote(dep.deploymentId, {
      draftId: await finalizedDraft(drafts, '2.0.0'),
      options: { autoStart: true },
    });
    await waitForJob(jobs, promoted.jobId!);
    await writeAppData(dep.deploymentId, 'v2-migrated');

    const rb = await deployments.rollback(dep.deploymentId, { targetReleaseId: v1, restoreData: true });
    const job = await waitForJob(jobs, rb.jobId);

    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/No pre-upgrade snapshot/);
    expect(await readFile(appDataFile(dep.deploymentId), 'utf8')).toBe('v2-migrated');
  });

  /**
   * The other half of #524: an explicitly requested snapshot that cannot be
   * taken fails the promote, so the operator never reaches the rollback above
   * believing they are protected.
   */
  test('a promote that cannot take the snapshot it was asked for fails (#524)', async () => {
    const { deployments, drafts, jobs, storage } = makeSystem();
    const dep = await install(deployments, drafts, jobs);
    await writeAppData(dep.deploymentId, 'v1');

    // Make the capture fail the way a full or unwritable disk would.
    const original = storage.ensureDir.bind(storage);
    storage.ensureDir = async (path: string, mode?: number) => {
      if (path.includes('/snapshots/')) throw new Error('ENOSPC: no space left on device');
      return original(path, mode);
    };

    await expect(
      deployments.promote(dep.deploymentId, {
        draftId: await finalizedDraft(drafts, '2.0.0'),
        snapshot: true,
        options: { autoStart: false },
      }),
    ).rejects.toThrow(/snapshot: true/);

    // The upgrade did NOT proceed unprotected.
    expect((await deployments.getDeployment(dep.deploymentId)).version).toBe('1.0.0');
  });

  /**
   * #524's mechanism, kept reproducible: the rollback job used to be enqueued
   * BEFORE the release pointer moved, and the job resolves the release to
   * materialize from that pointer. Delaying the pointer write is what the CI
   * runner's load did by accident on three consecutive PRs. With the promote
   * ordered first, the delay changes nothing.
   */
  test('a rollback materializes its target release even when the pointer write is slow (#524)', async () => {
    const { deployments, drafts, jobs } = makeSystem();
    const dep = await install(deployments, drafts, jobs, APP_ID, '1.0.0');
    await writeAppData(dep.deploymentId, 'v1');
    const v1 = dep.releaseId;

    const promoted = await deployments.promote(dep.deploymentId, {
      draftId: await finalizedDraft(drafts, '2.0.0'),
      snapshot: true,
      options: { autoStart: true },
    });
    await waitForJob(jobs, promoted.jobId!);

    // Simulate a loaded machine: the pointer write loses every footrace it is
    // still in. (It is in none — the rollback promotes before it enqueues.)
    const svc = deployments as unknown as { promoteRelease: (d: string, r: string) => Promise<void> };
    const original = svc.promoteRelease.bind(deployments);
    svc.promoteRelease = async (d: string, r: string) => {
      await new Promise((res) => setTimeout(res, 150));
      return original(d, r);
    };

    const rb = await deployments.rollback(dep.deploymentId, { targetReleaseId: v1, restoreData: true });
    expect((await waitForJob(jobs, rb.jobId)).status).toBe('completed');

    const record = JSON.parse(await readFile(join(appsRoot, dep.deploymentId, '.hola', 'instance.json'), 'utf8'));
    expect(record.appVersion).toBe('1.0.0');
    expect(await readFile(appDataFile(dep.deploymentId), 'utf8')).toBe('v1');
  });

  // ------------------------------------------- restoreTarGzInto (staging) ---

  /**
   * The finding's reproduction verbatim: "restoring a deliberately invalid
   * archive into an isolated directory raised an error after deleting its
   * original dummy file". The error is still raised; the deletion is not.
   */
  test('a corrupt archive leaves the destination exactly as it was', async () => {
    const dest = join(appsRoot, 'dest');
    const staging = join(appsRoot, '.hola', 'restore-tmp');
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, 'original.txt'), 'the only copy');
    const bad = join(appsRoot, 'bad.tar.gz');
    await writeFile(bad, 'this is not a gzip stream');

    await expect(restoreTarGzInto(bad, dest, staging)).rejects.toThrow();

    expect(await readFile(join(dest, 'original.txt'), 'utf8')).toBe('the only copy');
    // And no staging debris survives the failure.
    expect(existsSync(staging) ? await readdir(staging) : []).toEqual([]);
  });

  test('a missing archive leaves the destination exactly as it was', async () => {
    const dest = join(appsRoot, 'dest');
    const staging = join(appsRoot, '.hola', 'restore-tmp');
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, 'original.txt'), 'the only copy');

    await expect(restoreTarGzInto(join(appsRoot, 'nope.tar.gz'), dest, staging)).rejects.toThrow();

    expect(await readFile(join(dest, 'original.txt'), 'utf8')).toBe('the only copy');
  });

  /**
   * An archive of an empty directory is technically valid, so nothing in the
   * extraction itself refuses it — and landing it would be an `rm -rf` of the
   * data root dressed up as a restore.
   *
   * The archive is built by invoking `tar` directly rather than through
   * `tarGzipDir`, because F15 gave that helper the opposite post-condition: it
   * now refuses to report success for an archive holding no files. Both rules
   * are wanted — the capture side never records an empty snapshot, and the
   * restore side never lands one that reached it some other way (an older
   * snapshot on disk, a provider-delivered capture) — so this test constructs
   * the input it is about instead of borrowing a helper that now rejects it.
   */
  test('an archive that extracts to nothing is refused rather than landed', async () => {
    const dest = join(appsRoot, 'dest');
    const staging = join(appsRoot, '.hola', 'restore-tmp');
    const emptySrc = join(appsRoot, 'empty-src');
    await mkdir(dest, { recursive: true });
    await mkdir(emptySrc, { recursive: true });
    await writeFile(join(dest, 'original.txt'), 'the only copy');
    const archive = join(appsRoot, 'empty.tar.gz');
    await rawTarGzip(emptySrc, archive);

    await expect(restoreTarGzInto(archive, dest, staging)).rejects.toThrow(/extracted to nothing/);
    expect(await readFile(join(dest, 'original.txt'), 'utf8')).toBe('the only copy');
  });

  /**
   * The positive case the completion criteria also name: a VALID restore really
   * does replace, exactly (no stale files from the newer release), and leaves
   * no staging debris or superseded copy behind to accumulate on disk.
   */
  test('a valid archive replaces the destination exactly and cleans up after itself', async () => {
    const dest = join(appsRoot, 'dest');
    const staging = join(appsRoot, '.hola', 'restore-tmp');
    const src = join(appsRoot, 'src');
    await mkdir(join(src, 'nested'), { recursive: true });
    await writeFile(join(src, 'nested', 'kept.txt'), 'restored');
    const archive = join(appsRoot, 'good.tar.gz');
    await tarGzipDir(src, archive);

    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, 'stale.txt'), 'from the newer release');

    await restoreTarGzInto(archive, dest, staging);

    expect(await readFile(join(dest, 'nested', 'kept.txt'), 'utf8')).toBe('restored');
    expect(existsSync(join(dest, 'stale.txt'))).toBe(false);
    // Nothing accumulates: neither the staged tree nor the superseded copy.
    // Both are transiently a full second copy of the data root, so a leak here
    // is a slow disk-exhaustion bug rather than a cosmetic one.
    expect(existsSync(staging) ? await readdir(staging) : []).toEqual([]);
  });
});
