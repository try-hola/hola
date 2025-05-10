"""
Configuration management for the Hola CLI.

This package provides functionality for managing CLI configuration,
including loading and saving settings, server connection contexts,
and environment configuration.
"""

from .settings import load_settings, save_settings, CliSettings, ServerConnection
from .context import ServerContext, get_current_server

__all__ = [
    'load_settings', 
    'save_settings', 
    'CliSettings', 
    'ServerConnection',
    'ServerContext',
    'get_current_server'
]
