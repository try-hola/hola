// Live (network/host) validation run after the wizard collects answers, so config
// mistakes surface on the laptop in seconds instead of at `docker compose up`.
// Every dependency is injectable so tests run fully offline. Checks are advisory:
// they never throw — the wizard prints them and continues.

import type { ConfigMap } from './schema';

export type CheckStatus = 'pass' | 'warn' | 'fail';
export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail?: string;
}

export interface CheckDeps {
  /** DNS resolve; resolves with addresses or rejects. */
  lookup: (host: string) => Promise<unknown>;
  fetchImpl: typeof fetch;
  /** Run a command; resolves with exit code (rejects if the binary is missing). */
  exec: (cmd: string, args: string[]) => Promise<{ code: number; stderr: string }>;
}

function defaultDeps(): CheckDeps {
  return {
    lookup: async (host) => {
      const dns = await import('node:dns/promises');
      return dns.lookup(host);
    },
    fetchImpl: (...args: Parameters<typeof fetch>) => fetch(...args),
    exec: (cmd, args) =>
      new Promise((resolve, reject) => {
        import('node:child_process').then(({ spawn }) => {
          const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
          let stderr = '';
          child.stderr?.on('data', (d) => { stderr += String(d); });
          child.on('error', (e: NodeJS.ErrnoException) => {
            if (e.code === 'ENOENT') reject(e); // binary missing → caller treats as "not found"
            else resolve({ code: 1, stderr: e.message });
          });
          child.on('close', (code) => resolve({ code: code ?? 1, stderr }));
        }, reject);
      }),
  };
}

export async function runChecks(config: ConfigMap, deps: CheckDeps = defaultDeps()): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // DNS resolution — warn-only (DNS is often configured after install).
  const domains = [config.HOLA_DOMAIN, config.TRAEFIK_DASHBOARD_DOMAIN];
  if (config.HOLA_AUTH_MODE === 'authentik') domains.push(config.HOLA_AUTHENTIK_DOMAIN);
  for (const domain of domains.filter(Boolean)) {
    try {
      await deps.lookup(domain);
      results.push({ name: `DNS: ${domain}`, status: 'pass' });
    } catch {
      results.push({ name: `DNS: ${domain}`, status: 'warn', detail: 'does not resolve yet (set the record before going live)' });
    }
  }

  // Catalog reachability.
  if (config.HOLA_CATALOG_URL?.trim()) {
    try {
      const res = await deps.fetchImpl(config.HOLA_CATALOG_URL, { method: 'GET' });
      results.push(
        res.ok
          ? { name: 'Catalog URL', status: 'pass' }
          : { name: 'Catalog URL', status: 'warn', detail: `HTTP ${res.status}` }
      );
    } catch (e) {
      results.push({ name: 'Catalog URL', status: 'warn', detail: e instanceof Error ? e.message : 'unreachable' });
    }
  }

  // Cloudflare token — a cheap, authoritative verify endpoint (plain fetch).
  if (config.ACME_DNS_PROVIDER === 'cloudflare' && config.CF_DNS_API_TOKEN) {
    try {
      const res = await deps.fetchImpl('https://api.cloudflare.com/client/v4/user/tokens/verify', {
        headers: { Authorization: `Bearer ${config.CF_DNS_API_TOKEN}` },
      });
      results.push(
        res.ok
          ? { name: 'Cloudflare token', status: 'pass' }
          : { name: 'Cloudflare token', status: 'fail', detail: `rejected (HTTP ${res.status})` }
      );
    } catch (e) {
      results.push({ name: 'Cloudflare token', status: 'warn', detail: e instanceof Error ? e.message : 'verify failed' });
    }
  }

  // Route 53 — no AWS SDK bundled; best-effort via the aws CLI if present.
  if (config.ACME_DNS_PROVIDER === 'route53') {
    try {
      const env = withAwsEnv(config);
      const { code, stderr } = await runWithEnv(deps, env, 'aws', ['sts', 'get-caller-identity', '--output', 'text']);
      results.push(
        code === 0
          ? { name: 'AWS credentials', status: 'pass' }
          : { name: 'AWS credentials', status: 'fail', detail: firstLine(stderr) || `aws exited ${code}` }
      );
    } catch {
      results.push({
        name: 'AWS credentials',
        status: 'warn',
        detail: 'aws CLI not found — credentials will be verified on the host at cert issuance',
      });
    }
  }

  return results;
}

function withAwsEnv(config: ConfigMap): Record<string, string> {
  const env: Record<string, string> = {};
  if (config.AWS_ACCESS_KEY_ID) env.AWS_ACCESS_KEY_ID = config.AWS_ACCESS_KEY_ID;
  if (config.AWS_SECRET_ACCESS_KEY) env.AWS_SECRET_ACCESS_KEY = config.AWS_SECRET_ACCESS_KEY;
  if (config.AWS_REGION) env.AWS_REGION = config.AWS_REGION;
  return env;
}

// exec() in CheckDeps doesn't take env; for the aws check we temporarily set the
// vars on process.env around the call (single-threaded, restored in finally).
async function runWithEnv(
  deps: CheckDeps,
  env: Record<string, string>,
  cmd: string,
  args: string[]
): Promise<{ code: number; stderr: string }> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return await deps.exec(cmd, args);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// First NON-EMPTY line. The aws CLI prefixes its error with blank lines
// (`\n\naws: [ERROR]: An error occurred (SignatureDoesNotMatch) ...`), so taking
// line[0] would drop the actual reason and leave only "aws exited <code>".
function firstLine(s: string): string {
  return s.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
}
