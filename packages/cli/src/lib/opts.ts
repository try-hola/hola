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
 * Extra mri options for `prog.parse` — sade forwards this object to mri
 * verbatim, overriding only its `alias` and `default` keys, so `boolean` is
 * ours. Returns a FRESH object per call because both sade and mri mutate what
 * they are handed.
 *
 * It exists for one flag. `--carry-env` is the CLI's only TRI-STATE option
 * (spec 007, contracts/cli.md): `undefined` means "default to the candidate's
 * own `carriesEnv`", `true`/`false` are explicit operator choices. Every other
 * boolean flag declares a `false` default, and that default is the *only*
 * thing that lands a name in mri's boolean list — mri classifies by
 * `typeof opts.default[key]`. `--carry-env` cannot take a `false` default
 * without collapsing `undefined` into `false`, so it was classified as
 * value-taking and greedily ate the following token:
 * `hola install --carry-env gitea --restore-from latest` consumed `gitea` and
 * aborted with sade's "Insufficient arguments!" (#488).
 *
 * Naming it here classifies it as a boolean WITHOUT giving it a default, which
 * is the whole point — mri's boolean branch also pushes the token it looked at
 * back onto `_`, so the swallowed positional is handed back rather than lost:
 *
 *   (omitted)          → undefined   (mri's defaults pass writes sade's own `undefined`)
 *   --carry-env        → true
 *   --carry-env gitea  → true, and `gitea` returns to the positionals
 *   --no-carry-env     → false       (mri's `--no-` branch)
 *   --carry-env=false  → false       (mri reads the literal 'false'/'true')
 *
 * Normalizing after the fact — the `streamOpts` shape below — cannot fix this:
 * the token is consumed during parsing, before any handler sees an opts bag.
 */
export const parseOpts = (): { boolean: string[] } => ({ boolean: ['carry-env'] });

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
