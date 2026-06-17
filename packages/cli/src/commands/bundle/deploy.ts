import { HolaSdk } from '@hola/sdk';
import type { CreateDraftResponse, AppEnvVar } from '@hola/shared';
import { promises as fs } from 'fs';
import path from 'path';

import { DeployAbort, finalizeAndDeploy, reportDeployError, type DeployResult } from '../../lib/deploy-flow';

export interface BundleDeployOptions {
  path?: string;
  appId?: string;
  version?: string;
  port?: number | string;
  traefik?: boolean;
  noStream?: boolean;
  json?: boolean;
  strict?: boolean;
}

export type BundleDeployResult = DeployResult;

const COMPOSE_CANDIDATES = ['docker-compose.yaml', 'docker-compose.yml', 'compose.yaml', 'compose.yml'];

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
 * One-shot bundle deploy: import → draft → update → (validate → preflight →
 * finalize → deploy → watch). Returns the result, or undefined on failure
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
    const port = opts.port !== undefined ? Number(opts.port) : undefined;
    await sdk.drafts.update(draft.draftId, {
      composeOverride,
      ...(appEnv.length ? { appEnv } : {}),
      ...(port && Number.isFinite(port) ? { ports: [{ container: port, protocol: 'tcp' }] } : {}),
    });

    const result = await finalizeAndDeploy(sdk, draft.draftId, { name: appId, strict: opts.strict, noStream: opts.noStream }, out);

    if (opts.json) console.log(JSON.stringify(result, null, 2));
    else out(`Done. Job status: ${result.status}`);
    if (result.status === 'failed' || result.status === 'error') process.exitCode = 1;
    return result;
  } catch (err) {
    return reportDeployError(err);
  }
}
