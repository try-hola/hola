#!/bin/sh
# Hola CLI installer.
#
#   curl -fsSL https://raw.githubusercontent.com/try-hola/hola/main/cli-install.sh | sh
#
# Installs the `hola` command. Prefers a prebuilt binary from the latest GitHub
# release for your platform; if none is available it builds one from source with
# Bun (installing Bun if needed). Until the CLI is published to npm this is the
# supported install path.
#
# Environment overrides:
#   HOLA_INSTALL_DIR    install directory   (default: $HOME/.local/bin)
#   HOLA_REPO_SLUG      owner/repo          (default: try-hola/hola)
#   HOLA_VERSION        release tag to pull (default: latest)
set -eu

REPO_SLUG="${HOLA_REPO_SLUG:-try-hola/hola}"
INSTALL_DIR="${HOLA_INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${HOLA_VERSION:-latest}"
BIN_NAME="hola"

info() { printf '\033[1;36m[hola]\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m[hola]\033[0m %s\n' "$1" >&2; }
die()  { printf '\033[1;31m[hola] error:\033[0m %s\n' "$1" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl is required."

# --- detect platform -------------------------------------------------------
os="$(uname -s)"; arch="$(uname -m)"
case "$os" in
  Linux) os="linux" ;;
  Darwin) os="darwin" ;;
  *) die "unsupported OS: $os" ;;
esac
case "$arch" in
  x86_64 | amd64) arch="x64" ;;
  aarch64 | arm64) arch="arm64" ;;
  *) die "unsupported architecture: $arch" ;;
esac
ASSET="hola-${os}-${arch}"

mkdir -p "$INSTALL_DIR"
TARGET="$INSTALL_DIR/$BIN_NAME"

# --- try a prebuilt release binary -----------------------------------------
if [ "$VERSION" = "latest" ]; then
  API_URL="https://api.github.com/repos/${REPO_SLUG}/releases/latest"
else
  API_URL="https://api.github.com/repos/${REPO_SLUG}/releases/tags/${VERSION}"
fi

DL_URL="$(curl -fsSL "$API_URL" 2>/dev/null \
  | grep -oE "https://[^\"]*/${ASSET}([\"[:space:]]|$)" \
  | sed 's/[",[:space:]]*$//' \
  | head -1 || true)"

if [ -n "${DL_URL:-}" ]; then
  info "Downloading prebuilt ${ASSET}"
  tmp="$(mktemp)"
  if curl -fSL "$DL_URL" -o "$tmp"; then
    chmod +x "$tmp"
    mv "$tmp" "$TARGET"
  else
    rm -f "$tmp"
    die "failed to download $DL_URL"
  fi
else
  # --- fall back to building from source ----------------------------------
  warn "No prebuilt ${ASSET} found; building from source (requires git)."
  command -v git >/dev/null 2>&1 || die "git is required to build from source."
  if ! command -v bun >/dev/null 2>&1; then
    info "Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
    PATH="$BUN_INSTALL/bin:$PATH"
  fi
  command -v bun >/dev/null 2>&1 || die "Bun is not on PATH after install; open a new shell and retry."

  src="$(mktemp -d)"
  info "Cloning source into $src"
  git clone --depth 1 "https://github.com/${REPO_SLUG}.git" "$src"
  (
    cd "$src"
    bun install --frozen-lockfile
    bun build packages/cli/src/index.tsx --compile \
      --target="bun-${os}-${arch}" --external react-devtools-core \
      --outfile "$TARGET"
  )
  rm -rf "$src"
fi

chmod +x "$TARGET"
info "Installed $BIN_NAME to $TARGET"

# --- PATH + usage hints ----------------------------------------------------
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) warn "$INSTALL_DIR is not on your PATH. Add it:"
     warn "  export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
esac

info "Next steps:"
info "  • No server yet?  Set one up on a host:   $BIN_NAME bootstrap --host user@your-vm"
info "    (or generate a .env locally first with:  $BIN_NAME init)"
info "  • Already have a server?  Point the CLI at it:"
info "      export HOLA_API_URL=https://<your-hola-domain>"
info "      export HOLA_TOKEN=<admin-api-key>"
info "Run '$BIN_NAME --help' to see all commands."
