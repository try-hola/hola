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
      const redirectUri = `https://${input.host}${input.oidc.redirectPath}`;
      const issuer = 'https://auth.example.com/application/o/gitea-x/';
      const names = input.oidc.env;
      const env = names
        ? {
            [names.issuer]: issuer,
            [names.clientId]: 'cid-123',
            [names.clientSecret]: 'csecret-456',
            ...(names.redirectUri ? { [names.redirectUri]: redirectUri } : {}),
          }
        : {};
      return {
        env,
        credentials: { clientId: 'cid-123', clientSecret: 'csecret-456', issuer, redirectUri },
        ref: input.existingRef ?? { mode: 'native-oidc', providerPk: 42, applicationSlug: 'gitea-x', clientId: 'cid-123' },
      };
    }
    if (input.mode === 'forward-auth') {
      return {
        env: {},
        ref: input.existingRef ?? { mode: 'forward-auth', providerPk: 7, applicationSlug: 'gitea-x', outpostPk: 1 },
        middleware: { name: 'ak-gitea-x', outpostUrl: 'http://authentik-server:9000' },
      };
    }
    if (input.mode === 'native-ldap' && input.ldap) {
      const e = input.ldap.env;
      return {
        env: {
          [e.host]: 'authentik-ldap',
          [e.port]: '3389',
          [e.bindDn]: 'cn=svc,ou=users,dc=hola,dc=internal',
          [e.bindPassword]: 'ldap-pw',
          [e.baseDn]: 'dc=hola,dc=internal',
        },
        ref: input.existingRef ?? { mode: 'native-ldap', bindAccountPk: 9 },
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

  test('resolves install tokens (${HOLA_APP_HOST} / ${HOLA_BASE_DOMAIN}) in app env', async () => {
    const sys = makeSystem({ auth: undefined });
    const compose = [
      'services:',
      '  gitea:',
      '    image: gitea/gitea:1.21.0',
      '    environment:',
      '      ROOT_URL: https://${HOLA_APP_HOST}/',
      '      ALLOWED_HOST: ${HOLA_APP_HOST}',
      '      BASE: ${HOLA_BASE_DOMAIN}',
      '',
    ].join('\n');
    const { draftId } = await sys.drafts.createDraft({ appId: 'gitea', version: '1.0.0' });
    await sys.drafts.updateDraft(draftId, { composeOverride: compose });
    await sys.drafts.finalizeDraft(draftId);

    const created = await sys.deployments.createFromDraft({ draftId, name: 'gitea' });
    expect((await waitForJob(sys.jobs, created.jobId!)).status).toBe('completed');

    const env = await readMaterializedEnv(sys.storage, created.deploymentId);
    // baseDomain is local.hola, app is gitea -> host gitea.local.hola
    expect(env.ROOT_URL).toBe('https://gitea.local.hola/');
    expect(env.ALLOWED_HOST).toBe('gitea.local.hola');
    expect(env.BASE).toBe('local.hola');
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

    // Deletion resolves (does not throw) despite the deprovision error, and the
    // teardown was still attempted exactly once with the persisted ref.
    await expect(sys.deployments.deleteDeployment(created.deploymentId)).resolves.toBeUndefined();
    expect(failingDeprovision.deprovisions).toHaveLength(1);
    expect(failingDeprovision.deprovisions[0].ref?.providerPk).toBe(42);
  });

  // --- Post-deploy setup command (e.g. Gitea `gitea admin auth add-oauth`) -----

  const OIDC_SETUP_AUTH: AppAuthConfig = {
    mode: 'native-oidc',
    oidc: {
      redirectPath: '/user/oauth2/authentik/callback',
      scopes: ['openid', 'email'],
      // No `env` — Gitea-style: configured by an in-container command instead.
      setup: {
        user: 'git',
        check: ['gitea', 'admin', 'auth', 'list'],
        checkMatch: 'authentik',
        command: [
          'gitea', 'admin', 'auth', 'add-oauth', '--name', 'authentik',
          '--key', '{{clientId}}', '--secret', '{{clientSecret}}',
          '--auto-discover-url', '{{issuer}}.well-known/openid-configuration',
        ],
      },
    },
  };

  /** Docker mock that records composeExec calls and lets a test control the check output. */
  class RecordingDocker extends MockDockerService {
    execCalls: Array<{ service: string; command: string[]; user?: string }> = [];
    checkOutput = '';
    override async composeExec(_p: string, _n: string, service: string, command: string[], opts?: { user?: string }) {
      this.execCalls.push({ service, command, user: opts?.user });
      if (command.includes('list')) return { success: true, output: this.checkOutput };
      return { success: true, output: '[mock] source created' };
    }
  }

  test('post-deploy setup runs the OIDC command with substituted credentials (no env injected)', async () => {
    const docker = new RecordingDocker();
    const sys = makeSystem({ auth: OIDC_SETUP_AUTH, docker });

    const created = await sys.deployments.createFromDraft({ draftId: await finalizedDraft(sys.drafts), name: 'gitea' });
    expect((await waitForJob(sys.jobs, created.jobId!)).status).toBe('completed');

    // The add-oauth command ran in the ingress service as the configured user,
    // with placeholders substituted by the provisioned credentials.
    const addCall = docker.execCalls.find(c => c.command.includes('add-oauth'));
    expect(addCall).toBeDefined();
    expect(addCall!.service).toBe('gitea');
    expect(addCall!.user).toBe('git');
    expect(addCall!.command).toContain('cid-123');
    expect(addCall!.command).toContain('csecret-456');
    expect(addCall!.command).toContain('https://auth.example.com/application/o/gitea-x/.well-known/openid-configuration');

    // The app has no env mapping, so nothing was injected into the compose.
    expect(await readMaterializedEnv(sys.storage, created.deploymentId)).toEqual({});
  });

  test('forward-auth: gates the route with the Authentik outpost middleware', async () => {
    const sys = makeSystem({ auth: { mode: 'forward-auth', forwardAuth: {} } });
    const spy = sys.provisioner as SpyProvisioner;

    const created = await sys.deployments.createFromDraft({ draftId: await finalizedDraft(sys.drafts), name: 'gitea' });
    expect((await waitForJob(sys.jobs, created.jobId!)).status).toBe('completed');

    expect(spy.provisions[0].mode).toBe('forward-auth');

    // The provisioned middleware persisted on deployment metadata...
    const meta = JSON.parse(await sys.storage.readFileAsString(`deployments/${created.deploymentId}/metadata.json`));
    expect(meta.metadata.auth.mode).toBe('forward-auth');
    expect(meta.metadata.auth.middleware.name).toBe('ak-gitea-x');

    // ...and was emitted into the Traefik dynamic config (gate + outpost router).
    const dyn = await sys.storage.readFileAsString('runtime/traefik/dynamic.yml');
    expect(dyn).toContain('ak-gitea-x');
    expect(dyn).toContain('/outpost.goauthentik.io/auth/traefik');
    expect(dyn).toContain('PathPrefix(`/outpost.goauthentik.io/`)');

    // The route's rule carries forwardAuth so it survives a restart rebuild.
    const map = JSON.parse(await sys.storage.readFileAsString('runtime/traefik/routing-map.json'));
    expect(map['gitea.local.hola'].forwardAuth.name).toBe('ak-gitea-x');

    // Delete tears the provider down.
    await sys.deployments.deleteDeployment(created.deploymentId);
    expect(spy.deprovisions[0].ref?.mode).toBe('forward-auth');
  });

  test('forward-auth: route activation is deferred until the gate is provisioned (no ungated window)', async () => {
    const sys = makeSystem({ auth: { mode: 'forward-auth', forwardAuth: {} } });

    // Create without auto-start: the release is promoted (route activation seam runs)
    // but provisioning hasn't happened yet, so the route must NOT be live ungated.
    const created = await sys.deployments.createFromDraft({
      draftId: await finalizedDraft(sys.drafts),
      name: 'gitea',
      options: { autoStart: false },
    });
    const mapExists = await sys.storage.fileExists('runtime/traefik/routing-map.json');
    const mapBefore = mapExists ? JSON.parse(await sys.storage.readFileAsString('runtime/traefik/routing-map.json')) : {};
    expect(mapBefore['gitea.local.hola']).toBeUndefined();

    // Once started, provisioning runs and the route appears WITH the gate.
    const start = await sys.deployments.executeAction(created.deploymentId, { action: 'start' });
    expect((await waitForJob(sys.jobs, start.jobId!)).status).toBe('completed');
    const mapAfter = JSON.parse(await sys.storage.readFileAsString('runtime/traefik/routing-map.json'));
    expect(mapAfter['gitea.local.hola']?.forwardAuth?.name).toBe('ak-gitea-x');
  });

  test('fallback: a native-oidc app is also gated behind forward-auth', async () => {
    const sys = makeSystem({ auth: { ...OIDC_AUTH, fallback: 'forward-auth' } });
    const spy = sys.provisioner as SpyProvisioner;

    const created = await sys.deployments.createFromDraft({ draftId: await finalizedDraft(sys.drafts), name: 'gitea' });
    expect((await waitForJob(sys.jobs, created.jobId!)).status).toBe('completed');

    // Both the primary (oidc) and the fallback (forward-auth) were provisioned.
    expect(spy.provisions.map(p => p.mode)).toEqual(['native-oidc', 'forward-auth']);

    // OIDC env was injected AND the route is gated by the forward-auth middleware.
    const env = await readMaterializedEnv(sys.storage, created.deploymentId);
    expect(env.GITEA_OIDC_CLIENT_ID).toBe('cid-123');
    const map = JSON.parse(await sys.storage.readFileAsString('runtime/traefik/routing-map.json'));
    expect(map['gitea.local.hola']?.forwardAuth?.name).toBe('ak-gitea-x');

    // Both refs persisted; delete tears both down.
    const meta = JSON.parse(await sys.storage.readFileAsString(`deployments/${created.deploymentId}/metadata.json`));
    expect(meta.metadata.auth.ref.providerPk).toBe(42);
    expect(meta.metadata.auth.fallbackRef.mode).toBe('forward-auth');

    await sys.deployments.deleteDeployment(created.deploymentId);
    expect(spy.deprovisions.map(d => d.ref?.mode).sort()).toEqual(['forward-auth', 'native-oidc']);
  });

  test('native-ldap: injects the bind config into the ingress service', async () => {
    const sys = makeSystem({
      auth: {
        mode: 'native-ldap',
        ldap: { env: { host: 'LDAP_HOST', port: 'LDAP_PORT', bindDn: 'LDAP_BIND_DN', bindPassword: 'LDAP_BIND_PW', baseDn: 'LDAP_BASE_DN' } },
      },
    });
    const spy = sys.provisioner as SpyProvisioner;

    const created = await sys.deployments.createFromDraft({ draftId: await finalizedDraft(sys.drafts), name: 'gitea' });
    expect((await waitForJob(sys.jobs, created.jobId!)).status).toBe('completed');

    expect(spy.provisions[0].mode).toBe('native-ldap');
    const env = await readMaterializedEnv(sys.storage, created.deploymentId);
    expect(env.LDAP_HOST).toBe('authentik-ldap');
    expect(env.LDAP_BIND_DN).toBe('cn=svc,ou=users,dc=hola,dc=internal');
    expect(env.LDAP_BIND_PW).toBe('ldap-pw');

    await sys.deployments.deleteDeployment(created.deploymentId);
    expect(spy.deprovisions[0].ref?.mode).toBe('native-ldap');
  });

  test('post-deploy setup is idempotent: skips the command when already configured', async () => {
    const docker = new RecordingDocker();
    docker.checkOutput = 'authentik   OAuth2   ...'; // `gitea admin auth list` already lists it
    const sys = makeSystem({ auth: OIDC_SETUP_AUTH, docker });

    const created = await sys.deployments.createFromDraft({ draftId: await finalizedDraft(sys.drafts), name: 'gitea' });
    expect((await waitForJob(sys.jobs, created.jobId!)).status).toBe('completed');

    // The guard matched, so only the check ran — no add-oauth.
    expect(docker.execCalls.some(c => c.command.includes('add-oauth'))).toBe(false);
    expect(docker.execCalls.some(c => c.command.includes('list'))).toBe(true);
  });
});
