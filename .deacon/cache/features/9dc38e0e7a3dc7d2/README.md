# Modern CLI Tools (modern-cli-tools)

Installs modern CLI replacements and TUI tools: bat, ripgrep, fd, fzf, eza, zoxide, neovim, tmux, lazygit, ast-grep, jujutsu, zellij, and starship.

## Options

| Option | Description | Type | Default |
|--------|-------------|------|---------|
| `install` | Comma-separated list of tools to install (e.g. `"bat,ripgrep,fzf"`). When set, only the listed tools are installed. When empty, all tools are installed. | string | `""` |
| `omit` | Comma-separated list of tools to exclude (e.g. `"neovim,tmux"`). When set, the listed tools are skipped. Applied after `install` filtering. | string | `""` |
| `jujutsuVersion` | Version of jujutsu to install | string | `0.38.0` |
| `ezaVersion` | Version of eza to install | string | `latest` |
| `lazygitVersion` | Version of lazygit to install | string | `0.59.0` |
| `astGrepVersion` | Version of ast-grep to install | string | `0.40.5` |
| `zellijVersion` | Version of zellij to install | string | `0.43.1` |
| `starshipVersion` | Version of starship to install | string | `latest` |

## Usage

Add this feature to your `devcontainer.json`:

```jsonc
{
  "features": {
    "ghcr.io/get2knowio/devcontainer-features/modern-cli-tools:2": {}
  }
}
```

### Install only specific tools

```jsonc
{
  "features": {
    "ghcr.io/get2knowio/devcontainer-features/modern-cli-tools:2": {
      "install": "bat,ripgrep,fd,fzf,eza,lazygit"
    }
  }
}
```

### Exclude zellij and pin lazygit version

```jsonc
{
  "features": {
    "ghcr.io/get2knowio/devcontainer-features/modern-cli-tools:2": {
      "omit": "zellij",
      "lazygitVersion": "0.58.0"
    }
  }
}
```
