"""
Test logging functionality for the CLI application.
"""
import logging
import pytest
from hola_cli.utils.logging import setup_cli_logging, log_command_start, log_command_success, log_command_error
from hola_cli.config.settings import CliSettings
from unittest.mock import patch, MagicMock

def test_setup_cli_logging():
    """Test that setup_cli_logging configures logging correctly."""
    # Create a settings object with a specific log level
    settings = CliSettings(log_level="DEBUG")
    
    # Mock configure_logging to verify it's called correctly
    with patch('hola_cli.utils.logging.configure_logging') as mock_configure:
        with patch('hola_cli.utils.logging.get_settings', return_value=settings):
            # Call the function
            setup_cli_logging()
            
            # Verify configure_logging was called with our settings object
            mock_configure.assert_called_once()
            assert mock_configure.call_args[0][0] == settings

def test_log_command_functions():
    """Test that log command functions work correctly."""
    # Create a mock logger
    mock_logger = MagicMock(spec=logging.Logger)
    
    # Test log_command_start
    log_command_start(mock_logger, "test.command", name="test", sensitive="secret")
    mock_logger.debug.assert_called_once()
    # Verify the sensitive parameter is not logged
    assert "secret" not in mock_logger.debug.call_args[0][0]
    assert "name" in mock_logger.debug.call_args[0][0]
    
    # Reset the mock
    mock_logger.reset_mock()
    
    # Test log_command_success
    log_command_success(mock_logger, "test.command", {"result": "success"})
    mock_logger.debug.assert_called_once()
    
    # Reset the mock
    mock_logger.reset_mock()
    
    # Test log_command_error with HolaException
    from hola_shared.errors import HolaException
    error = HolaException("TEST_ERROR", "Test error")
    log_command_error(mock_logger, "test.command", error)
    # Should log as error without traceback
    mock_logger.error.assert_called_once()
    mock_logger.exception.assert_not_called()
    
    # Reset the mock
    mock_logger.reset_mock()
    
    # Test log_command_error with standard Exception
    error = ValueError("Unexpected error")
    log_command_error(mock_logger, "test.command", error)
    # Should log as exception with traceback
    mock_logger.exception.assert_called_once()
