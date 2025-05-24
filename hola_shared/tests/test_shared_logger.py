"""
Tests for the shared logger configuration.
"""
import pytest
import logging
import sys
from unittest.mock import patch, MagicMock
from hola_shared.logger import configure_logging, get_logger
from typing import Protocol


class MockConfig(Protocol):
    """Mock protocol for testing logging configuration."""
    log_level: str
    log_format: str


def test_configure_logging_uses_config():
    """Test that configure_logging uses the log level from provided config."""
    mock_config = MagicMock()
    mock_config.log_level = "DEBUG"
    mock_config.log_format = "test-format"
    
    with patch("logging.basicConfig") as mock_logging:
        configure_logging(mock_config)
        
        # Verify logging was configured with config values
        mock_logging.assert_called_once()
        args, kwargs = mock_logging.call_args
        assert kwargs["level"] == logging.DEBUG
        assert kwargs["format"] == "test-format"
        assert kwargs["handlers"][0].__class__ == logging.StreamHandler
        assert kwargs["handlers"][0].stream == sys.stdout


def test_configure_logging_level_override():
    """Test that configure_logging can override the log level."""
    mock_config = MagicMock()
    mock_config.log_level = "INFO"  # Default from config
    mock_config.log_format = "test-format"
    
    with patch("logging.basicConfig") as mock_logging:
        # Override with explicit level
        configure_logging(mock_config, level="ERROR")
        
        # Verify logging was configured with override level
        mock_logging.assert_called_once()
        args, kwargs = mock_logging.call_args
        assert kwargs["level"] == logging.ERROR  # Should use override


def test_configure_logging_without_config():
    """Test that configure_logging works without a config object."""
    with patch("hola_shared.environment.Environment.get", return_value="DEBUG") as mock_env:
        with patch("logging.basicConfig") as mock_logging:
            configure_logging()
            
            # Verify environment was checked for log level
            mock_env.assert_called_once_with("LOG_LEVEL", "INFO")
            
            # Verify logging was configured with environment value
            mock_logging.assert_called_once()
            args, kwargs = mock_logging.call_args
            assert kwargs["level"] == logging.DEBUG
            assert kwargs["format"] == "%(asctime)s - %(name)s - %(levelname)s - %(message)s"


def test_get_logger_caching():
    """Test that get_logger caches logger instances."""
    # First call should create new logger
    logger1 = get_logger("test.logger")
    
    # Second call with same name should return same instance
    logger2 = get_logger("test.logger")
    assert logger1 is logger2
    
    # Different name should return different instance
    logger3 = get_logger("test.different")
    assert logger1 is not logger3


def test_logger_levels_for_third_party_libraries():
    """Test that third-party loggers have their levels set correctly."""
    with patch("logging.basicConfig"):
        with patch("logging.getLogger") as mock_get_logger:
            mock_uvicorn_access = MagicMock()
            mock_uvicorn_error = MagicMock()
            
            # Setup mock to return different loggers
            mock_get_logger.side_effect = lambda name: {
                "uvicorn.access": mock_uvicorn_access,
                "uvicorn.error": mock_uvicorn_error
            }.get(name, MagicMock())
            
            configure_logging()
            
            # Verify levels were set for uvicorn loggers
            mock_uvicorn_access.setLevel.assert_called_once_with(logging.WARNING)
            mock_uvicorn_error.setLevel.assert_called_once_with(logging.WARNING)
