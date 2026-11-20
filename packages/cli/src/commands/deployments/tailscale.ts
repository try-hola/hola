import { readFile } from 'node:fs/promises';

import { HolaSdk } from '@hola/sdk';
import type {
  DisableTailscaleIngressResponse,
  GetDeploymentResponse,
  GetTailscaleIngressResponse,
  SetTailscaleIngressRequest,
  SetTailscaleIngressResponse,
  TailscaleIngressGuidance,
} from '@hola/shared';

import { watchJob, reportDeployError, DeployAbort } from '../../lib/deploy-flow';
import { maybeNotifyUpdate } from '../../lib/update-notice';
import { clackPrompter, PromptCancelled, type Prompter } from '../../install/prompter';

/**
 * Opt-in private Tailscale ingress (spec 010): `hola tailscale`,
 * `tailscale enable`, `tailscale login`, `tailscale disable`.
 *
 * The joining credential is read ONLY from `--auth-key-file <path>` or
 * `--auth-key-stdin`. There is deliberately no flag that takes it as a value
 * and no positional that accepts it (either would land in shell history and
 * the process list), and it is never printed: it goes into one request body
 * and nowhere else.
 */

export interface TailscaleOptions {
  json?: boolean;
  yes?: boolean;
  noStream?: boolean;
  service?: string;
  tag?: string;
  backend?: string;
  mode?: string;
  port?: number | string;
  authKeyFile?: string | boolean;
  authKeyStdin?: boolean;
  ackForwardAuth?: boolean;
  refresh?: boolean;
  /** Stray positionals / forbidden flag values land here from sade; never read for a value. */
  _?: unknown[];
  authKey?: unknown;
}

export interface TailscaleInjected {
  sdk?: HolaSdk;
  prompter?: Prompter;
  /** Whether a human can answer a prompt. Default: stdin is a TTY. */
  isTTY?: boolean;
  /** Reads all of stdin. Default: process.stdin. */
  readStdin?: () => Promise<string>;
  /** Reads a file as text. Default: node:fs. */
  readFile?: (path: string) => Promise<string>;
}

const out = (m: string) => console.log(m);

async function defaultReadStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
  return Buffer.concat(chunks).toString('utf8');
}

function abort(message: string): never {
  throw new DeployAbort(message);
}

/** Refuse any attempt to pass the credential by flag value or positional. Never echoes the value. */
function assertNoInlineCredential(opts: TailscaleOptions, allowedPositionals = 0): void {
  if (opts.authKey !== undefined) {
    abort(
      'The credential cannot be passed as a flag value (it would land in shell history and the process list). ' +
        'Use --auth-key-file <path> or --auth-key-stdin.',
    );
  }
  if ((opts._?.length ?? 0) > allowedPositionals) {
    abort(
      'Unexpected extra argument. The credential cannot be passed as an argument; use --auth-key-file <path> or --auth-key-stdin.',
    );
  }
}

/** Resolve the credential from the one permitted source, trimmed. Undefined when none was requested. */
async function readCredential(opts: TailscaleOptions, injected?: TailscaleInjected): Promise<string | undefined> {
  const hasFile = opts.authKeyFile !== undefined && opts.authKeyFile !== false;
  if (hasFile && opts.authKeyStdin) abort('Use only one of --auth-key-file and --auth-key-stdin.');
  let raw: string | undefined;
  if (hasFile) {
    if (typeof opts.authKeyFile !== 'string' || opts.authKeyFile === '') abort('--auth-key-file needs a path.');
    if (opts.authKeyFile === '-') abort("--auth-key-file does not accept '-'. Use --auth-key-stdin to read from standard input.");
    try {
      raw = await (injected?.readFile ?? ((p) => readFile(p, 'utf8')))(opts.authKeyFile);
    } catch {
      abort(`Could not read the credential file '${opts.authKeyFile}'.`);
    }
  } else if (opts.authKeyStdin) {
    raw = await (injected?.readStdin ?? defaultReadStdin)();
  }
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) abort('The credential source was empty.');
  return trimmed;
}

function intOpt(name: string, v: number | string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 65535) abort(`${name} must be an integer from 1 to 65535.`);
  return n;
}

/** `<service>:<port>`, `<service>` or `:<port>`. */
function parseBackend(v: string): { service?: string; port?: number } {
  const i = v.lastIndexOf(':');
  const svc = i === -1 ? v : v.slice(0, i);
  const portStr = i === -1 ? undefined : v.slice(i + 1);
  return {
    ...(svc ? { service: svc } : {}),
    ...(portStr ? { port: intOpt('--backend port', portStr) } : {}),
  };
}

function printGuidance(g: TailscaleIngressGuidance): void {
  out('');
  out('Setup guide (steps to do on the Tailscale side)');
  if (g.prerequisites.length) {
    out('Prerequisites:');
    for (const p of g.prerequisites) out(`  - ${p}`);
  }
  g.steps.forEach((s, i) => {
    out(`${i + 1}. ${s.title}`);
    out(`   ${s.detail}`);
    if (s.snippet) for (const l of s.snippet.split('\n')) out(`     ${l}`);
  });
  if (g.notes.length) {
    out('Notes:');
    for (const n of g.notes) out(`  - ${n}`);
  }
}

async function confirm(
  message: string,
  opts: TailscaleOptions,
  injected?: TailscaleInjected,
): Promise<boolean> {
  if (opts.yes) return true;
  const tty = injected?.isTTY ?? Boolean(process.stdin.isTTY);
  if (!tty) {
    abort('This restarts the app and needs confirmation, but there is no terminal to ask on. Re-run with --yes.');
  }
  const prompter = injected?.prompter ?? clackPrompter();
  const answer = await prompter.prompt({ key: 'confirm', type: 'confirm', message, default: 'false' });
  return answer === 'true';
}

async function isRunning(sdk: HolaSdk, deploymentId: string): Promise<{ running: boolean; name: string }> {
  const dep = (await sdk.deployments.byId(deploymentId)) as GetDeploymentResponse;
  return { running: dep?.status === 'running', name: dep?.name ?? deploymentId };
}

/** Watch a job unless `--no-stream`; returns its terminal status. */
async function followJob(sdk: HolaSdk, jobId: string | undefined, opts: TailscaleOptions): Promise<string | undefined> {
  if (!jobId) return undefined;
  if (opts.noStream) {
    const job = (await sdk.jobs.byId(jobId)) as { status?: string };
    return job.status ?? 'queued';
  }
  return watchJob(sdk, jobId, (m) => out(m));
}

/** `hola tailscale <deploymentId>` — show the setting, live status and guidance. */
export async function runTailscaleShow(
  deploymentId: string,
  opts: TailscaleOptions,
  injected?: TailscaleInjected,
): Promise<GetTailscaleIngressResponse | undefined> {
  const sdk = injected?.sdk ?? new HolaSdk();
  try {
    const res = (await sdk.deployments.tailscaleIngress.get(deploymentId, { refresh: opts.refresh })) as GetTailscaleIngressResponse;
    if (opts.json) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      const { setting, status } = res;
      if (!setting) {
        out('Private Tailscale ingress: off');
        out(`Enable it with: hola tailscale enable ${deploymentId} --service svc:<name> --tag ${res.defaults.tag} --auth-key-file <path>`);
      } else {
        out(`State: ${status.state}${status.message ? ` - ${status.message}` : ''}`);
        out(`Service: ${setting.serviceName} (tag ${setting.tag}, device ${setting.nodeName})`);
        out(`Backend: ${setting.backend.service}:${setting.backend.port} (${setting.mode}, listening on ${setting.listenPort})`);
        out(`Credential held: ${res.credentialHeld ? 'yes' : 'no'}`);
        if (status.dnsName) {
          const scheme = setting.mode === 'https' ? 'https://' : '';
          const port = status.port && !(setting.mode === 'https' && status.port === 443) ? `:${status.port}` : '';
          out(`Address: ${scheme}${status.dnsName}${port}`);
        }
        if (status.addresses?.length) out(`Tailnet addresses: ${status.addresses.join(', ')}`);
        if (status.action) out(`Action: ${status.action}`);
      }
      printGuidance(res.guidance);
    }
    await maybeNotifyUpdate(sdk, opts);
    return res;
  } catch (err) {
    return reportDeployError(err, { json: opts.json });
  }
}

/** `hola tailscale enable <deploymentId>` — enable or replace the setting. */
export async function runTailscaleEnable(
  deploymentId: string,
  opts: TailscaleOptions,
  injected?: TailscaleInjected,
): Promise<SetTailscaleIngressResponse | undefined> {
  const sdk = injected?.sdk ?? new HolaSdk();
  try {
    assertNoInlineCredential(opts);
    if (!opts.service) abort("--service is required (e.g. --service svc:omnigraph).");
    if (!opts.tag) abort('--tag is required (e.g. --tag tag:hola-ingress).');
    if (opts.mode !== undefined && opts.mode !== 'https' && opts.mode !== 'tcp') abort("--mode must be 'https' or 'tcp'.");
    const backend = opts.backend ? parseBackend(opts.backend) : undefined;
    const listenPort = intOpt('--port', opts.port);

    const { running, name } = await isRunning(sdk, deploymentId);
    // Decided BEFORE stdin is read: once the credential has been read to EOF
    // there is no input left to answer the restart confirmation on, so on a
    // terminal the operator would type the key and then be aborted anyway.
    if (running && opts.authKeyStdin && !opts.yes) {
      abort('--auth-key-stdin reads the credential from standard input, so it cannot also answer the restart confirmation. Re-run with --yes.');
    }
    const authKey = await readCredential(opts, injected);
    if (running) {
      out(`${name} is running: enabling private ingress restarts it briefly.`);
      if (!(await confirm(`Enable private Tailscale ingress for ${name} and restart it?`, opts, injected))) {
        out('Aborted.');
        return undefined;
      }
    }

    const body: SetTailscaleIngressRequest = {
      serviceName: opts.service,
      tag: opts.tag,
      ...(backend ? { backend } : {}),
      ...(opts.mode ? { mode: opts.mode as 'https' | 'tcp' } : {}),
      ...(listenPort !== undefined ? { listenPort } : {}),
      ...(opts.ackForwardAuth ? { acknowledgeForwardAuthBypass: true } : {}),
      ...(authKey ? { authKey } : {}),
    };
    return await applySetting(sdk, deploymentId, body, opts);
  } catch (err) {
    return handleError(err, opts);
  }
}

/** `hola tailscale login <deploymentId>` — supply a new credential, leaving the setting unchanged. */
export async function runTailscaleLogin(
  deploymentId: string,
  opts: TailscaleOptions,
  injected?: TailscaleInjected,
): Promise<SetTailscaleIngressResponse | undefined> {
  const sdk = injected?.sdk ?? new HolaSdk();
  try {
    assertNoInlineCredential(opts);
    const authKey = await readCredential(opts, injected);
    if (!authKey) abort('Supply the new credential with --auth-key-file <path> or --auth-key-stdin.');

    const cur = (await sdk.deployments.tailscaleIngress.get(deploymentId)) as GetTailscaleIngressResponse;
    const s = cur.setting;
    if (!s) abort(`Private ingress is not enabled for ${deploymentId}. Use 'hola tailscale enable' first.`);
    const body: SetTailscaleIngressRequest = {
      serviceName: s.serviceName,
      tag: s.tag,
      backend: s.backend,
      mode: s.mode,
      listenPort: s.listenPort,
      ...(s.forwardAuthAcknowledged ? { acknowledgeForwardAuthBypass: true } : {}),
      authKey,
    };
    return await applySetting(sdk, deploymentId, body, opts);
  } catch (err) {
    return handleError(err, opts);
  }
}

/** `hola tailscale disable <deploymentId>` — turn private ingress off. */
export async function runTailscaleDisable(
  deploymentId: string,
  opts: TailscaleOptions,
  injected?: TailscaleInjected,
): Promise<DisableTailscaleIngressResponse | undefined> {
  const sdk = injected?.sdk ?? new HolaSdk();
  try {
    assertNoInlineCredential(opts);
    const cur = (await sdk.deployments.tailscaleIngress.get(deploymentId)) as GetTailscaleIngressResponse;
    const device = cur.setting?.nodeName;
    const { running, name } = await isRunning(sdk, deploymentId);

    if (running) {
      out(`${name} is running: disabling private ingress restarts it briefly.`);
    }
    if (device) {
      out(`The Tailscale device '${device}' may remain in your admin console; delete it there if it is not removed automatically.`);
    }
    if (running || device) {
      if (!(await confirm(`Disable private Tailscale ingress for ${name}${device ? ` (device ${device})` : ''}?`, opts, injected))) {
        out('Aborted.');
        return undefined;
      }
    }

    const res = (await sdk.deployments.tailscaleIngress.disable(deploymentId)) as DisableTailscaleIngressResponse;
    const status = await followJob(sdk, res.jobId, opts);
    if (opts.json) {
      console.log(JSON.stringify({ ...res, ...(status ? { status } : {}) }, null, 2));
    } else {
      if (res.removal?.message) out(res.removal.message);
      out(status ? `Done (${status}).` : 'Done.');
    }
    if (status === 'failed') process.exitCode = 1;
    await maybeNotifyUpdate(sdk, opts);
    return res;
  } catch (err) {
    return handleError(err, opts);
  }
}

async function applySetting(
  sdk: HolaSdk,
  deploymentId: string,
  body: SetTailscaleIngressRequest,
  opts: TailscaleOptions,
): Promise<SetTailscaleIngressResponse> {
  const res = (await sdk.deployments.tailscaleIngress.set(deploymentId, body)) as SetTailscaleIngressResponse;
  const status = await followJob(sdk, res.jobId, opts);
  if (opts.json) {
    console.log(JSON.stringify({ ...res, ...(status ? { status } : {}) }, null, 2));
  } else {
    for (const w of res.warnings ?? []) out(`Warning: ${w}`);
    out(status ? `Done (${status}).` : 'Done.');
    out(`Check progress with: hola tailscale ${deploymentId}`);
  }
  if (status === 'failed') process.exitCode = 1;
  await maybeNotifyUpdate(sdk, opts);
  return res;
}

function handleError(err: unknown, opts: TailscaleOptions): undefined {
  if (err instanceof PromptCancelled) {
    out('Aborted.');
    return undefined;
  }
  return reportDeployError(err, { json: opts.json });
}
