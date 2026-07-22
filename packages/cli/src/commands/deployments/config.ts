import { HolaSdk } from '@hola/sdk';
import type { AppEnvVar, GetDeploymentConfigResponse, PatchDeploymentResponse } from '@hola/shared';

import { watchJob, reportDeployError } from '../../lib/deploy-flow';
import { maybeNotifyUpdate } from '../../lib/update-notice';

export interface ConfigOptions {
  /** `KEY=VALUE` upserts (repeatable). */
  set?: string | string[];
  /** Keys to remove (repeatable). */
  unset?: string | string[];
  noStream?: boolean;
  json?: boolean;
}

/** Normalize a repeatable string option into an array (sade yields string | string[]). */
function toArray(v?: string | string[]): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** Parse `KEY=VALUE` upserts into env rows. `isSecret` is left false — the server
 *  re-imposes the manifest spec (incl. isSecret) on any key it already knows. */
function parseUpserts(set?: string | string[]): AppEnvVar[] {
  return toArray(set).map((item) => {
    const eq = String(item).indexOf('=');
    if (eq <= 0) throw new Error(`Invalid --set '${item}' (expected KEY=VALUE)`);
    return { key: String(item).slice(0, eq).trim(), value: String(item).slice(eq + 1), isSecret: false };
  });
}

/**
 * `hola config <deploymentId>` — view or edit a deployment's environment.
 *
 * With no `--set`/`--unset`, prints the current config. Otherwise sends a single
 * merge-by-key PATCH (issue #332): `--set` upserts a var, `--unset` removes one,
 * and any var not mentioned is left untouched. The PATCH restarts the app to
 * apply the change (watched unless `--no-stream`).
 */
export async function runConfig(
  deploymentId: string,
  opts: ConfigOptions,
  injected?: { sdk?: HolaSdk }
): Promise<PatchDeploymentResponse | GetDeploymentConfigResponse | undefined> {
  const sdk = injected?.sdk ?? new HolaSdk();
  const out = (m: string) => console.log(m);
  try {
    const upserts = parseUpserts(opts.set);
    const removeEnvKeys = toArray(opts.unset).map((k) => k.trim());

    // No mutation requested → show the current config.
    if (upserts.length === 0 && removeEnvKeys.length === 0) {
      const cfg = (await sdk.deployments.config(deploymentId)) as GetDeploymentConfigResponse;
      if (opts.json) {
        console.log(JSON.stringify(cfg, null, 2));
      } else {
        if (cfg.appEnv.length === 0) out('(no environment variables)');
        for (const e of cfg.appEnv) out(`${e.key}=${e.isSecret ? '***' : e.value}`);
        const overrides = Object.entries(cfg.systemOverrides ?? {});
        if (overrides.length > 0) {
          out('\n# system overrides');
          for (const [k, v] of overrides) out(`${k}=${v}`);
        }
      }
      await maybeNotifyUpdate(sdk, opts);
      return cfg;
    }

    const summary = [
      upserts.length ? `set ${upserts.map((u) => u.key).join(', ')}` : '',
      removeEnvKeys.length ? `unset ${removeEnvKeys.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    out(`Updating ${deploymentId} config (${summary})…`);

    const res = (await sdk.deployments.update(deploymentId, {
      ...(upserts.length ? { env: upserts } : {}),
      ...(removeEnvKeys.length ? { removeEnvKeys } : {}),
    })) as PatchDeploymentResponse;

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
