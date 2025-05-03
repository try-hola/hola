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
yarn test
```

Run tests for a specific workspace:
```bash
yarn workspace server test
```

Run a specific test file:
```bash
yarn workspace server test src/controllers/__tests__/apps/deploy.test.ts
```

Run tests matching a specific pattern:
```bash
yarn workspace server test --test-name-pattern="deployApp"
```

Run tests in watch mode:
```bash
yarn workspace server test --watch
```

Watch a specific test file:
```bash
yarn workspace server test --watch src/controllers/__tests__/apps/deploy.test.ts
```

#### Linting

```bash
# Lint all workspaces
yarn workspaces run lint

# Lint a specific workspace
yarn workspace server lint
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
   yarn workspace server test
   ```

4. Lint your code:
   ```bash
   yarn workspace server lint
   ```

5. Commit your changes with a descriptive commit message

6. Push your branch and create a pull request

## Testing Guidelines

- We organize tests by feature area, with each function having its own dedicated test file
- Tests are grouped in subdirectories matching the component structure
- Follow the established pattern:
  1. Import and setup mocks first
  2. Import modules under test after mocking
  3. Define test fixtures in beforeEach()
  4. Write specific test cases with clear assertions

## Documentation Standards

- Document public API endpoints in the OpenAPI spec at `/server/public/docs/openapi.yaml`
- Add JSDoc comments to functions and classes
- When adding comments, explain _why_ something is done rather than _what_ is being done
- Keep README.md files updated in each workspace

## Getting Help

If you have any questions or need help, please:
- Check the existing documentation
- Look at existing code for examples
- Open an issue for larger discussions

Thank you for contributing to the Hola project!
