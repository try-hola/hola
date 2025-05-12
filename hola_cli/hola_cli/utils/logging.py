"""
CLI-specific logging utilities for Hola.

This module extends the shared logging functionality with CLI-specific features
and provides helpers for consistent logging across CLI commands.
"""

import logging
import sys
from typing import Any, Optional
from rich.console import Console
from hola_shared.logger import get_logger, configure_logging
from hola_shared.errors import HolaException
from ..config.settings import get_settings

# Create console instances for standard output and error
console = Console()
error_console = Console(stderr=True)

def setup_cli_logging() -> None:
    """
    Configure logging specifically for the CLI application.
    
    This ensures the log level from settings is applied and sets up
    appropriate logging configuration for a CLI environment.
    """
    settings = get_settings()
    configure_logging(settings)
    
    # Set level for CLI-specific loggers
    logging.getLogger("hola_cli").setLevel(getattr(logging, settings.log_level.upper()))


def log_command_start(logger: logging.Logger, command_name: str, **kwargs) -> None:
    """
    Log the start of a CLI command execution with its parameters.
    
    Args:
        logger: Logger instance to use
        command_name: Name of the command being executed
        kwargs: Command arguments to include in the log
    """
    # Filter out None values and sensitive parameters
    sensitive_params = ['api_key', 'password', 'token', 'sensitive']
    params = {k: v for k, v in kwargs.items() 
              if v is not None and k not in sensitive_params}
    
    logger.debug(f"Executing command '{command_name}' with parameters: {params}")


def log_command_success(logger: logging.Logger, command_name: str, result: Any = None) -> None:
    """
    Log successful command completion.
    
    Args:
        logger: Logger instance to use
        command_name: Name of the command that was executed
        result: Optional result information (non-sensitive)
    """
    if result:
        logger.debug(f"Command '{command_name}' completed successfully with result: {result}")
    else:
        logger.debug(f"Command '{command_name}' completed successfully")


def log_command_error(logger: logging.Logger, command_name: str, error: Exception) -> None:
    """
    Log command execution error.
    
    Args:
        logger: Logger instance to use
        command_name: Name of the command that failed
        error: The exception that occurred
    """
    if isinstance(error, HolaException):
        # For known exceptions, log without the traceback
        logger.error(f"Command '{command_name}' failed: {str(error)}")
    else:
        # For unexpected exceptions, include the traceback
        logger.exception(f"Command '{command_name}' failed with unexpected error")
