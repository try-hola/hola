"""
Tests for the shared logger configuration.
"""

import pytest
import logging
import sys
from unittest.mock import patch
from hola.utils.logging import configure_logging, get_logger
from typing import Protocol


class FakeConfig:
    """Fake config implementation for testing logging configuration."""

    def __init__(self, log_level: str = "INFO", log_format: str = "test-format"):
        self.log_level = log_level
        self.log_format = log_format


class FakeLogger:
    """Fake logger implementation for testing."""

    def __init__(self, name: str):
        self.name = name
        self.level = None
        self.set_level_calls = []

    def setLevel(self, level):
        """Record setLevel calls."""
        self.level = level
        self.set_level_calls.append(level)


def test_configure_logging_uses_config():
    """Test that configure_logging uses the log level from provided config."""
    fake_config = FakeConfig(log_level="DEBUG", log_format="test-format")

    with patch("logging.basicConfig") as mock_logging:
        configure_logging(fake_config)

        # Verify logging was configured with config values
        mock_logging.assert_called_once()
        args, kwargs = mock_logging.call_args
        assert kwargs["level"] == logging.DEBUG
        assert kwargs["format"] == "test-format"
        assert kwargs["handlers"][0].__class__ == logging.StreamHandler
        assert kwargs["handlers"][0].stream == sys.stdout


def test_configure_logging_level_override():
    """Test that configure_logging can override the log level."""
    fake_config = FakeConfig(log_level="INFO", log_format="test-format")

    with patch("logging.basicConfig") as mock_logging:
        # Override with explicit level
        configure_logging(fake_config, level="ERROR")

        # Verify logging was configured with override level
        mock_logging.assert_called_once()
        args, kwargs = mock_logging.call_args
        assert kwargs["level"] == logging.ERROR  # Should use override


def test_configure_logging_without_config():
    """Test that configure_logging works without a config object."""
    with patch(
        "hola.shared.environment.Environment.get", return_value="DEBUG"
    ) as mock_env:
        with patch("logging.basicConfig") as mock_logging:
            configure_logging()

            # Verify environment was checked for log level
            mock_env.assert_called_once_with("LOG_LEVEL", "INFO")

            # Verify logging was configured with environment value
            mock_logging.assert_called_once()
            args, kwargs = mock_logging.call_args
            assert kwargs["level"] == logging.DEBUG
            assert (
                kwargs["format"]
                == "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
            )


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
            fake_uvicorn_access = FakeLogger("uvicorn.access")
            fake_uvicorn_error = FakeLogger("uvicorn.error")
            fake_default = FakeLogger("default")

            # Setup fake to return different loggers
            def get_fake_logger(name):
                if name == "uvicorn.access":
                    return fake_uvicorn_access
                elif name == "uvicorn.error":
                    return fake_uvicorn_error
                else:
                    return fake_default

            mock_get_logger.side_effect = get_fake_logger

            configure_logging()

            # Verify levels were set for uvicorn loggers
            assert fake_uvicorn_access.level == logging.WARNING
            assert fake_uvicorn_error.level == logging.WARNING
