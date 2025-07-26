"""
Shared fixtures and configuration for hola tests.
"""

import pytest
from fastapi.testclient import TestClient
from typing import Dict, Generator, Any
import os

pytest_plugins = ["pytest_asyncio"]  # Added to explicitly load pytest-asyncio

# Import main app after setting up fakes
from hola.main import app


@pytest.fixture
def mock_environment():
    """
    Fixture to mock server environment variables for testing.

    This fixture temporarily sets environment variables with the HOLA_ prefix
    for testing environment-dependent server functionality, then restores the
    original environment after the test completes. This provides a clean,
    isolated environment for each test that interacts with environment variables.

    The fixture sets common test values including:
    - API key for authentication
    - Host and port settings
    - CORS configuration
    - Logging settings
    - Data directory location

    Example:
        def test_api_key_from_env(mock_environment):
            # Test accessing API key from environment
            from hola.config import get_settings
            settings = get_settings()
            assert settings.api_key == "test-env-api-key"

    Yields:
        dict: Dictionary containing the set environment variables
    """
    # Define test environment variables
    env_vars = {
        "HOLA_API_KEY": "test-env-api-key",
        "HOLA_HOST": "127.0.0.1",
        "HOLA_PORT": "9999",
        "HOLA_DEBUG": "true",
        "HOLA_LOG_LEVEL": "DEBUG",
        "HOLA_DATA_DIR": "./test-data",
        # CORS is not configurable via environment variables
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
        else:
            if key in os.environ:
                del os.environ[key]


@pytest.fixture
def client() -> TestClient:
    """Return a FastAPI test client for the application."""
    return TestClient(app)


@pytest.fixture
def base_headers() -> Dict[str, str]:
    """Return base headers for API requests including a test API key."""
    return {"X-API-Key": "test-api-key"}


from hola.config import Settings
from hola.test_utils.fakes.fake_app_service import FakeAppService
from hola.api.apps import get_app_service
from hola.config.context import ServerContext
from hola.config.settings import get_settings


@pytest.fixture
def fake_app_service() -> FakeAppService:
    """Return a fake app service for testing."""
    service = FakeAppService()
    return service


@pytest.fixture
def client_with_fake_app_service(
    fake_app_service: FakeAppService,
) -> Generator[TestClient, None, None]:
    """Return a FastAPI test client with fake app service dependency override."""
    app.dependency_overrides[get_app_service] = lambda: fake_app_service
    client = TestClient(app)
    yield client
    # It's good practice to clear overrides after the test
    del app.dependency_overrides[get_app_service]


@pytest.fixture
def mock_context(mock_environment: Dict[str, Any]) -> ServerContext:
    """
    Fixture to provide a mock ServerContext for testing.

    This fixture initializes a ServerContext using settings derived from
    the `mock_environment` fixture, ensuring that services within the context
    operate with test-specific configurations. It also clears the cache
    for `get_settings` to ensure fresh settings are loaded based on the
    mocked environment for each test.

    Args:
        mock_environment: Fixture that sets up test environment variables.

    Returns:
        ServerContext: An instance of ServerContext configured for testing.
    """
    # Clear LRU cache for get_settings to ensure it re-reads env vars
    # set by mock_environment for the current test.
    get_settings.cache_clear()

    settings = get_settings()
    return ServerContext(settings=settings)


@pytest.fixture
def override_config() -> Generator[None, None, None]:
    """
    Override app configurations for testing.

    This fixture sets up test configurations before tests,
    and restores original configurations after tests.
    """
    # Import here to avoid circular imports
    from hola.config.settings import get_settings

    # Save original
    original_get_settings = get_settings

    # Define a function to create and return test settings
    def get_test_settings() -> Settings:
        return Settings(api_key="test-api-key")

    # Replace the get_settings function with our test version
    from hola.config import settings

    settings.get_settings = get_test_settings

    # Also update the legacy import for backward compatibility
    from hola import config

    config.get_settings = get_test_settings

    yield

    # Restore original
    from hola.config import settings

    settings.get_settings = original_get_settings

    # Also restore the legacy import
    from hola import config

    config.get_settings = original_get_settings
