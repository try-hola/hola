"""
Server context management for the Hola server.

This module provides functions and classes for server context initialization,
service resolution and dependency management.
"""
from typing import Optional
from functools import lru_cache
from .settings import Settings, get_settings

class ServerContext:
    """
    Server context for managing application state and dependencies.
    
    This provides a central location for accessing shared
    resources and settings across the server application.
    """
    
    def __init__(self, settings: Optional[Settings] = None):
        """
        Initialize the server context with optional configuration.
        
        Args:
            settings: Optional settings to use, or load from environment if None
        """
        self.settings = settings or get_settings()
        # Services are created lazily when accessed
        self._config_service = None
        self._file_storage = None # Initialize file storage service
        # Additional shared resources can be initialized here
    
    def get_config_service(self):
        """Get the configuration service instance.
        
        Creates the service on first access for lazy initialization.
        
        Returns:
            ConfigService instance
        """
        if self._config_service is None:
            from ..services.config_service import ConfigService
            self._config_service = ConfigService(self)
        return self._config_service

    def get_file_storage(self):
        """Get the file storage service instance.
        
        Creates the service on first access for lazy initialization.
        
        Returns:
            FileStorage instance
        """
        if self._file_storage is None:
            from ..services.file_storage import FileStorage
            self._file_storage = FileStorage(self)
        return self._file_storage


@lru_cache()
def get_context() -> ServerContext:
    """
    Get the server application context.
    
    Uses a cached context instance for performance. If you need a fresh context
    with the latest settings, create a new ServerContext instance directly.
    
    Returns:
        A cached ServerContext instance
    """
    return ServerContext()
