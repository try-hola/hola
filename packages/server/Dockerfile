# Hola API server image. Build context is the repository root.
# Usage: docker build -f packages/server/Dockerfile -t hola/server:latest .
FROM oven/bun:1 AS base
WORKDIR /app

# ORAS CLI — the server pulls catalog app bundles from GHCR via `oras pull`
# (RealBundleService.ensurePulled). The oven/bun:1 base is Debian-based but ships
# without oras/curl, so install a pinned, arch-correct release here. Placed before
# the source COPY so this layer caches independently of application changes.
#
# Signing (cosign) is intentionally NOT installed: the default signaturePolicy is
# 'optional', under which a missing cosign only warns (verifySignature degrades
# gracefully). If signaturePolicy='required' is ever adopted, install cosign too.
#
# GHCR auth: try-hola/* app packages are public, so no credentials / `oras login`
# are needed. Pulling private packages would require a GHCR token + `oras login`
# at startup — out of scope here.
ARG ORAS_VERSION=1.2.3
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends curl ca-certificates; \
    rm -rf /var/lib/apt/lists/*; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) oras_arch="amd64" ;; \
      arm64) oras_arch="arm64" ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/oras.tar.gz \
      "https://github.com/oras-project/oras/releases/download/v${ORAS_VERSION}/oras_${ORAS_VERSION}_linux_${oras_arch}.tar.gz"; \
    tar -xzf /tmp/oras.tar.gz -C /usr/local/bin oras; \
    rm -f /tmp/oras.tar.gz; \
    oras version

# Install workspace dependencies against the committed lockfile (reproducible).
COPY . .
RUN bun install --frozen-lockfile

ENV NODE_ENV=production \
    PORT=3001 \
    HOLA_DATA_DIR=/data

# Persistent state: deployments, releases, sqlite, logs, generated Traefik config.
VOLUME ["/data"]
EXPOSE 3001

# The server runs TypeScript directly under Bun.
WORKDIR /app/packages/server

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://localhost:3001/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "start"]
