/**
 * A catalog install can name a stored registry credential for the app's
 * private RUNTIME image (the bundle itself is authenticated by the source's own
 * `auth`). Before this, the CLI and wizard sent it only for install-by-ref, so a
 * catalog app whose image lives in a private registry (e.g. an org's GHCR
 * package) finalized with no credential and failed at `compose pull`.
 *
 * The credential has to survive four hops, each pinned here against the real
 * draft + deployment services:
 *   1. createDraft (catalog path) — validated up front, recorded on the draft
 *   2. finalize — written into the manifest the deploy job reads
 *   3. createFromDraft — readable back off the active release
 *   4. the upgrade — the promote route rebuilds its draft, so it must carry it
 *
 * Same duck-typed-stub pattern as promote-endpoint.test.ts.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { RealDeploymentService } from '../../services/core/deployment';
import { MockProvisionerService } from '../../services/core/provisioner';
import { RealDraftService } from '../../services/core/draft';
import { RealStorageService } from '../../services/core/storage';
import { RealRoutingService } from '../../services/core/routing';
import { MockDockerService } from '../../services/core/docker';
import type { CatalogService } from '../../services/core/catalog';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];
type CredentialsArg = ConstructorParameters<typeof RealDraftService>[3];
type JobArg = ConstructorParameters<typeof RealDeploymentService>[1];
type LoggingArg = ConstructorParameters<typeof RealDeploymentService>[5];

const catalog = {
  getApp: async (appId: string) => ({ id: appId, name: 'Demo', icon: '📦' }),
  getVersionDetail: async (_appId: string, version: string) => ({
    version,
    channel: 'stable',
    defaultEnv: [],
    defaults: { ports: [{ host: 3000, container: 3000, protocol: 'tcp' as const }], volumes: [] },
  }),
  getVersions: async () => ({ items: [], total: 0 }),
} as unknown as CatalogArg;

const validation = {
  validateDraft: async () => ({ ok: true, errors: [], warnings: [] }),
  preflightCheck: async () => ({ ok: true, checks: [] }),
} as unknown as ValidationArg;

/** Knows exactly one credential, `acme-ghcr`; everything else is unknown. */
const credentials = {
  resolve: async (id: string) => (id === 'acme-ghcr' ? { registry: 'ghcr.io', username: 'bot', password: 'pat' } : undefined),
} as unknown as CredentialsArg;

const jobs = {
  createJob: async (p: { type: string; deploymentId?: string }) => ({ id: crypto.randomUUID(), type: p.type, status: 'queued', startedAt: new Date().toISOString(), deploymentId: p.deploymentId }),
  listJobs: async () => [],
  cancelJob: async () => {},
  getJob: async () => null,
  onJobUpdate: () => ({ unsubscribe() {} }),
  setExecutor: () => {},
  isDeploymentBusy: () => false,
  runExclusive: async (_id: string, fn: () => Promise<unknown>) => fn(),
  discardDeploymentJobs: async () => {},
  healthCheck: async () => ({ healthy: true, lastCheck: new Date() }),
} as unknown as JobArg;

const logging = {
  log: async () => {}, onLog: () => ({ unsubscribe() {} }), logJob: async () => {}, logDeployment: async () => {},
  healthCheck: async () => ({ healthy: true, lastCheck: new Date() }),
} as unknown as LoggingArg;

describe('catalog install with a registry credential', () => {
  let dataRoot: string;
  let appsRoot: string;
  let prevAppsBindRoot: string | undefined;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-catcred-data-'));
    appsRoot = await mkdtemp(join(tmpdir(), 'hola-catcred-apps-'));
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
    const drafts = new RealDraftService(storage, catalog, validation, credentials);
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const deployments = new RealDeploymentService(
      storage, jobs, new MockDockerService(), drafts, routing, logging, new MockProvisionerService(),
      catalog as unknown as CatalogService,
    );
    return { drafts, deployments };
  }

  async function finalize(drafts: RealDraftService, draftId: string): Promise<void> {
    await drafts.updateDraft(draftId, { composeOverride: 'services:\n  demo:\n    image: demo:1\n' });
    await drafts.finalizeDraft(draftId);
  }

  test('records the credential on the draft', async () => {
    const { drafts } = makeSystem();
    const { draftId } = await drafts.createDraft({ appId: 'demo', version: '1.0.0', source: 'acme', credentialRef: 'acme-ghcr' });
    const draft = await drafts.getDraft(draftId);
    expect(draft.credentialRef).toBe('acme-ghcr');
    expect(draft.source).toBe('acme');
  });

  test('an unknown credential is refused up front, before any draft exists', async () => {
    const { drafts } = makeSystem();
    await expect(
      drafts.createDraft({ appId: 'demo', version: '1.0.0', credentialRef: 'no-such-cred' }),
    ).rejects.toThrow('Unknown registry credential: no-such-cred');
  });

  test('no credential named: the draft carries none and nothing is looked up', async () => {
    const { drafts } = makeSystem();
    const { draftId } = await drafts.createDraft({ appId: 'demo', version: '1.0.0' });
    expect((await drafts.getDraft(draftId)).credentialRef).toBeUndefined();
  });

  test('the deployment reads the credential back off its active release', async () => {
    const { drafts, deployments } = makeSystem();
    const { draftId } = await drafts.createDraft({ appId: 'demo', version: '1.0.0', credentialRef: 'acme-ghcr' });
    await finalize(drafts, draftId);
    const dep = await deployments.createFromDraft({ draftId, name: 'demo', options: { autoStart: false } });

    expect(await deployments.getDeploymentCredentialRef(dep.deploymentId)).toBe('acme-ghcr');
  });

  test('a deployment installed without a credential reports none', async () => {
    const { drafts, deployments } = makeSystem();
    const { draftId } = await drafts.createDraft({ appId: 'demo', version: '1.0.0' });
    await finalize(drafts, draftId);
    const dep = await deployments.createFromDraft({ draftId, name: 'demo', options: { autoStart: false } });

    expect(await deployments.getDeploymentCredentialRef(dep.deploymentId)).toBeUndefined();
  });

  test('the draft the upgrade rebuilds carries the credential, so the new release keeps pulling its image', async () => {
    const { drafts, deployments } = makeSystem();
    const first = await drafts.createDraft({ appId: 'demo', version: '1.0.0', source: 'acme', credentialRef: 'acme-ghcr' });
    await finalize(drafts, first.draftId);
    const dep = await deployments.createFromDraft({ draftId: first.draftId, name: 'demo', options: { autoStart: false } });

    // Exactly the promote route's call shape (server.ts): source and credential
    // are both read off the deployment and handed to createDraft.
    const source = await deployments.getDeploymentSource(dep.deploymentId);
    const credentialRef = await deployments.getDeploymentCredentialRef(dep.deploymentId);
    const next = await drafts.createDraft({ appId: 'demo', version: '1.1.0', source, credentialRef });
    await finalize(drafts, next.draftId);

    const promoted = await deployments.promote(dep.deploymentId, { draftId: next.draftId });
    expect(promoted.releaseId).toBeTruthy();
    // The new release is now the active one and still names the credential.
    expect(await deployments.getDeploymentCredentialRef(dep.deploymentId)).toBe('acme-ghcr');
  });
});
