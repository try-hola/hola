/**
 * #506 — an app's own Compose fallback must not be written into `runtime/.env`.
 *
 * A draft seeds `appEnv` from the bundle's compose `environment` block, so an
 * app that declares its own default — `OIDC_AUTH_ENABLED: "${OIDC_AUTH_ENABLED:-false}"`
 * — hands the platform that template TEXT as the value. `dotenvValue` then
 * escapes the `$`, so Compose interpolates the compose file, looks the key up in
 * `.env`, finds the literal `${OIDC_AUTH_ENABLED:-false}`, and puts THAT in the
 * container. mealie crash-loops parsing it as a boolean.
 *
 * Found on a `mode=none` VM, and only visible there: under
 * `HOLA_AUTH_MODE=authentik` the provisioner's `injectedEnv` spreads after
 * `appEnv` and overwrites every such key with a real value, hiding it entirely.
 * That is why no existing test caught it — `MockProvisionerService` injects the
 * OIDC keys, exactly as Authentik would.
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

/** Mirrors mealie's real manifest/compose shape at the point that matters. */
function makeCatalog(): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'Mealie', icon: '🍲' }),
    getVersionDetail: async () => ({
      version: '1.0.0',
      defaultEnv: [
        // Self-referential bare tokens — must be DROPPED so Compose applies the
        // app author's own declared default.
        { key: 'OIDC_AUTH_ENABLED', value: '${OIDC_AUTH_ENABLED:-false}', isSecret: false },
        { key: 'OIDC_REMEMBER_ME', value: '${OIDC_REMEMBER_ME:-true}', isSecret: false },
        { key: 'OIDC_CLIENT_ID', value: '${OIDC_CLIENT_ID:-}', isSecret: false },
        { key: 'PLAIN_TOKEN', value: '${PLAIN_TOKEN}', isSecret: false },
        // A CROSS-reference: keyed to a different variable, which Compose
        // resolves from the compose file. Must be KEPT.
        { key: 'OIDC_CONFIGURATION_URL', value: '${OIDC_ISSUER_URL}.well-known/openid-configuration', isSecret: false },
        // Ordinary values, and a password that merely CONTAINS `${`.
        // `dotenvValue` escapes `$` on purpose so these survive — must be KEPT.
        { key: 'ALLOW_SIGNUP', value: 'false', isSecret: false },
        { key: 'POSTGRES_PASSWORD', value: 'pa${ss}word', isSecret: true },
        { key: 'PARTIAL', value: '${PARTIAL}extra', isSecret: false },
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

describe('#506: self-referential Compose interpolation in runtime/.env', () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-selfref-'));
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  test('a value that is only a Compose interpolation of its own key is omitted, so the app default applies', async () => {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage);
    const logging = new RealLoggingService(storage);
    const jobs = new RealJobService(database, logging);
    const routing = new RealRoutingService(storage, { baseDomain: 'example.com' });
    // 4th arg is RegistryCredentialService; routing (prefill) is the 5th. Neither
    // matters here — none of the values under test carry a platform token.
    const drafts = new RealDraftService(storage, makeCatalog(), makeValidation(), undefined, routing);
    const docker = new MockDockerService();
    // NoneProvisionerService, NOT Mock: the Mock injects the OIDC keys and would
    // mask the bug exactly as Authentik does on a real host.
    const deployments = new RealDeploymentService(
      storage, jobs, docker, drafts, routing, logging, new NoneProvisionerService(),
    );

    const { draftId } = await drafts.createDraft({ appId: 'mealie', version: '1.0.0' });
    await drafts.updateDraft(draftId, {
      composeOverride: 'services:\n  mealie:\n    image: mealie/mealie:1.0.0\n',
    });
    await drafts.finalizeDraft(draftId);

    const created = await deployments.createFromDraft({ draftId, name: 'mealie' });
    const job = await waitForJob(jobs, created.jobId!);
    expect(job.status).toBe('completed');

    const dotenv = await storage.readFileAsString(`deployments/${created.deploymentId}/runtime/.env`);

    // Dropped: a container receiving `OIDC_AUTH_ENABLED=${OIDC_AUTH_ENABLED:-false}`
    // is the bug. Absent, Compose substitutes the app's own `false`.
    expect(dotenv).not.toContain('OIDC_AUTH_ENABLED');
    expect(dotenv).not.toContain('OIDC_REMEMBER_ME');
    expect(dotenv).not.toContain('OIDC_CLIENT_ID=');
    expect(dotenv).not.toContain('PLAIN_TOKEN');

    // Kept: a cross-reference resolves from the compose file, and ordinary
    // values (including a password containing `${`) must survive untouched.
    expect(dotenv).toContain('OIDC_CONFIGURATION_URL=');
    expect(dotenv).toContain('ALLOW_SIGNUP="false"');
    expect(dotenv).toContain('POSTGRES_PASSWORD="pa\\${ss}word"');
    expect(dotenv).toContain('PARTIAL=');
  });
});
