"""
Configuration package for the Hola server.

This package provides configuration management, environment variable handling,
context initialization, and logging setup for the Hola server.

It includes:
- Settings: Server configuration from environment variables
- Context: Server context for dependency management
- Environment: Environment variable utilities
- Logger: Logging configuration
"""

# Import only what's needed at package level, import the rest directly
from .settings import Settings, get_settings

__all__ = ["Settings", "get_settings"]
