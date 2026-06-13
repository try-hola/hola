# Hola API server image. Build context is the repository root.
# Usage: docker build -f packages/server/Dockerfile -t hola/server:latest .
FROM oven/bun:1 AS base
WORKDIR /app

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
