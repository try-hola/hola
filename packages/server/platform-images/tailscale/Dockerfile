# The Tailscale companion image pin (spec 010). THIS FILE IS NEVER BUILT.
#
# It is the single source of truth for the image Hola injects next to an app
# with private Tailscale ingress. It is a Dockerfile only because that is a
# format Dependabot reads (.github/dependabot.yml, the `tailscale-companion`
# entry), which bumps the tag and the digest together. The server imports this
# file as text and takes DEFAULT_TAILSCALE_IMAGE from the FROM line below
# (packages/server/src/services/core/platform-images.ts), so merging a bump is
# the whole change: there is no second copy to edit.
#
# Format, enforced when the server loads: exactly one instruction, a FROM of
# `tailscale/tailscale:vX.Y.Z@sha256:<64 hex>`, where the digest is the
# multi-arch index digest. No stage name, no flags, no other instructions.
#
# Before merging a bump: the server drives this image's CLI (`tailscale up`,
# `tailscale serve`, `tailscale status --json`), and a new release can change
# those flags. CI does not exercise the real image. Run
#   bun test ./src/__tests__/integration/tailscale-ingress.it.ts
# from packages/server against a Docker daemon, and for a new minor go through
# the real-tailnet list in specs/010-tailscale-ingress/validation.md.
# See docs/TAILSCALE_INGRESS.md, "Updating the companion image".
FROM tailscale/tailscale:v1.104.7@sha256:72c1e19e0aedca96b8533bbb0b4368564410ff20b17e53b804eb6c1f04a31be4
