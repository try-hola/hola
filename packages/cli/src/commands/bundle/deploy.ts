import { HolaSdk } from '@hola/sdk';
import { API } from '@hola/shared';
import type {
  CreateDraftResponse,
  CreateDeploymentFromDraftResponse,
  AppEnvVar,
} from '@hola/shared';
import { promises as fs } from 'fs';
import path from 'path';

import { streamSSE } from '../../lib/sse';

export interface BundleDeployOptions {
  path?: string;
  appId?: string;
  version?: string;
  traefik?: boolean;
  noStream?: boolean;
  json?: boolean;
  strict?: boolean;
}

export interface BundleDeployResult {
  deploymentId: string;
  releaseId: string;
  jobId?: string;
  status: string;
}

const COMPOSE_CANDIDATES = ['docker-compose.yaml', 'docker-compose.yml', 'compose.yaml', 'compose.yml'];

/** Raised after a user-facing failure has been reported and the exit code set. */
class DeployAbort extends Error {}

async function readCompose(dir: string): Promise<string> {
  for (const candidate of COMPOSE_CANDIDATES) {
    try {
      return await fs.readFile(path.join(dir, candidate), 'utf8');
    } catch {
      // try next candidate
    }
  }
  throw new DeployAbort(`No compose file in ${dir} (looked for ${COMPOSE_CANDIDATES.join(', ')})`);
}

async function readEnvFile(dir: string): Promise<AppEnvVar[]> {
  try {
    const raw = await fs.readFile(path.join(dir, '.env'), 'utf8');
    return raw
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && line.includes('='))
      .map(line => {
        const eq = line.indexOf('=');
        return { key: line.slice(0, eq).trim(), value: line.slice(eq + 1).trim(), isSecret: false };
      });
  } catch {
    return [];
  }
}

/**
 * One-shot bundle deploy: import → draft → validate → preflight → finalize →
 * deployment create → watch job. Returns the result, or undefined on failure
 * (after setting a non-zero exit code).
 */
export async function runBundleDeploy(
  opts: BundleDeployOptions,
  injected?: { sdk?: HolaSdk }
): Promise<BundleDeployResult | undefined> {
  const sdk = injected?.sdk ?? new HolaSdk();
  const dir = path.resolve(process.cwd(), opts.path ?? '.');
  const appId = opts.appId ?? path.basename(dir);
  const version = opts.version ?? 'latest';
  const out = (msg: string) => { if (!opts.json) console.log(msg); };

  try {
    const composeOverride = await readCompose(dir);
    const appEnv = await readEnvFile(dir);

    out(`Creating draft for ${appId}@${version}`);
    const draft = (await sdk.drafts.create({ appId, version })) as CreateDraftResponse;
    await sdk.drafts.update(draft.draftId, { composeOverride, ...(appEnv.length ? { appEnv } : {}) });

    out('Validating…');
    const report = (await sdk.drafts.validate(draft.draftId)) as {
      ok?: boolean; errors?: Array<{ message: string }>; warnings?: Array<{ message: string }>;
    };
    for (const w of report.warnings ?? []) out(`  warning: ${w.message}`);
    if (report.errors?.length) {
      for (const e of report.errors) console.error(`  error: ${e.message}`);
      if (opts.strict || report.ok === false) throw new DeployAbort('Validation failed.');
    }

    out('Preflight…');
    const preflight = (await sdk.drafts.preflight(draft.draftId)) as {
      ok?: boolean; checks?: Array<{ name: string; status: string; detail?: string }>;
    };
    for (const c of preflight.checks ?? []) {
      if (c.status !== 'pass') out(`  ${c.status}: ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    }
    if (preflight.ok === false) throw new DeployAbort('Preflight failed.');

    out('Finalizing…');
    await sdk.drafts.finalize(draft.draftId);

    out('Creating deployment…');
    const dep = (await sdk.deployments.create({ draftId: draft.draftId, name: appId })) as CreateDeploymentFromDraftResponse;
    out(`Deployment ${dep.deploymentId} created (release ${dep.releaseId}).`);

    let status = 'created';
    if (dep.jobId && !opts.noStream) {
      status = await watchJob(sdk, dep.jobId, out);
    } else if (dep.jobId) {
      const job = (await sdk.jobs.byId(dep.jobId)) as { status?: string };
      status = job.status ?? 'queued';
    }

    const result: BundleDeployResult = {
      deploymentId: dep.deploymentId,
      releaseId: dep.releaseId,
      jobId: dep.jobId,
      status,
    };

    if (opts.json) console.log(JSON.stringify(result, null, 2));
    else out(`Done. Job status: ${status}`);
    if (status === 'failed' || status === 'error') process.exitCode = 1;
    return result;
  } catch (err) {
    if (err instanceof DeployAbort) {
      console.error(err.message);
      process.exitCode = 1;
      return undefined;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Deploy failed: ${msg}`);
    if (/401|unauthor/i.test(msg)) console.error('Hint: set HOLA_TOKEN to your admin API key.');
    if (/fetch failed|ECONNREFUSED|network|connect/i.test(msg)) console.error('Hint: set HOLA_API_URL (default http://localhost:3001).');
    process.exitCode = 1;
    return undefined;
  }
}

/** Stream job logs and poll until the job reaches a terminal state. */
async function watchJob(sdk: HolaSdk, jobId: string, out: (msg: string) => void): Promise<string> {
  const base = process.env.HOLA_API_URL || 'http://localhost:3001';
  const token = process.env.HOLA_TOKEN;
  const controller = new AbortController();

  const streaming = streamSSE(
    `${base}${API.jobs.logs(jobId)}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : undefined, signal: controller.signal },
    (msg) => {
      try {
        const evt = JSON.parse(msg.data) as { data?: { message?: string } };
        if (evt?.data?.message) out(`  ${evt.data.message}`);
      } catch {
        // ignore non-JSON frames (heartbeats)
      }
    }
  ).catch(() => { /* aborted or stream error — non-fatal */ });

  try {
    for (;;) {
      const job = (await sdk.jobs.byId(jobId)) as { status?: string };
      const status = job.status ?? 'queued';
      if (status === 'completed' || status === 'failed') {
        return status;
      }
      await sleep(500);
    }
  } finally {
    controller.abort();
    await streaming;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
