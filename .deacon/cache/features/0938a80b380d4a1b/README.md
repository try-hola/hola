# AI CLI Tools (ai-clis)

Installs AI coding assistant CLIs and agentic development tools: Claude Code, Gemini CLI, OpenAI Codex, GitHub Copilot, OpenCode, CodeRabbit, Beads (with Dolt), and Specify CLI.

## Options

| Option | Description | Type | Default |
|--------|-------------|------|---------|
| `install` | Comma-separated list of CLIs to install (e.g. `"claudeCode,geminiCli"`). When set, only the listed CLIs are installed. When empty, all CLIs are installed. | string | `""` |
| `omit` | Comma-separated list of CLIs to exclude (e.g. `"codex,copilot"`). When set, the listed CLIs are skipped. Applied after `install` filtering. | string | `""` |

> These tools can be large — use `install` or `omit` to skip any you don't need and speed up container builds.

## Usage

Add this feature to your `devcontainer.json`:

```jsonc
{
  "features": {
    "ghcr.io/get2knowio/devcontainer-features/ai-clis:2": {}
  }
}
```

### Install everything except a few

Use `omit` to exclude specific CLIs:

```jsonc
{
  "features": {
    "ghcr.io/get2knowio/devcontainer-features/ai-clis:2": {
      "omit": "codex,copilot"
    }
  }
}
```

### Install only the CLIs you want

Use `install` to list exactly the CLIs you need — new CLIs added in future releases won't be installed unless you opt in:

```jsonc
{
  "features": {
    "ghcr.io/get2knowio/devcontainer-features/ai-clis:2": {
      "install": "claudeCode,geminiCli"
    }
  }
}
```

**Requires:** Node.js (installs after `ghcr.io/devcontainers/features/node`)
