"""Configuration management service.

This module provides business logic for managing application configurations including
CRUD operations for config entries and app-specific configuration management.
"""

from typing import Dict, Any, Optional, List
from datetime import datetime, timezone

from hola_shared.models.config import (
    ConfigEntry,
    ConfigUpdateRequest,
    ConfigCreateRequest,
    AppConfig,
    ConfigResponse,
    ConfigListResponse,
    ConfigEntryResponse,
)
from hola_shared.errors import ValidationException, NotFoundException, ServiceException
from hola_shared.logger import get_logger
from ..config.context import ServerContext

logger = get_logger(__name__)


class ConfigService:
    """Service for managing application configurations.

    Provides business logic for configuration management including CRUD operations
    for configuration entries and app-specific configuration handling.
    """

    def __init__(self, context: ServerContext):
        """Initialize the configuration service.

        Args:
            context: Server context containing settings and dependencies
        """
        self.context = context
        self.settings = context.settings

        # In-memory storage for now - will be replaced with persistent storage
        self._configs: Dict[str, AppConfig] = {}

        logger.debug("ConfigService initialized")

    async def get_app_config(self, app_name: str) -> ConfigResponse:
        """Get all configuration for an application.

        Args:
            app_name: Name of the application

        Returns:
            Configuration response with app config

        Raises:
            ValidationException: If app_name is invalid
            NotFoundException: If app configuration not found
        """
        if not app_name or not app_name.strip():
            raise ValidationException("App name cannot be empty")

        app_name = app_name.strip()
        logger.debug(f"Getting configuration for app: {app_name}")

        if app_name not in self._configs:
            # Create empty config if it doesn't exist
            now = datetime.now(timezone.utc)
            self._configs[app_name] = AppConfig(
                app_name=app_name, config={}, created_at=now, updated_at=now
            )

        return ConfigResponse(config=self._configs[app_name])

    async def list_config_entries(self, app_name: str) -> ConfigListResponse:
        """List all configuration entries for an application.

        Args:
            app_name: Name of the application

        Returns:
            Configuration list response

        Raises:
            ValidationException: If app_name is invalid
        """
        if not app_name or not app_name.strip():
            raise ValidationException("App name cannot be empty")

        app_name = app_name.strip()
        logger.debug(f"Listing configuration entries for app: {app_name}")

        config_response = await self.get_app_config(app_name)
        entries = list(config_response.config.config.values())

        return ConfigListResponse(entries=entries, count=len(entries))

    async def get_config_entry(self, app_name: str, key: str) -> ConfigEntryResponse:
        """Get a specific configuration entry.

        Args:
            app_name: Name of the application
            key: Configuration key

        Returns:
            Configuration entry response

        Raises:
            ValidationException: If app_name or key is invalid
            NotFoundException: If configuration entry not found
        """
        if not app_name or not app_name.strip():
            raise ValidationException("App name cannot be empty")

        if not key or not key.strip():
            raise ValidationException("Configuration key cannot be empty")

        app_name = app_name.strip()
        key = key.strip()

        logger.debug(f"Getting configuration entry {key} for app: {app_name}")

        config_response = await self.get_app_config(app_name)

        if key not in config_response.config.config:
            raise NotFoundException(
                resource_type="configuration entry",
                resource_id=key,
                details={"app_name": app_name},
            )

        entry = config_response.config.config[key]
        return ConfigEntryResponse(entry=entry)

    async def create_config_entry(
        self, app_name: str, request: ConfigCreateRequest
    ) -> ConfigEntryResponse:
        """Create a new configuration entry.

        Args:
            app_name: Name of the application
            request: Configuration creation request

        Returns:
            Configuration entry response

        Raises:
            ValidationException: If app_name is invalid or entry already exists
        """
        if not app_name or not app_name.strip():
            raise ValidationException("App name cannot be empty")

        app_name = app_name.strip()
        key = request.key.strip() if request.key else ""

        if not key:
            raise ValidationException("Configuration key cannot be empty")

        logger.debug(f"Creating configuration entry {key} for app: {app_name}")

        # Get or create app config
        config_response = await self.get_app_config(app_name)
        app_config = config_response.config

        # Check if entry already exists
        if key in app_config.config:
            raise ValidationException(
                f"Configuration entry '{key}' already exists for app '{app_name}'"
            )

        # Create new entry
        now = datetime.now(timezone.utc)
        entry = ConfigEntry(
            key=key,
            value=request.value,
            description=request.description,
            is_secret=request.is_secret,
            created_at=now,
            updated_at=now,
        )

        # Update app config
        app_config.config[key] = entry
        app_config.updated_at = now

        logger.debug(f"Created configuration entry {key} for app: {app_name}")
        return ConfigEntryResponse(entry=entry)

    async def update_config_entry(
        self, app_name: str, key: str, request: ConfigUpdateRequest
    ) -> ConfigEntryResponse:
        """Update an existing configuration entry.

        Args:
            app_name: Name of the application
            key: Configuration key
            request: Configuration update request

        Returns:
            Configuration entry response

        Raises:
            ValidationException: If app_name or key is invalid
            NotFoundException: If configuration entry not found
        """
        if not app_name or not app_name.strip():
            raise ValidationException("App name cannot be empty")

        if not key or not key.strip():
            raise ValidationException("Configuration key cannot be empty")

        app_name = app_name.strip()
        key = key.strip()

        logger.debug(f"Updating configuration entry {key} for app: {app_name}")

        # Get existing entry
        entry_response = await self.get_config_entry(app_name, key)
        entry = entry_response.entry

        # Update entry
        now = datetime.now(timezone.utc)
        updated_entry = ConfigEntry(
            key=entry.key,
            value=request.value,
            description=(
                request.description
                if request.description is not None
                else entry.description
            ),
            is_secret=request.is_secret,
            created_at=entry.created_at,
            updated_at=now,
        )

        # Update in storage
        config_response = await self.get_app_config(app_name)
        app_config = config_response.config
        app_config.config[key] = updated_entry
        app_config.updated_at = now

        logger.debug(f"Updated configuration entry {key} for app: {app_name}")
        return ConfigEntryResponse(entry=updated_entry)

    async def delete_config_entry(self, app_name: str, key: str) -> None:
        """Delete a configuration entry.

        Args:
            app_name: Name of the application
            key: Configuration key

        Raises:
            ValidationException: If app_name or key is invalid
            NotFoundException: If configuration entry not found
        """
        if not app_name or not app_name.strip():
            raise ValidationException("App name cannot be empty")

        if not key or not key.strip():
            raise ValidationException("Configuration key cannot be empty")

        app_name = app_name.strip()
        key = key.strip()

        logger.debug(f"Deleting configuration entry {key} for app: {app_name}")

        # Verify entry exists
        await self.get_config_entry(app_name, key)

        # Delete from storage
        config_response = await self.get_app_config(app_name)
        app_config = config_response.config
        del app_config.config[key]
        app_config.updated_at = datetime.now(timezone.utc)

        logger.debug(f"Deleted configuration entry {key} for app: {app_name}")

    async def delete_app_config(self, app_name: str) -> None:
        """Delete all configuration for an application.

        Args:
            app_name: Name of the application

        Raises:
            ValidationException: If app_name is invalid
        """
        if not app_name or not app_name.strip():
            raise ValidationException("App name cannot be empty")

        app_name = app_name.strip()
        logger.debug(f"Deleting all configuration for app: {app_name}")

        if app_name in self._configs:
            del self._configs[app_name]
            logger.debug(f"Deleted all configuration for app: {app_name}")
