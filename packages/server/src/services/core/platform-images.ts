/**
 * Images the platform itself runs next to an app (spec 010).
 *
 * Unlike an app bundle's images these never pass through the compose
 * validator, so the "pinned image" rule is enforced HERE: the default is an exact
 * `tag@sha256:digest`, and an operator override must at least carry a tag or a
 * digest that is not `latest`.
 */

/** Tailscale companion image: tag + multi-arch index digest (research R9). */
export const DEFAULT_TAILSCALE_IMAGE =
  'tailscale/tailscale:v1.104.7@sha256:72c1e19e0aedca96b8533bbb0b4368564410ff20b17e53b804eb6c1f04a31be4';

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
