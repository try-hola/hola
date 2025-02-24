# GitHub Copilot Instructions

## Overview

This project consists of two main components:

1. **Bun/TypeScript API Server** - A backend server built using Bun and TypeScript.
2. **Go-Based Client** - A CLI application written in Go.

## Copilot Guidance

To ensure GitHub Copilot assists effectively, follow these guidelines:

### General Guidelines

- Always suggest idiomatic code for the respective language (TypeScript for the API, Go for the client).
- Prioritize testability and maintainability over brevity.
- Follow best practices for modularity and separation of concerns.

### TypeScript (Bun API Server)

- Use ES modules (`import`/`export` syntax) rather than CommonJS.
- Prefer `async/await` over raw promises.
- Use TypeScript types and interfaces extensively.
- Suggest `bun run` for executing scripts.
- Optimize for Bun's built-in features, avoiding unnecessary Node.js-specific modules unless explicitly needed.
- Recommend efficient dependency management using `bun.lockb` and `bun add` instead of `npm install`.
- Prioritize native Bun performance enhancements over traditional Node.js approaches.

### Go (Client CLI)

- Follow idiomatic Go practices (e.g., using `fmt.Printf`, `log`, and proper error handling).
- Use `cobra` for CLI command structure and flag parsing.
- Suggest Go modules (`go mod`) for dependency management.
- Prefer structured logging (e.g., `logrus` or `zap`) over plain `log.Printf` when applicable.
- Optimize for cross-platform compatibility.
- Ensure concurrency best practices when handling parallel execution (e.g., using goroutines and channels appropriately).

### Cross-Component Considerations

- The client and server communicate using REST, and an OpenAPI spec is maintained in /server/public/docs/openapi.yaml
- Ensure API request and response structures align correctly between the TypeScript server and Go client.
- Authentication is handled by a single API key that is defined on the server via an environment variable.
- Suggest integration testing strategies that verify end-to-end interactions.
- Encourage clear documentation comments, especially for API endpoints and CLI commands.

### Testing Recommendations

- For TypeScript, prefer `bun test` (or `vitest` if necessary) for unit and integration testing, not `jest`.
- For Go, use `go test` with `testing` package and, if applicable, `testify`.
- Recommend writing meaningful test cases that cover edge cases and error handling.

### Documentation & Comments

- Encourage writing clear, concise, and relevant documentation in the code.
- Suggest meaningful commit messages and PR descriptions.
- When adding comments, prefer explaining _why_ something is done rather than _what_ is being done.

By following these guidelines, Copilot can assist in maintaining a high-quality, well-structured, and efficient codebase for both the Bun/TypeScript API and the Go CLI client.
