"""
Logger configuration for Hola components.

This module provides consistent logging setup across both server and client applications.
"""

import logging
import sys
from typing import Dict, Any, Optional, Protocol
from functools import lru_cache

from .environment import Environment


class LoggingConfig(Protocol):
    """Protocol defining the required logging configuration attributes."""
    log_level: str
    log_format: str


def configure_logging(config: Optional[LoggingConfig] = None, level: Optional[str] = None) -> None:
    """
    Configure logging for the application.
    
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
    logging.basicConfig(
        level=getattr(logging, log_level.upper()),
        format=log_format,
        handlers=[logging.StreamHandler(sys.stdout)]
    )
    
    # Set levels for specific loggers
    # This helps control verbosity of third-party libraries
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.error").setLevel(logging.WARNING)


@lru_cache()
def get_logger(name: str) -> logging.Logger:
    """
    Get a logger instance for the specified name.
    
    Args:
        name: Name for the logger, typically the module name
        
    Returns:
        Configured logger instance
    """
    return logging.getLogger(name)
