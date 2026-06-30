import { HolaSdk } from '@hola/sdk';
import type { GetDeploymentResponse, PostDeploymentActionResponse, RollbackResponse, PromoteDeploymentResponse } from '@hola/shared';

import { watchJob, reportDeployError } from '../../lib/deploy-flow';
import { maybeNotifyUpdate } from '../../lib/update-notice';
import { clackPrompter, PromptCancelled, type Prompter } from '../../install/prompter';

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
    await maybeNotifyUpdate(sdk, opts);
    return { jobId: res.jobId, status };
  } catch (err) {
    return reportDeployError(err);
  }
}

export interface RollbackOptions extends ActionOptions {
  to?: string;
  reason?: string;
}

export interface UpgradeOptions extends ActionOptions {
  /** Target catalog version (default: the deployment's latest available version). */
  appVersion?: string;
  /** Force a pre-upgrade snapshot even when the target doesn't require one. */
  snapshot?: boolean;
}

/** Upgrade a deployment to a newer catalog version via POST /api/deployments/:id/promote.
 *  The server carries the current env/secrets forward and runs the upgrade skip-guard +
 *  pre-upgrade snapshot before switching the active release. */
export async function runUpgrade(
  deploymentId: string,
  opts: UpgradeOptions,
  injected?: { sdk?: HolaSdk }
): Promise<PromoteDeploymentResponse | undefined> {
  const sdk = injected?.sdk ?? new HolaSdk();
  const out = (m: string) => console.log(m);
  try {
    out(`Upgrading ${deploymentId}${opts.appVersion ? ` to ${opts.appVersion}` : ' to the latest version'}…`);
    const res = (await sdk.deployments.promote(deploymentId, {
      ...(opts.appVersion ? { version: opts.appVersion } : {}),
      ...(opts.snapshot ? { snapshot: true } : {}),
    })) as PromoteDeploymentResponse;

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
    await maybeNotifyUpdate(sdk, opts);
    return res;
  } catch (err) {
    return reportDeployError(err);
  }
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
    await maybeNotifyUpdate(sdk, opts);
    return res;
  } catch (err) {
    return reportDeployError(err);
  }
}

export interface UninstallOptions {
  yes?: boolean;
  json?: boolean;
}

/**
 * Uninstall a deployment via DELETE /api/deployments/:id — stops its containers,
 * deprovisions auth, and removes its record, releases, and data. Destructive and
 * synchronous (no job to watch); confirms first unless `--yes`.
 */
export async function runUninstall(
  deploymentId: string,
  opts: UninstallOptions,
  injected?: { sdk?: HolaSdk; prompter?: Prompter }
): Promise<{ uninstalled: string } | undefined> {
  const sdk = injected?.sdk ?? new HolaSdk();
  const out = (m: string) => console.log(m);
  try {
    // Resolve the name up front: confirms the deployment exists (fail fast on a
    // typo'd id) and makes the confirmation prompt unambiguous.
    let name = deploymentId;
    try {
      const dep = (await sdk.deployments.byId(deploymentId)) as GetDeploymentResponse;
      if (dep?.name) name = dep.name;
    } catch (err) {
      return reportDeployError(err);
    }

    if (!opts.yes) {
      const prompter = injected?.prompter ?? clackPrompter();
      const answer = await prompter.prompt({
        key: 'confirm',
        type: 'confirm',
        message: `Uninstall ${name} (${deploymentId})? This removes its containers, data, and auth.`,
        default: 'false',
      });
      if (answer !== 'true') {
        out('Aborted.');
        return undefined;
      }
    }

    out(`Uninstalling ${deploymentId}…`);
    await sdk.deployments.delete(deploymentId);

    if (opts.json) {
      console.log(JSON.stringify({ uninstalled: deploymentId }, null, 2));
    } else {
      out(`Uninstalled ${name}.`);
    }
    await maybeNotifyUpdate(sdk, opts);
    return { uninstalled: deploymentId };
  } catch (err) {
    if (err instanceof PromptCancelled) {
      console.log('Aborted.');
      return undefined;
    }
    return reportDeployError(err);
  }
}
