import type { AppUpgradeMeta } from '@hola/shared';

/**
 * Narrow-shape coercion for the bundle manifest's optional `upgrade` block
 * (#284 Phase 0), mirroring `coerceManifestAuth` / `coerceConsumes`: unknown or
 * malformed fields are dropped rather than trusted, so a hand-edited manifest
 * can't smuggle arbitrary shapes into the deploy lifecycle. Returns `undefined`
 * when nothing valid is present (the app then has no upgrade restrictions).
 */

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim());
  return out.length ? out : undefined;
}

export function coerceManifestUpgrade(value: unknown): AppUpgradeMeta | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;

  const meta: AppUpgradeMeta = {};
  if (rec.breaking === true) meta.breaking = true;

  const minFrom = asString(rec.minFromVersion);
  if (minFrom) meta.minFromVersion = minFrom;

  const waypoints = asStringArray(rec.waypoints);
  if (waypoints) meta.waypoints = waypoints;

  const notes = asString(rec.upgradeNotesUrl);
  if (notes) meta.upgradeNotesUrl = notes;

  const backup = rec.preUpgradeBackup;
  if (backup === 'required' || backup === 'recommended' || backup === 'none') {
    meta.preUpgradeBackup = backup;
  }

  // Only surface the block when at least one valid field survived coercion.
  return Object.keys(meta).length > 0 ? meta : undefined;
}
