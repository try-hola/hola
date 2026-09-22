/**
 * F01 (deployment side) — an app's values reach Compose through the generated
 * `runtime/.env`, and the orchestrator's own environment reaches it not at all.
 *
 * Compose interpolates `${VAR}` in the app's compose file from two sources: the
 * invoking process's environment, and the `.env` file in the project directory.
 * The platform now supplies the second and withholds the first (see
 * `appComposeEnv` in services/core/docker.ts), so this suite pins the half that
 * must keep working: an ordinary `appEnv` value is written to the `runtime/.env`
 * of the very project directory the lifecycle runs Compose in, while a dummy
 * platform credential present in the server's own environment appears nowhere in
 * the materialized runtime.
 *
 * The credential values below are dummies that exist only inside this test.
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

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

const LEAKY_VARS: Record<string, string> = {
  HOLA_AUTHENTIK_BOOTSTRAP_TOKEN: 'dummy-bootstrap-should-never-leak',
  HOLA_AUTHENTIK_API_TOKEN: 'dummy-provisioner-should-never-leak',
  HOLA_API_KEY: 'dummy-admin-key-should-never-leak',
};

function makeCatalog(): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'Wiki', icon: '📚' }),
    getVersionDetail: async () => ({
      version: '1.0.0',
      defaultEnv: [
        { key: 'APP_SETTING', value: 'hello from the app', isSecret: false },
        { key: 'DB_PASSWORD', value: 'dummy-app-password', isSecret: true },
      ],
      defaults: { ports: [], volumes: [] },
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
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('F01: app env arrives via runtime/.env, platform credentials arrive nowhere', () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-f01-'));
    for (const [key, value] of Object.entries(LEAKY_VARS)) process.env[key] = value;
  });

  afterEach(async () => {
    for (const key of Object.keys(LEAKY_VARS)) delete process.env[key];
    await rm(dataRoot, { recursive: true, force: true });
  });

  test('an ordinary app env value lands in the project dir Compose runs in; no platform credential does', async () => {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage);
    const logging = new RealLoggingService(storage);
    const jobs = new RealJobService(database, logging);
    const routing = new RealRoutingService(storage, { baseDomain: 'example.com' });
    const drafts = new RealDraftService(storage, makeCatalog(), makeValidation(), undefined, routing);
    const docker = new MockDockerService();
    // NoneProvisionerService: nothing injects extra env, so what lands in
    // `.env` is exactly what the app itself asked for.
    const deployments = new RealDeploymentService(
      storage, jobs, docker, drafts, routing, logging, new NoneProvisionerService(),
    );

    const { draftId } = await drafts.createDraft({ appId: 'wiki', version: '1.0.0' });
    await drafts.updateDraft(draftId, {
      // A hostile app: it asks Compose for a platform credential by name.
      composeOverride: [
        'services:',
        '  wiki:',
        '    image: wiki:1.0.0',
        '    environment:',
        '      APP_SETTING: "${APP_SETTING}"',
        '      STOLEN: "${HOLA_AUTHENTIK_BOOTSTRAP_TOKEN}"',
        '',
      ].join('\n'),
    });
    await drafts.finalizeDraft(draftId);

    const created = await deployments.createFromDraft({ draftId, name: 'wiki' });
    const job = await waitForJob(jobs, created.jobId!);
    expect(job.status).toBe('completed');

    // The lifecycle ran Compose in the runtime dir whose `.env` we assert on —
    // Compose auto-loads `.env` from the project directory, so this is the one
    // path an app value now travels.
    const upCall = docker.composeCalls.find(c => c.command === 'up');
    expect(upCall).toBeDefined();
    expect(upCall!.projectPath.endsWith(`deployments/${created.deploymentId}/runtime`)).toBe(true);

    const dotenv = await storage.readFileAsString(`deployments/${created.deploymentId}/runtime/.env`);
    expect(dotenv).toContain('APP_SETTING="hello from the app"');
    expect(dotenv).toContain('DB_PASSWORD="dummy-app-password"');

    // The app's `${HOLA_AUTHENTIK_BOOTSTRAP_TOKEN}` reference resolves to nothing:
    // it is not in the generated `.env`, and (see __tests__/docker/compose-env.test.ts)
    // not in the environment the compose child is given either.
    const runtimeCompose = await storage.readFileAsString(
      `deployments/${created.deploymentId}/runtime/docker-compose.yml`,
    );
    for (const value of Object.values(LEAKY_VARS)) {
      expect(dotenv).not.toContain(value);
      expect(runtimeCompose).not.toContain(value);
    }
    expect(dotenv).not.toContain('HOLA_AUTHENTIK_BOOTSTRAP_TOKEN=');
  });
});
