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

FROM nginx:1.27-alpine
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1
