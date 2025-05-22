"""
Provider module for Hola CLI.

This package implements the Provider pattern for the CLI side of the application,
allowing management of different server environments.
"""

from .server_manager import get_server_manager, ServerManager
