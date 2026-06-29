/**
 * Per-app update notifications (#284): deployment list/detail responses are
 * annotated with `latestVersion` + `updateAvailable` from the catalog. The
 * enrichment is fail-safe and a no-op when no catalog is wired.
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
type JobArg = ConstructorParameters<typeof RealDeploymentService>[1];

function makeCatalog(versions: string[]) {
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'Gitea', icon: '🍵' }),
    getVersionDetail: async () => ({ defaultEnv: [], defaults: { ports: [], volumes: [] } }),
    getVersions: async () => ({ items: versions.map((v) => ({ version: v, createdAt: '2020-01-01' })), total: versions.length }),
  };
}
function makeValidation() {
  return { validateDraft: async () => ({ ok: true, errors: [], warnings: [] }), preflightCheck: async () => ({ ok: true, checks: [] }) };
}
function makeJobs(): JobArg {
  return {
    createJob: async (p: { type: string; deploymentId?: string }) => ({ id: crypto.randomUUID(), type: p.type, status: 'queued', startedAt: new Date().toISOString(), deploymentId: p.deploymentId }),
    listJobs: async () => [],
    cancelJob: async () => {},
    getJob: async () => null,
    onJobUpdate: () => ({ unsubscribe() {} }),
    setExecutor: () => {},
    healthCheck: async () => ({ healthy: true, lastCheck: new Date() }),
  } as unknown as JobArg;
}
const noLogging = { log: async () => {}, onLog: () => ({ unsubscribe() {} }), logJob: async () => {}, logDeployment: async () => {}, healthCheck: async () => ({ healthy: true, lastCheck: new Date() }) } as unknown as ConstructorParameters<typeof RealDeploymentService>[5];

describe('Per-app update notifications (#284)', () => {
  let dataRoot: string;
  beforeEach(async () => { dataRoot = await mkdtemp(join(tmpdir(), 'hola-upd-')); });
  afterEach(async () => { await rm(dataRoot, { recursive: true, force: true }); });

  function makeSystem(catalogVersions: string[] | null) {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const catalog = makeCatalog(catalogVersions ?? ['1.0.0']);
    const drafts = new RealDraftService(storage, catalog as unknown as CatalogArg, makeValidation() as unknown as ConstructorParameters<typeof RealDraftService>[2]);
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const deployments = new RealDeploymentService(
      storage, makeJobs(), new MockDockerService(), drafts, routing, noLogging, new MockProvisionerService(),
      catalogVersions === null ? undefined : (catalog as unknown as CatalogService),
    );
    return { drafts, deployments };
  }

  async function deploy(drafts: RealDraftService, deployments: RealDeploymentService, version: string) {
    const { draftId } = await drafts.createDraft({ appId: 'gitea', version });
    await drafts.updateDraft(draftId, { composeOverride: 'services:\n  gitea:\n    image: gitea/gitea:latest\n' });
    await drafts.finalizeDraft(draftId);
    return deployments.createFromDraft({ draftId, name: 'gitea', options: { autoStart: false } });
  }

  test('flags updateAvailable + latestVersion when the catalog has a newer version', async () => {
    const { drafts, deployments } = makeSystem(['1.0.0', '2.0.0']);
    await deploy(drafts, deployments, '1.0.0');

    const list = await deployments.listDeployments({ page: 1, limit: 10 });
    expect(list.items[0].latestVersion).toBe('2.0.0');
    expect(list.items[0].updateAvailable).toBe(true);

    const detail = await deployments.getDeployment(list.items[0].id);
    expect(detail.updateAvailable).toBe(true);
    expect(detail.latestVersion).toBe('2.0.0');
  });

  test('no update when installed is already the newest', async () => {
    const { drafts, deployments } = makeSystem(['1.0.0', '2.0.0']);
    await deploy(drafts, deployments, '2.0.0');
    const list = await deployments.listDeployments({ page: 1, limit: 10 });
    expect(list.items[0].latestVersion).toBe('2.0.0');
    expect(list.items[0].updateAvailable).toBe(false);
  });

  test('a deployment pinned to "latest" is never flagged as out-of-date', async () => {
    const { drafts, deployments } = makeSystem(['1.0.0', '2.0.0']);
    await deploy(drafts, deployments, 'latest');
    const list = await deployments.listDeployments({ page: 1, limit: 10 });
    // latestVersion is still surfaced, but there's no spurious "update available"
    // (we don't know the concrete installed version behind "latest").
    expect(list.items[0].latestVersion).toBe('2.0.0');
    expect(list.items[0].updateAvailable).toBe(false);
  });

  test('no catalog wired → fields left unset (no enrichment)', async () => {
    const { drafts, deployments } = makeSystem(null);
    await deploy(drafts, deployments, '1.0.0');
    const list = await deployments.listDeployments({ page: 1, limit: 10 });
    expect(list.items[0].latestVersion).toBeUndefined();
    expect(list.items[0].updateAvailable).toBeUndefined();
  });
});
