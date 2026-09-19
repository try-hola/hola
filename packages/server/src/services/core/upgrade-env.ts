/**
 * Carry an operator's existing configuration forward onto a newer catalog
 * version, for the promote (upgrade) path in `server.ts`.
 *
 * Extracted from the route so the rule it encodes is testable on its own: the
 * merge decides what an upgrade does with every key the NEW version declares,
 * and getting it wrong either loses an operator's value or refuses the upgrade.
 */
import type { AppEnvVar } from '@hola/shared';
import { generateSecretValue } from '@hola/shared/param-validate';

/**
 * Merge the deployment's current env values onto the new version's declared
 * `appEnv`, by key.
 *
 * Three cases, in order:
 *
 *  1. **The deployment has a value** → it wins. The operator's configuration
 *     survives the upgrade; the new version's catalog default is only a default.
 *  2. **The new version introduces a key with a `generate` recipe and no value**
 *     → mint one (#458). This is the same thing install does — the wizard fills
 *     generated secrets before finalize — and without it an app that adds a
 *     generated secret in a patch release refuses to upgrade for every existing
 *     install, with `<label> is required` and no way to supply it (`hola upgrade`
 *     has no `--set`). A generated secret is by definition one the platform is
 *     free to invent, so there is nothing to ask the operator.
 *  3. **Otherwise** → the new version's own default rides through untouched,
 *     including a required-but-empty key, which finalize will reject with a
 *     message naming it. That refusal is correct: a value with real-world meaning
 *     (an external API token, an email address) must not be fabricated.
 *
 * Ports are deliberately not handled here — the new version's compose defines
 * its own.
 */
export function mergeUpgradeAppEnv(draftAppEnv: AppEnvVar[], carriedAppEnv: Record<string, string>): AppEnvVar[] {
  return draftAppEnv.map((entry) => {
    if (Object.prototype.hasOwnProperty.call(carriedAppEnv, entry.key)) {
      return { ...entry, value: carriedAppEnv[entry.key] };
    }
    if (entry.generate && !entry.value) {
      return { ...entry, value: generateSecretValue(entry.generate) };
    }
    return entry;
  });
}
