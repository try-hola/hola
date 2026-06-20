import { promises as fs } from 'fs';
import path from 'path';

import { clackPrompter, PromptCancelled, type Prompter } from '../../install/prompter';
import { parseEnv, renderEnv, schemaTemplate } from '../../install/render-env';
import { secretKeys, type ConfigMap } from '../../install/schema';
import { runWizard, WizardError } from '../../install/wizard';
import type { CheckResult } from '../../install/checks';
import { systemRunner, type Runner } from '../../lib/runner';
import { CLI_VERSION } from '../../version';

export interface BootstrapOptions {
  host?: string;
  repo?: string;
  ref?: string;
  /** Override the compose-bundle download URL (defaults to the release asset for this CLI version). */
  tarballUrl?: string;
  dir?: string;
  envFile?: string;
  skipChecks?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

export interface BootstrapResult {
  host: string;
  dir: string;
  ref: string;
  steps: string[];
}

class BootstrapAbort extends Error {}

const DEFAULT_REPO = 'https://github.com/try-hola/hola.git';
const DEFAULT_DIR = '/opt/hola';

/** Strip a leading `cli-v` from a release tag to get the bare version (cli-v0.3.0 → 0.3.0). */
function versionFromRef(ref: string): string {
  return ref.startsWith('cli-v') ? ref.slice('cli-v'.length) : ref;
}

/** Derive the GitHub release-download base from a clone URL (…/hola.git → …/hola). */
function releaseBase(repo: string): string {
  return repo.replace(/\.git$/, '');
}

/**
 * End-to-end remote install: collect config (wizard or --env-file), then over SSH
 * preflight the host, download the version-pinned compose bundle, write the .env
 * (streamed via stdin so secrets never hit argv), run scripts/install.sh (which
 * pulls the published images), and verify. Returns the result, or undefined on
 * failure (after setting a non-zero exit code).
 */
/** First existing `.env` a freshly-run `hola init` would have written, or null. */
async function defaultFindEnvFile(): Promise<string | null> {
  const candidates = [
    path.resolve(process.cwd(), 'packages/compose/.env'),
    path.resolve(process.cwd(), '.env'),
  ];
  for (const c of candidates) {
    try {
      await fs.access(c);
      return c;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export async function runBootstrap(
  opts: BootstrapOptions,
  injected?: {
    prompter?: Prompter;
    runner?: Runner;
    checks?: (c: ConfigMap) => Promise<CheckResult[]>;
    /** Locate a reusable .env (defaults to the init-produced compose/.env); injectable for tests. */
    findEnvFile?: () => Promise<string | null>;
  }
): Promise<BootstrapResult | undefined> {
  const prompter = injected?.prompter ?? clackPrompter();
  const runner = injected?.runner ?? systemRunner();
  const out = (msg: string) => { if (!opts.json) console.log(msg); };

  const host = opts.host;
  const repo = opts.repo ?? DEFAULT_REPO;
  const ref = opts.ref ?? `cli-v${CLI_VERSION}`;
  const version = versionFromRef(ref);
  // The bundle extracts compose's contents directly into `dir` — no git checkout,
  // so there's no packages/compose nesting on the host.
  const dir = opts.dir ?? DEFAULT_DIR;
  const composeDir = dir;
  const envPath = `${composeDir}/.env`;
  const tarballUrl = opts.tarballUrl ?? `${releaseBase(repo)}/releases/download/${ref}/hola-compose-${version}.tar.gz`;
  const steps: string[] = [];

  try {
    if (!host) throw new BootstrapAbort('--host user@vm is required.');

    // 1) Config → rendered .env: an explicit --env-file, else a detected
    //    init-produced .env we offer to reuse, else the wizard. Detection only
    //    runs interactively (skipped under --json, which is for scripted use).
    let rendered: string;
    let config: ConfigMap;
    let reuse: string | null = opts.envFile ? path.resolve(process.cwd(), opts.envFile) : null;
    if (!reuse && !opts.json) {
      const found = await (injected?.findEnvFile ?? defaultFindEnvFile)();
      if (found) {
        const ans = await prompter.prompt({
          key: '_use_env',
          type: 'confirm',
          message: `Found ${found} — use it (skip the questions)?`,
          default: 'true',
        });
        if (ans === 'true') reuse = found;
      }
    }
    if (reuse) {
      rendered = await fs.readFile(reuse, 'utf8');
      config = parseEnv(rendered);
      out(`Using ${reuse}`);
    } else {
      out('Hola setup — answer a few questions, then I will install on the host.\n');
      const wiz = await runWizard({ prompter, skipChecks: opts.skipChecks, checks: injected?.checks });
      config = wiz.config;
      rendered = renderEnv(config, schemaTemplate());
    }
    const keyList = Object.keys(config);

    // Helper: run a remote step (or describe it under --dry-run).
    const ssh = async (title: string, cmd: string, o?: { input?: string; stream?: boolean }) => {
      steps.push(title);
      if (opts.dryRun) {
        out(`# ${title}`);
        out(`  ssh ${host} ${o?.input != null ? '(stdin: .env redacted) ' : ''}${cmd}`);
        return { code: 0, stdout: '', stderr: '' };
      }
      out(`==> ${title}`);
      const r = await runner.ssh(host, cmd, {
        input: o?.input,
        stream: o?.stream ? (l) => out(`  ${l}`) : undefined,
      });
      return r;
    };

    // 2) Preflight (single remote probe → key=value lines). The host pulls
    //    prebuilt images, so it needs docker + compose + curl/tar — but not git.
    const probe =
      'for c in docker curl tar; do command -v "$c" >/dev/null 2>&1 && echo "$c=ok" || echo "$c=missing"; done; ' +
      'docker compose version >/dev/null 2>&1 && echo compose=ok || echo compose=missing; ' +
      'docker ps >/dev/null 2>&1 && echo dockerperm=ok || echo dockerperm=fail';
    if (opts.dryRun) {
      await ssh('Preflight host', probe);
    } else {
      const r = await ssh('Preflight host', probe);
      if (r.code !== 0) throw new BootstrapAbort(`Could not connect to ${host} (ssh exit ${r.code}).`);
      const p = parsePreflight(r.stdout);
      assertPreflight(p);
      out('  host OK (docker, compose, curl/tar, permissions)');
    }

    // 3) Download + extract the version-pinned compose bundle (no git, no source
    //    build on the host — the images are prebuilt and pulled at `up` time).
    //    The default dir (/opt/hola) lives under a root-owned parent, so create
    //    it with sudo + chown to this user when the parent isn't writable; an
    //    unprivileged dir (e.g. ~/hola) skips sudo entirely. Exit 13 = needs a
    //    one-time manual pre-create (no write access and no passwordless sudo).
    const fetchStack =
      `set -e; ` +
      `if [ ! -d ${dir} ]; then ` +
      `  parent=$(dirname ${dir}); ` +
      `  if [ -w "$parent" ]; then mkdir -p ${dir}; ` +
      `  elif sudo -n true 2>/dev/null; then sudo mkdir -p ${dir} && sudo chown "$(id -u):$(id -g)" ${dir}; ` +
      `  else exit 13; fi; ` +
      `fi; ` +
      `curl -fsSL ${tarballUrl} | tar xz -C ${dir}`;
    const fetchRes = await ssh(`Download Hola ${version} stack into ${composeDir}`, fetchStack, { stream: true });
    if (!opts.dryRun && fetchRes.code === 13) {
      throw new BootstrapAbort(
        `Cannot create ${dir}: no write access to its parent and no passwordless sudo.\n` +
          `Pre-create it once, then re-run bootstrap:\n` +
          `  ssh ${host} 'sudo mkdir -p ${dir} && sudo chown $(id -u):$(id -g) ${dir}'`,
      );
    }
    if (!opts.dryRun && fetchRes.code !== 0) {
      throw new BootstrapAbort(
        `Downloading the compose bundle failed (exit ${fetchRes.code}). ` +
          `Check that release ${ref} exists and the host can reach ${tarballUrl}.`,
      );
    }

    // 4) Write .env — streamed over stdin so values never appear in argv/ps/history.
    const writeRes = await ssh('Write .env (over stdin)', `cat > ${envPath} && chmod 600 ${envPath}`, { input: rendered });
    if (!opts.dryRun && writeRes.code !== 0) throw new BootstrapAbort(`Writing ${envPath} failed (exit ${writeRes.code}).`);

    // 5) Run the installer, streaming its output.
    const installRes = await ssh('Run install.sh', `cd ${composeDir} && ./scripts/install.sh`, { stream: true });
    if (!opts.dryRun && installRes.code !== 0) throw new BootstrapAbort(`install.sh failed (exit ${installRes.code}).`);

    // 6) Best-effort verify (warn-only: DNS/cert may still be settling).
    if (!opts.dryRun && config.HOLA_DOMAIN) {
      const verify = await ssh(
        `Verify https://${config.HOLA_DOMAIN}`,
        `curl -sk -o /dev/null -w "%{http_code}" https://${config.HOLA_DOMAIN}/api/health || true`,
      );
      const codeStr = verify.stdout.trim();
      out(codeStr === '200' ? '  UI is responding (200).' : `  UI not ready yet (got "${codeStr || 'no response'}") — may take a minute for TLS/DNS.`);
    }

    const result: BootstrapResult = { host, dir, ref, steps };
    if (opts.json) {
      console.log(JSON.stringify({ host, dir, ref, steps, keys: opts.dryRun ? keyList : undefined }, null, 2));
    } else if (opts.dryRun) {
      out(`\nDry run — would write a .env with ${keyList.length} keys: ${redactKeyList(keyList)}`);
      out('No connection was made. Re-run without --dry-run to execute.');
    } else {
      out(`\nDone. Hola is installed on ${host}. Open https://${config.HOLA_DOMAIN ?? '<your HOLA_DOMAIN>'}`);
    }
    return result;
  } catch (err) {
    if (err instanceof BootstrapAbort || err instanceof WizardError || err instanceof PromptCancelled) {
      console.error(err.message);
      process.exitCode = 1;
      return undefined;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`bootstrap failed: ${msg}`);
    if (/ENOENT|spawn ssh/i.test(msg)) console.error('Hint: the `ssh` client must be installed and on PATH.');
    process.exitCode = 1;
    return undefined;
  }
}

function parsePreflight(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    const eq = t.indexOf('=');
    if (eq > 0) out[t.slice(0, eq)] = t.slice(eq + 1);
  }
  return out;
}

function assertPreflight(p: Record<string, string>): void {
  if (p.docker !== 'ok' || p.compose !== 'ok') {
    throw new BootstrapAbort(
      'Docker + the Compose v2 plugin are required on the host. Install with:\n' +
        '  curl -fsSL https://get.docker.com | sh\n' +
        'then re-run bootstrap.',
    );
  }
  if (p.dockerperm !== 'ok') {
    throw new BootstrapAbort(
      "This SSH user can't run docker. Add them to the docker group:\n" +
        '  sudo usermod -aG docker $USER   (then reconnect)\n' +
        'then re-run bootstrap.',
    );
  }
  if (p.curl !== 'ok' || p.tar !== 'ok') {
    throw new BootstrapAbort(
      'curl and tar are required on the host to download the compose bundle ' +
        '(e.g. `sudo apt-get install -y curl tar`), then re-run bootstrap.',
    );
  }
}

/** Show key names for dry-run, redacting secret values' keys to a count is unnecessary — keys aren't secret. */
function redactKeyList(keys: string[]): string {
  const secrets = secretKeys();
  return keys.map((k) => (secrets.has(k) ? `${k}(secret)` : k)).join(', ');
}
