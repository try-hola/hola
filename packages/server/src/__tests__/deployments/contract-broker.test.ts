/**
 * The capability contract broker (ADR 0004 §6, closing #298).
 *
 * #121 gave apps a way to declare `pg_dump`-style hooks, and the server ran them
 * around its OWN pre-upgrade snapshot — never around Backrest's scheduled restic
 * run, because the server wasn't in that loop. These tests cover the loop being
 * closed: a provider announces its run, the server executes every accepting app's
 * hook in that app's own containers, and the provider never touches another app.
 *
 * Runs against RealDeploymentService with a docker double that records every
 * `compose exec` — no containers, but the real acceptor lookup, job plumbing and
 * failure semantics.
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
import type { AppBackupConfig } from '@hola/shared';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

const COMPOSE = 'services:\n  app:\n    image: nginx:1.27\n';

const PG_BACKUP: AppBackupConfig = {
  preHook: { service: 'db', command: ['sh', '-c', 'pg_dump -U app app > /backups/app.sql'] },
  postHook: { service: 'db', command: ['rm', '-f', '/backups/app.sql'] },
};

/** Records every exec so tests can assert which hook ran where. */
class ExecSpy extends MockDockerService {
  execs: Array<{ projectName: string; service: string; command: string[] }> = [];
  /** Deployment id substrings whose exec should fail (simulating a broken dump). */
  failFor: string[] = [];

  override async composeExec(
    projectPath: string,
    projectName: string,
    service: string,
    command: string[],
    opts?: { user?: string; profiles?: string[] },
  ): Promise<{ success: boolean; output: string }> {
    this.execs.push({ projectName, service, command });
    if (this.failFor.some(f => projectName.includes(f))) {
      return { success: false, output: 'FATAL: could not connect to server' };
    }
    return super.composeExec(projectPath, projectName, service, command, opts);
  }

  /** Hook commands run for a given phase, keyed by the compose project. */
  execsFor(phase: 'pre' | 'post'): string[] {
    return this.execs
      .filter(e => (phase === 'pre' ? e.command.join(' ').includes('pg_dump') : e.command.includes('rm')))
      .map(e => e.projectName);
  }
}

function makeCatalog(opts: { accepts?: string[]; backup?: AppBackupConfig }): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: appId, icon: '📦' }),
    getVersionDetail: async () => ({
      defaultEnv: [],
      defaults: { ports: [], volumes: [] },
      accepts: opts.accepts,
      backup: opts.backup,
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
    await new Promise(r => setTimeout(r, 10));
  }
}

describe('capability contract broker: backup@1', () => {
  let dataRoot: string;
  let docker: ExecSpy;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-broker-'));
    docker = new ExecSpy();
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  /** A system whose catalog stub gives every app the same accepts/backup shape. */
  function makeSystem(opts: { accepts?: string[]; backup?: AppBackupConfig }) {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage);
    const logging = new RealLoggingService(storage);
    const jobs = new RealJobService(database, logging);
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const drafts = new RealDraftService(storage, makeCatalog(opts), makeValidation());
    const deployments = new RealDeploymentService(
      storage, jobs, docker, drafts, routing, logging, new NoneProvisionerService(),
    );
    return { storage, jobs, drafts, deployments };
  }

  async function install(sys: ReturnType<typeof makeSystem>, appId: string): Promise<string> {
    const { draftId } = await sys.drafts.createDraft({ appId, version: '1.0.0' });
    await sys.drafts.updateDraft(draftId, { composeOverride: COMPOSE });
    await sys.drafts.finalizeDraft(draftId);
    const created = await sys.deployments.createFromDraft({ draftId, name: appId });
    expect((await waitForJob(sys.jobs, created.jobId!)).status).toBe('completed');
    return created.deploymentId;
  }

  test('runs every accepting app\'s preHook before the provider captures, and postHook after', async () => {
    const sys = makeSystem({ accepts: ['backup@1'], backup: PG_BACKUP });
    const paperless = await install(sys, 'paperless');
    const mealie = await install(sys, 'mealie');

    const prepared = await sys.deployments.prepareContractBackup();
    expect(prepared.apps.sort()).toEqual([mealie, paperless].sort());
    expect((await waitForJob(sys.jobs, prepared.jobId!)).status).toBe('completed');

    // Each dump ran in its OWN app's compose project — the provider never reaches
    // into another app; the server execs on its behalf.
    const dumped = docker.execsFor('pre');
    expect(dumped).toHaveLength(2);
    expect(dumped.some(p => p.includes(paperless))).toBe(true);
    expect(dumped.some(p => p.includes(mealie))).toBe(true);
    expect(docker.execsFor('post')).toHaveLength(0); // not yet — the capture happens here

    const finalized = await sys.deployments.finalizeContractBackup();
    expect(finalized.ok).toBe(true);
    expect(finalized.results.map(r => r.deploymentId).sort()).toEqual([mealie, paperless].sort());
    expect(docker.execsFor('post')).toHaveLength(2);
  });

  test('an app that accepts the contract but declares no hook is already covered', async () => {
    // SQLite/flat-file apps are consistent under a plain file copy. They accept
    // backup@1 and need nothing run — which is exactly why acceptance is declared
    // rather than inferred from the presence of a `backup` block.
    const sys = makeSystem({ accepts: ['backup@1'] });
    await install(sys, 'uptime-kuma');

    const prepared = await sys.deployments.prepareContractBackup();
    expect(prepared.apps).toEqual([]);
    expect(prepared.jobId).toBeUndefined(); // no job at all, so the provider just proceeds
    expect(docker.execs).toHaveLength(0);
  });

  test('an app with hooks that never accepted the contract is left alone', async () => {
    // Declaring hooks is not opting in. A manifest that predates ADR 0004 keeps
    // working for the pre-upgrade snapshot but does not silently join the fleet
    // backup — the server reports the discrepancy instead of assuming consent.
    const sys = makeSystem({ backup: PG_BACKUP });
    await install(sys, 'immich');

    const prepared = await sys.deployments.prepareContractBackup();
    expect(prepared.apps).toEqual([]);
    expect(docker.execs).toHaveLength(0);
  });

  test('a stopped app is skipped — nothing is writing to its files anyway', async () => {
    const sys = makeSystem({ accepts: ['backup@1'], backup: PG_BACKUP });
    const paperless = await install(sys, 'paperless');
    const stopped = await install(sys, 'mealie');

    const action = await sys.deployments.executeAction(stopped, { action: 'stop' });
    expect((await waitForJob(sys.jobs, action.jobId!)).status).toBe('completed');

    const prepared = await sys.deployments.prepareContractBackup();
    expect(prepared.apps).toEqual([paperless]);
  });

  test('a failed preHook fails the job and cleans up the dumps that did land', async () => {
    // Fail-closed (ADR 0004 §6): the provider aborts rather than capture files it
    // would report as transaction-consistent. Nothing else will call finalize, so
    // the broker cleans up after the apps that DID dump — otherwise every app's
    // data root keeps a stale dump that inflates the next backup and misleads a
    // later restore.
    const sys = makeSystem({ accepts: ['backup@1'], backup: PG_BACKUP });
    const ok = await install(sys, 'paperless');
    const broken = await install(sys, 'mealie');
    docker.failFor = [broken];

    const prepared = await sys.deployments.prepareContractBackup();
    const job = await waitForJob(sys.jobs, prepared.jobId!);
    expect(job.status).toBe('failed');

    const cleaned = docker.execsFor('post');
    expect(cleaned.some(p => p.includes(ok))).toBe(true);
  });

  test('with no apps installed at all, prepare is a no-op rather than an error', async () => {
    const sys = makeSystem({ accepts: ['backup@1'], backup: PG_BACKUP });
    expect(await sys.deployments.prepareContractBackup()).toEqual({ apps: [] });
    expect(await sys.deployments.finalizeContractBackup()).toEqual({ ok: true, results: [] });
  });
});
