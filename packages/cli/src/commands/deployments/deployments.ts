import { HolaSdk } from '@hola/sdk';
import type { GetDeploymentsResponse } from '@hola/shared';

export interface DeploymentsListOptions {
  status?: string;
  json?: boolean;
}

/** List deployments (GET /api/deployments). */
export async function runDeploymentsList(
  opts: DeploymentsListOptions,
  injected?: { sdk?: HolaSdk }
): Promise<void> {
  const sdk = injected?.sdk ?? new HolaSdk();
  try {
    const res = (await sdk.deployments.list({
      ...(opts.status ? { status: opts.status as GetDeploymentsResponse['items'][number]['status'] } : {}),
      limit: 100,
    })) as GetDeploymentsResponse;

    if (opts.json) {
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    if (!res.items.length) {
      console.log('No deployments.');
      return;
    }
    const idWidth = Math.max(2, ...res.items.map(d => d.id.length));
    const nameWidth = Math.max(4, ...res.items.map(d => d.name.length));
    for (const d of res.items) {
      const url = d.url ? `  ${d.url}` : '';
      console.log(`${d.id.padEnd(idWidth)}  ${d.name.padEnd(nameWidth)}  ${d.status.padEnd(10)}${url}`);
    }
    console.log(`\n${res.total} deployment(s).`);
  } catch (err) {
    reportListError(err);
  }
}

export interface DeploymentLogsOptions {
  json?: boolean;
}

/** Print recent logs for a deployment (GET /api/deployments/:id/logs). */
export async function runDeploymentLogs(
  deploymentId: string,
  opts: DeploymentLogsOptions,
  injected?: { sdk?: HolaSdk }
): Promise<void> {
  const sdk = injected?.sdk ?? new HolaSdk();
  try {
    const res = (await sdk.deployments.logs(deploymentId)) as {
      entries?: Array<{ timestamp?: string; message?: string }>;
    };
    if (opts.json) {
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    const entries = res.entries ?? [];
    if (!entries.length) {
      console.log('No logs.');
      return;
    }
    for (const e of entries) {
      console.log(`${e.timestamp ? `${e.timestamp} ` : ''}${e.message ?? ''}`);
    }
  } catch (err) {
    reportListError(err);
  }
}

function reportListError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Failed: ${msg}`);
  if (/401|unauthor/i.test(msg)) console.error('Hint: set HOLA_TOKEN to your admin API key.');
  if (/fetch failed|ECONNREFUSED|network|connect/i.test(msg)) console.error('Hint: set HOLA_API_URL (default http://localhost:3001).');
  process.exitCode = 1;
}
