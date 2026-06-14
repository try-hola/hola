// Orchestrates the interactive install wizard: walks INSTALL_SCHEMA honoring
// requiredWhen, prompts each field, accumulates answers (so later defaults and
// requiredWhen see earlier answers), then runs the live checks. Shared by both
// `hola init` and `hola bootstrap`.

import { runChecks, type CheckResult } from './checks';
import type { Prompter } from './prompter';
import { INSTALL_SCHEMA, defaultFor, type ConfigMap } from './schema';
import { interdependencyErrors } from './validate';

export interface WizardOptions {
  prompter: Prompter;
  /** Existing values to use as defaults (e.g. parsed from an existing .env on re-run). */
  initial?: ConfigMap;
  skipChecks?: boolean;
  /** Injectable for tests; defaults to the real network/host checks. */
  checks?: (config: ConfigMap) => Promise<CheckResult[]>;
}

export interface WizardResult {
  config: ConfigMap;
  checks: CheckResult[];
}

/** Raised when the collected answers fail interdependency validation. */
export class WizardError extends Error {}

export async function runWizard(opts: WizardOptions): Promise<WizardResult> {
  const { prompter, initial = {} } = opts;
  const config: ConfigMap = {};

  for (const field of INSTALL_SCHEMA) {
    if (field.requiredWhen && !field.requiredWhen(config)) continue;

    const fallback = initial[field.key] ?? defaultFor(field, config);
    const message = field.help ? `${field.prompt}\n  ${field.help}` : field.prompt;
    const value = await prompter.prompt({
      key: field.key,
      type: field.type,
      message,
      default: fallback,
      options: field.options,
      validate: field.validate ? (v: string) => field.validate!(v, config) : undefined,
    });
    config[field.key] = value;
  }

  const errs = interdependencyErrors(config);
  if (errs.length) throw new WizardError(errs.join('; '));

  let checks: CheckResult[] = [];
  if (!opts.skipChecks) {
    const run = opts.checks ?? runChecks;
    checks = await run(config);
    if (checks.length) {
      prompter.note('Validation:');
      for (const c of checks) prompter.note(`  ${c.status.toUpperCase()}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    }
  }

  return { config, checks };
}
