"""
Tests for server environment variable loading.
This file tests functionality that requires isolation from other environment variable tests.
"""
import pytest
import os
from hola_shared.environment import Environment
from hola_server.config.settings import Settings

def test_settings_uses_environment():
    """Test that Settings properly loads values from environment variables."""
    # Set test environment variables
    os.environ["HOLA_HOST"] = "test-host"
    os.environ["HOLA_PORT"] = "1234"
    os.environ["HOLA_DEBUG"] = "true"
    
    # Instantiate settings after setting environment variables
    settings = Settings()
    
    # Verify settings loaded from environment
    assert settings.host == "test-host"
    assert settings.port == 1234
    assert settings.debug is True
    # CORS is not configurable via env vars, should use default
    assert settings.cors_origins == ["*"]
    
    # Clean up
    del os.environ["HOLA_HOST"]
    del os.environ["HOLA_PORT"]
    del os.environ["HOLA_DEBUG"]
