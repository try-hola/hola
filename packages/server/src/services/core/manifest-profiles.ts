import type { AppProfileConfig } from '@hola/shared';

/**
 * Narrow-shape coercion for the bundle manifest's optional `profiles` block
 * (#162), mirroring `coerceManifestUpgrade` / `coerceManifestAuth`: unknown or
 * malformed entries are dropped rather than trusted, so a hand-edited manifest
 * can't smuggle arbitrary shapes into the deploy lifecycle.
 *
 * Each entry needs a valid compose profile `key` (the activation token) and a
 * `label`; `description` and `default` are optional. `key` is validated against
 * Compose's profile-name grammar so it can be threaded into `COMPOSE_PROFILES`
 * safely. Duplicate keys collapse to the first occurrence. Returns `undefined`
 * when nothing valid is present (the app then has no optional profiles).
 */

// Compose profile names: start alphanumeric, then alphanumerics, `_`, `.`, `-`.
const PROFILE_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

export function coerceManifestProfiles(value: unknown): AppProfileConfig[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const out: AppProfileConfig[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const rec = raw as Record<string, unknown>;

    const key = asString(rec.key);
    if (!key || !PROFILE_KEY_RE.test(key) || seen.has(key)) continue;

    // A label is what the wizard shows; fall back to the key so a terse manifest
    // still renders something sensible rather than a blank checkbox.
    const label = asString(rec.label) ?? key;
    const description = asString(rec.description);

    seen.add(key);
    out.push({
      key,
      label,
      ...(description ? { description } : {}),
      ...(rec.default === true ? { default: true } : {}),
    });
  }

  return out.length ? out : undefined;
}
