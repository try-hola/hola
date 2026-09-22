# Hola API server image. Build context is the repository root.
# Usage: docker build -f packages/server/Dockerfile -t hola/server:latest .
FROM oven/bun:1 AS base
WORKDIR /app

# Runtime CLIs the server shells out to: the Docker CLI + compose plugin (deploy
# lifecycle) and ORAS (pulls catalog app bundles from GHCR via `oras pull`,
# RealBundleService.ensurePulled). The oven/bun:1 base is Debian-based but ships
# none of these, so install them here — before the source COPY so this layer
# caches independently of application changes.
#
# Signing (cosign) is intentionally NOT installed — and the reason this comment
# used to give was dangerous (F05). It said a missing cosign "degrades
# gracefully" and that adopting signaturePolicy=required just meant installing
# cosign. The opposite was true: `verifySignature` ran `cosign version` and
# returned verified=true, so cosign ABSENT failed closed while cosign PRESENT
# passed having checked nothing. Installing it was what converted a safe error
# into a false pass — the posture degraded the more diligent the operator was.
#
# That inversion is fixed (cosign present with no configured trust root now
# yields `unverifiable`, which `required` refuses), so cosign is no longer
# harmful here — it is simply not yet useful: no bundle in the shipped catalog
# is signed, so there is nothing for it to verify. Satisfying
# HOLA_SIGNATURE_POLICY=required needs all three of a signed catalog, a
# configured trust root (HOLA_SIGNATURE_TRUST_*), and cosign in this image; an
# operator who has the first two can add the third in a derived image. Adding it
# here before the catalog signs would only grow the image and imply a capability
# the platform cannot yet use. See docs/OPERATIONS.md#bundle-signature-verification.
#
# GHCR auth: try-hola/* app packages are public, so no credentials / `oras login`
# are needed. Pulling private packages would require a GHCR token + `oras login`
# at startup — out of scope here.
ARG ORAS_VERSION=1.2.3
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends curl ca-certificates gnupg; \
    arch="$(dpkg --print-architecture)"; \
    # --- Docker CLI + compose plugin (from Docker's official apt repo) ---
    # The deploy lifecycle shells out to `docker compose up` / `docker version`
    # (services/core/docker.ts) against the host engine via the mounted
    # /var/run/docker.sock. Without these, every app install fails preflight with
    # "docker: not found".
    install -m 0755 -d /etc/apt/keyrings; \
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc; \
    chmod a+r /etc/apt/keyrings/docker.asc; \
    codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"; \
    echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian ${codename} stable" > /etc/apt/sources.list.d/docker.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin; \
    # --- ORAS CLI (pulls catalog app bundles from GHCR) ---
    case "$arch" in \
      amd64) oras_arch="amd64" ;; \
      arm64) oras_arch="arm64" ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/oras.tar.gz \
      "https://github.com/oras-project/oras/releases/download/v${ORAS_VERSION}/oras_${ORAS_VERSION}_linux_${oras_arch}.tar.gz"; \
    tar -xzf /tmp/oras.tar.gz -C /usr/local/bin oras; \
    rm -f /tmp/oras.tar.gz; \
    rm -rf /var/lib/apt/lists/*; \
    oras version; docker --version; docker compose version

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
