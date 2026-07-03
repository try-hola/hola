# Node.js Development Tools (node-dev-tools)

Installs TypeScript toolchain, bundlers, linters, file watchers, and Bun runtime for Node.js development.

## Options

| Option | Description | Type | Default |
|--------|-------------|------|---------|
| `install` | Comma-separated list of tool groups to install (e.g. `"typescript,bun"`). When set, only the listed groups are installed. When empty, all groups are installed. | string | `""` |
| `omit` | Comma-separated list of tool groups to exclude (e.g. `"bun"`). When set, the listed groups are skipped. Applied after `install` filtering. | string | `""` |

## Usage

Add this feature to your `devcontainer.json`:

```jsonc
{
  "features": {
    "ghcr.io/get2knowio/devcontainer-features/node-dev-tools:2": {}
  }
}
```

### TypeScript and Bun only

```jsonc
{
  "features": {
    "ghcr.io/get2knowio/devcontainer-features/node-dev-tools:2": {
      "install": "typescript,bun"
    }
  }
}
```

**Requires:** Node.js (installs after `ghcr.io/devcontainers/features/node`)
