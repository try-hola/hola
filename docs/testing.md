# Hola Test Infrastructure

This document describes the test infrastructure for the Hola monorepo.

## Overview

The test infrastructure is built on pytest and follows the project's preference for using fakes over mocks. Each package (hola_server, hola_cli, hola_shared) has its own test directory with appropriate fixtures and testing utilities.

## Directory Structure

```
hola/
├── hola_shared/tests/      # Tests for shared models and utilities
│   ├── models/             # Tests for models
│   └── fakes/              # Shared fake implementations
│
├── hola_server/tests/      # Tests for the server application
│   ├── api/                # API endpoint tests
│   └── fakes/              # Server-specific fake implementations
│
└── hola_cli/tests/         # Tests for the CLI application
    ├── commands/           # CLI command tests
    ├── services/           # Service tests
    ├── utils/              # Utility tests
    └── fakes/              # CLI-specific fake implementations
```

## Fake Implementations vs Mocks

Following project guidance, we prioritize fake implementations over mocks:

- **Fakes**: We implement real classes that mimic the behavior of dependencies but with simplified in-memory functionality. These are stored in the `tests/fakes/` directories.
- **Mocks**: Only used for simple cases where creating a fake would be excessive.

## Running Tests

### Running the Full Test Suite

```bash
cd /Users/paul/GitHub/hola
poetry run pytest
```

### Running Tests for a Specific Package

```bash
poetry run pytest hola_server/tests/

poetry run pytest hola_cli/tests/

poetry run pytest hola_shared/tests/
```

### Running Specific Test Files

```bash
poetry run pytest hola_server/tests/api/test_hello.py
poetry run pytest hola_cli/tests/commands/test_hello.py
```

### Running Tests with Coverage

```bash
poetry run pytest --cov=hola_server --cov=hola_cli --cov=hola_shared
```

Or use the predefined script:

```bash
poetry run test-cov
```

### Running Tests in Watch Mode

Watch mode automatically re-runs tests when files change:

```bash
poetry run pytest-watch hola_server/tests/
```

Or use the predefined script:

```bash
poetry run test-watch
```

## Test Fixtures

Each package has its own `conftest.py` with package-specific fixtures:

- **hola_shared**: Provides model factories and common response fixtures
- **hola_server**: Provides FastAPI TestClient and configuration overrides
- **hola_cli**: Provides fake settings, output capture, and server context

## Writing New Tests

1. Follow the existing directory structure and naming conventions
2. Use appropriate fixtures from `conftest.py`
3. For external dependencies, add fake implementations in the `fakes/` directory
4. Prefer fakes over mocks whenever possible
5. Test files should match the structure of the source code
6. Use meaningful test names that describe what is being tested

## Best Practices

1. Each test should be isolated and not depend on the state from other tests
2. Use fixtures to share setup code
3. Write both positive and negative test cases
4. Test edge cases and error conditions
5. Keep tests focused on a single functionality
6. Use meaningful assertions that clearly indicate what's being tested
