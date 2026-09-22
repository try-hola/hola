/**
 * The deploy-time half of bind-source containment (F02a).
 *
 * `@hola/shared/compose-validate` proves containment on the compose an app
 * DECLARES, which is the right enforcement point (Constitution I) but not the
 * last word on what Docker executes. Between validation and `compose up` the
 * server rewrites the document: it substitutes `${HOLA_APP_DATA}`, injects
 * grants, applies platform defaults — and then Compose itself interpolates
 * whatever `${VAR}` references survive, from `deployments/<id>/runtime/.env`,
 * a file that legitimately carries the app's own environment. The validator's
 * refusal of interpolated bind sources closes the one known path into that gap;
 * this module closes the gap itself, by reading the configuration Compose
 * actually resolved (`docker compose config`) and refusing to start it when a
 * bind source landed somewhere it may not.
 *
 * Both layers are deliberate. The validator gives the operator a 422 while
 * they are still in the wizard, and gives catalog CI something to fail on; this
 * gate is the one that can say "no host path outside this app's own root will
 * be bound", about the exact configuration being executed, whatever produced
 * it. It runs before `compose pull` and therefore before any container exists.
 *
 * Containment is LEXICAL, for the same reason it is in the validator: this
 * checks paths the platform composed, not the filesystem's opinion of them, and
 * a symlink planted inside an app's own data root is a separate (post-deploy)
 * concern. No `node:fs` here.
 */

/** One resolved bind mount, as `docker compose config` reports it. */
export interface ResolvedBindMount {
  service: string;
  /** Absolute host path. */
  source: string;
  /** Container-side path (carried for the error message only). */
  target: string;
}

/**
 * Collapse `.`/`..`/duplicate separators in an absolute POSIX path. A `..` at
 * the root stays at the root, exactly as the kernel resolves it.
 */
export function normalizeHostPath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join('/')}`;
}

/** True when `path` is `root` itself or sits underneath it. */
function isUnder(path: string, root: string): boolean {
  const p = normalizeHostPath(path);
  const r = normalizeHostPath(root);
  return p === r || p.startsWith(r === '/' ? '/' : `${r}/`);
}

/**
 * Every bind mount in a `docker compose config --format json` document.
 *
 * Compose normalises `volumes` to long syntax in `config` output, so each entry
 * is an object with a `type`. Only `bind` entries carry a host path: `volume`,
 * `tmpfs`, `npipe` and `cluster` have nothing to contain. An entry whose shape
 * is unrecognised is reported with an empty source so the caller refuses rather
 * than skips it — an unparseable mount is not a proof of containment.
 */
export function resolvedBindMounts(config: unknown): ResolvedBindMount[] {
  const mounts: ResolvedBindMount[] = [];
  const services = (config as { services?: unknown } | null)?.services;
  if (!services || typeof services !== 'object' || Array.isArray(services)) return mounts;

  for (const [service, raw] of Object.entries(services as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const volumes = (raw as { volumes?: unknown }).volumes;
    if (!Array.isArray(volumes)) continue;
    for (const entry of volumes) {
      if (typeof entry === 'string') {
        // Compose long-syntax is what `config` emits, but a short-syntax entry
        // surviving (an older CLI, a hand-written fixture) must still be read
        // rather than waved through.
        const source = entry.split(':')[0] ?? '';
        if (!source.startsWith('/')) continue; // named volume or anonymous mount
        mounts.push({ service, source, target: entry.split(':')[1] ?? '' });
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      const type = (entry as { type?: unknown }).type;
      if (type !== undefined && type !== 'bind') continue;
      const source = (entry as { source?: unknown }).source;
      const target = (entry as { target?: unknown }).target;
      mounts.push({
        service,
        source: typeof source === 'string' ? source : '',
        target: typeof target === 'string' ? target : '',
      });
    }
  }
  return mounts;
}

/** A bind mount the resolved configuration may not have. */
export interface UncontainedBindMount extends ResolvedBindMount {
  reason: string;
}

/**
 * Bind mounts in `config` that are neither inside `appRoot` nor one of the
 * platform's own `allowedPaths`.
 *
 * `allowedPaths` are the mounts the SERVER injects after validation — the
 * container-logs proxy's Docker socket, the apps-data read-only root, the
 * restore staging root. Each is matched as a containment root rather than a
 * string, because the injections are identity mounts of a directory.
 */
export function uncontainedBindMounts(
  config: unknown,
  opts: { appRoot: string; allowedPaths?: readonly string[] },
): UncontainedBindMount[] {
  const allowed = [opts.appRoot, ...(opts.allowedPaths ?? [])].filter((p) => p && p.startsWith('/'));
  const bad: UncontainedBindMount[] = [];
  for (const mount of resolvedBindMounts(config)) {
    if (!mount.source) {
      bad.push({ ...mount, reason: 'has no readable host source' });
      continue;
    }
    if (!mount.source.startsWith('/')) {
      // `config` absolutises relative host paths; anything left is not a path
      // this gate can reason about.
      bad.push({ ...mount, reason: 'is not an absolute host path' });
      continue;
    }
    if (allowed.some((root) => isUnder(mount.source, root))) continue;
    bad.push({ ...mount, reason: `resolves to '${normalizeHostPath(mount.source)}', outside the app data root` });
  }
  return bad;
}

/** One human-readable line per refusal, for the error the deploy fails with. */
export function describeUncontained(mounts: readonly UncontainedBindMount[]): string {
  return mounts
    .map((m) => `${m.service}: '${m.source}'${m.target ? ` → '${m.target}'` : ''} ${m.reason}`)
    .join('; ');
}
