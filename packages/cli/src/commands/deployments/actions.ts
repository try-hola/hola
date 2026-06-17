import { HolaSdk } from '@hola/sdk';
import type { PostDeploymentActionResponse, RollbackResponse } from '@hola/shared';

import { watchJob, reportDeployError } from '../../lib/deploy-flow';

export interface ActionOptions {
  noStream?: boolean;
  json?: boolean;
}

/** stop/restart a deployment via POST /api/deployments/:id/actions, watching any job. */
export async function runDeploymentAction(
  action: 'stop' | 'restart',
  deploymentId: string,
  opts: ActionOptions,
  injected?: { sdk?: HolaSdk }
): Promise<{ jobId?: string; status?: string } | undefined> {
  const sdk = injected?.sdk ?? new HolaSdk();
  const out = (m: string) => console.log(m);
  try {
    out(`${action === 'stop' ? 'Stopping' : 'Restarting'} ${deploymentId}…`);
    const res = (await sdk.deployments.action(deploymentId, { action })) as PostDeploymentActionResponse;

    let status: string | undefined;
    if (res.jobId && !opts.noStream) {
      status = await watchJob(sdk, res.jobId, (m) => out(m));
    } else if (res.jobId) {
      const job = (await sdk.jobs.byId(res.jobId)) as { status?: string };
      status = job.status ?? 'queued';
    }

    if (opts.json) {
      console.log(JSON.stringify({ ...res, status }, null, 2));
    } else {
      out(status ? `Done (${status}).` : 'Done.');
    }
    if (status === 'failed') process.exitCode = 1;
    return { jobId: res.jobId, status };
  } catch (err) {
    return reportDeployError(err);
  }
}

export interface RollbackOptions extends ActionOptions {
  to?: string;
  reason?: string;
}

/** Roll a deployment back via POST /api/deployments/:id/rollback, watching the job. */
export async function runRollback(
  deploymentId: string,
  opts: RollbackOptions,
  injected?: { sdk?: HolaSdk }
): Promise<RollbackResponse | undefined> {
  const sdk = injected?.sdk ?? new HolaSdk();
  const out = (m: string) => console.log(m);
  try {
    out(`Rolling back ${deploymentId}${opts.to ? ` to ${opts.to}` : ' to the previous release'}…`);
    const res = (await sdk.deployments.rollback(deploymentId, {
      ...(opts.to ? { targetReleaseId: opts.to } : {}),
      ...(opts.reason ? { reason: opts.reason } : {}),
    })) as RollbackResponse;
    out(`Target release ${res.targetReleaseId} (was ${res.previousReleaseId}).`);

    let status: string | undefined;
    if (res.jobId && !opts.noStream) {
      status = await watchJob(sdk, res.jobId, (m) => out(m));
    } else if (res.jobId) {
      const job = (await sdk.jobs.byId(res.jobId)) as { status?: string };
      status = job.status ?? 'queued';
    }

    if (opts.json) {
      console.log(JSON.stringify({ ...res, status }, null, 2));
    } else {
      out(status ? `Done (${status}).` : 'Done.');
    }
    if (status === 'failed') process.exitCode = 1;
    return res;
  } catch (err) {
    return reportDeployError(err);
  }
}
