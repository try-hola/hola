"""
Shared fixtures and configuration for hola_server tests.
"""
import pytest
from fastapi.testclient import TestClient
from typing import Dict, Generator, Any

# Import main app after setting up fakes
from hola_server.main import app


@pytest.fixture
def client() -> TestClient:
    """Return a FastAPI test client for the application."""
    return TestClient(app)


@pytest.fixture
def base_headers() -> Dict[str, str]:
    """Return base headers for API requests including a test API key."""
    return {"X-API-Key": "test-api-key"}


from hola_server.config import Settings

@pytest.fixture
def override_config() -> Generator[None, None, None]:
    """
    Override app configurations for testing.
    
    This fixture sets up test configurations before tests,
    and restores original configurations after tests.
    """
    # Import here to avoid circular imports
    from hola_server.config import get_settings
    
    # Save original
    original_get_settings = get_settings
    
    # Define a function to create and return test settings
    def get_test_settings() -> Settings:
        return Settings(api_key="test-api-key")
    
    # Replace the get_settings function with our test version
    from hola_server import config
    config.get_settings = get_test_settings
    
    yield
    
    # Restore original
    from hola_server import config
    config.get_settings = original_get_settings
