/**
 * The app registry: the generic, stable feed Hola publishes for cross-app
 * integration (ADR 0002). The server writes `registry.json` into the data root
 * of every deployment whose manifest declares `consumes: app-registry`; a
 * bundle-side bolt-on (e.g. a watcher sidecar) renders it into the app's own
 * config format. The schema below is the entire contract — the server never
 * learns what any consumer is.
 */

/** Manifest capability a consumer declares to receive the registry feed. */
export const APP_REGISTRY_CAPABILITY = 'app-registry';

/** File the feed is written as, inside the consumer's data root (`${HOLA_APP_DATA}`). */
export const REGISTRY_FILENAME = 'registry.json';

/** One installed app as seen by consumers. */
export interface RegistryApp {
  /** Deployment id (`<slug>-<hash>`). */
  id: string;
  /** App slug (stable key consumers can map to their own icon set). */
  app: string;
  /** Display name. */
  name: string;
  /** Public URL (`https://<app>.<base-domain>`), if known. */
  url?: string;
  /** Icon hint (may be a generic fallback; consumers may prefer `app`). */
  icon?: string;
  /** Current deployment status. */
  status: string;
}

/**
 * Render the canonical registry document. Deterministic (apps sorted by name)
 * so unchanged state produces byte-identical output — no needless rewrites.
 */
export function buildRegistry(apps: RegistryApp[]): string {
  const sorted = [...apps].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return JSON.stringify({ apps: sorted }, null, 2) + '\n';
}

/** Coerce a manifest `consumes` field (string or string[]) to a clean list. */
export function coerceConsumes(raw: unknown): string[] | undefined {
  const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const out = arr.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim());
  return out.length ? out : undefined;
}
