"""Tests for FakeConfigService implementation."""

import pytest
from datetime import datetime, timezone

from hola_shared.models.config import (
    ConfigCreateRequest, ConfigUpdateRequest
)
from hola_shared.errors import ValidationException, NotFoundException
from hola_server.test_utils.fakes.fake_config_service import FakeConfigService


@pytest.fixture
def fake_config_service():
    """Create a FakeConfigService instance."""
    return FakeConfigService()


class TestFakeConfigService:
    """Test cases for FakeConfigService."""

    @pytest.mark.asyncio
    async def test_get_app_config_creates_empty_config_for_new_app(self, fake_config_service):
        """Test that getting config for new app creates empty config."""
        app_name = "test-app"
        
        response = await fake_config_service.get_app_config(app_name)
        
        assert response.success is True
        assert response.config.app_name == app_name
        assert len(response.config.config) == 0
        assert fake_config_service.has_config(app_name)

    @pytest.mark.asyncio
    async def test_method_calls_tracking(self, fake_config_service):
        """Test that method calls are tracked."""
        app_name = "test-app"
        
        # Perform various operations
        await fake_config_service.get_app_config(app_name)
        await fake_config_service.list_config_entries(app_name)
        
        # Check method calls
        calls = fake_config_service.get_method_calls()
        # get_app_config might call itself twice during config creation
        assert len(calls) >= 2
        assert calls[0]["method"] == "get_app_config"
        assert calls[0]["app_name"] == app_name
        # Find the list_config_entries call
        list_call = next(call for call in calls if call["method"] == "list_config_entries")
        assert list_call["method"] == "list_config_entries"

    @pytest.mark.asyncio
    async def test_create_and_retrieve_config_entry(self, fake_config_service):
        """Test creating and retrieving config entries."""
        app_name = "test-app"
        key = "test_key"
        
        # Create entry
        create_request = ConfigCreateRequest(
            key=key,
            value="test_value",
            description="Test configuration",
            is_secret=True
        )
        
        response = await fake_config_service.create_config_entry(app_name, create_request)
        
        assert response.success is True
        assert response.entry.key == key
        assert response.entry.value == "test_value"
        assert response.entry.is_secret is True
        assert fake_config_service.has_config_entry(app_name, key)
        
        # Retrieve entry
        get_response = await fake_config_service.get_config_entry(app_name, key)
        assert get_response.entry.key == key
        assert get_response.entry.value == "test_value"

    @pytest.mark.asyncio
    async def test_update_config_entry(self, fake_config_service):
        """Test updating config entries."""
        app_name = "test-app"
        key = "test_key"
        
        # Create entry
        create_request = ConfigCreateRequest(
            key=key, 
            value="original", 
            description="Original",
            is_secret=False
        )
        await fake_config_service.create_config_entry(app_name, create_request)
        
        # Update entry
        update_request = ConfigUpdateRequest(
            value="updated", 
            description="Updated", 
            is_secret=True
        )
        response = await fake_config_service.update_config_entry(app_name, key, update_request)
        
        assert response.entry.value == "updated"
        assert response.entry.description == "Updated"
        assert response.entry.is_secret is True

    @pytest.mark.asyncio
    async def test_delete_config_entry(self, fake_config_service):
        """Test deleting config entries."""
        app_name = "test-app"
        key = "test_key"
        
        # Create entry
        create_request = ConfigCreateRequest(
            key=key, 
            value="value",
            description=None, 
            is_secret=False
        )
        await fake_config_service.create_config_entry(app_name, create_request)
        
        assert fake_config_service.has_config_entry(app_name, key)
        
        # Delete entry
        await fake_config_service.delete_config_entry(app_name, key)
        
        assert not fake_config_service.has_config_entry(app_name, key)

    @pytest.mark.asyncio
    async def test_delete_app_config(self, fake_config_service):
        """Test deleting all app configuration."""
        app_name = "test-app"
        
        # Create multiple entries
        for i in range(3):
            request = ConfigCreateRequest(
                key=f"key{i}", 
                value=f"value{i}",
                description=None,
                is_secret=False
            )
            await fake_config_service.create_config_entry(app_name, request)
        
        assert fake_config_service.get_config_count(app_name) == 3
        
        # Delete app config
        await fake_config_service.delete_app_config(app_name)
        
        assert not fake_config_service.has_config(app_name)

    @pytest.mark.asyncio
    async def test_list_config_entries(self, fake_config_service):
        """Test listing config entries."""
        app_name = "test-app"
        
        # Create entries
        entries = [
            ConfigCreateRequest(key="key1", value="value1", description=None, is_secret=False),
            ConfigCreateRequest(key="key2", value="value2", description=None, is_secret=False),
            ConfigCreateRequest(key="key3", value="value3", description=None, is_secret=False)
        ]
        
        for entry in entries:
            await fake_config_service.create_config_entry(app_name, entry)
        
        # List entries
        response = await fake_config_service.list_config_entries(app_name)
        
        assert response.count == 3
        assert len(response.entries) == 3
        keys = {entry.key for entry in response.entries}
        assert keys == {"key1", "key2", "key3"}

    @pytest.mark.asyncio
    async def test_validation_errors(self, fake_config_service):
        """Test validation error handling."""
        # Empty app name
        with pytest.raises(ValidationException, match="App name cannot be empty"):
            await fake_config_service.get_app_config("")
        
        # Empty key
        request = ConfigCreateRequest(key="", value="value", description=None, is_secret=False)
        with pytest.raises(ValidationException, match="Configuration key cannot be empty"):
            await fake_config_service.create_config_entry("app", request)

    @pytest.mark.asyncio
    async def test_not_found_errors(self, fake_config_service):
        """Test NotFoundException handling."""
        app_name = "test-app"
        key = "missing_key"
        
        # Get non-existent entry
        with pytest.raises(NotFoundException, match=f"Configuration entry '{key}' not found"):
            await fake_config_service.get_config_entry(app_name, key)
        
        # Update non-existent entry
        update_request = ConfigUpdateRequest(value="value", description=None, is_secret=False)
        with pytest.raises(NotFoundException):
            await fake_config_service.update_config_entry(app_name, key, update_request)
        
        # Delete non-existent entry
        with pytest.raises(NotFoundException):
            await fake_config_service.delete_config_entry(app_name, key)

    @pytest.mark.asyncio
    async def test_duplicate_key_error(self, fake_config_service):
        """Test duplicate key validation."""
        app_name = "test-app"
        key = "duplicate_key"
        
        # Create entry
        request = ConfigCreateRequest(key=key, value="value1", description=None, is_secret=False)
        await fake_config_service.create_config_entry(app_name, request)
        
        # Try to create duplicate
        duplicate_request = ConfigCreateRequest(key=key, value="value2", description=None, is_secret=False)
        with pytest.raises(ValidationException, match=f"Configuration entry '{key}' already exists"):
            await fake_config_service.create_config_entry(app_name, duplicate_request)

    def test_reset_clears_all_state(self, fake_config_service):
        """Test that reset clears all state."""
        # Add some data
        fake_config_service.configs["app1"] = type('MockConfig', (), {})()
        fake_config_service.method_calls.append({"test": "call"})
        
        # Reset
        fake_config_service.reset()
        
        # Verify state is cleared
        assert len(fake_config_service.configs) == 0
        assert len(fake_config_service.method_calls) == 0

    def test_helper_methods(self, fake_config_service):
        """Test helper methods for testing assertions."""
        app_name = "test-app"
        
        # Initially no config
        assert not fake_config_service.has_config(app_name)
        assert fake_config_service.get_config_count(app_name) == 0
        
        # After creating config
        fake_config_service.configs[app_name] = type('MockConfig', (), {'config': {}})()
        assert fake_config_service.has_config(app_name)
        
        # Test has_config_entry
        assert not fake_config_service.has_config_entry(app_name, "key1")

    @pytest.mark.asyncio
    async def test_preserves_timestamps_on_update(self, fake_config_service):
        """Test that update preserves created_at timestamp."""
        app_name = "test-app"
        key = "test_key"
        
        # Create entry
        create_request = ConfigCreateRequest(key=key, value="original", description=None, is_secret=False)
        create_response = await fake_config_service.create_config_entry(app_name, create_request)
        original_created_at = create_response.entry.created_at
        
        # Update entry (add small delay to ensure different timestamps)
        import asyncio
        await asyncio.sleep(0.01)
        
        update_request = ConfigUpdateRequest(value="updated", description=None, is_secret=False)
        update_response = await fake_config_service.update_config_entry(app_name, key, update_request)
        
        # Check timestamps
        assert update_response.entry.created_at == original_created_at
        assert update_response.entry.updated_at > original_created_at
