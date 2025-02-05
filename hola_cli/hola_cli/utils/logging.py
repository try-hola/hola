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
    appropriate logging configuration for a CLI environment. The function
    integrates with the shared logger configuration while adding CLI-specific
    enhancements.

    The configured logging system follows the project's layered approach:
    1. Base functionality from hola_shared.logger
    2. CLI-specific extensions in this module
    3. Application-level logging calls in command modules

    This function should be called early in the CLI application lifecycle,
    ideally before any other operations are performed.
    """
    settings = get_settings()
    configure_logging(settings)

    # Set level for CLI-specific loggers
    logging.getLogger("hola_cli").setLevel(getattr(logging, settings.log_level.upper()))


def log_command_start(logger: logging.Logger, command_name: str, **kwargs) -> None:
    """
    Log the start of a CLI command execution with its parameters.

    This function should be called at the beginning of each command handler to
    provide a consistent logging pattern across the CLI application. It logs
    the command name and any passed parameters at debug level.

    The function is part of the recommended command logging pattern:
    1. Call log_command_start at the beginning of the command
    2. Execute the command logic
    3. Call log_command_success or log_command_error based on the outcome

    Args:
        logger: Logger instance to use
        command_name: Name of the command being executed
        kwargs: Command arguments to include in the log
    """
    # Filter out None values and sensitive parameters
    sensitive_params = ["api_key", "password", "token", "sensitive"]
    params = {
        k: v for k, v in kwargs.items() if v is not None and k not in sensitive_params
    }

    logger.debug(f"Executing command '{command_name}' with parameters: {params}")


def log_command_success(
    logger: logging.Logger, command_name: str, result: Any = None
) -> None:
    """
    Log the successful completion of a CLI command.

    This function should be called at the end of a command handler when the command
    executes successfully. It logs the successful completion of the command along
    with an optional result value at debug level.

    The function is part of the recommended command logging pattern:
    1. Call log_command_start at the beginning of the command
    2. Execute the command logic
    3. Call log_command_success when the command completes successfully

    Args:
        logger: Logger instance to use
        command_name: Name of the command that completed
        result: Optional result data to include in the log (non-sensitive data only)
    """
    if result:
        logger.debug(
            f"Command '{command_name}' completed successfully with result: {result}"
        )
    else:
        logger.debug(f"Command '{command_name}' completed successfully")


def log_command_error(
    logger: logging.Logger, command_name: str, error: Exception
) -> None:
    """
    Log a command execution error.

    This function should be called when a command handler encounters an exception.
    It logs the error with appropriate detail level based on the exception type:
    - For HolaException instances (expected errors), it logs a simple error message
    - For other exceptions (unexpected errors), it logs the full traceback

    The function is part of the recommended command logging pattern:
    1. Call log_command_start at the beginning of the command
    2. Execute the command logic in a try block
    3. Call log_command_error in the exception handler

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
