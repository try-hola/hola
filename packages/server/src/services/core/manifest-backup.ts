import type { AppBackupConfig, AppBackupHook } from '@hola/shared';

/**
 * Narrow-shape coercion for the bundle manifest's optional `backup` block (#121),
 * mirroring `coerceManifestAuth` / `coerceManifestUpgrade`. A hook is kept only
 * when it names a service and a non-empty exec-form command (all-string argv);
 * anything malformed is dropped. Returns `undefined` when neither hook survives.
 */

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

/** A command must be a non-empty array of non-empty strings (exec form, no shell-string). */
function asCommand(v: unknown): string[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  if (!v.every((x) => typeof x === 'string' && x.length > 0)) return undefined;
  return v as string[];
}

function coerceHook(value: unknown): AppBackupHook | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const service = asString(rec.service);
  const command = asCommand(rec.command);
  if (!service || !command) return undefined;
  return { service, command };
}

export function coerceManifestBackup(value: unknown): AppBackupConfig | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;

  const config: AppBackupConfig = {};
  const preHook = coerceHook(rec.preHook);
  if (preHook) config.preHook = preHook;
  const postHook = coerceHook(rec.postHook);
  if (postHook) config.postHook = postHook;

  return config.preHook || config.postHook ? config : undefined;
}
