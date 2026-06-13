# Act (Local GitHub Actions) Setup

## Overview
Act is configured to run GitHub Actions locally for testing and development.

## Configuration Files
- **`.actrc`**: Main configuration with environment variables
- **`.github/act_platforms`**: Docker image mappings for runner platforms
- **`.github/workflows/ci-local.yml`**: Local-optimized workflow without upload steps

## Available Commands

### Convenience Scripts (via bun/npm)
```bash
# Quick local CI run (optimized workflow)
bun run ci:local

# Dry-run to see what would execute
bun run ci:local:dryrun

# Full workflow with all steps (may fail on upload)
bun run ci:local:full

# Test pull request events
bun run ci:local:pr

# List all available workflows
bun run ci:local:list
```

### Direct Act Commands
```bash
# Run specific workflow
act -W .github/workflows/ci-local.yml push

# Run with custom event
act pull_request

# Dry-run mode
act -n

# List workflows
act --list

# Run with specific platform/image
act -P ubuntu-latest=catthehacker/ubuntu:act-latest
```

## Features
- ✅ **Workspace Binding**: Uses local code directly (no checkout needed)
- ✅ **Test Environment**: `NODE_ENV=test` selects deterministic mock services
- ✅ **Docker Support**: Uses `catthehacker/ubuntu:act-latest` for compatibility
- ✅ **Caching**: Action caching enabled for faster subsequent runs
- ✅ **Local Optimization**: Separate workflow without GitHub-specific steps

## What Works Locally
- Bun installation and setup
- Dependency installation (`bun install`)
- Linting (`bun run lint`)
- Type checking (`bun run typecheck`)
- Test execution (`bun run test`)
- Web build (`bun --cwd packages/web run build`)

## Limitations
- Artifact upload fails (expected - no ACTIONS_RUNTIME_TOKEN locally)
- Some GitHub-specific actions may not work identically
- Network-dependent actions may behave differently

## Troubleshooting
- If Docker issues occur, ensure Docker daemon is running
- For permission errors, check Docker socket permissions
- Use `--verbose` or check `.actrc` for debug output
- Update images with `docker pull catthehacker/ubuntu:act-latest`

## Environment Variables
Default environment variable set in `.actrc`:
- `NODE_ENV=test` - Select deterministic mock services for CI-compatible tests
