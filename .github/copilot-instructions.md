# GitHub Copilot Instructions

## Overview

This project consists of two main components organized as a monorepo using Yarn workspaces:

1. **Node.js/TypeScript API Server** - A backend server built using Node.js and TypeScript with CommonJS modules.
2. **Node.js/TypeScript Client** - A CLI application written in TypeScript with CommonJS modules running on Node.js.

## Copilot Guidance

To ensure GitHub Copilot assists effectively, follow these guidelines:

### General Guidelines

- Always suggest idiomatic TypeScript code for both components.
- Use CommonJS module format (`require`/`module.exports`) for all TypeScript code.
- Prioritize testability and maintainability over brevity.
- Follow best practices for modularity and separation of concerns.
- Leverage Yarn workspaces for shared code and dependencies across packages.

### TypeScript (Node.js API Server)

- Use CommonJS module syntax (`require`/`module.exports`) rather than ES modules.
- Configure TypeScript to emit CommonJS-compatible code.
- Prefer `async/await` over raw promises.
- Use TypeScript types and interfaces extensively.
- Suggest `yarn` scripts for executing commands.
- Optimize for Node.js performance best practices.
- Recommend efficient dependency management using Yarn.
- Consider suggesting appropriate middleware for Express or other Node.js frameworks.

### TypeScript (Node.js Client CLI)

- Follow modern TypeScript practices for Node.js environments with CommonJS modules.
- Configure tsconfig.json with `"module": "CommonJS"` and appropriate settings.
- Use `commander` or `yargs` for CLI command structure and flag parsing.
- Leverage Yarn workspace references for shared code.
- Prefer structured logging solutions like `winston` or `pino` when applicable.
- Optimize for cross-platform compatibility.
- Use TypeScript interfaces to define and validate API request/response structures.
- Ensure proper error handling and user feedback in the CLI experience.

### Cross-Component Considerations

- The client and server communicate using REST, and an OpenAPI spec is maintained in /server/public/docs/openapi.yaml
- Utilize shared TypeScript types/interfaces between client and server via Yarn workspaces.
- Authentication is handled by a single API key that is defined on the server via an environment variable.
- Suggest integration testing strategies that verify end-to-end interactions.
- Encourage clear documentation comments, especially for API endpoints and CLI commands.
- Recommend appropriate monorepo patterns for shared utilities and constants.

### Testing Recommendations

- Use Jest for testing across both server and client packages.
- Configure Jest to work with CommonJS modules and TypeScript.
- Organize tests by feature area, with each controller function having its own dedicated test file.
- Group related test files in subdirectories matching the component structure (e.g., `__tests__/apps/` for app-related controller tests).
- Follow the pattern of importing test utilities and setting up mocks before importing the modules under test.
- Use beforeEach() hooks to reset mocks and set up test fixtures for each test case.
- Leverage Jest's mocking capabilities for API and external service testing.
- Write meaningful test cases that cover edge cases and error handling.
- Maintain consistent test structure across files:
  - Import and setup mocks first
  - Import modules under test after mocking
  - Define test fixtures in beforeEach()
  - Write specific test cases with clear assertions
- Set up Jest configs that work well with TypeScript and the workspace structure.
- Use shared test utilities to maintain DRY testing code across the codebase.

### Running Tests

- Run the full test suite with `yarn test`
- Run specific test files by specifying the path:
  ```bash
  yarn test src/controllers/__tests__/apps/deploy.test.ts
  ```
- Run specific test cases by specifying the test name:
  ```bash
  yarn test -t "deployApp"
  ```
- Run tests in watch mode:
  ```bash
  yarn test:watch src/controllers/__tests__/apps/deploy.test.ts
  ```

### Documentation & Comments

- Encourage writing clear, concise, and relevant documentation in the code.
- Suggest meaningful commit messages and PR descriptions.
- When adding comments, prefer explaining _why_ something is done rather than _what_ is being done.
- Recommend maintaining workspace-level documentation for cross-cutting concerns.

### Yarn Workspace Structure

- Suggest appropriate workspace organization with packages for server, client, and shared code.
- Recommend efficient workspace dependency management.
- Consider suggesting appropriate scripts in the root package.json for managing the workspaces.
- Advise on workspace-aware testing, building, and deployment strategies.

By following these guidelines, Copilot can assist in maintaining a high-quality, well-structured, and efficient codebase for both the Node.js/TypeScript API server and client within a Yarn workspace monorepo structure.
