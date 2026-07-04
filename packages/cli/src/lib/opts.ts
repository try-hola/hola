// sade/mri parse `--multi-word` flags into kebab-case keys (`env-file`,
// `skip-checks`, `tarball-url`), but the command handlers read camelCase
// (`opts.envFile`, …). Normalize so multi-word flags actually take effect.
// Single-word keys (and mri's `--no-x` → `{ x: false }`) are unchanged.
export const camelKeys = <T extends Record<string, unknown>>(opts: T): T => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(opts)) {
    out[k.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())] = v;
  }
  return out as T;
};

/**
 * camelKeys + normalize the `--no-stream` and `--no-generate-secrets` flags.
 * sade/mri routes `--no-stream` to `{ stream: false }` (and `--no-generate-secrets`
 * to `{ generateSecrets: false }`) rather than setting `noStream`/`noGenerateSecrets`
 * directly, so command handlers that read those `opts.no*` fields would never see
 * the flag take effect. Surface both explicitly.
 */
export const streamOpts = <T extends Record<string, unknown>>(
  opts: T
): T & { noStream: boolean; noGenerateSecrets: boolean } => {
  const o = camelKeys(opts);
  return {
    ...o,
    noStream: o.noStream === true || o.stream === false,
    noGenerateSecrets: o.noGenerateSecrets === true || o.generateSecrets === false,
  };
};
