# CONTRIBUTING.md

Welcome to the Hola project! This guide will help you understand how to work with our monorepo structure using Yarn workspaces.

## Project Structure

This project is organized as a monorepo using Yarn workspaces with the following main components:

- **server**: Node.js/TypeScript API server
- **client**: Node.js/TypeScript CLI application

## Setting Up Development Environment

1. Clone the repository:
   ```bash
   git clone https://github.com/try-hola/hola.git
   cd hola
   ```

2. Install dependencies for all workspaces:
   ```bash
   yarn install
   ```

## Yarn Workspace Commands

### Working with Workspaces

List all workspaces:
```bash
yarn workspaces info
```

Run a command in a specific workspace:
```bash
yarn workspace <workspace-name> <command>
```

For example:
```bash
yarn workspace server start
yarn workspace client dev
```

### Common Development Tasks

#### Starting the Development Server

```bash
# Start the server in development mode
yarn workspace server dev

# Start the client in development mode
yarn workspace client dev
```

#### Building the Project

```bash
# Build all workspaces
yarn workspaces run build

# Build a specific workspace
yarn workspace server build
```

#### Running Tests

Run all tests:
```bash
bun test
```

Run tests for a specific workspace:
```bash
bun run --filter './packages/*' test
# or specifically
cd packages/server && bun test
cd packages/web && bun test
```

Run tests from the workspace root:
```bash
# Web tests (using Vitest)
bun run test:web

# Server tests (using Bun's built-in test runner)
cd packages/server && bun test

# Run tests in watch mode
cd packages/web && bun test:watch
```

Run specific test files or patterns:
```bash
# Run a specific test file
bun test packages/server/src/__tests__/health/infrastructure.test.ts

# Run tests in a specific domain
bun test packages/server/src/__tests__/auth/
bun test packages/web/src/__tests__/hooks/
```

#### Linting

```bash
# Lint all workspaces
bun run lint

# Lint a specific workspace
cd packages/server && bun run lint
cd packages/web && bun run lint
```

## Development Workflow

1. Create a new branch for your feature or bugfix:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes, following our code organization principles:
   - Keep related functionality in the same module
   - Use TypeScript types and interfaces extensively
   - Write tests for new functionality

3. Run tests to ensure your changes don't break existing functionality:
   ```bash
   bun test
   # or for a specific workspace
   cd packages/server && bun test
   cd packages/web && bun test
   ```

4. Lint your code:
   ```bash
   bun run lint
   ```

5. Commit your changes with a descriptive commit message

6. Push your branch and create a pull request

## Testing Guidelines

We organize tests by functional domains rather than implementation structure. Tests are grouped into logical feature areas for better maintainability and discoverability.

### Test Organization

**Server Tests** (`packages/server/src/__tests__/`):
- `health/` - Health endpoints, infrastructure, and observability
- `auth/` - Authentication, authorization, and security
- `system/` - System monitoring, status, and performance
- `docker/` - Docker service integration and health reporting
- `jobs/` - Job management, tracking, and structured logging
- `bundles/` - Bundle cache, OCI integration, and catalog management
- `drafts/` - Draft lifecycle and validation
- `deployments/` - Deployment management and actions
- `dev-sessions/` - Development session management
- `sse/` - Server-Sent Events and real-time features
- `utils/` - Test utilities and shared helpers

**Web Tests** (`packages/web/src/__tests__/`):
- `hooks/` - React hooks and custom API hooks
- `components/` - React component unit tests  
- `pages/` - Page component integration tests
- `api/` - API client and integration tests
- `sse/` - SSE client-side functionality and real-time features
- `utils/` - Test utilities, mocks, and fixtures

### Test Patterns

Follow these established patterns:
1. Import dependencies and setup mocks first
2. Import modules under test after mocking  
3. Define test fixtures and setup in beforeEach()
4. Write specific test cases with clear, descriptive assertions
5. Use functional test names that describe behavior, not implementation details
6. Group related tests in describe blocks by feature or scenario

## Code Review with CodeRabbit

This repository uses CodeRabbit AI for automated code reviews. CodeRabbit provides context-aware code analysis, automated reviews on pull requests with actionable feedback, and integrates with 40+ linters and security tools.

### What CodeRabbit Provides

- **Assertive Review Profile**: Thorough reviews focusing on critical issues
- **TypeScript Focus**: Specialized attention to type safety and API contracts
- **Monorepo Awareness**: Package-specific review instructions
- **Security Scanning**: GitLeaks for secrets detection
- **Code Quality Tools**: ESLint, Hadolint (Docker), YAML/Markdown linting
- **Knowledge Base**: Learns from our coding guidelines in `.github/copilot-instructions.md`

### Package-Specific Reviews

CodeRabbit provides tailored feedback for each package:

- **`packages/web/`**: React patterns, hooks, performance, accessibility
- **`packages/server/`**: API implementation, security, Bun patterns
- **`packages/shared/`**: Type definitions, breaking changes, contracts
- **`packages/cli/`**: CLI usability, error handling
- **`packages/sdk/`**: API client implementation, documentation
- **Tests**: Focus on fakes over mocks, isolation, edge cases

### Working with CodeRabbit

**In Pull Requests**, CodeRabbit automatically reviews all pull requests and provides:

1. **High-level Summary**: What changed and why it matters
2. **File-by-file Walkthrough**: Detailed breakdown of each change
3. **Architecture Diagrams**: Visual flow of system changes
4. **Inline Comments**: Specific feedback on code sections

**Interacting with CodeRabbit** - You can chat with CodeRabbit in PR comments:

```
@coderabbitai Can you explain this function?
@coderabbitai How does this change affect the API contract?
@coderabbitai Generate unit tests for this component
@coderabbitai Create documentation for this endpoint
```

**Review Commands**:
- `@coderabbitai summary` - Generate/update PR summary
- `@coderabbitai review` - Trigger a new review
- `@coderabbitai help` - Show available commands

### Best Practices for CodeRabbit

**For Code Authors**:
1. **Use Descriptive PR Titles**: CodeRabbit can auto-generate titles with `@coderabbitai` placeholder
2. **Link Issues**: CodeRabbit verifies changes address linked issues
3. **Small, Focused PRs**: Better reviews with clear scope
4. **Draft PRs**: Use drafts for work-in-progress (reviews are skipped)

**For Reviewers**:
1. **Review CodeRabbit's Analysis**: Start with the high-level summary
2. **Check Inline Comments**: Address or resolve AI feedback
3. **Use Chat Feature**: Ask CodeRabbit questions about complex changes
4. **Provide Feedback**: Teach CodeRabbit your team's preferences

**Teaching CodeRabbit**: When CodeRabbit's suggestions don't match your preferences, reply to its comment with your preference. CodeRabbit learns and applies this to future reviews.

### Troubleshooting CodeRabbit

**CodeRabbit Not Reviewing**:
1. Check repository access in [CodeRabbit settings](https://app.coderabbit.ai/settings/repositories)
2. Verify PR is not a draft (if `auto_review.drafts: false`)
3. Ensure PR has changes in included file patterns

**Bot PRs**: CodeRabbit is configured to review pull requests from bots (including GitHub Actions, Dependabot, etc.). If you want to exclude specific bots, add their usernames to the `ignore_usernames` array in `.coderabbit.yaml`.

**Configuration Updates**: To modify CodeRabbit's behavior, edit `.coderabbit.yaml` in the repository root. Changes take effect on the next PR.

## Documentation Standards

- Document public API endpoints in the OpenAPI spec at `/server/public/docs/openapi.yaml`
- Add JSDoc comments to functions and classes
- When adding comments, explain _why_ something is done rather than _what_ is being done
- Keep README.md files updated in each workspace

## Getting Help

If you have any questions or need help, please:
- Check the existing documentation
- Look at existing code for examples
- Ask CodeRabbit questions in PR comments using `@coderabbitai`
- Open an issue for larger discussions

For CodeRabbit-specific support:
- **Documentation**: [docs.coderabbit.ai](https://docs.coderabbit.ai/)
- **Discord**: [CodeRabbit Community](https://discord.gg/GsXnASn26c)
- **Issues**: Create GitHub issues for configuration problems

Thank you for contributing to the Hola project!
