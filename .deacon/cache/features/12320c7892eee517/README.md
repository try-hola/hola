# GitHub Actions Tools (github-actions-tools)

Installs tools for local GitHub Actions development: act (local runner) and actionlint (workflow linter).

## Options

| Option | Description | Type | Default |
|--------|-------------|------|---------|
| `install` | Comma-separated list of tools to install (e.g. `"act"`). When set, only the listed tools are installed. When empty, all tools are installed. | string | `""` |
| `omit` | Comma-separated list of tools to exclude (e.g. `"actionlint"`). When set, the listed tools are skipped. Applied after `install` filtering. | string | `""` |
| `actVersion` | Version of act to install | string | `0.2.84` |
| `actionlintVersion` | Version of actionlint to install | string | `1.7.10` |

## Usage

Add this feature to your `devcontainer.json`:

```jsonc
{
  "features": {
    "ghcr.io/get2knowio/devcontainer-features/github-actions-tools:2": {}
  }
}
```

### Install only actionlint

```jsonc
{
  "features": {
    "ghcr.io/get2knowio/devcontainer-features/github-actions-tools:2": {
      "install": "actionlint"
    }
  }
}
```
