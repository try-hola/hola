/**
 * Install identity markers (spec 006): two platform-authored JSON records
 * written on every materialization, in two DIFFERENT places —
 *
 *   <appsRoot>/<id>/.hola/instance.json   install identity, `0644`, no secret
 *   <appsRoot>/.hola/<id>/env.json        resolved app env, `0600` in a `0700` dir
 *
 * The split is the feature's sharpest edge (#478 item 1): `${HOLA_APP_DATA}`
 * resolves to `<appsRoot>/<id>` and is bind-mounted into the app's own
 * containers, so a secret-bearing record inside it is readable by the app —
 * and by the end users of any app that serves or browses its own data
 * directory. `env.json` therefore lives one level up, a sibling of every data
 * root, still inside the apps bind root the `apps-data` grant identity-mounts.
 * Nothing in the platform reads either record in this feature (FR-018) — see
 * `writeInstanceMarkers` in `deployment.ts`.
 *
 * Harness copied from `backup-hooks.test.ts:65-95` (research R11):
 * `RealStorageService` over a `mkdtemp` dir, `HOLA_APPS_BIND_ROOT` pointed at
 * a SECOND `mkdtemp` dir, real database/logging/job/routing/draft services,
 * `MockDockerService` + `MockProvisionerService`, driven through
 * `drafts.createDraft` → `finalizeDraft` → `deployments.createFromDraft` →
 * `waitForJob`. `MockStorageService` CANNOT be used here: it stores content
 * in a `Map` and only logs the `mode` (`storage.ts:378-382`), so a mode
 * assertion against it would silently assert nothing.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, mkdir, rm, readdir, chmod, stat, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { AppEnvVar, AppBackupDeclaration } from '@hola/shared';
import { slugifySubdomain } from '@hola/shared';
import { RealDeploymentService } from '../../services/core/deployment';
import { MockProvisionerService } from '../../services/core/provisioner';
import { RealDraftService } from '../../services/core/draft';
import { RealStorageService } from '../../services/core/storage';
import { RealRoutingService } from '../../services/core/routing';
import { RealDatabaseService } from '../../services/core/database';
import { RealLoggingService } from '../../services/core/logging';
import { RealJobService } from '../../services/core/jobs';
import { MockDockerService } from '../../services/core/docker';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

const APP_ID = 'demoapp';

// A single-service compose whose data volume references ${HOLA_APP_DATA} —
// the token that gates FR-015 ("does this app have a data root?"). Not a
// template literal: the token must stay LITERAL text, never JS-interpolated.
const COMPOSE_WITH_DATA =
  'services:\n  demoapp:\n    image: demoapp:latest\n    volumes:\n      - ${HOLA_APP_DATA}:/data\n';
const COMPOSE_NO_DATA = 'services:\n  demoapp:\n    image: demoapp:latest\n';

// Mutable per-test catalog fixtures, reset in beforeEach (pattern from
// backup-hooks.test.ts).
let defaultEnv: AppEnvVar[];
let acceptsConfig: string[] | undefined;
let backupConfig: AppBackupDeclaration | undefined;

function makeCatalog(): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'Demo App', icon: '🧪' }),
    getVersionDetail: async () => ({
      defaultEnv,
      defaults: { ports: [], volumes: [] },
      accepts: acceptsConfig,
      backup: backupConfig,
    }),
  } as unknown as CatalogArg;
}

function makeValidation(): ValidationArg {
  return {
    validateDraft: async () => ({ ok: true, errors: [], warnings: [] }),
    preflightCheck: async () => ({ ok: true, checks: [] }),
  } as unknown as ValidationArg;
}

/** Every path under `dir`, relative to it (files and directories alike), so a
 *  "this file is nowhere under here" assertion can't be defeated by the file
 *  simply moving to a different subdirectory of the same tree. */
async function walk(dir: string): Promise<string[]> {
  return (await readdir(dir, { recursive: true })) as string[];
}

/** Entry names inside a gzip tarball, via `tar -tzf` — the same `tar` that
 *  wrote it (`snapshot-fs.ts`), so this reads exactly what a restore would. */
async function listTar(tarPath: string): Promise<string[]> {
  const proc = Bun.spawn(['tar', '-tzf', tarPath], { stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`tar -tzf ${tarPath} exited ${code}: ${err.trim()}`);
  return out.split('\n').map((line) => line.trim()).filter(Boolean);
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

describe('Install identity markers (spec 006)', () => {
  let dataRoot: string;
  let appsRoot: string;
  let prevAppsBindRoot: string | undefined;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-im-data-'));
    appsRoot = await mkdtemp(join(tmpdir(), 'hola-im-apps-'));
    prevAppsBindRoot = process.env.HOLA_APPS_BIND_ROOT;
    process.env.HOLA_APPS_BIND_ROOT = appsRoot;
    defaultEnv = [];
    acceptsConfig = undefined;
    backupConfig = undefined;
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
    const deployments = new RealDeploymentService(storage, jobs, new MockDockerService(), drafts, routing, logging, new MockProvisionerService());
    return { storage, jobs, drafts, deployments };
  }

  async function finalizedDraft(
    drafts: RealDraftService,
    opts: { version?: string; compose?: string; channel?: string; source?: string } = {},
  ): Promise<string> {
    const { draftId } = await drafts.createDraft({ appId: APP_ID, version: opts.version ?? '1.0.0', channel: opts.channel, source: opts.source });
    await drafts.updateDraft(draftId, { composeOverride: opts.compose ?? COMPOSE_WITH_DATA });
    await drafts.finalizeDraft(draftId);
    return draftId;
  }

  async function install(
    deployments: RealDeploymentService,
    drafts: RealDraftService,
    jobs: RealJobService,
    opts: { version?: string; compose?: string; channel?: string; source?: string; name?: string } = {},
  ) {
    const draftId = await finalizedDraft(drafts, opts);
    const created = await deployments.createFromDraft({ draftId, name: opts.name ?? APP_ID, options: { autoStart: true } });
    await waitForJob(jobs, created.jobId!);
    return created;
  }

  /** `<appsRoot>/<id>/.hola/` — inside the app's own bind mount. Identity
   *  record only. */
  function holaDirFor(deploymentId: string): string {
    return join(appsRoot, deploymentId, '.hola');
  }

  /** `<appsRoot>/.hola/<id>/` — a SIBLING of the data root, outside every
   *  app's `${HOLA_APP_DATA}` mount. Environment record only (#478). */
  function envDirFor(deploymentId: string): string {
    return join(appsRoot, '.hola', deploymentId);
  }

  // Test-local mirrors of data-model.md's two record shapes — NOT imported
  // from `deployment.ts` (its `InstallIdentityRecord`/`InstallEnvRecord` are
  // deliberately module-local and unexported per FR-018) and NOT proof this
  // suite reads the production records at runtime — used purely so `JSON.parse`
  // here has a type instead of `any`.
  type InstanceRecordShape = {
    schema: number;
    writtenBy: string;
    writtenAt: string;
    deploymentId: string;
    lineageId: string;
    app: string;
    appVersion: string | null;
    channel: string | null;
    source: string | null;
    name: string;
    subdomain: string | null;
    host: string;
    accepts: string[];
    participations: Record<string, string[]>;
  };
  type EnvRecordShape = {
    schema: number;
    writtenAt: string;
    deploymentId: string;
    env: Record<string, string>;
  };

  async function readInstanceRecord(deploymentId: string): Promise<InstanceRecordShape> {
    const raw = await Bun.file(join(holaDirFor(deploymentId), 'instance.json')).text();
    return JSON.parse(raw) as InstanceRecordShape;
  }

  async function readEnvRecord(deploymentId: string): Promise<EnvRecordShape> {
    const raw = await Bun.file(join(envDirFor(deploymentId), 'env.json')).text();
    return JSON.parse(raw) as EnvRecordShape;
  }

  async function modeOf(path: string): Promise<number> {
    const s = await stat(path);
    return s.mode & 0o777;
  }

  // ---- Scenario 1 (T012): both records exist, every FR-003/FR-004 field present ----
  test('a fresh install writes both records with every FR-003/FR-004 field correct', async () => {
    acceptsConfig = ['backup@1'];
    const { deployments, drafts, jobs } = makeSystem();
    const created = await install(deployments, drafts, jobs, { version: '1.0.0', channel: 'stable', source: 'hola' });

    const detail = await deployments.getDeployment(created.deploymentId);
    const expectedHost = new URL(detail.url!).host;

    const identity = await readInstanceRecord(created.deploymentId);
    expect(identity.schema).toBe(1);
    expect(typeof identity.writtenBy).toBe('string');
    expect(identity.writtenBy.length).toBeGreaterThan(0);
    expect(typeof identity.writtenAt).toBe('string');
    expect(new Date(identity.writtenAt).toString()).not.toBe('Invalid Date');
    expect(identity.deploymentId).toBe(created.deploymentId);
    expect(identity.lineageId).toBe(created.deploymentId);
    expect(identity.app).toBe(APP_ID);
    expect(identity.appVersion).toBe('1.0.0');
    expect(identity.channel).toBe('stable');
    expect(identity.source).toBe('hola');
    expect(identity.name).toBe(APP_ID);
    expect(identity.subdomain).toBe(slugifySubdomain(APP_ID));
    expect(identity.host).toBe(expectedHost);
    expect(identity.accepts).toEqual(['backup@1']);
    expect(identity.participations).toEqual({});

    const env = await readEnvRecord(created.deploymentId);
    expect(env.schema).toBe(1);
    expect(env.deploymentId).toBe(created.deploymentId);
    expect(env.env).toEqual({});
  });

  // ---- Scenario 2 (T013, T025): permission modes ----
  test('instance.json is 0644 and env.json is 0600 (FR-005, FR-012)', async () => {
    const { deployments, drafts, jobs } = makeSystem();
    const created = await install(deployments, drafts, jobs, {});

    expect(await modeOf(join(holaDirFor(created.deploymentId), 'instance.json'))).toBe(0o644);
    expect(await modeOf(join(envDirFor(created.deploymentId), 'env.json'))).toBe(0o600);
  });

  // ---- Placement (#478 item 1): the reason this feature was amended ----
  //
  // `${HOLA_APP_DATA}` resolves to `<appsRoot>/<id>` and is bind-mounted into
  // the app's own containers (usually `/data`), so anything under it is
  // readable by the app itself — and by the end users of an app that serves,
  // syncs or browses its own data directory. `0600` is no defence: plenty of
  // images run as root. This is the assertion that fails if a future refactor
  // moves the env record back inside the mount, and it is deliberately a
  // RECURSIVE sweep rather than a check of one path: any location under the
  // data root is the defect, not just the old one.
  test('env.json is NOT anywhere under the app data root, and instance.json is (#478)', async () => {
    const { deployments, drafts, jobs } = makeSystem();
    const created = await install(deployments, drafts, jobs, {});
    const appRoot = join(appsRoot, created.deploymentId);

    const underAppRoot = await walk(appRoot);
    expect(underAppRoot).toContain(join('.hola', 'instance.json'));
    expect(underAppRoot.some((p) => p.endsWith('env.json'))).toBe(false);

    // And it does exist, at the sibling path — so the sweep above passing is
    // "it moved", never "it was never written".
    expect(existsSync(join(envDirFor(created.deploymentId), 'env.json'))).toBe(true);
  });

  // The record is `0600`, but a `0755` parent still lets any local user list
  // which installs exist by name. Both levels of the reserved sibling tree are
  // `0700`: `mkdir -p` would otherwise create the outer one under the umask.
  test('the env record directory and its reserved root are both 0700 (FR-012)', async () => {
    const { deployments, drafts, jobs } = makeSystem();
    const created = await install(deployments, drafts, jobs, {});

    expect(await modeOf(envDirFor(created.deploymentId))).toBe(0o700);
    expect(await modeOf(join(appsRoot, '.hola'))).toBe(0o700);
  });

  // A pre-upgrade snapshot tars the WHOLE app data root under the process
  // umask (`data.tar.gz`, world-readable `0644`) and keeps it to the retention
  // bound (#478 item 2). With the env record outside that root the archive
  // carries the secret-free identity record and nothing else of ours.
  test('a pre-upgrade snapshot tarball contains instance.json but no env.json (#478)', async () => {
    const { storage, deployments, drafts, jobs } = makeSystem();
    const created = await install(deployments, drafts, jobs, { version: '1.0.0' });
    // Real app data, so the snapshot is not skipped by the `dirHasContents`
    // guard (which ignores `.hola/`).
    await writeFile(join(appsRoot, created.deploymentId, 'real-data.txt'), 'payload');

    const draftId2 = await finalizedDraft(drafts, { version: '2.0.0' });
    const promoted = await deployments.promote(created.deploymentId, {
      draftId: draftId2,
      snapshot: true,
      options: { autoStart: true },
    });
    await waitForJob(jobs, promoted.jobId!);

    const snapshotsDir = join(dataRoot, 'deployments', created.deploymentId, 'snapshots');
    const snapshotIds = await storage.listDir(snapshotsDir);
    expect(snapshotIds.length).toBeGreaterThan(0);
    const tarPath = join(snapshotsDir, snapshotIds[0], 'data.tar.gz');
    expect(existsSync(tarPath)).toBe(true);

    const listed = await listTar(tarPath);
    expect(listed.some((e) => e.endsWith('real-data.txt'))).toBe(true);
    expect(listed.some((e) => e.endsWith('.hola/instance.json'))).toBe(true);
    expect(listed.some((e) => e.endsWith('env.json'))).toBe(false);
  });

  // The first write is the easy half. `fs.writeFile`'s `mode` option is
  // IGNORED when the file already exists, so a REWRITE is where a mode
  // silently rots — `RealStorageService.writeFile` re-asserts with an explicit
  // `chmod` after the atomic rename (`storage.ts:191-195`) precisely for this.
  // Widen both files to 0666 first so the assertion can only pass if the
  // rewrite actually re-applied the mode, rather than inheriting a mode that
  // happened to be right already. This matters most for env.json, which
  // carries secrets: a rewrite that left it 0666 would expose them to every
  // local reader with no visible symptom.
  test('a rewrite re-asserts 0644/0600 rather than inheriting the existing mode (FR-005, FR-012)', async () => {
    const { deployments, drafts, jobs } = makeSystem();
    const created = await install(deployments, drafts, jobs, {});
    const instancePath = join(holaDirFor(created.deploymentId), 'instance.json');
    const envDir = envDirFor(created.deploymentId);
    const envPath = join(envDir, 'env.json');

    await chmod(instancePath, 0o666);
    await chmod(envPath, 0o666);
    // `mkdir -p` never re-modes an existing directory either, so the env dir
    // needs the same re-assertion its file does.
    await chmod(envDir, 0o777);
    expect(await modeOf(envPath)).toBe(0o666);

    const action = await deployments.executeAction(created.deploymentId, { action: 'restart' });
    await waitForJob(jobs, action.jobId!);

    expect(await modeOf(instancePath)).toBe(0o644);
    expect(await modeOf(envPath)).toBe(0o600);
    expect(await modeOf(envDir)).toBe(0o700);
  });

  // ---- Scenario 3 (T029): fresh install lineageId === deploymentId ----
  test('a fresh install has lineageId === deploymentId (FR-008)', async () => {
    const { deployments, drafts, jobs } = makeSystem();
    const created = await install(deployments, drafts, jobs, {});

    const identity = await readInstanceRecord(created.deploymentId);
    expect(identity.lineageId).toBe(identity.deploymentId);
    expect(identity.lineageId).toBe(created.deploymentId);
  });

  // ---- Scenario 4 (T014): no ${HOLA_APP_DATA} -> no records, no directory at all ----
  test('an app with no ${HOLA_APP_DATA} gets no records and no data root (FR-015, SC-005)', async () => {
    const { deployments, drafts, jobs } = makeSystem();
    const created = await install(deployments, drafts, jobs, { compose: COMPOSE_NO_DATA });

    expect(existsSync(join(appsRoot, created.deploymentId))).toBe(false);
    // The env record moved out of the data root, so "no data root" is no
    // longer sufficient to prove "no records" — assert the sibling too.
    expect(existsSync(envDirFor(created.deploymentId))).toBe(false);
  });

  // `channel` is the FOLLOWED TRACK (data-model.md), and it is the one field
  // of the three release facts that changes without a new manifest: spec 005's
  // Join/Leave is a metadata-only `PATCH { channel }`. Reading `manifest.channel`
  // first (a draft-time seed) reports the channel the install was CREATED on
  // forever after a Join. Every other test installs and never joins, which is
  // exactly why the inverted precedence shipped green.
  test('a Join (PATCH channel) is reflected on the next materialization (data-model.md)', async () => {
    const { deployments, drafts, jobs } = makeSystem();
    const created = await install(deployments, drafts, jobs, { version: '1.0.0', channel: 'stable' });
    expect((await readInstanceRecord(created.deploymentId)).channel).toBe('stable');

    await deployments.updateDeployment(created.deploymentId, { channel: 'beta' });
    const action = await deployments.executeAction(created.deploymentId, { action: 'restart' });
    await waitForJob(jobs, action.jobId!);

    expect((await readInstanceRecord(created.deploymentId)).channel).toBe('beta');
  });

  // ---- Scenario 5 (T015): upgrade refreshes appVersion + writtenAt (FR-006, SC-006) ----
  test('an upgrade refreshes appVersion and advances writtenAt', async () => {
    const { deployments, drafts, jobs } = makeSystem();
    const created = await install(deployments, drafts, jobs, { version: '1.0.0' });
    const before = await readInstanceRecord(created.deploymentId);
    expect(before.appVersion).toBe('1.0.0');

    const draftId2 = await finalizedDraft(drafts, { version: '2.0.0' });
    const promoted = await deployments.promote(created.deploymentId, { draftId: draftId2, options: { autoStart: true } });
    await waitForJob(jobs, promoted.jobId!);

    const after = await readInstanceRecord(created.deploymentId);
    expect(after.appVersion).toBe('2.0.0');
    expect(new Date(after.writtenAt).getTime()).toBeGreaterThanOrEqual(new Date(before.writtenAt).getTime());
  });

  // ---- Scenario 6 (T030): lineageId unchanged across restart/promote/rollback (FR-009, SC-004) ----
  test('lineageId is unchanged across restart, promote and rollback', async () => {
    const { deployments, drafts, jobs } = makeSystem();
    const created = await install(deployments, drafts, jobs, { version: '1.0.0' });
    const lineageId = (await readInstanceRecord(created.deploymentId)).lineageId;

    // Restart.
    const restartAction = await deployments.executeAction(created.deploymentId, { action: 'restart' });
    await waitForJob(jobs, restartAction.jobId!);
    expect((await readInstanceRecord(created.deploymentId)).lineageId).toBe(lineageId);

    // Promote.
    const draftId2 = await finalizedDraft(drafts, { version: '2.0.0' });
    const promoted = await deployments.promote(created.deploymentId, { draftId: draftId2, options: { autoStart: true } });
    await waitForJob(jobs, promoted.jobId!);
    expect((await readInstanceRecord(created.deploymentId)).lineageId).toBe(lineageId);

    // Rollback (containers-only, no restoreData) to the first release.
    const rolledBack = await deployments.rollback(created.deploymentId, { targetReleaseId: created.releaseId });
    await waitForJob(jobs, rolledBack.jobId);
    expect((await readInstanceRecord(created.deploymentId)).lineageId).toBe(lineageId);
  });

  // ---- Scenarios 7-9 (T016): accepts + backup participations (research R6) ----
  test('accepts is recorded verbatim and plural backup participations are keyed by contract ref (FR-004)', async () => {
    acceptsConfig = ['backup@1'];
    backupConfig = [
      { id: 'app-db', preHook: { service: APP_ID, command: ['true'] } },
      { id: 'app-cache', preHook: { service: APP_ID, command: ['true'] } },
    ];
    const { deployments, drafts, jobs } = makeSystem();
    const created = await install(deployments, drafts, jobs, {});

    const identity = await readInstanceRecord(created.deploymentId);
    expect(identity.accepts).toEqual(['backup@1']);
    expect(identity.participations).toEqual({ 'backup@1': ['app-db', 'app-cache'] });
  });

  test('a legacy singular backup block records one participation named "default" (research R6)', async () => {
    backupConfig = { preHook: { service: APP_ID, command: ['true'] } };
    const { deployments, drafts, jobs } = makeSystem();
    const created = await install(deployments, drafts, jobs, {});

    const identity = await readInstanceRecord(created.deploymentId);
    expect(identity.participations).toEqual({ 'backup@1': ['default'] });
  });

  test('a manifest with no backup block omits the backup@1 key entirely (data-model.md)', async () => {
    backupConfig = undefined;
    const { deployments, drafts, jobs } = makeSystem();
    const created = await install(deployments, drafts, jobs, {});

    const identity = await readInstanceRecord(created.deploymentId);
    expect(Object.prototype.hasOwnProperty.call(identity.participations, 'backup@1')).toBe(false);
  });

  // data-model.md: the key is absent, "not present with an empty array". A
  // backup block can be PRESENT yet yield no participations, so gating on the
  // block's presence rather than on the normalised result writes
  // `{"backup@1": []}` — a record that claims the install is a backup@1
  // subject with zero participations, which is not the same fact as "declares
  // no backup". `backup: null` is reachable because the manifest is read with
  // `JSON.parse(...) as FinalizedManifest` and never runtime-validated.
  for (const [label, value] of [
    ['an empty plural array', [] as unknown],
    ['a singular block with no hooks', {} as unknown],
    ['an explicit null', null as unknown],
    ['plural entries that declare no hooks', [{ id: 'app-db' }] as unknown],
  ] as const) {
    test(`${label} omits the backup@1 key rather than writing an empty array (data-model.md)`, async () => {
      acceptsConfig = ['backup@1'];
      backupConfig = value as AppBackupDeclaration | undefined;
      const { deployments, drafts, jobs } = makeSystem();
      const created = await install(deployments, drafts, jobs, {});

      const identity = await readInstanceRecord(created.deploymentId);
      expect(identity.participations).toEqual({});
      expect(Object.prototype.hasOwnProperty.call(identity.participations, 'backup@1')).toBe(false);
    });
  }

  // ---- Scenario 10 (T026): env.json matches readActiveAppEnv, no provisioned OIDC values ----
  test('env.json carries the resolved app env and no provisioned OIDC values (data-model.md)', async () => {
    defaultEnv = [
      { key: 'SECRET_KEY', value: 'abc123', isSecret: true, description: 'x' },
      { key: 'TIMEZONE', value: 'UTC', isSecret: false, description: 'y' },
    ];
    const { deployments, drafts, jobs } = makeSystem();
    const created = await install(deployments, drafts, jobs, {});

    const env = await readEnvRecord(created.deploymentId);
    expect(env.env).toEqual({ SECRET_KEY: 'abc123', TIMEZONE: 'UTC' });
    expect(env.env).not.toHaveProperty('OIDC_CLIENT_ID');
    expect(env.env).not.toHaveProperty('OIDC_CLIENT_SECRET');
    expect(env.env).not.toHaveProperty('OIDC_ISSUER_URL');
  });

  // ---- Scenario 11 (T018): corrupt manifest — the highest-value test in the set ----
  test('a manifest that becomes corrupt during writeInstanceMarkers does not fail the deploy (FR-016, SC-007)', async () => {
    // A GENUINELY corrupt manifest.json fails a deploy long before
    // `writeInstanceMarkers` ever runs: `materializeCompose` reads the active
    // manifest, unguarded, several times before this feature's call site
    // (`readActiveIngressService` at the top, `mintContractEnv` right after) —
    // and that pre-existing, correctly-tested behaviour (see
    // corrupt-manifest.test.ts) is NOT this feature's to relax. What FR-016
    // actually promises is narrower: IF this feature's own manifest read
    // fails, THAT failure must not escape `writeInstanceMarkers`. This test
    // isolates exactly that by corrupting the manifest immediately before
    // calling the real `writeInstanceMarkers` and restoring it immediately
    // after — bracketing the corruption tightly around the one read this
    // feature owns, so every OTHER manifest read in the same materialize
    // pass still sees the good file and the deploy can genuinely succeed.
    const { storage, deployments, drafts, jobs } = makeSystem();
    const created = await install(deployments, drafts, jobs, { version: '1.0.0' });
    const before = await readInstanceRecord(created.deploymentId);

    const manifestPath = `deployments/${created.deploymentId}/releases/${created.releaseId}/manifest.json`;
    const goodManifest = await storage.readFileAsString(manifestPath);

    const svc = deployments as unknown as {
      writeInstanceMarkers: (...args: unknown[]) => Promise<void>;
      logger: { warn: (message: string, context?: unknown) => void };
    };
    const originalWriteMarkers = svc.writeInstanceMarkers.bind(deployments);
    svc.writeInstanceMarkers = async (...args: unknown[]) => {
      await storage.writeFile(manifestPath, '{ this is not valid json');
      try {
        await originalWriteMarkers(...args);
      } finally {
        await storage.writeFile(manifestPath, goodManifest);
      }
    };

    const warnings: Array<{ message: string; context?: unknown }> = [];
    const originalWarn = svc.logger.warn.bind(svc.logger);
    svc.logger.warn = (message: string, context?: unknown) => {
      warnings.push({ message, context });
      return originalWarn(message, context);
    };

    const action = await deployments.executeAction(created.deploymentId, { action: 'restart' });
    const job = await waitForJob(jobs, action.jobId!);

    expect(job.status).toBe('completed');
    expect(job.error).toBeFalsy();

    const markerWarnings = warnings.filter((w) => w.message.includes('install identity/environment records'));
    expect(markerWarnings).toHaveLength(1);
    expect(JSON.stringify(markerWarnings[0].context)).toContain(created.deploymentId);

    // Neither record was rewritten by the failed attempt — the good ones from
    // the first (uncorrupted) deploy are untouched.
    const after = await readInstanceRecord(created.deploymentId);
    expect(after.writtenAt).toBe(before.writtenAt);
  });

  // ---- Scenario 12 (T019): an unwritable record path — deploy survives (FR-016) ----
  //
  // The fault is injected by replacing `instance.json` with a DIRECTORY, not
  // by chmod-ing `.hola` unwritable. Two reasons, both about the test actually
  // proving something:
  //   1. `chmod 0500` does not stop root, and these tests run as root in some
  //      container images — there the write would simply SUCCEED and the
  //      assertions below (`job.status === 'completed'`) would hold for the
  //      wrong reason, making the test silently vacuous. `rename()` onto a
  //      directory is EISDIR for root too.
  //   2. It fails the `writeFile` itself (the atomic rename), which is the
  //      failure FR-016 is actually about, rather than the `ensureDir` before it.
  // Asserting the WARNING (not just that the deploy survived) is what
  // distinguishes "the failure path ran and was swallowed" from "nothing went
  // wrong at all" — without it the test passes even if no write was attempted.
  test('a write failure on a record does not fail the deploy and warns naming the install (FR-016)', async () => {
    const { deployments, drafts, jobs } = makeSystem();
    const created = await install(deployments, drafts, jobs, {});
    const instancePath = join(holaDirFor(created.deploymentId), 'instance.json');

    await rm(instancePath, { force: true });
    await mkdir(instancePath); // rename(temp, instancePath) -> EISDIR, for any uid

    const svc = deployments as unknown as { logger: { warn: (message: string, context?: unknown) => void } };
    const warnings: Array<{ message: string; context?: unknown }> = [];
    const originalWarn = svc.logger.warn.bind(svc.logger);
    svc.logger.warn = (message: string, context?: unknown) => {
      warnings.push({ message, context });
      return originalWarn(message, context);
    };

    const action = await deployments.executeAction(created.deploymentId, { action: 'restart' });
    const job = await waitForJob(jobs, action.jobId!);
    expect(job.status).toBe('completed');
    expect(job.error).toBeFalsy();

    const markerWarnings = warnings.filter((w) => w.message.includes('install identity/environment records'));
    expect(markerWarnings).toHaveLength(1);
    expect(JSON.stringify(markerWarnings[0].context)).toContain(created.deploymentId);

    // The warn context must name the install and nothing else — an error
    // message plus the deployment id. `env.json` carries secrets, so a context
    // that ever grew to include record content would leak them into the log.
    expect(JSON.stringify(markerWarnings[0].context)).not.toContain('SECRET');
  });

  // FR-016's other half: an `ensureDir` failure (the FIRST statement inside the
  // helper's try) must be swallowed too, not just a `writeFile` failure. A
  // catch that started after the ensureDir would let this one fail the deploy.
  test('an unusable .hola path does not fail the deploy (FR-016)', async () => {
    const { deployments, drafts, jobs } = makeSystem();
    const created = await install(deployments, drafts, jobs, {});
    const holaDir = holaDirFor(created.deploymentId);

    await rm(holaDir, { recursive: true, force: true });
    await writeFile(holaDir, 'not a directory'); // mkdir -p over a file -> ENOTDIR/EEXIST

    const svc = deployments as unknown as { logger: { warn: (message: string, context?: unknown) => void } };
    const warnings: string[] = [];
    const originalWarn = svc.logger.warn.bind(svc.logger);
    svc.logger.warn = (message: string, context?: unknown) => {
      warnings.push(message);
      return originalWarn(message, context);
    };

    const action = await deployments.executeAction(created.deploymentId, { action: 'restart' });
    const job = await waitForJob(jobs, action.jobId!);
    expect(job.status).toBe('completed');
    expect(job.error).toBeFalsy();
    // Without this the test passes even if `ensureDir` quietly succeeded and
    // nothing was ever exercised.
    expect(warnings.filter((m) => m.includes('install identity/environment records'))).toHaveLength(1);
  });

  // ---- Scenario 13 (T017): second deploy replaces atomically, no temp file left (FR-019, SC-009) ----
  test('a second deploy replaces both records with no temp file left behind (FR-019, SC-009)', async () => {
    const { deployments, drafts, jobs } = makeSystem();
    const created = await install(deployments, drafts, jobs, {});

    const restartAction = await deployments.executeAction(created.deploymentId, { action: 'restart' });
    await waitForJob(jobs, restartAction.jobId!);

    // Both directories, because the two records no longer share one.
    const markerEntries = (await readdir(holaDirFor(created.deploymentId))).sort();
    expect(markerEntries).toEqual(['instance.json']);
    const envEntries = (await readdir(envDirFor(created.deploymentId))).sort();
    expect(envEntries).toEqual(['env.json']);
    expect([...markerEntries, ...envEntries].some((e) => e.includes('.tmp.'))).toBe(false);
  });

  // ---- Scenario 14 (T020): delete both record dirs, redeploy -> records reappear (FR-017, SC-001) ----
  test('deleting both record directories and redeploying recreates them with no operator action (FR-017, SC-001)', async () => {
    const { deployments, drafts, jobs } = makeSystem();
    const created = await install(deployments, drafts, jobs, {});
    const holaDir = holaDirFor(created.deploymentId);
    const envDir = envDirFor(created.deploymentId);
    await rm(holaDir, { recursive: true, force: true });
    await rm(envDir, { recursive: true, force: true });
    expect(existsSync(holaDir)).toBe(false);
    expect(existsSync(envDir)).toBe(false);

    const action = await deployments.executeAction(created.deploymentId, { action: 'restart' });
    await waitForJob(jobs, action.jobId!);

    expect(existsSync(join(holaDir, 'instance.json'))).toBe(true);
    expect(existsSync(join(envDir, 'env.json'))).toBe(true);
  });

  // ---- Scenario 15 (T021): data-aware rollback rewrites records for the release
  //      being brought up, never the one rolled away from (FR-006, SC-010) ----
  test('a data-aware rollback rewrites both records for the release actually brought up, not the one rolled away from', async () => {
    const { deployments, drafts, jobs } = makeSystem();
    const created = await install(deployments, drafts, jobs, { version: '1.0.0' });
    const v1ReleaseId = created.releaseId;
    const v1Before = await readInstanceRecord(created.deploymentId);
    expect(v1Before.appVersion).toBe('1.0.0');

    // Promote to v2 WITH a pre-upgrade snapshot: this captures v1's data root
    // (its .hola/ included) BEFORE switching to v2.
    const draftId2 = await finalizedDraft(drafts, { version: '2.0.0' });
    const promoted = await deployments.promote(created.deploymentId, {
      draftId: draftId2,
      snapshot: true,
      options: { autoStart: true },
    });
    await waitForJob(jobs, promoted.jobId!);
    const v2 = await readInstanceRecord(created.deploymentId);
    expect(v2.appVersion).toBe('2.0.0');

    // Roll back to v1 WITH restoreData: true. The lifecycle job wipes and
    // replaces the whole data root from the v1 snapshot (which carries v1's
    // OLD record, with the OLD writtenAt) BEFORE materializeCompose reruns
    // for the release actually being brought up (v1) — see deployment.ts
    // ~:3410 (restore) before ~:3414 (materialize). If a refactor ever hoists
    // the marker write earlier in the lifecycle job, the freshly-written
    // record would be wiped by the restore and this test would see the STALE
    // writtenAt from the snapshot survive, rather than a fresh one.
    const rolledBack = await deployments.rollback(created.deploymentId, {
      targetReleaseId: v1ReleaseId,
      restoreData: true,
    });
    const job = await waitForJob(jobs, rolledBack.jobId);
    expect(job.status).toBe('completed');

    const afterRollback = await readInstanceRecord(created.deploymentId);
    expect(afterRollback.appVersion).toBe('1.0.0');
    expect(new Date(afterRollback.writtenAt).getTime()).toBeGreaterThan(new Date(v1Before.writtenAt).getTime());
  });

  // ---- Scenario 16 (T027): reconfiguration updates env.json (FR-013) ----
  test('reconfiguring the app env updates env.json on the next materialization (FR-013)', async () => {
    defaultEnv = [{ key: 'FOO', value: 'one', isSecret: false, description: '' }];
    const { deployments, drafts, jobs } = makeSystem();
    const created = await install(deployments, drafts, jobs, { version: '1.0.0' });
    expect((await readEnvRecord(created.deploymentId)).env).toEqual({ FOO: 'one' });

    defaultEnv = [{ key: 'FOO', value: 'two', isSecret: false, description: '' }];
    const draftId2 = await finalizedDraft(drafts, { version: '1.0.0' });
    const promoted = await deployments.promote(created.deploymentId, { draftId: draftId2, options: { autoStart: true } });
    await waitForJob(jobs, promoted.jobId!);

    expect((await readEnvRecord(created.deploymentId)).env).toEqual({ FOO: 'two' });
  });

  // ---- Scenario 17 (T032): uninstall removes BOTH locations ----
  //
  // The env record is deliberately outside the data root, so a `removeAppData`
  // that only deleted the data root would leave one directory of secrets
  // behind per app ever uninstalled — orphaned forever, since nothing else
  // knows the deployment id afterwards (#478).
  test('uninstall removes both the data root and the sibling env record, leaving no orphan (edge case)', async () => {
    const { deployments, drafts, jobs } = makeSystem();
    const created = await install(deployments, drafts, jobs, {});
    const appRoot = join(appsRoot, created.deploymentId);
    const envDir = envDirFor(created.deploymentId);
    expect(existsSync(join(appRoot, '.hola', 'instance.json'))).toBe(true);
    expect(existsSync(join(envDir, 'env.json'))).toBe(true);

    await deployments.deleteDeployment(created.deploymentId);

    expect(existsSync(appRoot)).toBe(false);
    expect(existsSync(envDir)).toBe(false);
    // Nothing of this install survives anywhere under the apps bind root. The
    // reserved `.hola/` root itself is shared and stays.
    const remaining = await walk(appsRoot);
    expect(remaining.some((p) => p.includes(created.deploymentId))).toBe(false);
    expect(remaining.some((p) => p.endsWith('env.json'))).toBe(false);
  });

  // The sibling directory outlives its data root if uninstall consults only
  // the data root's existence. Delete the data root by hand first, so the
  // env-record delete is reached on its own.
  test('uninstall removes the env record even when the data root is already gone (#478)', async () => {
    const { deployments, drafts, jobs } = makeSystem();
    const created = await install(deployments, drafts, jobs, {});
    const appRoot = join(appsRoot, created.deploymentId);
    const envDir = envDirFor(created.deploymentId);
    await rm(appRoot, { recursive: true, force: true });

    await deployments.deleteDeployment(created.deploymentId);

    expect(existsSync(envDir)).toBe(false);
  });

  // An install that declares no `${HOLA_APP_DATA}` gets neither record, so
  // uninstall must create nothing and warn about nothing.
  test('uninstalling an app with no data root touches neither location (FR-015)', async () => {
    const { deployments, drafts, jobs } = makeSystem();
    const created = await install(deployments, drafts, jobs, { compose: COMPOSE_NO_DATA });
    expect(existsSync(envDirFor(created.deploymentId))).toBe(false);

    await deployments.deleteDeployment(created.deploymentId);

    expect(existsSync(join(appsRoot, created.deploymentId))).toBe(false);
    expect(existsSync(envDirFor(created.deploymentId))).toBe(false);
  });
});
