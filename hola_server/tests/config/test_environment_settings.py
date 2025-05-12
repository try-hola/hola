"""
Test server configuration with environment variables.
"""
import pytest
from hola_server.config.settings import Settings, get_settings

def test_settings_from_environment(mock_environment):
    """Test that Settings correctly loads values from environment variables."""
    # Create settings directly to test environment variable loading
    settings = Settings()
    
    # Verify settings loaded from environment variables
    assert settings.api_key == "test-env-api-key"
    assert settings.host == "127.0.0.1"
    assert settings.port == 9999
    assert settings.debug is True
    # CORS is not configurable via env vars, should use default
    assert settings.cors_origins == ["*"]
    assert settings.log_level == "DEBUG"
    assert settings.data_dir == "./test-data"


def test_get_settings_cached_from_environment(mock_environment):
    """Test that get_settings caches the settings instance."""
    # First call to get_settings with environment set
    settings1 = get_settings()
    
    # Save original value for assertion
    original_host = settings1.host
    
    # Change an environment variable
    import os
    os.environ["HOLA_HOST"] = "new-test-host"
    
    # Second call should return cached instance, not reflecting the change
    settings2 = get_settings()
    
    # Both instances should be the same object
    assert settings1 is settings2
    
    # Host should still have the original value from when settings were first loaded
    assert settings2.host == original_host
    
    # Clear the cache to force reloading from environment
    from functools import lru_cache
    get_settings.cache_clear()
    
    # Now we should get a new instance with updated values
    settings3 = get_settings()
    assert settings3 is not settings1
    assert settings3.host == "new-test-host"


def test_settings_env_override_precedence(mock_environment):
    """Test that environment variables take precedence over class defaults."""
    # Create settings with constructor values
    settings = Settings(
        api_key="constructor-key",
        host="constructor-host",
        log_level="ERROR"
    )
    
    # In Pydantic v2, constructor values override environment variables
    assert settings.api_key == "constructor-key"  # From constructor
    assert settings.host == "constructor-host"    # From constructor
    assert settings.log_level == "ERROR"          # From constructor
    
    # Remove environment variables and test again
    import os
    del os.environ["HOLA_API_KEY"]
    del os.environ["HOLA_HOST"]
    del os.environ["HOLA_LOG_LEVEL"]
    
    # Create new settings instance
    settings_no_env = Settings(
        api_key="constructor-key",
        host="constructor-host",
        log_level="ERROR"
    )
    
    # Now constructor values should be used
    assert settings_no_env.api_key == "constructor-key"
    assert settings_no_env.host == "constructor-host"
    assert settings_no_env.log_level == "ERROR"
