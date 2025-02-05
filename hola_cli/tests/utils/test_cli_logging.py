"""
Test logging functionality for the CLI application.
"""

import logging
import pytest
from hola_cli.utils.logging import (
    setup_cli_logging,
    log_command_start,
    log_command_success,
    log_command_error,
)
from hola_cli.config.settings import CliSettings
from hola_shared.test_utils.fakes.logging import FakeLogger
from unittest.mock import patch


def test_setup_cli_logging():
    """Test that setup_cli_logging configures logging correctly."""
    # Create a settings object with a specific log level
    settings = CliSettings(log_level="DEBUG")

    # Mock configure_logging to verify it's called correctly
    with patch("hola_cli.utils.logging.configure_logging") as mock_configure:
        with patch("hola_cli.utils.logging.get_settings", return_value=settings):
            # Call the function
            setup_cli_logging()

            # Verify configure_logging was called with our settings object
            mock_configure.assert_called_once()
            assert mock_configure.call_args[0][0] == settings


def test_log_command_functions():
    """Test that log command functions work correctly."""
    # Create a fake logger
    fake_logger = FakeLogger("test.command")

    # Test log_command_start
    log_command_start(fake_logger, "test.command", name="test", sensitive="secret")  # type: ignore

    # Verify the message was logged and sensitive parameter is not logged
    assert len(fake_logger.messages) == 1
    debug_messages = fake_logger.get_messages("DEBUG")
    assert len(debug_messages) == 1
    assert "secret" not in debug_messages[0].message
    assert "name" in debug_messages[0].message

    # Reset the fake logger
    fake_logger.reset()

    # Test log_command_success
    log_command_success(fake_logger, "test.command", {"result": "success"})  # type: ignore
    assert len(fake_logger.messages) == 1
    assert fake_logger.has_message("test.command", "DEBUG")

    # Reset the fake logger
    fake_logger.reset()

    # Test log_command_error with HolaException
    from hola_shared.errors import HolaException

    error = HolaException("TEST_ERROR", "Test error")
    log_command_error(fake_logger, "test.command", error)  # type: ignore

    # Should log as error without traceback
    assert len(fake_logger.messages) == 1
    error_messages = fake_logger.get_messages("ERROR")
    assert len(error_messages) == 1
    # Check that it was not logged as exception (no exc_info=True)
    assert error_messages[0].kwargs.get("exc_info") is not True

    # Reset the fake logger
    fake_logger.reset()

    # Test log_command_error with standard Exception
    error = ValueError("Unexpected error")
    log_command_error(fake_logger, "test.command", error)  # type: ignore

    # Should log as exception with traceback
    assert len(fake_logger.messages) == 1
    error_messages = fake_logger.get_messages("ERROR")
    assert len(error_messages) == 1
    # Check that the exception method was called (exc_info=True in kwargs)
    assert error_messages[0].kwargs.get("exc_info") is True
