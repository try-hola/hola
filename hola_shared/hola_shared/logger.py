"""Logger configuration for Hola components.

This module provides consistent logging setup across both server and client applications.
It implements a standardized logging approach with configurable log levels and formats,
along with utilities for obtaining properly configured logger instances.

The module includes:
    - A protocol for logging configuration
    - A function to configure logging based on configuration or environment variables
    - A cached utility for obtaining logger instances

Usage:
    from hola_shared.logger import get_logger, configure_logging
    
    # Configure logging (typically done at application startup)
    configure_logging(level="DEBUG")
    
    # Get a logger for a module
    logger = get_logger(__name__)
    logger.info("Application started")
"""

import logging
import sys
from typing import Dict, Any, Optional, Protocol
from functools import lru_cache

from .environment import Environment


class LoggingConfig(Protocol):
    """Protocol defining the required logging configuration attributes.
    
    This protocol specifies the interface that configuration objects must implement
    to be used with the configure_logging function. It ensures that configuration
    objects provide the necessary logging settings.
    
    Attributes:
        log_level: The logging level to use (e.g., "DEBUG", "INFO", "WARNING")
        log_format: The format string for log messages, using the logging module format
    """
    log_level: str
    log_format: str


def configure_logging(config: Optional[LoggingConfig] = None, level: Optional[str] = None) -> None:
    """Configure logging for the application.
    
    Sets up the root logger and configures specific loggers with appropriate
    levels and formatting. The configuration can come from a config object,
    direct parameters, or environment variables.
    
    Args:
        config: Configuration object with log_level and log_format attributes
        level: Log level override (defaults to config setting or environment variable)
    """
    # Get log level from parameters, config, or environment
    if level is not None:
        log_level = level
    elif config is not None:
        log_level = config.log_level
    else:
        log_level = Environment.get("LOG_LEVEL", "INFO")
    
    # Get log format from config or use a default
    log_format = getattr(config, "log_format", "%(asctime)s - %(name)s - %(levelname)s - %(message)s") \
        if config is not None else "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    
    # Configure root logger
    log_level_upper = log_level.upper() if log_level else "INFO"
    logging.basicConfig(
        level=getattr(logging, log_level_upper),
        format=log_format,
        handlers=[logging.StreamHandler(sys.stdout)]
    )
    
    # Set levels for specific loggers
    # This helps control verbosity of third-party libraries
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.error").setLevel(logging.WARNING)


@lru_cache()
def get_logger(name: str) -> logging.Logger:
    """Get a logger instance for the specified name.
    
    Retrieves a logger instance with the given name. Results are cached using lru_cache
    to ensure that the same logger instance is returned for the same name, optimizing
    performance and ensuring consistent logger behavior.
    
    Args:
        name: Name for the logger, typically the module name (__name__)
        
    Returns:
        Configured logger instance that can be used for logging messages
        
    Example:
        logger = get_logger(__name__)
        logger.info("This is an informational message")
        logger.error("An error occurred", exc_info=True)
    """
    return logging.getLogger(name)
