/**
 * Manifest-declared push targets (#409).
 *
 * `getPushTargets` resolves an app's declared `push[]` paths against the
 * deployment's data root and hands the CLI absolute host paths. Because those
 * paths come from a *catalog* manifest and a push is a write primitive, the
 * containment check is the security boundary — hence the dedicated
 * escape-attempt tests below (`..`, absolute, and a symlink planted inside the
 * data root). An escaping target is dropped from the listing, not returned.
 *
 * These tests also guard the manifest thread-through end to end: the target is
 * declared only in the stub catalog's version detail, so it can only reach
 * `getPushTargets` by surviving every draft/finalize hop.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, symlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import type { AppPushTarget } from '@hola/shared';
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

let pushConfig: AppPushTarget[] | undefined;

function makeCatalog(): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'Library App', icon: '📚' }),
    getVersionDetail: async () => ({
      defaultEnv: [],
      defaults: { ports: [{ host: 3000, container: 3000, protocol: 'tcp' as const }], volumes: [] },
      push: pushConfig,
    }),
  } as unknown as CatalogArg;
}

function makeValidation(): ValidationArg {
  return {
    validateDraft: async () => ({ ok: true, errors: [], warnings: [] }),
    preflightCheck: async () => ({ ok: true, checks: [] }),
  } as unknown as ValidationArg;
}

const COMPOSE = 'services:\n  app:\n    image: app:latest\n';

/** Records composeExec calls; can be told to fail a given service's exec. */
class RecordingDocker extends MockDockerService {
  calls: Array<{ service: string; command: string[] }> = [];
  failService?: string;
  override async composeExec(projectPath: string, projectName: string, service: string, command: string[]) {
    this.calls.push({ service, command });
    if (this.failService === service) return { success: false, output: `boom in ${service}` };
    return super.composeExec(projectPath, projectName, service, command);
  }
}

describe('Push targets (#409)', () => {
  let dataRoot: string;
  let appsRoot: string;
  let outsideRoot: string;
  let prevAppsBindRoot: string | undefined;
  let docker: RecordingDocker;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-push-data-'));
    appsRoot = await mkdtemp(join(tmpdir(), 'hola-push-apps-'));
    outsideRoot = await mkdtemp(join(tmpdir(), 'hola-push-outside-'));
    prevAppsBindRoot = process.env.HOLA_APPS_BIND_ROOT;
    process.env.HOLA_APPS_BIND_ROOT = appsRoot;
    pushConfig = undefined;
    docker = new RecordingDocker();
  });

  afterEach(async () => {
    if (prevAppsBindRoot === undefined) delete process.env.HOLA_APPS_BIND_ROOT;
    else process.env.HOLA_APPS_BIND_ROOT = prevAppsBindRoot;
    await rm(dataRoot, { recursive: true, force: true });
    await rm(appsRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  });

  function makeSystem() {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage);
    const logging = new RealLoggingService(storage);
    const jobs = new RealJobService(database, logging);
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const drafts = new RealDraftService(storage, makeCatalog(), makeValidation());
    const deployments = new RealDeploymentService(storage, jobs, docker, drafts, routing, logging, new MockProvisionerService());
    return { drafts, deployments };
  }

  /** Install an app whose manifest declares `targets`, and return its id. */
  async function install(targets: AppPushTarget[] | undefined): Promise<{ deployments: RealDeploymentService; deploymentId: string }> {
    pushConfig = targets;
    const { drafts, deployments } = makeSystem();
    const { draftId } = await drafts.createDraft({ appId: 'libapp', version: '1.0.0' });
    await drafts.updateDraft(draftId, { composeOverride: COMPOSE });
    await drafts.finalizeDraft(draftId);
    const dep = await deployments.createFromDraft({ draftId, name: 'libapp', options: { autoStart: false } });
    return { deployments, deploymentId: dep.deploymentId };
  }

  const LIBRARY: AppPushTarget = {
    id: 'library',
    label: 'Calibre library',
    description: 'metadata.db plus the book folders',
    path: 'books',
    mode: 'mirror',
    quiesce: 'stop',
  };

  test('resolves a declared target to an absolute path under the app data root', async () => {
    const { deployments, deploymentId } = await install([LIBRARY]);

    const { targets } = await deployments.getPushTargets(deploymentId);

    expect(targets).toEqual([
      {
        id: 'library',
        label: 'Calibre library',
        description: 'metadata.db plus the book folders',
        destPath: join(appsRoot, deploymentId, 'books'),
        mode: 'mirror',
        quiesce: 'stop',
        hasPostHook: false,
      },
    ]);
  });

  test('applies the mode/quiesce defaults and flags a postHook', async () => {
    const { deployments, deploymentId } = await install([
      { id: 'media', label: 'Media', path: 'data/media', postHook: { service: 'app', command: ['reindex'] } },
    ]);

    const { targets } = await deployments.getPushTargets(deploymentId);

    expect(targets).toHaveLength(1);
    expect(targets[0].mode).toBe('additive');
    expect(targets[0].quiesce).toBe('none');
    expect(targets[0].hasPostHook).toBe(true);
    expect(targets[0].description).toBeUndefined();
  });

  test('an app declaring no push block has no targets', async () => {
    const { deployments, deploymentId } = await install(undefined);
    expect((await deployments.getPushTargets(deploymentId)).targets).toEqual([]);
  });

  test('an unknown deployment is a 404', async () => {
    const { deployments } = await install([LIBRARY]);
    await expect(deployments.getPushTargets('no-such-deployment')).rejects.toThrow();
  });

  // --- Containment: the security boundary (#409) -----------------------------

  test('drops a target whose path climbs out with ..', async () => {
    // The coercer normally catches this; declare it past the coercer to prove
    // the service refuses on its own.
    const { deployments, deploymentId } = await install([{ ...LIBRARY, path: '../other-app' }]);
    expect((await deployments.getPushTargets(deploymentId)).targets).toEqual([]);
  });

  test('drops a target whose path is absolute', async () => {
    const { deployments, deploymentId } = await install([{ ...LIBRARY, path: '/etc' }]);
    expect((await deployments.getPushTargets(deploymentId)).targets).toEqual([]);
  });

  test('drops a target whose path is a symlink escaping the data root', async () => {
    const { deployments, deploymentId } = await install([LIBRARY]);

    // Plant `<appRoot>/books -> <somewhere outside>`. The declared path is an
    // honest relative `books`, so only following the link catches this.
    const appRoot = join(appsRoot, deploymentId);
    await mkdir(appRoot, { recursive: true });
    await symlink(outsideRoot, join(appRoot, 'books'), 'dir');

    expect((await deployments.getPushTargets(deploymentId)).targets).toEqual([]);
  });

  test('keeps a target reached through a symlink that stays inside the data root', async () => {
    const { deployments, deploymentId } = await install([LIBRARY]);

    const appRoot = join(appsRoot, deploymentId);
    await mkdir(join(appRoot, 'real-books'), { recursive: true });
    await symlink(join(appRoot, 'real-books'), join(appRoot, 'books'), 'dir');

    const { targets } = await deployments.getPushTargets(deploymentId);
    expect(targets).toHaveLength(1);
    expect(targets[0].destPath).toBe(join(appRoot, 'books'));
  });

  test('drops only the escaping target, leaving the honest ones listable', async () => {
    const { deployments, deploymentId } = await install([
      { id: 'escape', label: 'Escape', path: '../../etc' },
      LIBRARY,
    ]);

    const { targets } = await deployments.getPushTargets(deploymentId);
    expect(targets.map((t) => t.id)).toEqual(['library']);
  });

  // --- postHook -------------------------------------------------------------

  test('runs the declared postHook in the app container', async () => {
    const { deployments, deploymentId } = await install([
      { ...LIBRARY, postHook: { service: 'app', command: ['sh', '-c', 'reconnect'] } },
    ]);

    const res = await deployments.runPushHook(deploymentId, 'library');

    expect(res.ok).toBe(true);
    expect(docker.calls).toContainEqual({ service: 'app', command: ['sh', '-c', 'reconnect'] });
  });

  test('a target with no postHook is a no-op success', async () => {
    const { deployments, deploymentId } = await install([LIBRARY]);

    expect(await deployments.runPushHook(deploymentId, 'library')).toEqual({ ok: true });
    expect(docker.calls).toHaveLength(0);
  });

  test('a failing postHook reports ok:false with its output rather than throwing', async () => {
    docker.failService = 'app';
    const { deployments, deploymentId } = await install([
      { ...LIBRARY, postHook: { service: 'app', command: ['reindex'] } },
    ]);

    const res = await deployments.runPushHook(deploymentId, 'library');

    expect(res.ok).toBe(false);
    expect(res.output).toContain('boom in app');
  });

  test('an unknown target id is an error', async () => {
    const { deployments, deploymentId } = await install([LIBRARY]);
    await expect(deployments.runPushHook(deploymentId, 'nope')).rejects.toThrow(/nope/);
  });

  test('a target dropped for escaping containment cannot have its hook run', async () => {
    const { deployments, deploymentId } = await install([
      { ...LIBRARY, path: '../other-app', postHook: { service: 'app', command: ['reindex'] } },
    ]);

    await expect(deployments.runPushHook(deploymentId, 'library')).rejects.toThrow();
    expect(docker.calls).toHaveLength(0);
  });
});
