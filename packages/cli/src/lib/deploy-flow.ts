import { HolaApiError, HolaSdk } from '@hola/sdk';
import { API } from '@hola/shared';
import type { CreateDeploymentFromDraftResponse } from '@hola/shared';

import { streamSSE } from './sse';

/** Raised after a user-facing failure has been reported; callers set the exit code. */
export class DeployAbort extends Error {}

export interface DeployResult {
  deploymentId: string;
  releaseId: string;
  jobId?: string;
  status: string;
  /** Release channel the new deployment follows (#428); `stable` when absent
   *  on the create response (older server, or the deployment is on stable). */
  channel?: string;
}

/**
 * The shared tail of every deploy: validate → preflight → finalize → create
 * deployment → watch the job. Used by `install` (draft seeded from the
 * catalog). Throws `DeployAbort` on validation/preflight failure (after
 * reporting it).
 */
export async function finalizeAndDeploy(
  sdk: HolaSdk,
  draftId: string,
  opts: { name?: string; strict?: boolean; noStream?: boolean; allowMultiple?: boolean; profiles?: string[]; grants?: string[] },
  out: (msg: string) => void
): Promise<DeployResult> {
  out('Validating…');
  const report = (await sdk.drafts.validate(draftId)) as {
    ok?: boolean; errors?: Array<{ message: string }>; warnings?: Array<{ message: string }>;
  };
  for (const w of report.warnings ?? []) out(`  warning: ${w.message}`);
  if (report.errors?.length) {
    for (const e of report.errors) console.error(`  error: ${e.message}`);
    if (opts.strict || report.ok === false) throw new DeployAbort('Validation failed.');
  }

  out('Preflight…');
  const preflight = (await sdk.drafts.preflight(draftId)) as {
    ok?: boolean; checks?: Array<{ name: string; status: string; detail?: string }>;
  };
  for (const c of preflight.checks ?? []) {
    if (c.status !== 'pass') out(`  ${c.status}: ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  }
  // `preflight.ok` is the server's "everything perfect" flag — it is false on ANY
  // non-pass check, including advisory WARNINGS (disk under the 2 GB soft threshold,
  // an image not yet pulled locally, an unconventional env-var name). Those must not
  // block a normal install — only a hard `fail` check does (Docker down, a port or
  // routing conflict, an env ERROR). `--strict` still gates on the full `ok` flag
  // for callers (e.g. CI) that want a spotless preflight.
  const hardFail = (preflight.checks ?? []).some(c => c.status === 'fail');
  if (opts.strict ? preflight.ok === false : hardFail) {
    throw new DeployAbort('Preflight failed.');
  }

  out('Finalizing…');
  await sdk.drafts.finalize(draftId);

  out('Creating deployment…');
  const dep = (await sdk.deployments.create({ draftId, name: opts.name, allowMultiple: opts.allowMultiple, profiles: opts.profiles, grants: opts.grants })) as CreateDeploymentFromDraftResponse;
  out(`Deployment ${dep.deploymentId} created (release ${dep.releaseId}).`);

  let status = 'created';
  if (dep.jobId && !opts.noStream) {
    status = await watchJob(sdk, dep.jobId, out);
  } else if (dep.jobId) {
    const job = (await sdk.jobs.byId(dep.jobId)) as { status?: string };
    status = job.status ?? 'queued';
  }

  return { deploymentId: dep.deploymentId, releaseId: dep.releaseId, jobId: dep.jobId, status, channel: dep.channel };
}

/** Stream job logs and poll until the job reaches a terminal state. */
export async function watchJob(sdk: HolaSdk, jobId: string, out: (msg: string) => void): Promise<string> {
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

/**
 * Whether an error is an API 401. The SDK now throws `HolaApiError` carrying the
 * server's OWN message ("Authentication required" / "Invalid key"), which no
 * longer contains the status or the word "unauthorized" the old
 * `HTTP <status> <statusText>` message did — so the status is checked first and
 * the text sniff only remains as the fallback for non-SDK/legacy errors.
 */
export function isUnauthorizedError(err: unknown): boolean {
  if (err instanceof HolaApiError && err.status === 401) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /401|unauthor/i.test(msg);
}

/** Map a CLI error to a friendly message + non-zero exit code. Returns undefined. */
export function reportDeployError(err: unknown): undefined {
  if (err instanceof DeployAbort) {
    console.error(err.message);
    process.exitCode = 1;
    return undefined;
  }
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Failed: ${msg}`);
  if (isUnauthorizedError(err)) console.error('Hint: set HOLA_TOKEN to your admin API key.');
  if (/fetch failed|ECONNREFUSED|network|connect/i.test(msg)) console.error('Hint: set HOLA_API_URL (default http://localhost:3001).');

  // Structured ALREADY_INSTALLED conflict (spec 005, contracts/cli.md): the
  // server names the existing copy in `details` rather than in the message
  // (which is deliberately surface-neutral, SC-003 — it contains none of
  // these flags itself), so the hint is built from `details`, not sniffed
  // from the message text.
  const details = err instanceof HolaApiError
    ? (err.details as { code?: string; existing?: { id: string; name: string; channel: string }; channelPublished?: boolean } | undefined)
    : undefined;
  if (details?.code === 'ALREADY_INSTALLED' && details.existing) {
    const { id, name, channel } = details.existing;
    const channelClause = details.channelPublished
      ? `install a separate copy on another published channel with '--channel <name>', `
      : '';
    console.error(
      `Hint: '${name}' (${id}) already follows ${channel}. Switch it with 'hola channel ${id} <channel>', ` +
        channelClause +
        `or force a second copy with '--allow-multiple --name ${name}-2'.`,
    );
  }
  // #246: a single-instance app already installed (older/untyped error shape,
  // e.g. a pre-spec-005 server) — the message already names the
  // --allow-multiple escape hatch, but pair it with the distinct-name it needs.
  else if (/single-instance/i.test(msg)) console.error('Hint: pass a distinct name too, e.g. --allow-multiple --name myapp-2.');
  // A taken/reserved/invalid subdomain — the instance name must be distinct.
  else if (/is already in use|reserved by a core|valid DNS label/i.test(msg)) {
    console.error('Hint: choose a different instance name with --name (e.g. --name myapp-2).');
  }
  process.exitCode = 1;
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
