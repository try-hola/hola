/**
 * Auth provisioning lifecycle tests (epic #89, PR1).
 *
 * Verifies that when a catalog app declares a `native-oidc` auth block, the
 * deploy lifecycle provisions an OIDC client, injects the returned env into the
 * materialized compose (ingress service), persists the provisioned ref, reuses
 * it on re-deploy, tears it down on delete (but not on stop), and fails the
 * deploy cleanly when provisioning fails. Uses a spy provisioner — no network.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { parse } from 'yaml';

import { RealDeploymentService } from '../../services/core/deployment';
import { RealDraftService } from '../../services/core/draft';
import { RealStorageService } from '../../services/core/storage';
import { RealRoutingService } from '../../services/core/routing';
import { RealDatabaseService } from '../../services/core/database';
import { RealLoggingService } from '../../services/core/logging';
import { RealJobService } from '../../services/core/jobs';
import { MockDockerService, type DockerService } from '../../services/core/docker';
import { ProvisioningError } from '../../middleware/error-mapping';
import type {
  ProvisionerService,
  ProvisionInput,
  ProvisionResult,
  DeprovisionInput,
} from '../../services/core/provisioner';
import type { AppAuthConfig } from '@hola/shared';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

const OIDC_AUTH: AppAuthConfig = {
  mode: 'native-oidc',
  oidc: {
    redirectPath: '/user/oauth2/authentik/callback',
    scopes: ['openid', 'profile', 'email'],
    env: {
      issuer: 'GITEA_OIDC_ISSUER',
      clientId: 'GITEA_OIDC_CLIENT_ID',
      clientSecret: 'GITEA_OIDC_CLIENT_SECRET',
      redirectUri: 'GITEA_OIDC_REDIRECT',
    },
  },
};

function makeCatalog(auth?: AppAuthConfig): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'Gitea', icon: '🍵' }),
    getVersionDetail: async () => ({
      defaultEnv: [],
      defaults: { ports: [{ host: 3000, container: 3000, protocol: 'tcp' as const }], volumes: [] },
      auth,
    }),
  } as unknown as CatalogArg;
}

function makeValidation(): ValidationArg {
  return {
    validateDraft: async () => ({ ok: true, errors: [], warnings: [] }),
    preflightCheck: async () => ({ ok: true, checks: [] }),
  } as unknown as ValidationArg;
}

const COMPOSE = 'services:\n  gitea:\n    image: gitea/gitea:1.21.0\n';

/** Records every provision/deprovision call; can be told to fail the next provision. */
class SpyProvisioner implements ProvisionerService {
  provisions: ProvisionInput[] = [];
  deprovisions: DeprovisionInput[] = [];
  failNext = false;

  async healthCheck() {
    return { healthy: true, lastCheck: new Date() };
  }

  async provision(input: ProvisionInput): Promise<ProvisionResult> {
    this.provisions.push(input);
    if (this.failNext) throw new ProvisioningError('simulated provisioning failure');
    if (input.mode === 'native-oidc' && input.oidc) {
      const names = input.oidc.env;
      return {
        env: {
          [names.issuer]: 'https://auth.example.com/application/o/gitea-x/',
          [names.clientId]: 'cid-123',
          [names.clientSecret]: 'csecret-456',
          [names.redirectUri]: `https://${input.host}${input.oidc.redirectPath}`,
        },
        ref: input.existingRef ?? { mode: 'native-oidc', providerPk: 42, applicationSlug: 'gitea-x', clientId: 'cid-123' },
      };
    }
    return { env: {}, ref: { mode: input.mode } };
  }

  async deprovision(input: DeprovisionInput): Promise<void> {
    this.deprovisions.push(input);
  }
}

async function waitForJob(jobs: RealJobService, id: string, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const job = await jobs.getJob(id);
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    if (Date.now() - start > timeoutMs) throw new Error(`Job ${id} did not finish (last status: ${job?.status})`);
    await new Promise(r => setTimeout(r, 10));
  }
}

describe('Auth provisioning lifecycle', () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-auth-'));
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  function makeSystem(opts: { auth?: AppAuthConfig; provisioner?: ProvisionerService; docker?: DockerService } = {}) {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage);
    const logging = new RealLoggingService(storage);
    const jobs = new RealJobService(database, logging);
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const drafts = new RealDraftService(storage, makeCatalog(opts.auth), makeValidation());
    const provisioner = opts.provisioner ?? new SpyProvisioner();
    const docker = opts.docker ?? new MockDockerService();
    const deployments = new RealDeploymentService(storage, jobs, docker, drafts, routing, logging, provisioner);
    return { storage, jobs, drafts, deployments, provisioner };
  }

  async function finalizedDraft(drafts: RealDraftService): Promise<string> {
    const { draftId } = await drafts.createDraft({ appId: 'gitea', version: '1.0.0' });
    await drafts.updateDraft(draftId, { composeOverride: COMPOSE });
    await drafts.finalizeDraft(draftId);
    return draftId;
  }

  async function readMaterializedEnv(storage: RealStorageService, deploymentId: string): Promise<Record<string, unknown>> {
    const raw = await storage.readFileAsString(`deployments/${deploymentId}/runtime/docker-compose.yml`);
    const doc = parse(raw) as { services?: Record<string, { environment?: Record<string, unknown> }> };
    return doc.services?.gitea?.environment ?? {};
  }

  test('native-oidc: provisions, injects env into the ingress service, persists the ref', async () => {
    const sys = makeSystem({ auth: OIDC_AUTH });
    const spy = sys.provisioner as SpyProvisioner;

    const created = await sys.deployments.createFromDraft({ draftId: await finalizedDraft(sys.drafts), name: 'gitea' });
    const job = await waitForJob(sys.jobs, created.jobId!);
    expect(job.status).toBe('completed');

    // Provisioner was called once with the app's host + oidc mapping.
    expect(spy.provisions).toHaveLength(1);
    expect(spy.provisions[0].mode).toBe('native-oidc');
    expect(spy.provisions[0].host).toBe('gitea.local.hola');
    expect(spy.provisions[0].existingRef).toBeUndefined();

    // Env was injected onto the ingress service under the app's expected names.
    const env = await readMaterializedEnv(sys.storage, created.deploymentId);
    expect(env.GITEA_OIDC_CLIENT_ID).toBe('cid-123');
    expect(env.GITEA_OIDC_CLIENT_SECRET).toBe('csecret-456');
    expect(env.GITEA_OIDC_REDIRECT).toBe('https://gitea.local.hola/user/oauth2/authentik/callback');
    expect(env.GITEA_OIDC_ISSUER).toBe('https://auth.example.com/application/o/gitea-x/');

    // The provisioned ref is persisted on the deployment metadata.
    const meta = JSON.parse(await sys.storage.readFileAsString(`deployments/${created.deploymentId}/metadata.json`));
    expect(meta.metadata.auth.mode).toBe('native-oidc');
    expect(meta.metadata.auth.ref.providerPk).toBe(42);
  });

  test('no auth block: deploys normally with no provisioning and no injected env', async () => {
    const sys = makeSystem({ auth: undefined });
    const spy = sys.provisioner as SpyProvisioner;

    const created = await sys.deployments.createFromDraft({ draftId: await finalizedDraft(sys.drafts), name: 'gitea' });
    expect((await waitForJob(sys.jobs, created.jobId!)).status).toBe('completed');

    expect(spy.provisions).toHaveLength(0);
    expect(await readMaterializedEnv(sys.storage, created.deploymentId)).toEqual({});
  });

  test('re-deploy reuses the existing ref (idempotent, keyed on deploymentId)', async () => {
    const sys = makeSystem({ auth: OIDC_AUTH });
    const spy = sys.provisioner as SpyProvisioner;

    const created = await sys.deployments.createFromDraft({ draftId: await finalizedDraft(sys.drafts), name: 'gitea' });
    await waitForJob(sys.jobs, created.jobId!);

    // A restart re-runs the deploy path and must reuse the same client.
    const restart = await sys.deployments.executeAction(created.deploymentId, { action: 'restart' });
    await waitForJob(sys.jobs, restart.jobId!);

    expect(spy.provisions).toHaveLength(2);
    expect(spy.provisions[1].existingRef?.providerPk).toBe(42);
  });

  test('deprovision runs on delete but not on stop', async () => {
    const sys = makeSystem({ auth: OIDC_AUTH });
    const spy = sys.provisioner as SpyProvisioner;

    const created = await sys.deployments.createFromDraft({ draftId: await finalizedDraft(sys.drafts), name: 'gitea' });
    await waitForJob(sys.jobs, created.jobId!);

    // Stop does NOT tear down the auth client.
    const stop = await sys.deployments.executeAction(created.deploymentId, { action: 'stop' });
    await waitForJob(sys.jobs, stop.jobId!);
    expect(spy.deprovisions).toHaveLength(0);

    // Delete DOES, with the persisted ref.
    await sys.deployments.deleteDeployment(created.deploymentId);
    expect(spy.deprovisions).toHaveLength(1);
    expect(spy.deprovisions[0].ref?.providerPk).toBe(42);
  });

  test('provisioning failure fails the deploy before any container starts', async () => {
    const spy = new SpyProvisioner();
    spy.failNext = true;
    const sys = makeSystem({ auth: OIDC_AUTH, provisioner: spy });

    const created = await sys.deployments.createFromDraft({ draftId: await finalizedDraft(sys.drafts), name: 'gitea' });
    const job = await waitForJob(sys.jobs, created.jobId!);

    expect(job.status).toBe('failed');
    expect((await sys.deployments.getDeployment(created.deploymentId)).status).toBe('error');
    // No compose was materialized (provisioning threw first).
    expect(await sys.storage.fileExists(`deployments/${created.deploymentId}/runtime/docker-compose.yml`)).toBe(false);
  });

  test('delete tolerates a deprovision failure (orphan logged, delete proceeds)', async () => {
    const failingDeprovision = new (class extends SpyProvisioner {
      override async deprovision(input: DeprovisionInput): Promise<void> {
        await super.deprovision(input);
        throw new ProvisioningError('simulated deprovision failure');
      }
    })();
    const sys = makeSystem({ auth: OIDC_AUTH, provisioner: failingDeprovision });

    const created = await sys.deployments.createFromDraft({ draftId: await finalizedDraft(sys.drafts), name: 'gitea' });
    await waitForJob(sys.jobs, created.jobId!);

    await sys.deployments.deleteDeployment(created.deploymentId);
    // Deletion completed despite the deprovision error.
    expect(failingDeprovision.deprovisions).toHaveLength(1);
    await expect(sys.deployments.getDeployment(created.deploymentId)).rejects.toThrow();
  });
});
