// Prompt abstraction so the wizard never imports a prompt library directly —
// keeping @clack/prompts out of the test path. clackPrompter() is the production
// implementation; scriptedPrompter() is the test double.

import pc from 'picocolors';

import type { FieldType } from './schema';

export interface PromptSpec {
  key: string;
  type: FieldType;
  message: string;
  default?: string;
  options?: { value: string; label: string }[];
  /** Returns an error message, or undefined when valid. */
  validate?: (v: string) => string | undefined;
}

export interface Prompter {
  /** Ask one question and return the answer as a string ('true'/'false' for confirm). */
  prompt(spec: PromptSpec): Promise<string>;
  /** Print an informational line (section headers, check results). */
  note(message: string): void;
}

/** Raised when the user cancels (Ctrl-C) a clack prompt. */
export class PromptCancelled extends Error {
  constructor() {
    super('Cancelled.');
  }
}

/**
 * Adapt a string validator to clack, which passes `undefined` (not `''`) when an
 * optional field is submitted blank. Our validators all call `v.trim()`, so coerce
 * the value to a string at this one boundary. Exported for testing.
 */
export function toClackValidate(
  validate?: (v: string) => string | undefined
): ((v: string | undefined) => string | undefined) | undefined {
  return validate ? (v) => validate(v ?? '') : undefined;
}

/**
 * Coerce a clack prompt result to the string the wizard expects. Exported for testing.
 *
 * `clack.password()` resolves to `undefined` on an empty submit — unlike `text()`,
 * the PasswordPrompt has no finalize/default handler, so an untouched field never
 * sets `value`. A naive `String(result)` would turn that into the literal string
 * `"undefined"`, which is truthy and so poisons the wizard's `!value` env-reuse
 * fallback (the masked `fromEnv` secret silently becomes `"undefined"`, and AWS
 * later rejects it as `SignatureDoesNotMatch`). Mapping nullish → '' lets the
 * fallback fire.
 */
export function resultToAnswer(type: FieldType, result: unknown): string {
  if (type === 'confirm') return result ? 'true' : 'false';
  return result == null ? '' : String(result);
}

/**
 * A masked secret prompt prefilled with `def`, rendered as dots and fully editable.
 * Pressing Enter submits the real (unmodified) value — so a secret already present
 * in the environment is reused without retyping or pasting it (which also sidesteps
 * terminal paste-mangling of `/ + =` in AWS-style secrets).
 *
 * clack's high-level `password()` ignores `initialValue`, so we drive @clack/core's
 * `PasswordPrompt` directly with `initialUserInput` and re-render in clack's house
 * style (its inline renderer isn't exported). Kept faithful to clack@1's render so
 * this one field looks identical to every other prompt.
 */
export async function passwordWithDefault(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clack: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  PasswordPrompt: any,
  spec: PromptSpec,
  validate: unknown,
  // Tests inject fake TTY streams; production omits this so the prompt uses process stdio.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  io?: { input?: any; output?: any }
): Promise<unknown> {
  const { S_BAR, S_BAR_END, S_STEP_ACTIVE, S_STEP_ERROR, S_STEP_SUBMIT, S_STEP_CANCEL, S_PASSWORD_MASK } = clack;
  const symbol = (state: string) =>
    state === 'error'
      ? pc.yellow(S_STEP_ERROR)
      : state === 'submit'
        ? pc.green(S_STEP_SUBMIT)
        : state === 'cancel'
          ? pc.red(S_STEP_CANCEL)
          : pc.cyan(S_STEP_ACTIVE);
  const prompt = new PasswordPrompt({
    mask: S_PASSWORD_MASK,
    initialUserInput: spec.default,
    validate,
    input: io?.input,
    output: io?.output,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(this: any) {
      const head = `${pc.gray(S_BAR)}\n${symbol(this.state)}  ${spec.message}\n`;
      const masked = this.masked as string;
      switch (this.state) {
        case 'error':
          return `${head.trim()}\n${pc.yellow(S_BAR)}  ${masked ?? ''}\n${pc.yellow(S_BAR_END)}  ${pc.yellow(this.error)}\n`;
        case 'submit':
          return `${head}${pc.gray(S_BAR)}  ${masked ? pc.dim(masked) : ''}`;
        case 'cancel':
          return `${head}${pc.gray(S_BAR)}  ${masked ? pc.strikethrough(pc.dim(masked)) : ''}`;
        default:
          return `${head}${pc.cyan(S_BAR)}  ${this.userInputWithCursor}\n${pc.cyan(S_BAR_END)}\n`;
      }
    },
  });
  return prompt.prompt();
}

/** Production prompter backed by @clack/prompts. Lazily imported so tests never load it. */
export function clackPrompter(): Prompter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let p: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let core: any;
  const load = async () => {
    if (!p) p = await import('@clack/prompts');
    return p;
  };
  const loadCore = async () => {
    if (!core) core = await import('@clack/core');
    return core;
  };
  return {
    async prompt(spec) {
      const clack = await load();
      const validate = toClackValidate(spec.validate);
      let result: unknown;
      switch (spec.type) {
        case 'secret':
          // Prefill with the detected value (e.g. a fromEnv secret) so Enter submits
          // it as dots; fall back to an empty masked prompt when there's nothing to reuse.
          result = spec.default
            ? await passwordWithDefault(clack, (await loadCore()).PasswordPrompt, spec, validate)
            : await clack.password({ message: spec.message, validate });
          break;
        case 'select':
          result = await clack.select({
            message: spec.message,
            options: (spec.options ?? []).map((o) => ({ value: o.value, label: o.label })),
            initialValue: spec.default,
          });
          break;
        case 'confirm':
          result = await clack.confirm({ message: spec.message, initialValue: spec.default !== 'false' });
          break;
        default:
          result = await clack.text({ message: spec.message, initialValue: spec.default, validate });
      }
      if (clack.isCancel(result)) throw new PromptCancelled();
      return resultToAnswer(spec.type, result);
    },
    note(message) {
      // clack.log.message keeps the framed output consistent.
      void load().then((clack) => clack.log.message(message)).catch(() => console.log(message));
    },
  };
}

/**
 * Test double: returns answers keyed by field key, falling back to the spec
 * default. Runs the field's validator and throws on invalid input so tests can
 * exercise the abort path.
 */
export function scriptedPrompter(answers: Record<string, string>, notes?: string[]): Prompter {
  return {
    async prompt(spec) {
      const value = spec.key in answers ? answers[spec.key] : (spec.default ?? '');
      if (spec.validate) {
        const err = spec.validate(value);
        if (err) throw new Error(`${spec.key}: ${err}`);
      }
      return value;
    },
    note(message) {
      notes?.push(message);
    },
  };
}
