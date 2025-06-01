"""Configuration settings for the Hola server.

This module handles loading and providing access to application settings
from environment variables and .env files.

Classes:
    Settings: Represents server configuration settings.

Functions:
    get_settings: Retrieves a cached instance of the application settings.
"""

from pydantic_settings import BaseSettings
from typing import List, Optional
from functools import lru_cache
from hola_shared.environment import Environment
from datetime import datetime  # Add datetime import


class Settings(BaseSettings):
    """
    Server configuration settings loaded from environment variables.

    Attributes:
        api_key (str): API key for authentication.
        host (str): Host address for the server.
        port (int): Port number for the server.
        debug (bool): Debug mode flag.
        APP_VERSION (str): Application version.
        BUILD_ID (str): Build identifier.
        GIT_COMMIT (str): Git commit hash.
        BUILD_DATE (Optional[datetime]): Build date.
        cors_origins (List[str]): Allowed CORS origins.
        log_level (str): Logging level.
        log_format (str): Logging format string.
        data_dir (str): Directory for data storage.
        HEALTH_CHECK_DISK_MIN_GB (float): Minimum disk space in GB for health checks.
        HEALTH_CHECK_DISK_MIN_PERCENT (float): Minimum disk space percentage for health checks.
        HEALTH_CHECK_MEM_MIN_GB (float): Minimum memory in GB for health checks.
        HEALTH_CHECK_MEM_MIN_PERCENT (float): Minimum memory percentage for health checks.
        docker_socket (Optional[str]): Path to Docker socket.
    """

    # Core authentication
    api_key: str = ""

    # Server settings
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False

    # Version and Build Info
    APP_VERSION: str = "0.1.0-dev"
    BUILD_ID: str = "local-dev-build"
    GIT_COMMIT: str = "unknown"
    BUILD_DATE: Optional[datetime] = None  # Add BUILD_DATE

    # CORS settings - hardcoded for simplicity
    # Not configurable via environment variables
    cors_origins: List[str] = ["*"]

    # Logging and monitoring
    log_level: str = "INFO"
    log_format: str = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"

    # Data storage
    data_dir: str = "./data"

    # Health Check Thresholds (NEW)
    HEALTH_CHECK_DISK_MIN_GB: float = 1.0
    HEALTH_CHECK_DISK_MIN_PERCENT: float = 5.0  # Percentage
    HEALTH_CHECK_MEM_MIN_GB: float = 0.5
    HEALTH_CHECK_MEM_MIN_PERCENT: float = 10.0  # Percentage

    # Docker integration
    docker_socket: Optional[str] = None  # e.g. "unix:///var/run/docker.sock"

    model_config = {
        "env_prefix": "HOLA_",  # Prefix for all environment variables
        "env_file": ".env",  # Optional .env file to load settings from
        "case_sensitive": False,  # Allow case-insensitive env vars
    }

    @property
    def data_path(self) -> str:
        """
        Alias for data_dir to provide consistent access.

        Returns:
            str: Path to the data directory.
        """
        return self.data_dir

    @data_path.setter
    def data_path(self, value: str):
        """
        Setter for data_path to update data_dir.

        Args:
            value (str): New path for the data directory.
        """
        self.data_dir = value

    @classmethod
    def get_environment_variable(
        cls, key: str, default: Optional[str] = None
    ) -> Optional[str]:
        """
        Direct access to an environment variable.

        Provides a convenient way to access individual environment variables
        without creating a full Settings instance.

        Args:
            key (str): Name of the environment variable (without the HOLA_ prefix).
            default (Optional[str]): Default value if the environment variable is not set.

        Returns:
            Optional[str]: Value of the environment variable, or the default if not set.
        """
        return Environment.get(key, default)


@lru_cache()
def get_settings() -> Settings:
    """
    Return cached settings instance.

    Uses lru_cache for performance optimization to avoid reading
    environment variables repeatedly.

    Returns:
        Settings: A cached instance of the application settings.
    """
    return Settings()
