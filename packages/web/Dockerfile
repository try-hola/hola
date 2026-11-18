# Hola web (SPA) image. Build context is the repository root.
# Usage: docker build -f packages/web/Dockerfile -t hola/web:latest .
#
# A static nginx serves the built SPA and reverse-proxies /api to the API
# server, so the browser uses a single origin (no CORS).
FROM oven/bun:1 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run --cwd packages/web build

# Pinned to 1.31.9, the release that fixes CVE-2026-123633 (HTTP/2 use-after-free) and
# nine other CVEs. hola-web serves plain HTTP behind Traefik, so it was not exploitable, but
# the shipped version should be deliberate. Dependabot keeps this pin moving.
FROM nginx:1.31.9-alpine@sha256:0713660ff64e819a478be0d69ae314e52d21623c93672edd9f381a6e66fd95ff
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
EXPOSE 80
# Use 127.0.0.1 (not localhost): in the alpine image `localhost` can resolve to
# IPv6 ::1, where nginx (listening on IPv4 0.0.0.0:80) does not answer, which
# would mark the container unhealthy even though it serves correctly.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
