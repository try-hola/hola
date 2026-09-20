import type { AppBackupHook, AppRestoreDeclaration } from '@hola/shared';
import type { Logger } from '../../lib/logger';

/**
 * Narrow-shape coercion for the bundle manifest's optional `restore` block
 * (spec 007), mirroring `coerceManifestBackup`. Unlike `backup`, `restore` has
 * no legacy singular form — it is new with this feature, so the manifest
 * declares it as an array from day one, one entry per **backup** participation
 * id it restores.
 *
 * Drop rules (never throw — a malformed entry degrades, per ADR 0003):
 * - an entry with no usable `id` (non-string, empty after trim);
 * - an entry whose `id` repeats an earlier one (first wins);
 * - a `discard` entry that isn't a non-empty string is dropped from the list,
 *   not the whole declaration;
 * - a malformed `hook` is dropped (the declaration survives with no hook);
 * - `requiresEnv` is kept only when it's literally `true`.
 */

type CoerceCtx = { appId?: string; version?: string };

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

/**
 * A Compose service name, as Compose itself defines it: `[a-zA-Z0-9]` then
 * word/dot/dash characters. Validated HERE, at the manifest boundary, because
 * `restore[].hook.service` is app-supplied data that the restore sequence
 * hands to `composeUp({ services })` as a command argument. `composeUp` runs
 * argv-only (no shell), so this is defence in depth rather than the only
 * guard — but a name that could never name a real service is a malformed
 * declaration either way, and the drop rules above say a malformed hook is
 * dropped rather than thrown over (ADR 0003).
 */
const COMPOSE_SERVICE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function coerceHook(value: unknown): AppBackupHook | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const service = asString(rec.service);
  const command = asCommand(rec.command);
  if (!service || !command) return undefined;
  if (!COMPOSE_SERVICE_NAME.test(service)) return undefined;
  return { service, command };
}

function coerceDiscard(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const paths = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return paths.length > 0 ? paths : undefined;
}

export function coerceManifestRestore(
  value: unknown,
  logger?: Logger,
  ctx: CoerceCtx = {},
): AppRestoreDeclaration[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const out: AppRestoreDeclaration[] = [];
  const seen = new Set<string>();

  for (const raw of value) {
    const rec = asRecord(raw);
    if (!rec) {
      logger?.warn('Dropping restore declaration: not an object', { ...ctx });
      continue;
    }
    const id = asString(rec.id);
    if (!id) {
      logger?.warn('Dropping restore declaration: missing or blank id', { ...ctx });
      continue;
    }
    if (seen.has(id)) {
      logger?.warn('Dropping restore declaration: duplicate id, keeping the first', { ...ctx, id });
      continue;
    }
    seen.add(id);

    const declaration: AppRestoreDeclaration = { id };
    const discard = coerceDiscard(rec.discard);
    if (discard) declaration.discard = discard;
    const hook = coerceHook(rec.hook);
    if (hook) declaration.hook = hook;
    if (rec.requiresEnv === true) declaration.requiresEnv = true;
    out.push(declaration);
  }

  return out.length > 0 ? out : undefined;
}
