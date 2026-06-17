import { HolaSdk } from '@hola/sdk';
import type { CreateDraftResponse, GetDraftResponse, AppEnvVar } from '@hola/shared';

import { finalizeAndDeploy, reportDeployError, type DeployResult } from '../../lib/deploy-flow';

export interface InstallOptions {
  version?: string;
  name?: string;
  set?: string | string[];
  noStream?: boolean;
  json?: boolean;
  strict?: boolean;
}

/** Parse repeated `--set KEY=VALUE` into a map. */
function parseSet(set?: string | string[]): Record<string, string> {
  const items = set === undefined ? [] : Array.isArray(set) ? set : [set];
  const out: Record<string, string> = {};
  for (const item of items) {
    const eq = String(item).indexOf('=');
    if (eq <= 0) throw new Error(`Invalid --set '${item}' (expected KEY=VALUE)`);
    out[String(item).slice(0, eq).trim()] = String(item).slice(eq + 1);
  }
  return out;
}

/**
 * Install a catalog app by id: create a draft (the server seeds compose/env from
 * the catalog bundle), apply any `--set` env overrides, then validate → preflight
 * → finalize → deploy → watch. Uses only existing endpoints — the same flow the
 * web install wizard drives.
 */
export async function runInstall(
  appId: string,
  opts: InstallOptions,
  injected?: { sdk?: HolaSdk }
): Promise<DeployResult | undefined> {
  const sdk = injected?.sdk ?? new HolaSdk();
  const version = opts.version ?? 'latest';
  const name = opts.name ?? appId;
  const out = (msg: string) => { if (!opts.json) console.log(msg); };

  try {
    const overrides = parseSet(opts.set);

    out(`Creating draft for ${appId}@${version} (from catalog)`);
    const draft = (await sdk.drafts.create({ appId, version })) as CreateDraftResponse;

    // Apply env overrides onto the catalog-seeded appEnv (merge by key).
    if (Object.keys(overrides).length) {
      const current = (await sdk.drafts.byId(draft.draftId)) as GetDraftResponse;
      const appEnv: AppEnvVar[] = [...(current.appEnv ?? [])];
      for (const [key, value] of Object.entries(overrides)) {
        const existing = appEnv.find(e => e.key === key);
        if (existing) existing.value = value;
        else appEnv.push({ key, value, isSecret: false });
      }
      await sdk.drafts.update(draft.draftId, { appEnv });
    }

    const result = await finalizeAndDeploy(sdk, draft.draftId, { name, strict: opts.strict, noStream: opts.noStream }, out);

    if (opts.json) console.log(JSON.stringify(result, null, 2));
    else out(`Done. ${appId} → job status: ${result.status}`);
    if (result.status === 'failed' || result.status === 'error') process.exitCode = 1;
    return result;
  } catch (err) {
    return reportDeployError(err);
  }
}
