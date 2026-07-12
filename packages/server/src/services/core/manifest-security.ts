// Defensive coercion for a catalog bundle manifest's optional `security` block
// into a typed AppSecurityConfig. Mirrors the narrow-shape coercion used for
// `auth`/`consumes` in catalog.ts: anything malformed degrades to `undefined`
// (treated as "no elevated permissions requested") rather than throwing, so a
// sloppy manifest never breaks catalog browsing — it just doesn't get the grant.

import type { AppSecurityConfig, ElevatedPermission, ElevatedPermissionType } from '@hola/shared';

// The elevated-permission types the server understands. An unknown `type` is
// dropped (not granted): a manifest can't invent a privilege the platform hasn't
// implemented, and forward-compat means a newer bundle on an older server simply
// doesn't get the not-yet-supported grant rather than failing to install.
const ELEVATED_TYPES: readonly ElevatedPermissionType[] = ['allow-privilege-escalation'];

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

function coerceElevated(v: unknown): ElevatedPermission | undefined {
  const rec = asRecord(v);
  if (!rec) return undefined;
  const type = asString(rec.type) as ElevatedPermissionType | undefined;
  if (!type || !ELEVATED_TYPES.includes(type)) return undefined;
  // A reason is mandatory — it's what the operator reads before consenting. Drop
  // an entry that doesn't justify itself rather than surface a bare checkbox.
  const reason = asString(rec.reason);
  if (!reason) return undefined;
  return { type, reason };
}

/**
 * Coerce the optional manifest `security` block. Returns undefined when absent,
 * malformed, or when it declares no valid elevated permission — so the common
 * (fully-hardened) case carries no security object at all. Duplicate types are
 * de-duplicated (first wins) so a manifest can't stack the same grant twice.
 */
export function coerceManifestSecurity(raw: unknown): AppSecurityConfig | undefined {
  const rec = asRecord(raw);
  if (!rec) return undefined;
  const list = Array.isArray(rec.elevated) ? rec.elevated : [];
  const seen = new Set<ElevatedPermissionType>();
  const elevated: ElevatedPermission[] = [];
  for (const entry of list) {
    const coerced = coerceElevated(entry);
    if (!coerced || seen.has(coerced.type)) continue;
    seen.add(coerced.type);
    elevated.push(coerced);
  }
  return elevated.length ? { elevated } : undefined;
}

/** True when the app requests the privilege-escalation grant (drop no-new-privileges). */
export function requestsPrivilegeEscalation(security: AppSecurityConfig | undefined): boolean {
  return !!security?.elevated.some((e) => e.type === 'allow-privilege-escalation');
}
