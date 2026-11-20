/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shared harness for the spec 010 deployment tests: a real storage/jobs/deployment
 * stack over a temp dir, a MockDockerService whose calls are recorded, and a
 * MockTailscaleIngressService. Not a test file (no `.test.` suffix).
 */
import { mkdtemp, rm, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parse } from 'yaml';

import { RealDeploymentService } from '../../services/core/deployment';
import { MockProvisionerService } from '../../services/core/provisioner';
import { RealDraftService } from '../../services/core/draft';
import { RealStorageService } from '../../services/core/storage';
import { RealRoutingService } from '../../services/core/routing';
import { RealDatabaseService } from '../../services/core/database';
import { RealLoggingService } from '../../services/core/logging';
import { RealJobService } from '../../services/core/jobs';
import { MockDockerService } from '../../services/core/docker';
import { MockTailscaleIngressService } from '../../services/core/tailscale-ingress';

export const MARKER = 'tskey-auth-kMARKERCRED77-abcdefghijklmnop';
export const DEFAULT_COMPOSE = 'services:\n  app:\n    image: nginx:1.27\n  db:\n    image: postgres:16\n';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

export async function waitForJob(jobs: RealJobService, id: string, timeoutMs = 8000) {
  const start = Date.now();
  for (;;) {
    const job = await jobs.getJob(id);
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    if (Date.now() - start > timeoutMs) throw new Error(`Job ${id} did not finish (last: ${job?.status})`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

export interface TsSystem {
  dataRoot: string;
  storage: RealStorageService;
  jobs: RealJobService;
  drafts: RealDraftService;
  deployments: RealDeploymentService;
  docker: MockDockerService;
  tailscale: MockTailscaleIngressService;
  /** Whether composePs reports the companion running. */
  companionRunning: { value: boolean };
  /** Order-preserving log of docker/tailscale operations. */
  events: string[];
  cleanup(): Promise<void>;
  deploy(opts?: { compose?: string; name?: string; app?: string }): Promise<{ deploymentId: string; jobId: string }>;
  record(deploymentId: string): any;
  runningJob(jobId: string): ReturnType<typeof waitForJob>;
  rendered(deploymentId: string): Promise<string>;
  renderedDoc(deploymentId: string): Promise<any>;
  restart(deploymentId: string): Promise<Awaited<ReturnType<typeof waitForJob>>>;
}

export async function makeTsSystem(): Promise<TsSystem> {
  const dataRoot = await mkdtemp(join(tmpdir(), 'hola-ts-'));
  const appsRoot = await mkdtemp(join(tmpdir(), 'hola-ts-apps-'));
  const prev = process.env.HOLA_APPS_BIND_ROOT;
  process.env.HOLA_APPS_BIND_ROOT = appsRoot;

  const storage = new RealStorageService({ holaDir: dataRoot });
  const database = new RealDatabaseService(storage);
  const logging = new RealLoggingService(storage);
  const jobs = new RealJobService(database, logging);
  const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
  const catalog = {
    getApp: async (appId: string) => ({ id: appId, name: 'App', icon: '📦' }),
    getVersionDetail: async () => ({ defaultEnv: [], defaults: { ports: [], volumes: [] } }),
  } as unknown as CatalogArg;
  const validation = {
    validateDraft: async () => ({ ok: true, errors: [], warnings: [] }),
    preflightCheck: async () => ({ ok: true, checks: [] }),
  } as unknown as ValidationArg;
  const drafts = new RealDraftService(storage, catalog, validation);

  const docker = new MockDockerService();
  const tailscale = new MockTailscaleIngressService();
  const events: string[] = [];
  const companionRunning = { value: true };

  // Record ordering of the calls the spec 010 tests assert on.
  const wrap = <K extends keyof MockDockerService>(name: K, label: (args: any[]) => string) => {
    const orig = (docker[name] as any).bind(docker);
    (docker as any)[name] = async (...args: any[]) => {
      events.push(label(args));
      return orig(...args);
    };
  };
  wrap('composeUp', () => 'up');
  wrap('composeDown', () => 'down');
  wrap('composePull', () => 'pull');
  wrap('composeRemoveService', (a) => `rm:${a[2]}`);
  wrap('removeVolume', (a) => `rmvolume:${a[0]}`);
  wrap('removeNetwork', (a) => `rmnetwork:${a[0]}`);
  docker.composePs = async (_p: string, projectName: string) => ({
    name: projectName,
    services: [
      { name: 'app', state: 'running', status: 'Up', image: 'x', ports: [] },
      ...(companionRunning.value ? [{ name: 'hola-tailscale', state: 'running', status: 'Up', image: 'x', ports: [] }] : []),
    ],
    configFiles: [],
  }) as any;
  for (const op of ['withdraw', 'signOut', 'signIn', 'applyServe'] as const) {
    const orig = (tailscale as any)[op].bind(tailscale);
    (tailscale as any)[op] = async (...a: any[]) => {
      events.push(`ts:${op}`);
      return orig(...a);
    };
  }

  const deployments = new RealDeploymentService(
    storage, jobs, docker, drafts, routing, logging, new MockProvisionerService(),
    undefined, undefined, undefined, undefined, tailscale,
  );
  deployments.tsPollIntervalMs = 5;
  deployments.tsHookBudgetMs = 500;
  deployments.tsOffboardBudgetMs = 500;

  const sys: TsSystem = {
    dataRoot, storage, jobs, drafts, deployments, docker, tailscale, companionRunning, events,
    async cleanup() {
      if (prev === undefined) delete process.env.HOLA_APPS_BIND_ROOT;
      else process.env.HOLA_APPS_BIND_ROOT = prev;
      await rm(dataRoot, { recursive: true, force: true });
      await rm(appsRoot, { recursive: true, force: true });
    },
    async deploy(opts = {}) {
      const { draftId } = await drafts.createDraft({ appId: opts.app ?? 'app', version: '1.0.0' });
      await drafts.updateDraft(draftId, { composeOverride: opts.compose ?? DEFAULT_COMPOSE });
      await drafts.finalizeDraft(draftId);
      const created = await deployments.createFromDraft({ draftId, name: opts.name ?? opts.app ?? 'app' });
      const job = await waitForJob(jobs, created.jobId!);
      if (job.status !== 'completed') throw new Error(`deploy job ${job.status}: ${job.error}`);
      events.length = 0;
      tailscale.calls.length = 0;
      return { deploymentId: created.deploymentId, jobId: created.jobId! };
    },
    record: (id: string) => (deployments as any).deployments.get(id),
    runningJob: (id: string) => waitForJob(jobs, id),
    async rendered(id: string) {
      return readFile(join(dataRoot, 'deployments', id, 'runtime', 'docker-compose.yml'), 'utf8');
    },
    async renderedDoc(id: string) {
      return parse(await sys.rendered(id));
    },
    async restart(id: string) {
      const { jobId } = await deployments.executeAction(id, { action: 'restart' });
      return waitForJob(jobs, jobId!);
    },
  };
  void existsSync;
  return sys;
}
