import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * Resolve a manifest-declared relative path against a root directory and prove
 * the result is still inside it (#409).
 *
 * This is the security boundary for `hola app data push`: a push is a write
 * primitive into an app's data root driven by a *catalog-supplied* path, so a
 * malicious or careless manifest declaring `"path": "../../"` must not be able
 * to mirror over another app's data or the compose stack itself.
 *
 * Three layers, because each catches something the others don't:
 *  1. Syntactic — absolute paths and `..` segments are rejected outright.
 *  2. Lexical — `relative(root, resolved)` must not climb out (the same check
 *     `RealStorageService.resolveStoragePath` makes).
 *  3. Physical — **both sides are realpath'd**, so a symlink planted inside the
 *     data root (`books -> /etc`) can't smuggle the write elsewhere. The root is
 *     realpath'd too: with a symlinked bind root, comparing a resolved candidate
 *     against an unresolved root would reject honest paths.
 *
 * The candidate usually exists (the server creates the data root at materialize
 * time), but a target declared for a directory the app hasn't created yet still
 * needs an answer — so we realpath the deepest existing ancestor and re-append
 * the not-yet-existing tail. That tail can't itself be a symlink, because it
 * doesn't exist.
 *
 * @returns the absolute, contained path, or `undefined` if it escapes.
 */
export function resolveContainedDir(root: string, relPath: string): string | undefined {
  if (!relPath || isAbsolute(relPath)) return undefined;
  if (relPath.split(/[\\/]/).some((segment) => segment === '..')) return undefined;

  const resolvedRoot = resolve(root);
  const candidate = resolve(resolvedRoot, relPath);
  if (!isInside(resolvedRoot, candidate)) return undefined;

  // A root that doesn't exist yet can't hide a symlink, so the lexical check is
  // all there is to check against.
  if (!existsSync(resolvedRoot)) return candidate;

  let realRoot: string;
  let realCandidate: string;
  try {
    realRoot = realpathSync(resolvedRoot);
    realCandidate = realpathDeepest(candidate);
  } catch {
    return undefined;
  }

  return isInside(realRoot, realCandidate) ? candidate : undefined;
}

function isInside(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  const rel = relative(root, candidate);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * `realpathSync` for a path whose tail may not exist yet: resolve the deepest
 * existing ancestor and re-attach the segments below it.
 */
function realpathDeepest(target: string): string {
  const missing: string[] = [];
  let current = target;

  while (!existsSync(current)) {
    const parent = dirname(current);
    // Reached the filesystem root without finding anything that exists.
    if (parent === current) return target;
    missing.unshift(current.slice(parent.length + 1));
    current = parent;
  }

  return missing.length > 0 ? resolve(realpathSync(current), ...missing) : realpathSync(current);
}
