#!/usr/bin/env bash
# Devcontainer post-create: toolchain check, repo deps, the disposable-VM helpers,
# and the Playwright browser used by bin/vm-web-check (headless dashboard test).
# Playwright steps are non-fatal so a download hiccup never blocks the build.
set -u

node --version && tsc --version

# Repo dependencies (includes Playwright, used by bin/vm-web-check).
bun install || echo "[post-create] bun install failed — run it manually"

# Make the disposable-VM helpers executable.
chmod +x bin/mcp-setup bin/vm-create bin/vm-wait-ssh bin/vm-ssh bin/vm-snapshot \
         bin/vm-destroy bin/vm-reap bin/vm-test bin/vm-web-check 2> /dev/null || true

# Playwright's Chromium for bin/vm-web-check. Download the browser as THIS user
# (so it lands in our cache, not root's), then install system libs via sudo.
# Rerun later if it fails: bunx playwright install --with-deps chromium
if [ -x node_modules/.bin/playwright ]; then
  node_modules/.bin/playwright install chromium \
    || echo "[post-create] playwright chromium download failed (rerun: bunx playwright install chromium)"
  sudo env "PATH=$PATH" node_modules/.bin/playwright install-deps chromium \
    || echo "[post-create] playwright system deps failed (rerun: sudo bunx playwright install-deps chromium)"
else
  echo "[post-create] playwright not installed — skipping browser setup (bun install first)"
fi

# MCP / disposable-VM testing env status (non-fatal).
bin/mcp-setup --check || true
