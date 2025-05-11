"""Configuration management for the Hola server.

This module handles loading and providing access to application settings
from environment variables and .env files.
"""

from pydantic_settings import BaseSettings
from typing import List
from functools import lru_cache

class Settings(BaseSettings):
    """Server configuration settings loaded from environment variables.
    
    All environment variables are prefixed with HOLA_ and can also be loaded from a .env file.
    """
    api_key: str = ""  # API authentication key
    cors_origins: List[str] = ["*"]  # List of allowed CORS origins
    log_level: str = "INFO"  # Application logging level
    
    model_config = {
        "env_prefix": "HOLA_",  # Prefix for all environment variables
        "env_file": ".env",  # Optional .env file to load settings from
    }

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