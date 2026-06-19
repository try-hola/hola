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
