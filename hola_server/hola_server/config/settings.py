"""Configuration settings for the Hola server.

This module handles loading and providing access to application settings
from environment variables and .env files.
"""

from pydantic_settings import BaseSettings
from typing import List, Optional
from functools import lru_cache
from hola_shared.environment import Environment

class Settings(BaseSettings):
    """Server configuration settings loaded from environment variables."""
    
    # Core authentication
    api_key: str = ""
    
    # Server settings
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False
    
    # CORS settings - hardcoded for simplicity
    # Not configurable via environment variables
    cors_origins: List[str] = ["*"]
    
    # Logging and monitoring
    log_level: str = "INFO"
    log_format: str = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    
    # Data storage
    data_dir: str = "./data"
    
    # Docker integration
    docker_socket: Optional[str] = None  # e.g. "unix:///var/run/docker.sock"
    
    model_config = {
        "env_prefix": "HOLA_",  # Prefix for all environment variables
        "env_file": ".env",     # Optional .env file to load settings from
        "case_sensitive": False # Allow case-insensitive env vars
    }
    
    @classmethod
    def get_environment_variable(cls, key: str, default: Optional[str] = None) -> Optional[str]:
        """
        Direct access to an environment variable.
        
        This provides a convenient way to access individual environment variables
        without creating a full Settings instance, which is useful for simple
        configuration needs or early initialization tasks.
        
        Args:
            key: The name of the environment variable (without the HOLA_ prefix)
            default: Optional default value if the environment variable is not set
            
        Returns:
            The value of the environment variable, or the default if not set
        """
        return Environment.get(key, default)

@lru_cache()
def get_settings() -> Settings:
    """Return cached settings instance.
    
    Returns:
        Settings: A cached instance of the application settings.
        
    Note:
        Uses lru_cache for performance optimization to avoid reading
        environment variables repeatedly.
    """
    return Settings()
