#!/bin/bash
set -e

echo "Installing GitHub Actions tools..."

ARCH=$(dpkg --print-architecture)

resolve_latest_version() {
    local repo="$1"
    local tag
    tag=$(curl -sI "https://github.com/${repo}/releases/latest" \
          | grep -i "^location:" | sed 's/.*\///' | tr -d '\r\n')
    echo "${tag#v}"
}

# Step 1: All tools enabled by default
ACT="true"
ACTIONLINT="true"

# Step 2: If install is set, whitelist mode
if [ -n "${INSTALL}" ]; then
    ACT="false"
    ACTIONLINT="false"

    IFS=',' read -ra SELECTED <<< "${INSTALL}"
    for item in "${SELECTED[@]}"; do
        item="$(echo "$item" | xargs)"
        case "$item" in
            act)        ACT="true" ;;
            actionlint) ACTIONLINT="true" ;;
            *) echo "Warning: unknown tool '$item' in install list" ;;
        esac
    done
fi

# Step 3: If omit is set, blacklist filter
if [ -n "${OMIT}" ]; then
    IFS=',' read -ra EXCLUDED <<< "${OMIT}"
    for item in "${EXCLUDED[@]}"; do
        item="$(echo "$item" | xargs)"
        case "$item" in
            act)        ACT="false" ;;
            actionlint) ACTIONLINT="false" ;;
            *) echo "Warning: unknown tool '$item' in omit list" ;;
        esac
    done
fi

# act - run GitHub Actions locally
if [ "${ACT}" = "true" ]; then
    if [ "${ACTVERSION}" = "latest" ]; then
        ACTVERSION=$(resolve_latest_version "nektos/act")
        echo "Resolved act latest -> ${ACTVERSION}"
    fi
    echo "Installing act ${ACTVERSION}..."
    case "$ARCH" in
        amd64) ACT_ARCH="x86_64" ;;
        arm64) ACT_ARCH="arm64" ;;
        *) echo "Unsupported architecture for act: $ARCH" && exit 1 ;;
    esac
    ACT_URL="https://github.com/nektos/act/releases/download/v${ACTVERSION}/act_Linux_${ACT_ARCH}.tar.gz"
    curl -fsSL "$ACT_URL" | tar -xz -C /usr/local/bin act
    chmod +x /usr/local/bin/act
fi

# actionlint - GitHub Actions workflow linter
if [ "${ACTIONLINT}" = "true" ]; then
    if [ "${ACTIONLINTVERSION}" = "latest" ]; then
        ACTIONLINTVERSION=$(resolve_latest_version "rhysd/actionlint")
        echo "Resolved actionlint latest -> ${ACTIONLINTVERSION}"
    fi
    echo "Installing actionlint ${ACTIONLINTVERSION}..."
    case "$ARCH" in
        amd64) ACTIONLINT_ARCH="amd64" ;;
        arm64) ACTIONLINT_ARCH="arm64" ;;
        *) echo "Unsupported architecture for actionlint: $ARCH" && exit 1 ;;
    esac
    ACTIONLINT_URL="https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINTVERSION}/actionlint_${ACTIONLINTVERSION}_linux_${ACTIONLINT_ARCH}.tar.gz"
    curl -fsSL "$ACTIONLINT_URL" | tar -xz -C /usr/local/bin actionlint
    chmod +x /usr/local/bin/actionlint
fi

echo "GitHub Actions tools installation complete."
