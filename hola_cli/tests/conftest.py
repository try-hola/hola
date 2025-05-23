"""
Shared fixtures and configuration for hola_cli tests.

This module provides common test fixtures used across the CLI test suite. It includes:
- Configuration fixtures that override production settings for testing purposes
- Response fixtures that simulate server API responses
- Console output capture utilities for validating CLI command output
- Provider fixtures for testing with fake providers instead of real ones

These fixtures follow the project's testing strategy of preferring fakes over mocks
and ensuring tests are isolated from external dependencies like file systems and network calls.
"""
# Make this module unique to avoid conflicts when running all tests
__name__ = "hola_cli.tests.conftest"

import pytest
import json
import os
from pathlib import Path
from typing import Dict, Any, Generator, Iterator
from unittest.mock import patch

from hola_cli.config.settings import CliSettings, ServerConnection
from hola_shared.models.response import ApiResponse, ApiError
from hola_cli.providers.registry import ServerProviderRegistry
from hola_cli.providers.providers import get_provider_registry
from hola_cli.test_utils.fakes.fake_provider import FakeServerProvider


@pytest.fixture
def mock_environment():
    """
    Fixture to mock environment variables for testing.
    
    This fixture temporarily sets environment variables with the HOLA_ prefix
    for testing environment-dependent functionality, then restores the original
    environment after the test completes. This provides a clean, isolated
    environment for each test that interacts with environment variables.
    
    The fixture sets common test values that can be used by default in tests,
    but individual tests can modify the environment as needed for specific test cases.
    
    Example:
        def test_server_from_env(mock_environment):
            # Environment is pre-configured with test values
            context = get_current_server()
            assert context.name == "env"
            assert context.url == "http://test-url"
            
            # Test can modify environment for specific test cases
            os.environ["HOLA_SERVER_URL"] = "http://different-url"
            context = get_current_server()
            assert context.url == "http://different-url"
    
    Yields:
        dict: Dictionary containing the set environment variables
    """
    # Define test environment variables
    env_vars = {
        "HOLA_SERVER": "test-server",
        "HOLA_SERVER_URL": "http://test-url",
        "HOLA_API_KEY": "test-env-key",
        "HOLA_OUTPUT_FORMAT": "json",
        "HOLA_LOG_LEVEL": "DEBUG"
    }
    
    # Save original environment
    original_env = {}
    for key in env_vars:
        if key in os.environ:
            original_env[key] = os.environ[key]
    
    # Set test environment
    for key, value in env_vars.items():
        os.environ[key] = value
        
    yield env_vars
    
    # Restore original environment
    for key in env_vars:
        if key in original_env:
            os.environ[key] = original_env[key]
        elif key in os.environ:
            del os.environ[key]


@pytest.fixture
def fake_settings() -> CliSettings:
    """
    Return test CLI settings.
    
    This fixture provides a standardized, in-memory configuration object that can be used
    across tests without reading from the filesystem. It simulates a configured CLI
    with a test server connection for consistent testing behavior.
    
    The fixture creates a pre-configured CliSettings object with:
    - A 'test' server connection with mock URL and API key
    - A default server set to 'test'
    - Default output formatting configured as 'table'
    - Predefined log level set to 'INFO'
    
    Using this fixture in tests means:
    1. Tests don't need to repeatedly set up configuration objects
    2. Tests are isolated from the user's actual configuration files
    3. There's a consistent baseline configuration across all tests
    4. Tests can be written assuming this standardized environment
    
    Returns:
        CliSettings: A pre-configured settings object for testing
    """
    return CliSettings(
        servers={"test": ServerConnection(url="http://test", api_key="test-key")},
        default_server="test",
        output_format="table",
        log_level="INFO"
    )


@pytest.fixture
def settings_path_override(tmp_path) -> Generator[Path, None, None]:
    """
    Override the settings file path for testing.
    
    Creates a temporary directory for test settings and cleans it up afterward. This fixture:
    1. Creates a temporary directory to store test settings
    2. Writes a predefined configuration to a settings file in that location
    3. Patches the settings path lookup to use this temporary file
    4. Cleans up automatically after tests complete
    
    This ensures tests don't interact with the user's actual configuration files
    and allows for testing configuration file loading/saving functionality.
    
    This fixture is particularly valuable for tests that need to verify:
    - Settings file loading and parsing
    - Settings file saving and updates
    - Migration of settings between versions
    - Handling of missing or invalid settings files
    
    The fixture uses pytest's built-in tmp_path fixture to create isolated
    filesystem environments for each test, ensuring tests don't interfere
    with each other even when manipulating settings files.
    
    Args:
        tmp_path: A pytest-provided temporary directory that's unique per test
        
    Yields:
        Path: The path to the temporary settings file
    """
    settings_dir = tmp_path / ".config" / "hola"
    settings_dir.mkdir(parents=True, exist_ok=True)
    settings_file = settings_dir / "settings.json"
    
    # Save fake settings to the file
    settings = {
        "servers": {"test": {"url": "http://test", "api_key": "test-key"}},
        "default_server": "test",
        "output_format": "table",
        "log_level": "INFO"
    }
    with open(settings_file, "w") as f:
        json.dump(settings, f)
    
    # Patch the settings path to use our temporary file
    with patch("hola_cli.config.settings.get_settings_path", return_value=settings_file):
        yield settings_file


@pytest.fixture
def capture_output() -> Generator[Iterator[str], None, None]:
    """
    Capture console output for testing CLI commands.
    
    Returns a callable that provides access to captured output lines when invoked.
    
    This fixture temporarily redirects stdout to a string buffer during test execution,
    making it possible to assert on what would have been printed to the console.
    This is particularly useful for testing CLI commands that use print statements
    or formatting utilities to display information to users.
    
    The fixture is critical for CLI testing because it allows tests to verify what
    the user would actually see in the terminal, including:
    - Formatted output from commands (tables, JSON, etc.)
    - Progress indicators and status messages
    - Error messages and warnings
    - Help text and usage information
    
    The fixture handles the necessary cleanup to restore the original stdout
    even if a test fails, ensuring that test isolation is maintained.
    
    Example:
        def test_hello_command(capture_output):
            # Run command that prints to console
            hello_world()
            # Get captured output
            output_lines = capture_output()
            # Assert on the output
            assert "Hello, world!" in output_lines
            
    Returns:
        Callable[[], List[str]]: A function that returns captured output lines
    """
    from io import StringIO
    import sys
    
    # Save original stdout
    original_stdout = sys.stdout
    # Replace with a string buffer
    string_buffer = StringIO()
    sys.stdout = string_buffer
    
    try:
        yield lambda: string_buffer.getvalue().splitlines()
    finally:
        # Restore original stdout
        sys.stdout = original_stdout


@pytest.fixture
def successful_api_response() -> ApiResponse:
    """
    Return a successful API response for testing.
    
    This fixture provides a standardized successful response object that can be
    used consistently across tests. It follows the shared ApiResponse model
    structure that is used between the CLI and server components.
    
    Having a standardized successful response ensures:
    1. Tests have a consistent baseline for verifying successful operations
    2. There's a single source of truth for what success looks like
    3. Tests focus on their specific logic rather than repeatedly creating response objects
    4. Changes to the response structure only need to be updated in one place
    
    The response contains generic test data that can be used in most test scenarios.
    For tests requiring specific data structures, this fixture can either be customized
    or supplemented with more specific fixtures.
    
    Returns:
        ApiResponse: A standardized successful API response with test data
    """
    return ApiResponse(success=True, data="Test data")


@pytest.fixture
def error_api_response() -> ApiResponse:
    """
    Return an error API response for testing.
    
    This fixture provides a standardized error response object that can be
    used consistently across tests. It follows the shared ApiResponse model
    with an ApiError component, matching the error structure used throughout
    the application for consistency in error handling testing.
    
    Having a standardized error response ensures:
    1. Tests have a consistent baseline for verifying error handling
    2. Error handling tests follow a predictable pattern
    3. Tests can focus on specific error handling logic without recreating error responses
    4. The application's error handling can be tested with realistic error structures
    
    The response includes a standard error code and details that can be used
    to test the CLI's error handling and display logic. For tests requiring specific
    error scenarios, this fixture can be customized or extended with additional fixtures.
    
    Returns:
        ApiResponse: A standardized error API response with error details
    """
    return ApiResponse(
        success=False,
        error=ApiError(code="TEST_ERROR", details={"reason": "Test error"})
    )


@pytest.fixture
def fake_provider():
    """Fixture providing a FakeServerProvider instance."""
    return FakeServerProvider()

@pytest.fixture
def fake_provider_registry():
    """
    Fixture providing a ServerProviderRegistry with only the fake provider registered.
    
    This fixture patches the get_provider_registry function to return a registry
    with only the fake provider, ensuring tests don't depend on real providers.
    
    Returns:
        A server provider registry with only the fake provider registered
    """
    # Create a clean registry with only the fake provider
    registry = ServerProviderRegistry()
    fake_provider = FakeServerProvider()
    registry.register_provider(fake_provider)
    
    # Patch the get_provider_registry function to return our test registry
    with patch('hola_cli.providers.providers.get_provider_registry', return_value=registry):
        yield registry
