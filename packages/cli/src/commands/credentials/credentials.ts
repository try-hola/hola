import { promises as fs } from 'fs';
import path from 'path';

import { clackPrompter, PromptCancelled, type Prompter } from '../../install/prompter';
import { parseEnv } from '../../install/render-env';
import type { ConfigMap } from '../../install/schema';
import { systemRunner, type Runner } from '../../lib/runner';
import { createSpinner, colors } from '../../lib/ui';

export interface CredentialsOptions {
  host?: string;
  /** Install directory on the host (default /opt/hola). */
  dir?: string;
  /** Reveal the akadmin fallback password without prompting (no named admin). */
  showPassword?: boolean;
  json?: boolean;
}

export interface CredentialsResult {
  host: string;
  /** Where the local CLI credentials file was written (when auth is enabled). */
  credsPath?: string;
  apiUrl?: string;
  /** The one-time SSO password-setup link, when a named admin is configured. */
  recoveryLink?: string;
  adminEmail?: string;
}

const DEFAULT_DIR = '/opt/hola';

/** Filesystem-safe slug for a host (paul@vm → paul-vm), for the local creds filename. */
export function hostSlug(host: string): string {
  return host.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'host';
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface HandoffContext {
  host: string;
  composeDir: string;
  runner: Runner;
  prompter: Prompter;
  out: (msg: string) => void;
  /** Directory the local creds file is written to. */
  credsDir: string;
  /** Pre-answer the akadmin reveal (the standalone command's --show-password). */
  showPassword?: boolean;
  /** Poll budget for the recovery link. Default is unbounded (wait until ready). */
  linkAttempts?: number;
  linkIntervalMs?: number;
  /** Injectable delay so tests don't actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Retrieve and present the post-install credentials for a host: write the local
 * CLI credentials file (admin API key) and surface the dashboard admin sign-in —
 * a one-time SSO password-setup link for a named admin (waited for, since it is
 * logged a little after first boot), or an opt-in akadmin password reveal.
 *
 * Shared by `hola bootstrap` (inline, right after install) and `hola credentials`
 * (run later). It never tells the user to "ssh in and check" — it waits, and the
 * standalone command is the way to come back later.
 */
export async function handoffCredentials(config: ConfigMap, ctx: HandoffContext): Promise<CredentialsResult> {
  const { host, composeDir, runner, prompter, out, credsDir } = ctx;
  const wait = ctx.sleep ?? sleep;
  const result: CredentialsResult = { host };

  const ssh = async (title: string, cmd: string) => {
    out(colors.dim(`==> ${title}`));
    return runner.ssh(host, cmd);
  };

  // 1) CLI credential: fetch the generated admin API key and save it locally.
  if (config.HOLA_USE_AUTH === 'true') {
    let apiKey = config.HOLA_API_KEY?.trim() || undefined; // a pinned key needs no fetch
    if (!apiKey) {
      const fetchKey =
        `cd ${composeDir} && for i in $(seq 1 10); do ` +
        `k=$(docker compose exec -T server cat /data/config/admin-api-key 2>/dev/null | tr -d '\\r\\n'); ` +
        `[ -n "$k" ] && { printf %s "$k"; break; }; sleep 2; done`;
      apiKey = (await ssh('Retrieve admin API key', fetchKey)).stdout.trim() || undefined;
    }
    if (apiKey && config.HOLA_DOMAIN) {
      const apiUrl = `https://${config.HOLA_DOMAIN}`;
      const credsPath = path.join(credsDir, `hola-${hostSlug(host)}.env`);
      await fs.writeFile(
        credsPath,
        `# Hola CLI credentials for ${host}. Source this file (or export the vars) to use the CLI.\n` +
          `export HOLA_API_URL=${apiUrl}\n` +
          `export HOLA_TOKEN=${apiKey}\n`,
        { mode: 0o600 },
      );
      result.credsPath = credsPath;
      result.apiUrl = apiUrl;
      out(`\n${colors.green('✔')} Saved CLI credentials to ${colors.bold(credsPath)} ${colors.dim('(chmod 600)')}.`);
      out(`  Use them:  ${colors.cyan(`source ${credsPath}`)}   ${colors.dim('# then e.g. hola catalog')}`);
    } else {
      out(`\n${colors.yellow('!')} The admin API key was not ready yet (the server may still be starting).`);
      out(`  Re-run ${colors.cyan(`hola credentials --host ${host}`)} in a moment to fetch it.`);
    }
  }

  // 2) Web dashboard admin sign-in.
  if (config.HOLA_AUTH_MODE === 'authentik') {
    if (config.HOLA_ADMIN_EMAIL?.trim()) {
      result.adminEmail = config.HOLA_ADMIN_EMAIL.trim();
      out(`\nWeb dashboard admin: sign in as ${colors.bold(result.adminEmail)} via SSO.`);
      // Surface the escape hatch BEFORE waiting: SSO provisioning (Authentik
      // migrations + provider setup) can take minutes, so tell the user how to
      // bail and resume later — then wait indefinitely until the link is logged.
      out(`  ${colors.dim('SSO provisioning can take several minutes — this will keep waiting.')}`);
      out(`  ${colors.dim('Press Ctrl-C to stop; resume anytime with')} ${colors.cyan(`hola credentials --host ${host}`)}`);
      const { link, failed } = await pollRecoveryLink(ctx, wait);
      if (link) {
        result.recoveryLink = link;
        out(`  ${colors.green('Open this one-time link to set your password:')}`);
        out(`    ${colors.cyan(link)}`);
      } else if (failed) {
        // The server tried and gave up minting the link (e.g. no recovery flow).
        // Don't wait forever — point at the akadmin fallback to get in now.
        out(`  ${colors.yellow('!')} Authentik could not provision the password-setup link.`);
        out(`  Sign in as akadmin instead:  ${colors.cyan(`hola credentials --host ${host} --show-password`)}`);
      } else {
        // Only reachable when a finite poll budget is injected (tests). In normal
        // use the poll waits until the link appears or the server reports failure.
        out(`  ${colors.yellow('!')} Not ready yet — resume with ${colors.cyan(`hola credentials --host ${host}`)}.`);
      }
    } else {
      // akadmin fallback → reveal the password only on explicit opt-in.
      const authUrl = config.HOLA_AUTHENTIK_DOMAIN ? `https://${config.HOLA_AUTHENTIK_DOMAIN}` : 'your Authentik domain';
      out(`\nWeb dashboard admin: ${colors.bold('akadmin')} at ${authUrl}.`);
      const reveal =
        ctx.showPassword === true ||
        (ctx.showPassword === undefined &&
          (await prompter.prompt({
            key: '_show_akadmin_pw',
            type: 'confirm',
            message: 'Show the akadmin password once now?',
            default: 'false',
          })) === 'true');
      if (reveal) {
        const pw = (await ssh('Read akadmin password', `grep '^AUTHENTIK_BOOTSTRAP_PASSWORD=' ${composeDir}/.env | cut -d= -f2-`)).stdout.trim();
        out(pw ? `  akadmin password: ${colors.bold(pw)}` : `  ${colors.yellow('Could not read it')} — re-run with --show-password once the stack is up.`);
      } else {
        out(`  Reveal it later:  ${colors.cyan(`hola credentials --host ${host} --show-password`)}`);
      }
    }
  }

  return result;
}

const PROVISION_FAILED = '__HOLA_PROVISION_FAILED__';

/** Human elapsed time: seconds under a minute, "Xm Ys" at or above 60s. */
export function formatElapsed(ms: number): string {
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

/**
 * Poll the server log for the one-time recovery link, waiting through first-boot
 * provisioning with a spinner. By default it waits **indefinitely** (the user can
 * Ctrl-C and resume via `hola credentials`) — provisioning is the slow part and
 * there's no useful timeout. It stops early if the server logs that it *gave up*
 * minting the link, so a genuine failure degrades to the akadmin fallback instead
 * of hanging forever. A finite `linkAttempts` can be injected (tests).
 *
 * Returns `{ link }` on success, `{ failed: true }` if the server reported giving
 * up, or `{}` if an injected budget was exhausted.
 */
async function pollRecoveryLink(
  ctx: HandoffContext,
  wait: (ms: number) => Promise<void>,
): Promise<{ link?: string; failed?: boolean }> {
  const { host, composeDir, runner } = ctx;
  const maxAttempts = ctx.linkAttempts ?? Infinity; // default: never give up
  const intervalMs = ctx.linkIntervalMs ?? 3000;
  // One read of the server log per poll. The server logs structured JSON, so the
  // marker and the link sit on the SAME physical line ("…setup ===\\n<url>"); a
  // naive "line after the marker" grep misses it. Match the marker line + the one
  // after, then extract the recovery URL itself (it carries a `flow_token`). Also
  // emit a sentinel if the server logged that it gave up.
  const grab =
    `cd ${composeDir} && logs=$(docker compose logs --no-color --no-log-prefix server 2>&1); ` +
    `printf '%s\\n' "$logs" | grep -A1 'Hola admin setup' | grep -oE 'https?://[^" ]*flow_token=[^" ]+' | tail -1; ` +
    `printf '%s' "$logs" | grep -qE 'Could not mint admin recovery link|Gave up self-provisioning' && echo ${PROVISION_FAILED}`;
  const spin = createSpinner('Waiting for SSO provisioning to finish…');
  let elapsedMs = 0;
  for (let i = 0; i < maxAttempts; i++) {
    const out = (await runner.ssh(host, grab)).stdout;
    const link = out.split('\n').map((l) => l.trim()).find((l) => /^https?:\/\//.test(l));
    if (link) {
      spin.succeed('Password-setup link is ready.');
      return { link };
    }
    if (out.includes(PROVISION_FAILED)) {
      spin.fail('Authentik could not provision the password-setup link.');
      return { failed: true };
    }
    elapsedMs += intervalMs;
    spin.update(`Waiting for SSO provisioning… (${formatElapsed(elapsedMs)} elapsed)`);
    if (i < maxAttempts - 1) await wait(intervalMs);
  }
  spin.fail('Password-setup link not available yet.');
  return {};
}

/**
 * Standalone `hola credentials` — retrieve the post-install credentials for a host
 * that is already running. Reads the host's `.env` for the deployment config, then
 * runs the same handoff bootstrap uses. Returns the result, or undefined on failure.
 */
export async function runCredentials(
  opts: CredentialsOptions,
  injected?: { prompter?: Prompter; runner?: Runner; credsDir?: string; sleep?: (ms: number) => Promise<void> },
): Promise<CredentialsResult | undefined> {
  const prompter = injected?.prompter ?? clackPrompter();
  const runner = injected?.runner ?? systemRunner();
  const out = (msg: string) => { if (!opts.json) console.log(msg); };

  const host = opts.host;
  const composeDir = opts.dir ?? DEFAULT_DIR;
  try {
    if (!host) throw new CredentialsAbort('--host user@vm is required.');

    // Read the host's .env to recover the deployment config.
    const read = await runner.ssh(host, `cat ${composeDir}/.env 2>/dev/null`);
    if (read.code !== 0) throw new CredentialsAbort(`Could not connect to ${host} (ssh exit ${read.code}).`);
    const config = parseEnv(read.stdout);
    if (!config.HOLA_DOMAIN) {
      throw new CredentialsAbort(
        `No Hola .env found at ${composeDir}/.env on ${host}. ` +
          `Install first with: hola bootstrap --host ${host}`,
      );
    }

    const result = await handoffCredentials(config, {
      host,
      composeDir,
      runner,
      prompter,
      out,
      credsDir: injected?.credsDir ?? process.cwd(),
      showPassword: opts.showPassword,
      sleep: injected?.sleep,
    });

    if (opts.json) console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (err) {
    if (err instanceof CredentialsAbort || err instanceof PromptCancelled) {
      console.error(err.message);
      process.exitCode = 1;
      return undefined;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`credentials failed: ${msg}`);
    if (/ENOENT|spawn ssh/i.test(msg)) console.error('Hint: the `ssh` client must be installed and on PATH.');
    process.exitCode = 1;
    return undefined;
  }
}

class CredentialsAbort extends Error {}
