import { HolaSdk } from '@hola/sdk';
import type { DeploymentDetail, PatchDeploymentResponse } from '@hola/shared';
import { isEligibleOnChannel, STABLE_CHANNEL } from '@hola/shared';

import { reportDeployError } from '../../lib/deploy-flow';
import { maybeNotifyUpdate } from '../../lib/update-notice';

export interface ChannelOptions {
  json?: boolean;
}

/**
 * `hola channel <deploymentId> [channel]` — show or change the release
 * channel a deployment follows (spec 005, R10).
 *
 * With no `channel`, prints what this copy follows and what it's currently
 * running. With a `channel`, PATCHes it — a metadata-only write (no job, no
 * restart) — then re-reads the detail so it can report the honest "stays
 * behind" state when the running build isn't eligible on the new channel.
 */
export async function runChannel(
  deploymentId: string,
  channel: string | undefined,
  opts: ChannelOptions,
  injected?: { sdk?: HolaSdk }
): Promise<DeploymentDetail | PatchDeploymentResponse | undefined> {
  const sdk = injected?.sdk ?? new HolaSdk();
  const out = (m: string) => console.log(m);
  try {
    if (!channel) {
      const detail = (await sdk.deployments.byId(deploymentId)) as DeploymentDetail;
      if (opts.json) {
        console.log(JSON.stringify(detail, null, 2));
      } else {
        out(`Follows: ${detail.channel ?? STABLE_CHANNEL}`);
        out(
          detail.versionChannel
            ? `Running: ${detail.version} (${detail.versionChannel} build)`
            : `Running: ${detail.version}`
        );
      }
      await maybeNotifyUpdate(sdk, opts);
      return detail;
    }

    const res = (await sdk.deployments.update(deploymentId, { channel })) as PatchDeploymentResponse;
    const detail = (await sdk.deployments.byId(deploymentId)) as DeploymentDetail;

    if (opts.json) {
      console.log(JSON.stringify({ ...detail, warnings: res.warnings }, null, 2));
    } else {
      out(`Now follows: ${channel}`);
      for (const w of res.warnings ?? []) out(`Warning: ${w}`);
      if (detail.versionChannel && !isEligibleOnChannel(detail.versionChannel, channel)) {
        // Name the channel actually being followed: anything eligible on it —
        // its own releases OR the stable floor — takes this copy forward, so
        // saying "a stable release" is only right when `channel` IS stable.
        const eligible = channel === STABLE_CHANNEL ? 'a stable release' : `a ${channel} or stable release`;
        out(`Stays on ${detail.version} until ${eligible} at or above it is published.`);
      }
    }
    await maybeNotifyUpdate(sdk, opts);
    return res;
  } catch (err) {
    return reportDeployError(err);
  }
}
