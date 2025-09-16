# CONTRIBUTING.md

Welcome to the Hola project! This guide explains how to work with our Bun-based monorepo.

## Project Structure

This repository is a Bun workspaces monorepo with these primary packages:

- `packages/server`: Bun/TypeScript HTTP API
- `packages/web`: Vite + React + TypeScript SPA
- `packages/shared`: Shared types/config and route contracts
- `packages/cli`: Ink-based CLI for workflows
- `packages/sdk`: Typed client for the API
- `packages/compose`: Docker Compose stack for local/hosted runs

## Setting Up Development Environment

1. Clone the repository:
   ```bash
   git clone https://github.com/try-hola/hola.git
   cd hola
   ```

2. Install dependencies for all workspaces:
   ```bash
   bun install
   ```

## Bun Workspace Commands

### Working with Workspaces

- Run a script across all packages:
  ```bash
  bun run --filter './packages/*' <script>
  ```
- Run in a specific package (recommended):
  ```bash
  bun --cwd packages/<name> run <script>
  ```

Examples:
```bash
bun --cwd packages/server run dev
bun --cwd packages/web run dev
```

### Common Development Tasks

#### Start Development
```bash
# Run server and web together (root script)
bun run dev

# Or run individually
bun --cwd packages/server run dev
bun --cwd packages/web run dev
```

#### Build
```bash
# Build all packages
bun run build

# Build a specific package
bun --cwd packages/web run build
```

#### Tests
```bash
# All packages (delegates to each package)
bun run test

# Web (Vitest)
bun run test:web
bun --cwd packages/web run test:watch

# Server (Bun test runner)
bun --cwd packages/server run test

# Focused examples
bun test packages/server/src/__tests__/health/
npx vitest run packages/web/src/__tests__/hooks/
```

#### Linting & Type Checking
```bash
# All packages
bun run lint
bun run typecheck

# Specific package
bun --cwd packages/server run lint
bun --cwd packages/web run typecheck
```

## Development Workflow

1. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Make changes following repo conventions:
   - Keep related code within the same feature/domain
   - Prefer shared types from `@hola/shared`
   - Add/adjust tests for new behavior
3. Verify locally:
   ```bash
   bun run lint && bun run typecheck && bun run test
   ```
4. Commit with a clear, imperative message and open a PR.

## Testing Guidelines

Organize tests by functional domain rather than implementation details for discoverability and maintenance.

**Server** (`packages/server/src/__tests__/`): health, auth, system, docker, jobs, bundles, drafts, deployments, dev-sessions, sse, utils.

**Web** (`packages/web/src/__tests__/`): hooks, components, pages, api, sse, utils.

Patterns:
1. Mock first; import after mocks
2. Use fixtures/setup in `beforeEach`
3. Assert behavior, not internals
4. Use descriptive test names and `describe` by scenario

## Documentation Standards

- Keep `README.md` in each package up-to-date
- Add JSDoc to public functions/classes
- Prefer explaining "why" in comments

## Getting Help

If you need assistance:
- Check docs in `/docs` and package READMEs
- Review similar code paths for patterns
- Open an issue for design or larger questions

Thank you for contributing to the Hola project!
