"""
Test package for hola_cli.

This package contains the test suite for the hola_cli Python package, which is a command-line
interface application that interacts with the Hola server. The tests follow a structured 
organization pattern with tests grouped by component type:

- commands/: Tests for CLI commands defined in hola_cli/commands/
- services/: Tests for service layer components in hola_cli/services/
- utils/: Tests for utility functions in hola_cli/utils/
- fakes/: Fake implementations used across tests instead of mocks
- conftest.py: Shared pytest fixtures and configurations

# Testing Strategy Overview

The test suite uses pytest as the testing framework and follows these key principles:

1. **Isolation from External Dependencies**: 
   - Tests operate in isolated environments without depending on network, filesystem, etc.
   - Temporary directories are used for file operations
   - Network calls are replaced with fake clients or mocked responses

2. **Preference for Fakes Over Mocks**:
   - Fake implementations (in the 'fakes/' directory) implement the same interface as real components
   - Fakes provide realistic behavior that mimics the real components
   - This approach makes tests more resilient to implementation changes
   - Mocks are used selectively for simpler cases where fakes would be excessive

3. **Focus on Behavior Verification**:
   - Tests verify what the code does, not how it does it
   - Command tests check that the right output is produced for given inputs
   - Service tests verify that the right API calls are made and responses are processed correctly
   - This approach allows refactoring without breaking tests

4. **Component-Based Test Organization**:
   - Each test file corresponds to a specific component in the main package
   - Tests are grouped by component type (commands, services, utils)
   - This structure makes it easy to find tests for a specific component

5. **Shared Fixtures and Utilities**:
   - Common test fixtures are defined in conftest.py
   - These fixtures provide standardized test environments and objects
   - This approach reduces duplication and ensures consistency across tests

# Running the Tests

From the hola_cli directory:
    
    poetry run pytest            # Run all tests
    poetry run pytest -v         # Run with verbose output
    poetry run pytest -k keyword # Run tests matching keyword
    poetry run pytest tests/commands/test_hello.py  # Run tests in a specific file
    poetry run pytest --cov=hola_cli  # Run tests with coverage reporting
"""
