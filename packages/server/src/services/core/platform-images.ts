/**
 * Images the platform itself runs next to an app (spec 010).
 *
 * Unlike an app bundle's images these never pass through the compose
 * validator, so the "pinned image" rule is enforced HERE: the default is an exact
 * `tag@sha256:digest`, and an operator override must at least carry a tag or a
 * digest that is not `latest`.
 */

import tailscalePinFile from '../../../platform-images/tailscale/Dockerfile' with { type: 'text' };

const TAILSCALE_PIN_RE = /^tailscale\/tailscale:v\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/;

/**
 * Read the companion image reference out of the pin file
 * (`packages/server/platform-images/tailscale/Dockerfile`).
 *
 * Strict on purpose: Dependabot edits that file, and whatever this returns is
 * what the server runs. Comments and blank lines aside, the file must hold
 * exactly one instruction, a FROM of `tailscale/tailscale:vX.Y.Z@sha256:<digest>`.
 * Anything else throws, which stops the server at startup.
 */
export function parseTailscaleImagePin(dockerfile: string): string {
  const where = 'platform-images/tailscale/Dockerfile';
  const instructions = dockerfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  const from = instructions.filter((line) => /^FROM\s/i.test(line));
  if (from.length !== 1) {
    throw new Error(`${where} must contain exactly one FROM line, found ${from.length}`);
  }
  if (instructions.length !== 1) {
    throw new Error(`${where} must contain only a FROM line; it is a pin file and is never built`);
  }
  const ref = from[0].replace(/^FROM\s+/i, '');
  if (!TAILSCALE_PIN_RE.test(ref)) {
    throw new Error(`${where} must pin tailscale/tailscale:vX.Y.Z@sha256:<64 hex digits>, got "${ref}"`);
  }
  return ref;
}

/**
 * Tailscale companion image: tag + multi-arch index digest (research R9). The
 * pin file is the only place the reference is written; Dependabot updates it.
 */
export const DEFAULT_TAILSCALE_IMAGE = parseTailscaleImagePin(tailscalePinFile);

const DIGEST_RE = /@sha256:[0-9a-f]{64}$/;

/** The tag of a reference (`a/b:tag`, `host:5000/a/b:tag@sha256:..`), or undefined. */
function tagOf(ref: string): string | undefined {
  const noDigest = ref.replace(/@sha256:[0-9a-f]{64}$/, '');
  const lastSlash = noDigest.lastIndexOf('/');
  const colon = noDigest.indexOf(':', lastSlash + 1);
  return colon === -1 ? undefined : noDigest.slice(colon + 1);
}

/**
 * The companion image: `HOLA_TAILSCALE_IMAGE` when set and pinned (for hosts that
 * mirror registries), else the built-in default. An unpinned override throws
 * rather than silently falling back, so a typo cannot quietly change what runs.
 */
export function tailscaleImage(env: Record<string, string | undefined> = process.env): string {
  const override = env.HOLA_TAILSCALE_IMAGE?.trim();
  if (!override) return DEFAULT_TAILSCALE_IMAGE;
  if (/\s/.test(override)) {
    throw new Error('HOLA_TAILSCALE_IMAGE must be a single image reference');
  }
  const tag = tagOf(override);
  if (!DIGEST_RE.test(override) && (!tag || tag === 'latest')) {
    throw new Error(
      'HOLA_TAILSCALE_IMAGE must carry a tag (not "latest") or a sha256 digest; an unpinned image is refused',
    );
  }
  if (DIGEST_RE.test(override) && tag === 'latest') {
    throw new Error('HOLA_TAILSCALE_IMAGE must not use the "latest" tag');
  }
  return override;
}
