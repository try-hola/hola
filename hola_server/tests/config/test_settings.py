"""
Tests for the server settings functionality.
"""
import pytest
from hola_server.config.settings import Settings, get_settings

def test_settings_default_values():
    """Test that Settings has sensible defaults."""
    settings = Settings()
    
    # Check core defaults
    assert settings.host == "0.0.0.0"
    assert settings.port == 8000
    assert settings.debug is False
    assert settings.cors_origins == ["*"]
    assert settings.log_level == "INFO"
    assert settings.data_dir == "./data"


def test_settings_custom_values():
    """Test that Settings can be initialized with custom values."""
    settings = Settings(
        api_key="custom-key",
        host="custom-host",
        port=9999,
        debug=True,
        cors_origins=["https://example.com"],
        log_level="DEBUG",
        data_dir="/custom/data"
    )
    
    # Check custom values
    assert settings.api_key == "custom-key"
    assert settings.host == "custom-host"
    assert settings.port == 9999
    assert settings.debug is True
    assert settings.cors_origins == ["https://example.com"]
    assert settings.log_level == "DEBUG"
    assert settings.data_dir == "/custom/data"


def test_get_environment_variable():
    """Test direct environment variable access through Settings class."""
    import os
    
    # Set test environment variable
    os.environ["HOLA_TEST_VAR"] = "test-value"
    
    # Access through class method
    value = Settings.get_environment_variable("TEST_VAR")
    assert value == "test-value"
    
    # Test with default value when variable doesn't exist
    value = Settings.get_environment_variable("NON_EXISTENT", "default-value")
    assert value == "default-value"
    
    # Clean up
    del os.environ["HOLA_TEST_VAR"]
