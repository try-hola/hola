/**
 * Shared wiring for tests that exercise the REAL services on an isolated temp
 * data dir (no global singleton). Mirrors the production composition from
 * simple-factory.ts but with a stub catalog (no network) and a caller-supplied
 * Docker engine (mock by default, real for the Docker-gated integration suite).
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';

import { RealDeploymentService } from '../../services/core/deployment';
import { RealDraftService } from '../../services/core/draft';
import { RealStorageService } from '../../services/core/storage';
import { RealRoutingService } from '../../services/core/routing';
import { RealDatabaseService } from '../../services/core/database';
import { RealLoggingService } from '../../services/core/logging';
import { RealJobService } from '../../services/core/jobs';
import { RealValidationService } from '../../services/core/validation';
import { MockDockerService } from '../../services/core/docker';
import { MockSystemMonitoringService } from '../../services/core/system-monitoring';
import { MockProvisionerService } from '../../services/core/provisioner';
import type { DockerService } from '../../services/core/docker';
import type { ProvisionerService } from '../../services/core/provisioner';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];

/** Stub catalog so draft creation needs no network. */
export function makeStubCatalog(): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'Fixture', icon: '🧪' }),
    getVersionDetail: async () => ({
      defaultEnv: [],
      defaults: { ports: [{ container: 8080, protocol: 'tcp' as const }], volumes: [] },
    }),
  } as unknown as CatalogArg;
}

export const FIXTURE_COMPOSE_PATH = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  'fixtures',
  'integration',
  'docker-compose.yaml',
);

export interface RealSystem {
  storage: RealStorageService;
  database: RealDatabaseService;
  jobs: RealJobService;
  routing: RealRoutingService;
  docker: DockerService;
  validation: RealValidationService;
  drafts: RealDraftService;
  provisioner: ProvisionerService;
  deployments: RealDeploymentService;
}

/** Build a full real-service system rooted at `dataRoot`, with the given Docker engine. */
export function makeRealSystem(
  dataRoot: string,
  docker: DockerService = new MockDockerService(),
  provisioner: ProvisionerService = new MockProvisionerService()
): RealSystem {
  const storage = new RealStorageService({ holaDir: dataRoot });
  const database = new RealDatabaseService(storage);
  const logging = new RealLoggingService(storage);
  const jobs = new RealJobService(database, logging);
  const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
  const systemMonitoring = new MockSystemMonitoringService();
  const validation = new RealValidationService(docker, systemMonitoring, storage, routing);
  const drafts = new RealDraftService(storage, makeStubCatalog(), validation);
  const deployments = new RealDeploymentService(storage, jobs, docker, drafts, routing, logging, provisioner);
  return { storage, database, jobs, routing, docker, validation, drafts, provisioner, deployments };
}

/** Poll a job to a terminal state. */
export async function waitForJob(jobs: RealJobService, id: string, timeoutMs = 30_000) {
  const start = Date.now();
  for (;;) {
    const job = await jobs.getJob(id);
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    if (Date.now() - start > timeoutMs) throw new Error(`Job ${id} did not finish (last: ${job?.status})`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Create, configure with the busybox fixture compose, and finalize a draft. */
export async function finalizedFixtureDraft(drafts: RealDraftService, appId = 'fixture'): Promise<string> {
  const compose = await readFile(FIXTURE_COMPOSE_PATH, 'utf8');
  const { draftId } = await drafts.createDraft({ appId, version: '1.0.0' });
  await drafts.updateDraft(draftId, {
    composeOverride: compose,
    ports: [{ container: 8080, protocol: 'tcp' }],
  });
  await drafts.finalizeDraft(draftId);
  return draftId;
}
