"""Tests for ConfigService functionality."""

import pytest
from datetime import datetime, timezone

from hola_shared.models.config import (
    ConfigCreateRequest,
    ConfigUpdateRequest,
    ConfigResponse,
    ConfigListResponse,
    ConfigEntryResponse,
    ConfigEntry,
    AppConfig,
)
from hola_shared.errors import ValidationException, NotFoundException
from hola_server.services.config_service import ConfigService
from hola_server.config.context import ServerContext
from hola_server.config.settings import Settings


@pytest.fixture
def test_settings():
    """Create test settings."""
    return Settings(api_key="test-api-key", cors_origins=["*"])


@pytest.fixture
def test_context(test_settings):
    """Create a test server context with real dependencies."""
    return ServerContext(settings=test_settings)


@pytest.fixture
def config_service(test_context):
    """Create a ConfigService instance with test context."""
    return ConfigService(test_context)


class TestConfigService:
    """Test cases for ConfigService."""

    @pytest.mark.asyncio
    async def test_get_app_config_creates_empty_config_for_new_app(
        self, config_service
    ):
        """Test that getting config for new app creates empty config."""
        app_name = "test-app"

        response = await config_service.get_app_config(app_name)

        assert response.success is True
        assert response.config.app_name == app_name
        assert len(response.config.config) == 0
        assert response.config.created_at is not None
        assert response.config.updated_at is not None

    @pytest.mark.asyncio
    async def test_get_app_config_returns_existing_config(self, config_service):
        """Test that getting config returns existing config."""
        app_name = "test-app"

        # Create app config first
        await config_service.get_app_config(app_name)

        # Add a config entry
        create_request = ConfigCreateRequest(
            key="test_key",
            value="test_value",
            description="Test configuration",
            is_secret=False,
        )
        await config_service.create_config_entry(app_name, create_request)

        # Get config again
        response = await config_service.get_app_config(app_name)

        assert response.success is True
        assert response.config.app_name == app_name
        assert len(response.config.config) == 1
        assert "test_key" in response.config.config
        assert response.config.config["test_key"].value == "test_value"

    @pytest.mark.asyncio
    async def test_get_app_config_validates_app_name(self, config_service):
        """Test that get_app_config validates app name."""
        with pytest.raises(ValidationException, match="App name cannot be empty"):
            await config_service.get_app_config("")

        with pytest.raises(ValidationException, match="App name cannot be empty"):
            await config_service.get_app_config("   ")

    @pytest.mark.asyncio
    async def test_list_config_entries_returns_empty_for_new_app(self, config_service):
        """Test that listing config entries returns empty list for new app."""
        app_name = "test-app"

        response = await config_service.list_config_entries(app_name)

        assert response.success is True
        assert len(response.entries) == 0
        assert response.count == 0

    @pytest.mark.asyncio
    async def test_list_config_entries_returns_all_entries(self, config_service):
        """Test that listing config entries returns all entries."""
        app_name = "test-app"

        # Create multiple config entries
        entries = [
            ConfigCreateRequest(
                key="key1", value="value1", description="First config", is_secret=False
            ),
            ConfigCreateRequest(
                key="key2", value="value2", description="Second config", is_secret=False
            ),
            ConfigCreateRequest(
                key="key3", value="value3", description="Third config", is_secret=True
            ),
        ]

        for entry in entries:
            await config_service.create_config_entry(app_name, entry)

        response = await config_service.list_config_entries(app_name)

        assert response.success is True
        assert len(response.entries) == 3
        assert response.count == 3

        # Check that all entries are present
        keys = [entry.key for entry in response.entries]
        assert "key1" in keys
        assert "key2" in keys
        assert "key3" in keys

    @pytest.mark.asyncio
    async def test_get_config_entry_returns_existing_entry(self, config_service):
        """Test that getting config entry returns existing entry."""
        app_name = "test-app"
        key = "test_key"

        # Create config entry first
        create_request = ConfigCreateRequest(
            key=key,
            value="test_value",
            description="Test configuration",
            is_secret=False,
        )
        await config_service.create_config_entry(app_name, create_request)

        # Get the entry
        response = await config_service.get_config_entry(app_name, key)

        assert response.success is True
        assert response.entry.key == key
        assert response.entry.value == "test_value"
        assert response.entry.description == "Test configuration"
        assert response.entry.is_secret is False

    @pytest.mark.asyncio
    async def test_get_config_entry_raises_not_found_for_missing_entry(
        self, config_service
    ):
        """Test that getting missing config entry raises NotFoundException."""
        app_name = "test-app"
        key = "missing_key"

        with pytest.raises(
            NotFoundException, match=f"Configuration entry '{key}' not found"
        ):
            await config_service.get_config_entry(app_name, key)

    @pytest.mark.asyncio
    async def test_get_config_entry_validates_parameters(self, config_service):
        """Test that get_config_entry validates parameters."""
        with pytest.raises(ValidationException, match="App name cannot be empty"):
            await config_service.get_config_entry("", "key")

        with pytest.raises(
            ValidationException, match="Configuration key cannot be empty"
        ):
            await config_service.get_config_entry("app", "")

    @pytest.mark.asyncio
    async def test_create_config_entry_creates_new_entry(self, config_service):
        """Test that creating config entry creates new entry."""
        app_name = "test-app"
        key = "test_key"

        create_request = ConfigCreateRequest(
            key=key,
            value="test_value",
            description="Test configuration",
            is_secret=False,
        )

        response = await config_service.create_config_entry(app_name, create_request)

        assert response.success is True
        assert response.entry.key == key
        assert response.entry.value == "test_value"
        assert response.entry.description == "Test configuration"
        assert response.entry.is_secret is False
        assert response.entry.created_at is not None
        assert response.entry.updated_at is not None

    @pytest.mark.asyncio
    async def test_create_config_entry_raises_error_for_duplicate_key(
        self, config_service
    ):
        """Test that creating duplicate config entry raises ValidationException."""
        app_name = "test-app"
        key = "test_key"

        # Create first entry
        create_request = ConfigCreateRequest(
            key=key,
            value="test_value",
            description="Test configuration",
            is_secret=False,
        )
        await config_service.create_config_entry(app_name, create_request)

        # Try to create duplicate
        with pytest.raises(
            ValidationException,
            match=f"Configuration entry '{key}' already exists for app '{app_name}'",
        ):
            await config_service.create_config_entry(app_name, create_request)

    @pytest.mark.asyncio
    async def test_create_config_entry_validates_parameters(self, config_service):
        """Test that create_config_entry validates parameters."""
        with pytest.raises(ValidationException, match="App name cannot be empty"):
            create_request = ConfigCreateRequest(
                key="key", value="value", description="desc", is_secret=False
            )
            await config_service.create_config_entry("", create_request)

    @pytest.mark.asyncio
    async def test_update_config_entry_updates_existing_entry(self, config_service):
        """Test that updating config entry updates existing entry."""
        app_name = "test-app"
        key = "test_key"

        # Create entry first
        create_request = ConfigCreateRequest(
            key=key,
            value="original_value",
            description="Original description",
            is_secret=False,
        )
        await config_service.create_config_entry(app_name, create_request)

        # Update the entry
        update_request = ConfigUpdateRequest(
            value="updated_value", description="Updated description", is_secret=True
        )

        updated_response = await config_service.update_config_entry(
            app_name, key, update_request
        )

        assert updated_response.success is True
        assert updated_response.entry.key == key
        assert updated_response.entry.value == "updated_value"
        assert updated_response.entry.description == "Updated description"
        assert updated_response.entry.is_secret is True
        assert updated_response.entry.updated_at > updated_response.entry.created_at

    @pytest.mark.asyncio
    async def test_update_config_entry_preserves_description_when_not_provided(
        self, config_service
    ):
        """Test that updating config entry preserves description when not provided."""
        app_name = "test-app"
        key = "test_key"

        # Create entry first
        create_request = ConfigCreateRequest(
            key=key,
            value="original_value",
            description="Original description",
            is_secret=False,
        )
        await config_service.create_config_entry(app_name, create_request)

        # Update without description
        update_request = ConfigUpdateRequest(
            value="updated_value", description=None, is_secret=False
        )

        updated_response = await config_service.update_config_entry(
            app_name, key, update_request
        )

        assert updated_response.entry.description == "Original description"

    @pytest.mark.asyncio
    async def test_update_config_entry_raises_not_found_for_missing_entry(
        self, config_service
    ):
        """Test that updating missing config entry raises NotFoundException."""
        app_name = "test-app"
        key = "missing_key"

        update_request = ConfigUpdateRequest(
            value="new_value", description="New description", is_secret=False
        )

        with pytest.raises(
            NotFoundException, match=f"Configuration entry '{key}' not found"
        ):
            await config_service.update_config_entry(app_name, key, update_request)

    @pytest.mark.asyncio
    async def test_update_config_entry_validates_parameters(self, config_service):
        """Test that update_config_entry validates parameters."""
        update_request = ConfigUpdateRequest(
            value="value", description="desc", is_secret=False
        )

        with pytest.raises(ValidationException, match="App name cannot be empty"):
            await config_service.update_config_entry("", "key", update_request)

        with pytest.raises(
            ValidationException, match="Configuration key cannot be empty"
        ):
            await config_service.update_config_entry("app", "", update_request)

    @pytest.mark.asyncio
    async def test_delete_config_entry_removes_entry(self, config_service):
        """Test that deleting config entry removes entry."""
        app_name = "test-app"
        key = "test_key"

        # Create entry first
        create_request = ConfigCreateRequest(
            key=key,
            value="test_value",
            description="Test configuration",
            is_secret=False,
        )
        await config_service.create_config_entry(app_name, create_request)

        # Delete the entry
        await config_service.delete_config_entry(app_name, key)

        # Verify it's gone
        with pytest.raises(NotFoundException):
            await config_service.get_config_entry(app_name, key)

    @pytest.mark.asyncio
    async def test_delete_config_entry_raises_not_found_for_missing_entry(
        self, config_service
    ):
        """Test that deleting missing config entry raises NotFoundException."""
        app_name = "test-app"
        key = "missing_key"

        with pytest.raises(
            NotFoundException, match=f"Configuration entry '{key}' not found"
        ):
            await config_service.delete_config_entry(app_name, key)

    @pytest.mark.asyncio
    async def test_delete_config_entry_validates_parameters(self, config_service):
        """Test that delete_config_entry validates parameters."""
        with pytest.raises(ValidationException, match="App name cannot be empty"):
            await config_service.delete_config_entry("", "key")

        with pytest.raises(
            ValidationException, match="Configuration key cannot be empty"
        ):
            await config_service.delete_config_entry("app", "")

    @pytest.mark.asyncio
    async def test_delete_app_config_removes_all_config(self, config_service):
        """Test that deleting app config removes all configuration."""
        app_name = "test-app"

        # Create multiple config entries
        entries = [
            ConfigCreateRequest(
                key="key1", value="value1", description="First config", is_secret=False
            ),
            ConfigCreateRequest(
                key="key2", value="value2", description="Second config", is_secret=False
            ),
        ]

        for entry in entries:
            await config_service.create_config_entry(app_name, entry)

        # Delete all config
        await config_service.delete_app_config(app_name)

        # Verify all entries are gone
        response = await config_service.list_config_entries(app_name)
        assert response.count == 0

    @pytest.mark.asyncio
    async def test_delete_app_config_validates_app_name(self, config_service):
        """Test that delete_app_config validates app name."""
        with pytest.raises(ValidationException, match="App name cannot be empty"):
            await config_service.delete_app_config("")

    @pytest.mark.asyncio
    async def test_config_entries_support_different_value_types(self, config_service):
        """Test that config entries support different value types."""
        app_name = "test-app"

        # Test different value types
        test_values = [
            ("string_key", "string_value"),
            ("int_key", 42),
            ("float_key", 3.14),
            ("bool_key", True),
            ("list_key", [1, 2, 3]),
            ("dict_key", {"nested": "value"}),
        ]

        for key, value in test_values:
            create_request = ConfigCreateRequest(
                key=key,
                value=value,
                description=f"Test {type(value).__name__} value",
                is_secret=False,
            )
            response = await config_service.create_config_entry(
                app_name, create_request
            )

            assert response.success is True
            assert response.entry.value == value
            assert response.entry.key == key
