// Orchestrates the interactive install wizard: walks INSTALL_SCHEMA honoring
// requiredWhen, prompts each field, accumulates answers (so later defaults and
// requiredWhen see earlier answers), then runs the live checks. Shared by both
// `hola init` and `hola bootstrap`.

import { runChecks, type CheckResult } from './checks';
import type { Prompter } from './prompter';
import { INSTALL_SCHEMA, defaultFor, type ConfigMap } from './schema';
import { interdependencyErrors } from './validate';
import { renderChecks } from '../lib/ui';

export interface WizardOptions {
  prompter: Prompter;
  /** Existing values to use as defaults (e.g. parsed from an existing .env on re-run). */
  initial?: ConfigMap;
  skipChecks?: boolean;
  /** Injectable for tests; defaults to the real network/host checks. */
  checks?: (config: ConfigMap) => Promise<CheckResult[]>;
  /** Process environment, for fields that offer to reuse a value already set (AWS_*). Injectable for tests. */
  env?: Record<string, string | undefined>;
}

export interface WizardResult {
  config: ConfigMap;
  checks: CheckResult[];
}

/** Raised when the collected answers fail interdependency validation. */
export class WizardError extends Error {}

export async function runWizard(opts: WizardOptions): Promise<WizardResult> {
  const { prompter, initial = {}, env = process.env } = opts;
  const config: ConfigMap = {};

  for (const field of INSTALL_SCHEMA) {
    if (field.requiredWhen && !field.requiredWhen(config)) continue;

    // A `fromEnv` field offers a value already set in the environment (AWS_*); the
    // prompt prefills with it (masked secrets render as dots) so the user just
    // presses Enter. A blank answer still means "use the detected value" and is
    // not rejected by the field's validator.
    const envVal = field.fromEnv ? env[field.key]?.trim() || undefined : undefined;

    // A literal "undefined"/"null" in `initial` is corruption, not a real prior
    // value — earlier releases could mis-collect a masked secret and write
    // `AWS_SECRET_ACCESS_KEY=undefined` into .env. Never let that shadow a good value.
    const prior = initial[field.key];
    const priorVal = prior === 'undefined' || prior === 'null' ? undefined : prior;

    // For env-sourced fields the live environment is authoritative: a stale value
    // in an existing .env must not override what the operator just exported. Other
    // fields prefer the existing .env so host-generated secrets (HOLA_API_KEY)
    // survive a `hola init --force` re-run.
    const fallback = field.fromEnv
      ? envVal ?? priorVal ?? defaultFor(field, config)
      : priorVal ?? envVal ?? defaultFor(field, config);

    let message = field.help ? `${field.prompt}\n  ${field.help}` : field.prompt;
    if (envVal && field.secret) message = `${field.prompt} (found in your environment — press Enter to use it)`;

    const validate = field.validate
      ? (v: string) => (!v && envVal ? undefined : field.validate!(v, config))
      : undefined;

    let value = await prompter.prompt({
      key: field.key,
      type: field.type,
      message,
      default: fallback,
      options: field.options,
      validate,
    });
    if (!value && envVal) value = envVal; // accept the detected environment value
    config[field.key] = value;
  }

  const errs = interdependencyErrors(config);
  if (errs.length) throw new WizardError(errs.join('; '));

  let checks: CheckResult[] = [];
  if (!opts.skipChecks) {
    const run = opts.checks ?? runChecks;
    checks = await run(config);
    if (checks.length) {
      // One compact, colorized block — not a framed line per check.
      prompter.note(renderChecks(checks));
    }
  }

  return { config, checks };
}
