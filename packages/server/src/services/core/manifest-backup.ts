import type { AppBackupHook, AppBackupParticipation } from '@hola/shared';
import type { Logger } from '../../lib/logger';

/**
 * Narrow-shape coercion for the bundle manifest's optional `backup` block
 * (#121), mirroring `coerceManifestAuth` / `coerceManifestUpgrade`. A hook is
 * kept only when it names a service and a non-empty exec-form command
 * (all-string argv); anything malformed is dropped.
 *
 * Spec 004 (FR-001–004): the block may be the legacy singular object
 * (`{ preHook?, postHook? }`) or a plural array of participations, each with
 * its own `id`. This coercer always **emits the array** — the singular form
 * becomes a one-element list whose participation id is `default` — so a
 * freshly-coerced manifest is always the canonical shape and every server-side
 * reader (the broker, the pre-upgrade snapshot, the coverage judgement) has
 * exactly one shape to handle. A value already on disk (written by a server
 * before this feature, or a legacy release manifest) is read through
 * `backupParticipations()` instead, which accepts either shape directly —
 * this function is only the publish/finalize-time coercer, which is why it
 * alone takes a `Logger` and logs one warning per drop.
 *
 * Drop rules (never throw — a malformed entry degrades, per ADR 0003):
 * - a plural entry with no usable `id` (non-string, empty after trim);
 * - a plural entry whose `id` repeats an earlier one (first wins);
 * - an entry (singular or plural) with neither a well-formed `preHook` nor
 *   `postHook` survives.
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

function coerceHook(value: unknown): AppBackupHook | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const service = asString(rec.service);
  const command = asCommand(rec.command);
  if (!service || !command) return undefined;
  return { service, command };
}

/** The singular legacy shape → a one-element list named `default`, or `undefined` if neither hook survives. */
function coerceSingular(rec: Record<string, unknown>): AppBackupParticipation[] | undefined {
  const preHook = coerceHook(rec.preHook);
  const postHook = coerceHook(rec.postHook);
  if (!preHook && !postHook) return undefined;
  const participation: AppBackupParticipation = { id: 'default' };
  if (preHook) participation.preHook = preHook;
  if (postHook) participation.postHook = postHook;
  return [participation];
}

/** The plural shape: filtered to well-formed, uniquely-identified entries, in declaration order. */
function coercePlural(entries: unknown[], logger: Logger | undefined, ctx: CoerceCtx): AppBackupParticipation[] {
  const out: AppBackupParticipation[] = [];
  const seen = new Set<string>();

  for (const raw of entries) {
    const rec = asRecord(raw);
    if (!rec) {
      logger?.warn('Dropping backup participation: not an object', { ...ctx });
      continue;
    }
    const id = asString(rec.id);
    if (!id) {
      logger?.warn('Dropping backup participation: missing or blank id', { ...ctx });
      continue;
    }
    if (seen.has(id)) {
      logger?.warn('Dropping backup participation: duplicate id, keeping the first', { ...ctx, id });
      continue;
    }
    const preHook = coerceHook(rec.preHook);
    const postHook = coerceHook(rec.postHook);
    if (!preHook && !postHook) {
      logger?.warn('Dropping backup participation: no well-formed preHook or postHook', { ...ctx, id });
      continue;
    }
    seen.add(id);
    const participation: AppBackupParticipation = { id };
    if (preHook) participation.preHook = preHook;
    if (postHook) participation.postHook = postHook;
    out.push(participation);
  }

  return out;
}

export function coerceManifestBackup(
  value: unknown,
  logger?: Logger,
  ctx: CoerceCtx = {},
): AppBackupParticipation[] | undefined {
  if (Array.isArray(value)) {
    const participations = coercePlural(value, logger, ctx);
    return participations.length > 0 ? participations : undefined;
  }

  const rec = asRecord(value);
  if (!rec) return undefined;

  return coerceSingular(rec);
}
