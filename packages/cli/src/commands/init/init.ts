import { promises as fs } from 'fs';
import path from 'path';

import { clackPrompter, PromptCancelled, type Prompter } from '../../install/prompter';
import { parseEnv, renderEnv, schemaTemplate } from '../../install/render-env';
import { secretKeys, type ConfigMap } from '../../install/schema';
import { runWizard, WizardError } from '../../install/wizard';
import type { CheckResult } from '../../install/checks';
import type { BootstrapOptions, BootstrapResult } from '../bootstrap/bootstrap';

export interface InitOptions {
  out?: string;
  composeDir?: string;
  force?: boolean;
  skipChecks?: boolean;
  json?: boolean;
  /** Keep the local .env after a successful remote install (default: delete it). */
  keepEnv?: boolean;
}

/** The bootstrap entrypoint, narrowed to what the init handoff needs; injectable for tests. */
type BootstrapFn = (
  opts: BootstrapOptions,
  injected?: { prompter?: Prompter }
) => Promise<BootstrapResult | undefined>;

export interface InitResult {
  target: string;
  config: ConfigMap;
}

/** Raised after a user-facing failure has been reported and the exit code set. */
class InitAbort extends Error {}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Where the compose stack (and .env.example) lives, for default targets. */
async function resolveComposeDir(opts: InitOptions): Promise<string> {
  if (opts.composeDir) return path.resolve(process.cwd(), opts.composeDir);
  const candidate = path.resolve(process.cwd(), 'packages/compose');
  if (await exists(path.join(candidate, '.env.example'))) return candidate;
  return process.cwd();
}

/**
 * Guided first-time setup: collect + validate install config and write a `.env`.
 * Runs entirely on the user's machine — it never contacts the server. Returns the
 * result, or undefined on failure (after setting a non-zero exit code).
 */
export async function runInit(
  opts: InitOptions,
  injected?: { prompter?: Prompter; checks?: (c: ConfigMap) => Promise<CheckResult[]>; bootstrap?: BootstrapFn }
): Promise<InitResult | undefined> {
  const prompter = injected?.prompter ?? clackPrompter();
  const out = (msg: string) => { if (!opts.json) console.log(msg); };

  try {
    const composeDir = await resolveComposeDir(opts);
    const target = opts.out ? path.resolve(process.cwd(), opts.out) : path.join(composeDir, '.env');

    const targetExists = await exists(target);
    if (targetExists && !opts.force) {
      throw new InitAbort(`${target} already exists. Re-run with --force to update it in place.`);
    }

    // Base text we merge into: prefer an existing .env (preserves host-generated
    // secrets), then the documented .env.example, then a schema-generated stub.
    let baseText = '';
    let initial: ConfigMap = {};
    if (targetExists) {
      baseText = await fs.readFile(target, 'utf8');
      initial = parseEnv(baseText);
    } else {
      const examplePath = path.join(composeDir, '.env.example');
      baseText = (await exists(examplePath)) ? await fs.readFile(examplePath, 'utf8') : schemaTemplate();
    }

    out('Hola setup — answer a few questions to generate your .env.\n');
    const { config } = await runWizard({
      prompter,
      initial,
      skipChecks: opts.skipChecks,
      checks: injected?.checks,
    });

    const rendered = renderEnv(config, baseText);
    await fs.writeFile(target, rendered, { mode: 0o600 });
    await fs.chmod(target, 0o600); // ensure 0600 even if the file pre-existed

    const result: InitResult = { target, config };

    // JSON / non-interactive mode: emit the result and stop (no prompts).
    if (opts.json) {
      console.log(JSON.stringify({ target, config: redact(config) }, null, 2));
      return result;
    }

    out(`\nWrote ${target}`);
    out('  Note: this file holds the values you entered, including any secrets (it is chmod 600).');

    // Offer the one-step remote install so the freshly written .env is reused
    // (no re-answering the wizard), then prompt for the target host.
    const wantsInstall = await prompter.prompt({
      key: '_bootstrap',
      type: 'confirm',
      message: 'Install Hola on a host now over SSH?',
      default: 'true',
    });
    if (wantsInstall !== 'true') {
      out('\nWhen you are ready, install on a host with:');
      out(`  hola bootstrap --host user@your-vm --env-file ${target}`);
      return result;
    }

    const host = (await prompter.prompt({
      key: '_host',
      type: 'text',
      message: 'Target host to install on (user@host)',
      validate: (v: string) => (v.trim() ? undefined : 'A host is required'),
    })).trim();

    // Lazily load bootstrap so `hola init` stays light when not installing.
    const bootstrap = injected?.bootstrap ?? (await import('../bootstrap/bootstrap')).runBootstrap;
    const bootRes = await bootstrap({ host, envFile: target, skipChecks: opts.skipChecks }, { prompter });
    if (!bootRes) {
      // bootstrap already reported the error + set the exit code; keep the .env
      // so the user can retry without re-entering everything.
      out(`\nKept ${target} so you can retry:  hola bootstrap --host ${host} --env-file ${target}`);
      return result;
    }

    // Installed — the secrets now live on the host, so remove the local copy by
    // default (it's a sensitive artifact). `--keep-env` opts out.
    if (opts.keepEnv) {
      out(`\nKept ${target} (--keep-env).`);
    } else {
      await fs.rm(target, { force: true });
      out(`\nRemoved ${target} — its secrets now live only on ${host}.`);
    }
    return result;
  } catch (err) {
    if (err instanceof InitAbort || err instanceof WizardError || err instanceof PromptCancelled) {
      console.error(err.message);
      process.exitCode = 1;
      return undefined;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`init failed: ${msg}`);
    process.exitCode = 1;
    return undefined;
  }
}

/** Mask secret values for JSON output. */
function redact(config: ConfigMap): ConfigMap {
  const secrets = secretKeys();
  const out: ConfigMap = {};
  for (const [k, v] of Object.entries(config)) out[k] = secrets.has(k) && v ? '***' : v;
  return out;
}
