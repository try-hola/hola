/**
 * Deploy-time platform-token resolution (belt-and-braces) — declarative-
 * drifting-tiger PR 2.
 *
 * `RealDraftService` resolves `${HOLA_APP_HOST}`/`${HOLA_BASE_DOMAIN}` at
 * SEED time (see __tests__/drafts/token-prefill.test.ts). This suite covers
 * the fallback: a draft is constructed here WITHOUT a routing service wired
 * (the same shape a pre-PR2 draft, or a promote's carried-forward value, would
 * have), so its `appEnv` still carries the literal token when finalized. The
 * deploy lifecycle (`materializeCompose`'s `.env` writer in deployment.ts) must
 * still resolve it before it reaches the running container — a literal
 * `${HOLA_APP_HOST}` leaking into an app's env would be a functional bug.
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
import { MockProvisionerService } from '../../services/core/provisioner';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

function makeCatalog(): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'Vaultwarden', icon: '🔐' }),
    getVersionDetail: async () => ({
      version: '1.0.0',
      // A literal token, as if seeded before PR2's seed-time prefill existed
      // (draft service constructed with no routing service — see below).
      defaultEnv: [{ key: 'DOMAIN', value: 'https://${HOLA_APP_HOST}', isSecret: false }],
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
    if (Date.now() - start > timeoutMs) throw new Error(`Job ${id} did not finish (last status: ${job?.status})`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('Deploy-time platform-token resolution fallback (PR2)', () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-deploy-token-'));
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  test('materializeCompose resolves a literal ${HOLA_APP_HOST}/${HOLA_BASE_DOMAIN} carried in appEnv into the runtime .env', async () => {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage);
    const logging = new RealLoggingService(storage);
    const jobs = new RealJobService(database, logging);
    const routing = new RealRoutingService(storage, { baseDomain: 'example.com' });
    // No routing service passed to RealDraftService: the draft carries the
    // literal token straight through to finalize, as a pre-PR2 draft would.
    const drafts = new RealDraftService(storage, makeCatalog(), makeValidation());
    const docker = new MockDockerService();
    const deployments = new RealDeploymentService(storage, jobs, docker, drafts, routing, logging, new MockProvisionerService());

    const { draftId } = await drafts.createDraft({ appId: 'vaultwarden', version: '1.0.0' });
    // Sanity check: the token is indeed still literal at this point (no seed-time prefill).
    const seeded = await drafts.getDraft(draftId);
    expect(seeded.appEnv.find((e) => e.key === 'DOMAIN')?.value).toBe('https://${HOLA_APP_HOST}');

    await drafts.updateDraft(draftId, { composeOverride: 'services:\n  vaultwarden:\n    image: vaultwarden/server:1.0.0\n' });
    await drafts.finalizeDraft(draftId);

    const created = await deployments.createFromDraft({ draftId, name: 'vaultwarden' });
    const job = await waitForJob(jobs, created.jobId!);
    expect(job.status).toBe('completed');

    const dotenv = await storage.readFileAsString(`deployments/${created.deploymentId}/runtime/.env`);
    expect(dotenv).toContain('DOMAIN="https://vaultwarden.example.com"');
    expect(dotenv).not.toContain('HOLA_APP_HOST');
  });
});
