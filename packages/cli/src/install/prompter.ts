// Prompt abstraction so the wizard never imports a prompt library directly —
// keeping @clack/prompts out of the test path. clackPrompter() is the production
// implementation; scriptedPrompter() is the test double.

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

/** Production prompter backed by @clack/prompts. Lazily imported so tests never load it. */
export function clackPrompter(): Prompter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let p: any;
  const load = async () => {
    if (!p) p = await import('@clack/prompts');
    return p;
  };
  return {
    async prompt(spec) {
      const clack = await load();
      const validate = toClackValidate(spec.validate);
      let result: unknown;
      switch (spec.type) {
        case 'secret':
          result = await clack.password({ message: spec.message, validate });
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
      if (spec.type === 'confirm') return result ? 'true' : 'false';
      return String(result);
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
