#!/bin/bash
set -e

echo "Installing AI CLI tools..."

# Step 1: All tools enabled by default
CLAUDECODE="true"
GEMINICLI="true"
CODEX="true"
COPILOT="true"
OPENCODE="true"
CODERABBIT="true"
BEADS="true"
SPECIFYCLI="true"
QMD="true"
CLAUDEAGENTACP="true"

# Step 2: If install is set, whitelist mode
if [ -n "${INSTALL}" ]; then
    CLAUDECODE="false"
    GEMINICLI="false"
    CODEX="false"
    COPILOT="false"
    OPENCODE="false"
    CODERABBIT="false"
    BEADS="false"
    SPECIFYCLI="false"
    QMD="false"
    CLAUDEAGENTACP="false"

    IFS=',' read -ra SELECTED <<< "${INSTALL}"
    for item in "${SELECTED[@]}"; do
        item="$(echo "$item" | xargs)"
        case "$item" in
            claudeCode)  CLAUDECODE="true" ;;
            geminiCli)   GEMINICLI="true" ;;
            codex)       CODEX="true" ;;
            copilot)     COPILOT="true" ;;
            openCode)    OPENCODE="true" ;;
            codeRabbit)  CODERABBIT="true" ;;
            beads)       BEADS="true" ;;
            specifyCli)  SPECIFYCLI="true" ;;
            qmd)             QMD="true" ;;
            claudeAgentAcp)  CLAUDEAGENTACP="true" ;;
            *) echo "Warning: unknown CLI '$item' in install list" ;;
        esac
    done
fi

# Step 3: If omit is set, blacklist filter
if [ -n "${OMIT}" ]; then
    IFS=',' read -ra EXCLUDED <<< "${OMIT}"
    for item in "${EXCLUDED[@]}"; do
        item="$(echo "$item" | xargs)"
        case "$item" in
            claudeCode)  CLAUDECODE="false" ;;
            geminiCli)   GEMINICLI="false" ;;
            codex)       CODEX="false" ;;
            copilot)     COPILOT="false" ;;
            openCode)    OPENCODE="false" ;;
            codeRabbit)  CODERABBIT="false" ;;
            beads)       BEADS="false" ;;
            specifyCli)  SPECIFYCLI="false" ;;
            qmd)             QMD="false" ;;
            claudeAgentAcp)  CLAUDEAGENTACP="false" ;;
            *) echo "Warning: unknown CLI '$item' in omit list" ;;
        esac
    done
fi

# Claude Code - uses its own installer (npm install -g is deprecated)
if [ "${CLAUDECODE}" = "true" ]; then
    echo "Installing Claude Code..."
    su - "$_REMOTE_USER" -c 'curl -fsSL https://claude.ai/install.sh | bash' || echo "Warning: Claude Code installation failed"
fi

# Gemini CLI
if [ "${GEMINICLI}" = "true" ]; then
    echo "Installing Gemini CLI..."
    npm install -g @google/gemini-cli
fi

# OpenAI Codex
if [ "${CODEX}" = "true" ]; then
    echo "Installing OpenAI Codex..."
    npm install -g @openai/codex
fi

# GitHub Copilot CLI (requires Node 22+)
if [ "${COPILOT}" = "true" ]; then
    echo "Installing GitHub Copilot CLI..."
    npm install -g @github/copilot
fi

# OpenCode AI
if [ "${OPENCODE}" = "true" ]; then
    echo "Installing OpenCode AI..."
    curl -fsSL https://opencode.ai/install | bash
    # Installer puts binary in $HOME/.opencode/bin — copy to a system PATH location
    # (symlinking fails for non-root users since /root is chmod 700)
    install -m 755 "$HOME/.opencode/bin/opencode" /usr/local/bin/opencode
fi

# CodeRabbit CLI
if [ "${CODERABBIT}" = "true" ]; then
    echo "Installing CodeRabbit CLI..."
    # The upstream installer can exit non-zero even after a successful install
    # (it prints "Installation complete" then returns exit code 2), which would
    # abort this script under `set -e`. Tolerate the exit code and verify the
    # binary actually landed instead.
    curl -fsSL https://cli.coderabbit.ai/install.sh | CODERABBIT_INSTALL_DIR=/usr/local/bin sh || true
    if [ -x /usr/local/bin/coderabbit ] || command -v coderabbit >/dev/null 2>&1; then
        echo "CodeRabbit CLI installed."
    else
        echo "Warning: CodeRabbit CLI installation failed"
    fi
fi

# Beads - coding agent memory system (depends on Dolt)
if [ "${BEADS}" = "true" ]; then
    echo "Installing Dolt (required by Beads)..."
    curl -fsSL https://github.com/dolthub/dolt/releases/latest/download/install.sh | bash
    echo "Installing Beads..."
    npm install -g @beads/bd
fi

# Specify CLI - spec-driven development toolkit
if [ "${SPECIFYCLI}" = "true" ]; then
    echo "Installing Specify CLI (spec-kit) via uv..."
    # Ensure uv is available
    if command -v uv >/dev/null 2>&1; then
        UV_BIN="$(command -v uv)"
    elif [ -f "$_REMOTE_USER_HOME/.local/bin/uv" ]; then
        UV_BIN="$_REMOTE_USER_HOME/.local/bin/uv"
    else
        echo "uv not found; installing via Astral script..."
        curl -LsSf https://astral.sh/uv/install.sh | env INSTALLER_NO_MODIFY_PATH=1 sh
        cp /root/.local/bin/uv /usr/local/bin/uv
        cp /root/.local/bin/uvx /usr/local/bin/uvx
        chmod 755 /usr/local/bin/uv /usr/local/bin/uvx
        UV_BIN="/usr/local/bin/uv"
    fi
    # Ensure ~/.local/bin on PATH for user-installed tools
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$_REMOTE_USER_HOME/.zshrc"
    su - "$_REMOTE_USER" -c "\"$UV_BIN\" tool install specify-cli --from git+https://github.com/github/spec-kit.git" || echo "Warning: Specify CLI installation failed"
fi

# QMD - on-device search engine for markdown notes and documents
if [ "${QMD}" = "true" ]; then
    echo "Installing QMD..."
    npm install -g @tobilu/qmd
fi

# Claude Agent ACP - ACP adapter for Claude Code SDK (by Zed Industries)
if [ "${CLAUDEAGENTACP}" = "true" ]; then
    echo "Installing Claude Agent ACP..."
    npm install -g @zed-industries/claude-agent-acp
fi

echo "AI CLI tools installation complete."
