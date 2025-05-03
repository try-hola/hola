# Hola

Hola is a comprehensive application management platform built with TypeScript and Node.js, organized as a monorepo using Yarn workspaces. It provides a robust CLI client and API server to streamline application deployment, configuration, and management.

## Project Overview

This project consists of two main components:

- **CLI Component**: A TypeScript/Node.js CLI application that provides an intuitive command-line interface for managing applications, files, backups, and more.
- **Server-Side Component**: A Node.js/TypeScript API server that handles application deployments, configurations, and file storage with real-time updates via Server-Sent Events (SSE).

## Features

- **Application Lifecycle Management**: Deploy, list, upgrade, start, stop, and delete applications
- **File Management**: Upload, list, and delete files associated with applications
- **Backup & Restore**: Create, list, and restore application backups
- **Logs & Monitoring**: Access application logs, metrics, and health information
- **Real-Time Updates**: Watch application events in real-time
- **Configuration Management**: Handle system-wide and application-specific configurations

## Project Structure

```
project-root/
 │ ├── packages/ # Yarn workspace packages
 │ ├── client/ # CLI client application
 │ ├── server/ # API server application
 │ └── docs/ # Project documentation
 ├── .gitignore # Git ignore file
 ├── package.json # Root package.json for Yarn workspaces
 └── README.md # Project overview
```

## Technical Stack

- **Language**: TypeScript (configured with CommonJS modules)
- **Runtime**: Node.js (v16+)
- **Package Management**: Yarn with workspaces
- **API Documentation**: OpenAPI specification maintained at `/server/public/docs/openapi.yaml`
- **Testing Framework**: Node.js built-in test runner
- **CLI Framework**: Commander.js

## Getting Started

### Prerequisites

- Node.js (v16+)
- Yarn package manager

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/try-hola/hola.git
   cd hola
   ```
2. Install dependencies for all workspaces:
   ```bash
   yarn install
   ```
3. Set up environment variables (for server):
   ```bash
   cp server/.env.example server/.env
   # Edit the .env file with your configuration
   ```

## Development

### Starting the Development Server

```bash
# Start the server in development mode
yarn workspace server dev

# Start the client in development mode
yarn workspace client dev
```

### Building the Project

```bash
# Build all workspaces
yarn workspaces run build

# Build a specific workspace
yarn workspace server build
yarn workspace client build
```

## CLI Usage

The CLI follows a consistent pattern:

```bash
hola <command> <subcommand> [options]
```

Examples:

```bash
# Deploy an application
hola app deploy myapp --package mypackage:1.0 --env DB_USER=admin

# List all applications
hola app list

# View application logs
hola logs myapp

# Upload files to an application
hola file upload myapp config/nginx.conf static/logo.png
```

## Testing

The project uses Node.js built-in test runner for testing both server and client components. Tests are organized by feature area, with each controller function having its own dedicated test file.

### Running Tests

Run tests for all workspaces

```bash
yarn test
```

Run tests for a specific workspace:

```bash
yarn workspace server test
yarn workspace client test
```

Run specific test files by specifying the path:

```bash
yarn test packages/server/src/controllers/__tests__/apps/deploy.test.ts
```

Run specific test cases by specifying the test name:

```bash
yarn test -t "deployApp"
```

Run tests in watch mode:

```bash
yarn test:watch packages/server/src/controllers/__tests__/apps/deploy.test.ts
```

### Test Structure

Tests follow a consistent structure:

- Import and setup mocks first
- Import modules under test after mocking
- Define test fixtures in `beforeEach()`
- Write specific test cases with clear assertions

Example:

```typescript
// Import and setup mocks
const { mock } = require('node:test/mock');
const mockAppService = mock.module("../../services/appService");

// Import module under test
const { deployApp } = require("../../controllers/appController");

// Test implementation
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

describe("deployApp", () => {
  beforeEach(() => {
    // Set up test fixtures
    mockAppService.deploy.mockReset();
  });

  it("should deploy an app successfully", async () => {
    // Test implementation with assertions
    assert.strictEqual(result.success, true);
  });
});
```

## Communication Between Components

- The client and server communicate using REST APIs
- An OpenAPI specification is maintained at openapi.yaml
- Authentication is handled via a single API key defined on the server through environment variables
- Common types and interfaces are shared between client and server via the shared package

## Contributing

Please see [CONTRIBUTING.md] for detailed information on how to contribute to this project, including our development workflow, testing guidelines, and documentation standards.

## License

This project is licensed under the terms specified in the[LICENSE] file.
