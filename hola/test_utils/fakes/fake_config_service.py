"""Fake configuration service implementation for testing.

This module provides a fake implementation of a configuration service for testing purposes.
It includes in-memory configuration storage and state tracking for test assertions.

Attributes:
    FakeConfigService (class): Provides methods to simulate configuration operations.
    ConfigEntry (class): Represents a single configuration entry.
    ConfigUpdateRequest (class): Represents a request to update a configuration entry.
    ConfigCreateRequest (class): Represents a request to create a new configuration entry.
    AppConfig (class): Represents the configuration for an application.
    ConfigResponse (class): Represents the response containing application configuration.
    ConfigListResponse (class): Represents the response containing a list of configuration entries.
    ConfigEntryResponse (class): Represents the response containing a single configuration entry.
    ValidationException (exception): Raised for validation errors.
    NotFoundException (exception): Raised when a requested resource is not found.
"""

from typing import Dict, List, Any, Optional
from datetime import datetime, timezone

from hola.models.config import (
    ConfigEntry,
    ConfigUpdateRequest,
    ConfigCreateRequest,
    AppConfig,
    ConfigResponse,
    ConfigListResponse,
    ConfigEntryResponse,
)
from hola.models.errors import ValidationException, NotFoundException


class FakeConfigService:
    """
    Fake implementation of configuration service for testing.

    Provides in-memory configuration storage with state tracking for test assertions.
    """

    def __init__(self):
        """
        Initialize the fake configuration service.

        Attributes:
            configs (Dict[str, AppConfig]): A dictionary to store application configurations.
            method_calls (List[Dict[str, Any]]): A list to track method calls for assertions.
        """
        # Structure: {app_name: AppConfig}
        self.configs: Dict[str, AppConfig] = {}
        self.method_calls: List[Dict[str, Any]] = []

    async def get_app_config(self, app_name: str) -> ConfigResponse:
        """
        Get all configuration for an application.

        Args:
            app_name (str): The name of the application.

        Returns:
            ConfigResponse: The response containing the application's configuration.

        Raises:
            ValidationException: If the app name is empty or invalid.
        """
        self.method_calls.append(
            {
                "method": "get_app_config",
                "app_name": app_name,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if not app_name or not app_name.strip():
            raise ValidationException("App name cannot be empty")

        app_name = app_name.strip()

        if app_name not in self.configs:
            # Create empty config if it doesn't exist
            now = datetime.now(timezone.utc)
            self.configs[app_name] = AppConfig(
                app_name=app_name, config={}, created_at=now, updated_at=now
            )

        return ConfigResponse(success=True, config=self.configs[app_name])

    async def list_config_entries(self, app_name: str) -> ConfigListResponse:
        """
        List all configuration entries for an application.

        Args:
            app_name (str): The name of the application.

        Returns:
            ConfigListResponse: The response containing a list of configuration entries.

        Raises:
            ValidationException: If the app name is empty or invalid.
        """
        self.method_calls.append(
            {
                "method": "list_config_entries",
                "app_name": app_name,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if not app_name or not app_name.strip():
            raise ValidationException("App name cannot be empty")

        app_name = app_name.strip()

        config_response = await self.get_app_config(app_name)
        entries = list(config_response.config.config.values())

        return ConfigListResponse(success=True, entries=entries, count=len(entries))

    async def get_config_entry(self, app_name: str, key: str) -> ConfigEntryResponse:
        """
        Get a specific configuration entry.

        Args:
            app_name (str): The name of the application.
            key (str): The configuration key.

        Returns:
            ConfigEntryResponse: The response containing the configuration entry.

        Raises:
            ValidationException: If the app name or key is empty or invalid.
            NotFoundException: If the configuration entry does not exist.
        """
        self.method_calls.append(
            {
                "method": "get_config_entry",
                "app_name": app_name,
                "key": key,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if not app_name or not app_name.strip():
            raise ValidationException("App name cannot be empty")

        if not key or not key.strip():
            raise ValidationException("Configuration key cannot be empty")

        app_name = app_name.strip()
        key = key.strip()

        config_response = await self.get_app_config(app_name)

        if key not in config_response.config.config:
            raise NotFoundException(
                resource_type="configuration entry", resource_id=key
            )

        entry = config_response.config.config[key]
        return ConfigEntryResponse(success=True, entry=entry)

    async def create_config_entry(
        self, app_name: str, request: ConfigCreateRequest
    ) -> ConfigEntryResponse:
        """
        Create a new configuration entry.

        Args:
            app_name (str): The name of the application.
            request (ConfigCreateRequest): The request containing configuration entry details.

        Returns:
            ConfigEntryResponse: The response containing the created configuration entry.

        Raises:
            ValidationException: If the app name or key is empty or invalid, or if the entry already exists.
        """
        self.method_calls.append(
            {
                "method": "create_config_entry",
                "app_name": app_name,
                "request": request.model_dump(),
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if not app_name or not app_name.strip():
            raise ValidationException("App name cannot be empty")

        app_name = app_name.strip()
        key = request.key.strip() if request.key else ""

        if not key:
            raise ValidationException("Configuration key cannot be empty")

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

        return ConfigEntryResponse(success=True, entry=entry)

    async def update_config_entry(
        self, app_name: str, key: str, request: ConfigUpdateRequest
    ) -> ConfigEntryResponse:
        """
        Update an existing configuration entry.

        Args:
            app_name (str): The name of the application.
            key (str): The configuration key.
            request (ConfigUpdateRequest): The request containing updated configuration entry details.

        Returns:
            ConfigEntryResponse: The response containing the updated configuration entry.

        Raises:
            ValidationException: If the app name or key is empty or invalid.
            NotFoundException: If the configuration entry does not exist.
        """
        self.method_calls.append(
            {
                "method": "update_config_entry",
                "app_name": app_name,
                "key": key,
                "request": request.model_dump(),
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if not app_name or not app_name.strip():
            raise ValidationException("App name cannot be empty")

        if not key or not key.strip():
            raise ValidationException("Configuration key cannot be empty")

        app_name = app_name.strip()
        key = key.strip()

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

        return ConfigEntryResponse(success=True, entry=updated_entry)

    async def delete_config_entry(self, app_name: str, key: str) -> None:
        """
        Delete a configuration entry.

        Args:
            app_name (str): The name of the application.
            key (str): The configuration key.

        Raises:
            ValidationException: If the app name or key is empty or invalid.
            NotFoundException: If the configuration entry does not exist.
        """
        self.method_calls.append(
            {
                "method": "delete_config_entry",
                "app_name": app_name,
                "key": key,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if not app_name or not app_name.strip():
            raise ValidationException("App name cannot be empty")

        if not key or not key.strip():
            raise ValidationException("Configuration key cannot be empty")

        app_name = app_name.strip()
        key = key.strip()

        # Verify entry exists
        await self.get_config_entry(app_name, key)

        # Delete from storage
        config_response = await self.get_app_config(app_name)
        app_config = config_response.config
        del app_config.config[key]
        app_config.updated_at = datetime.now(timezone.utc)

    async def delete_app_config(self, app_name: str) -> None:
        """
        Delete all configuration for an application.

        Args:
            app_name (str): The name of the application.

        Raises:
            ValidationException: If the app name is empty or invalid.
        """
        self.method_calls.append(
            {
                "method": "delete_app_config",
                "app_name": app_name,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if not app_name or not app_name.strip():
            raise ValidationException("App name cannot be empty")

        app_name = app_name.strip()

        if app_name in self.configs:
            del self.configs[app_name]

    def reset(self) -> None:
        """
        Reset the fake service state.

        Clears all stored configurations and method calls.
        """
        self.configs.clear()
        self.method_calls.clear()

    def has_config(self, app_name: str) -> bool:
        """
        Check if an app has configuration.

        Args:
            app_name (str): The name of the application.

        Returns:
            bool: True if the app has configuration, False otherwise.
        """
        return app_name in self.configs

    def has_config_entry(self, app_name: str, key: str) -> bool:
        """
        Check if a specific configuration entry exists.

        Args:
            app_name (str): The name of the application.
            key (str): The configuration key.

        Returns:
            bool: True if the configuration entry exists, False otherwise.
        """
        if app_name not in self.configs:
            return False
        return key in self.configs[app_name].config

    def get_method_calls(self) -> List[Dict[str, Any]]:
        """
        Get all method calls for testing assertions.

        Returns:
            List[Dict[str, Any]]: A list of method calls.
        """
        return self.method_calls.copy()

    def get_config_count(self, app_name: str) -> int:
        """
        Get the number of configuration entries for an app.

        Args:
            app_name (str): The name of the application.

        Returns:
            int: The number of configuration entries.
        """
        if app_name not in self.configs:
            return 0
        return len(self.configs[app_name].config)
