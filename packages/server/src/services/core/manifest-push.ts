import type { AppBackupHook, AppPushMode, AppPushQuiesce, AppPushTarget } from '@hola/shared';

/**
 * Narrow-shape coercion for the bundle manifest's optional `push` block (#409),
 * mirroring `coerceManifestBackup` / `coerceManifestProfiles`. A target is kept
 * only when it declares an id, a label and a usable relative path; a malformed
 * `postHook` or a bad enum value is dropped from an otherwise-valid target
 * rather than taking the whole target with it. Returns `undefined` when nothing
 * survives.
 *
 * `path` is rejected here when it's absolute, contains a `..` segment, or
 * contains whitespace/NUL. That's syntactic defence-in-depth — the real
 * containment guarantee is `resolveContainedDir`, which resolves against the
 * deployment's data root and follows symlinks. Rejecting whitespace also
 * de-fangs word-splitting when the resolved path is interpolated into a remote
 * shell command by the CLI.
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

/** Data-root-relative, no traversal, no shell-hostile characters. */
function asRelativePath(v: unknown): string | undefined {
  const raw = asString(v);
  if (!raw) return undefined;
  if (raw.startsWith('/')) return undefined;
  if (/[\s\0]/.test(raw)) return undefined;
  if (raw.split('/').some((segment) => segment === '..')) return undefined;
  return raw;
}

function asMode(v: unknown): AppPushMode | undefined {
  return v === 'mirror' || v === 'additive' ? v : undefined;
}

function asQuiesce(v: unknown): AppPushQuiesce | undefined {
  return v === 'stop' || v === 'none' ? v : undefined;
}

export function coerceManifestPush(value: unknown): AppPushTarget[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const targets: AppPushTarget[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    const rec = asRecord(entry);
    if (!rec) continue;

    const id = asString(rec.id);
    const label = asString(rec.label);
    const path = asRelativePath(rec.path);
    if (!id || !label || !path) continue;
    // First declaration of an id wins; a duplicate would make `push <id>`
    // ambiguous.
    if (seen.has(id)) continue;
    seen.add(id);

    const target: AppPushTarget = { id, label, path };
    const description = asString(rec.description);
    if (description) target.description = description;
    const mode = asMode(rec.mode);
    if (mode) target.mode = mode;
    const quiesce = asQuiesce(rec.quiesce);
    if (quiesce) target.quiesce = quiesce;
    const postHook = coerceHook(rec.postHook);
    if (postHook) target.postHook = postHook;

    targets.push(target);
  }

  return targets.length > 0 ? targets : undefined;
}
