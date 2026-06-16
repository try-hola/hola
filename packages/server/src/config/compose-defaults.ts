/**
 * Install-wide operational defaults applied to every deployed app's compose at
 * materialization time (restart policy, log rotation, no-new-privileges
 * hardening, optional TZ and resource limits). Operators tune ops policy once
 * for the whole install via `HOLA_DEFAULT_*` rather than per app; apps keep
 * authoring lean compose.
 *
 * Follows the config pattern in `config/catalog.ts` / `config/auth.ts`: a typed
 * default object read from `process.env`, a `load*` accessor, and a singleton.
 */

export interface ComposeDefaultsConfig {
  /** `restart:` value for services that don't declare one (`''`/`none` disables). */
  restartPolicy: string;
  /** `logging.options.max-size` for services without a `logging` block (blank disables rotation). */
  logMaxSize: string;
  /** `logging.options.max-file` count (paired with logMaxSize). */
  logMaxFile: string;
  /** Append `no-new-privileges:true` to every service's `security_opt`. */
  noNewPrivileges: boolean;
  /** Default `TZ` env added to services that don't set it (unset → not injected). */
  tz?: string;
  /** Default `mem_limit` (unset → off). */
  memLimit?: string;
  /** Default `cpus` (unset → off). */
  cpus?: string;
}

/** Read the platform defaults from the environment (re-read on each call). */
export function loadComposeDefaultsConfig(): ComposeDefaultsConfig {
  return {
    restartPolicy: process.env.HOLA_DEFAULT_RESTART_POLICY ?? 'unless-stopped',
    logMaxSize: process.env.HOLA_DEFAULT_LOG_MAX_SIZE ?? '10m',
    logMaxFile: process.env.HOLA_DEFAULT_LOG_MAX_FILE ?? '3',
    noNewPrivileges: process.env.HOLA_DEFAULT_NO_NEW_PRIVILEGES !== 'false',
    tz: process.env.HOLA_DEFAULT_TZ?.trim() || undefined,
    memLimit: process.env.HOLA_DEFAULT_MEM_LIMIT?.trim() || undefined,
    cpus: process.env.HOLA_DEFAULT_CPUS?.trim() || undefined,
  };
}

/** Singleton snapshot taken at startup (used by the deploy lifecycle). */
export const composeDefaultsConfig = loadComposeDefaultsConfig();
