# GitHub Copilot Instructions

## Overview

This project consists of two main components organized as a monorepo using Poetry workspaces:

1. **Python FastAPI Server** - A backend server built using Python with FastAPI framework.
2. **Python CLI Client** - A CLI application written in Python using Typer, running as a standard Python package.

## Copilot Guidance

### General Guidelines

- Always suggest idiomatic Python code for both components.
- Follow Python best practices with PEP 8 style guidelines.
- Prioritize testability and maintainability over brevity.
- Follow best practices for modularity and separation of concerns.
- Leverage Poetry workspaces for shared code and dependencies across packages.
- Maintain consistency with the existing directory structure:
  - Use package directories for all source code.
  - Use `__mocks__/` for test mocks.
  - Use `tests/` for test files, organized by feature area.
- Use `poetry add` to add dependencies to the correct workspace.

### MCP Servers

This project uses Context7 MCP Server with get-library-docs and resolve-library-id.

### Python (FastAPI Server)

- Use modern Python practices with type hints.
- Configure Poetry to manage dependencies efficiently.
- Prefer `async/await` for asynchronous operations.
- Use Pydantic models and type hints extensively.
- Suggest Poetry scripts for executing commands.
- Optimize for Python performance best practices.
- Recommend efficient dependency management using Poetry.
- Consider suggesting appropriate middleware for FastAPI.
- Follow the deployment workflow outlined in project documentation:
  - Package download, deployment preparation, configuration merging, and activation.

### Python (CLI Client)

- Follow modern Python practices with type hints.
- Use Typer for CLI command structure and flag parsing.
- Leverage Poetry workspace references for shared code.
- Prefer structured logging solutions like `logging` or `loguru` when applicable.
- Optimize for cross-platform compatibility.
- Use Pydantic models to define and validate API request/response structures.
- Ensure proper error handling and user feedback in the CLI experience.
- **Always use `format_output` for all user-facing output, even for simple console logs, to ensure consistent formatting and future extensibility.**
- **Always use the shared error structure defined in `ApiResponse` for all command implementations.**

### API Client Guidelines

- The API client module **must remain generic**.
- Do **not** add command-specific or feature-specific methods to the API client.
- Only include generic HTTP helpers like `get`, `post`, `put`, `delete`.
- Command-specific logic should be implemented in the command handler modules.
- This keeps the API client reusable, maintainable, and decoupled from CLI features.

### Cross-Component Considerations

- The client and server communicate using REST, and an OpenAPI spec is maintained in `/hola_server/public/docs/openapi.yaml`.
- Utilize shared Pydantic models between client and server via Poetry workspaces.
- Authentication is handled by a single API key that is defined on the server via an environment variable.
- Suggest integration testing strategies that verify end-to-end interactions.
- Encourage clear documentation comments, especially for API endpoints and CLI commands.
- Recommend appropriate monorepo patterns for shared utilities and constants.

### Testing Recommendations

- Use pytest for testing across both server and client packages.
- Configure pytest to work with Python type hints and async code.
- Organize tests by feature area, with each function or controller having its own dedicated test file.
- Group related test files in subdirectories matching the component structure (e.g., `tests/apps/` for app-related controller tests).
- Strongly prefer fakes over mocks for testing, particularly at the periphery of the system:
  - Create proper fake implementations that mimic external dependencies (HTTP clients, file systems, databases) instead of using mocks.
  - Use fakes that implement the same interface as the real dependency but with simplified in-memory behavior.
  - Store fake implementations in a dedicated `tests/fakes/` directory for reusability across tests.
  - Only use mocks for simple cases where creating a fake would be excessive.
- Follow the established test structure:
  1. Import and set up fakes first.
  2. Import modules under test after setting up fakes.
  3. Define test fixtures in pytest fixtures.
  4. Write specific test cases with clear assertions.
- Write meaningful test cases that cover edge cases and error handling.
- Use shared test utilities to maintain DRY testing code across the codebase.

### Running Tests

- Run the full test suite with `poetry run pytest`.
- Run tests for a specific workspace:
  ```bash
  cd hola_server && poetry run pytest
  cd hola_cli && poetry run pytest
  ```
- Run specific test files by specifying the path:
  ```bash
  poetry run pytest hola_server/tests/controllers/test_apps_deploy.py
  ```
- Run specific test cases by specifying the test name:
  ```bash
  poetry run pytest -k "test_deploy_app"
  ```
- Run tests in watch mode:
  ```bash
  poetry run pytest-watch hola_server/tests/controllers/test_apps_deploy.py
  ```

### Documentation & Comments

- Encourage writing clear, concise, and relevant documentation in the code.
- Use docstrings for all functions, classes, and modules following PEP 257.
- Suggest meaningful commit messages and PR descriptions.
- When adding comments, prefer explaining _why_ something is done rather than _what_ is being done.
- Maintain workspace-level documentation for cross-cutting concerns.

### Commit Message Conventions

- Use [Conventional Commits](https://www.conventionalcommits.org/) style for all commit messages.
- Prefix commit messages with a clear scope, e.g.:
  - `feat(cli):` for new CLI features.
  - `feat(server):` for new server features.
  - `fix(cli):` for CLI bug fixes.
  - `fix(server):` for server bug fixes.
  - `refactor(cli):` for refactoring CLI code.
  - `test(server):` for adding or updating server tests.
- Write concise, descriptive commit messages explaining **what** was done.
- Prefer imperative mood (e.g., "add", "fix", "remove", "refactor").

### Poetry Workspace Structure

- Organize the workspace with packages for hola_server, hola_cli, hola_shared, and hola_client_sdk.
- Use Poetry for efficient dependency management.
- Suggest appropriate scripts in the root pyproject.toml for managing the workspaces.
- Advise on workspace-aware testing, building, and deployment strategies.