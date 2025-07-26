"""Tests for configuration API endpoints."""

import pytest
from fastapi.testclient import TestClient
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from hola.main import app
from hola.models.config import (
    ConfigCreateRequest,
    ConfigUpdateRequest,
    ConfigEntry,
    AppConfig,
)
from hola.test_utils.fakes.fake_app_service import FakeAppService
from hola.test_utils.fakes.fake_config_service import FakeConfigService


@pytest.fixture
def fake_config_service():
    """Create a fake config service."""
    return FakeConfigService()


@pytest.fixture
def fake_app_service():
    """Create a fake app service with config delegation."""
    return FakeAppService()


@pytest.fixture
def client_with_fake_app_service(fake_app_service):
    """Create a test client with fake app service (for config delegation)."""
    with patch(
        "hola.api.app_config.get_app_service", return_value=fake_app_service
    ):
        with TestClient(app) as client:
            yield client, fake_app_service


@pytest.fixture
def client_with_fake_config(fake_config_service):
    """Create a test client with fake config service."""
    with patch(
        "hola.config.context.ServerContext.get_config_service",
        return_value=fake_config_service,
    ):
        with TestClient(app) as client:
            yield client, fake_config_service


class TestConfigAPI:
    """Test cases for configuration API endpoints."""

    def test_get_app_config_returns_empty_config_for_new_app(
        self, client_with_fake_config
    ):
        """Test GET /api/config/{app_name} returns empty config for new app."""
        client, fake_service = client_with_fake_config
        app_name = "test-app"

        response = client.get(f"/api/config/{app_name}")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["config"]["app_name"] == app_name
        assert len(data["data"]["config"]["config"]) == 0

    def test_get_app_config_returns_existing_config(self, client_with_fake_config):
        """Test GET /api/config/{app_name} returns existing config."""
        client, fake_service = client_with_fake_config
        app_name = "test-app"

        # Pre-create some config
        now = datetime.now(timezone.utc)
        entry = ConfigEntry(
            key="test_key",
            value="test_value",
            description="Test config",
            is_secret=False,
            created_at=now,
            updated_at=now,
        )
        config = AppConfig(
            app_name=app_name,
            config={"test_key": entry},
            created_at=now,
            updated_at=now,
        )
        fake_service.configs[app_name] = config

        response = client.get(f"/api/config/{app_name}")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["config"]["app_name"] == app_name
        assert len(data["data"]["config"]["config"]) == 1
        assert "test_key" in data["data"]["config"]["config"]

    def test_get_app_config_validates_app_name(self, client_with_fake_config):
        """Test GET /api/config/{app_name} validates app name."""
        client, fake_service = client_with_fake_config

        response = client.get("/api/config/ ")
        assert response.status_code == 400
        assert "App name cannot be empty" in response.json()["error"]["message"]

    def test_list_config_entries_returns_all_entries(self, client_with_fake_config):
        """Test GET /api/config/{app_name}/entries returns all entries."""
        client, fake_service = client_with_fake_config
        app_name = "test-app"

        # Pre-create config entries
        now = datetime.now(timezone.utc)
        entries = {
            "key1": ConfigEntry(
                key="key1",
                value="value1",
                description="Test description",
                is_secret=False,
                created_at=now,
                updated_at=now,
            ),
            "key2": ConfigEntry(
                key="key2",
                value="value2",
                description="Test description",
                is_secret=True,
                created_at=now,
                updated_at=now,
            ),
        }
        config = AppConfig(
            app_name=app_name, config=entries, created_at=now, updated_at=now
        )
        fake_service.configs[app_name] = config

        response = client.get(f"/api/config/{app_name}/entries")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["count"] == 2
        assert len(data["data"]["entries"]) == 2

        keys = {entry["key"] for entry in data["data"]["entries"]}
        assert keys == {"key1", "key2"}

    def test_get_config_entry_returns_specific_entry(self, client_with_fake_config):
        """Test GET /api/config/{app_name}/entries/{key} returns specific entry."""
        client, fake_service = client_with_fake_config
        app_name = "test-app"
        key = "test_key"

        # Pre-create config entry
        now = datetime.now(timezone.utc)
        entry = ConfigEntry(
            key=key,
            value="test_value",
            description="Test config",
            is_secret=True,
            created_at=now,
            updated_at=now,
        )
        config = AppConfig(
            app_name=app_name, config={key: entry}, created_at=now, updated_at=now
        )
        fake_service.configs[app_name] = config

        response = client.get(f"/api/config/{app_name}/entries/{key}")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["entry"]["key"] == key
        assert data["data"]["entry"]["value"] == "test_value"
        assert data["data"]["entry"]["description"] == "Test config"
        assert data["data"]["entry"]["is_secret"] is True

    def test_get_config_entry_returns_404_for_missing_entry(
        self, client_with_fake_config
    ):
        """Test GET /api/config/{app_name}/entries/{key} returns 404 for missing entry."""
        client, fake_service = client_with_fake_config
        app_name = "test-app"
        key = "missing_key"

        response = client.get(f"/api/config/{app_name}/entries/{key}")

        assert response.status_code == 404
        assert (
            f"Configuration entry '{key}' not found"
            in response.json()["error"]["message"]
        )

    def test_create_config_entry_creates_new_entry(self, client_with_fake_config):
        """Test POST /api/config/{app_name}/entries creates new entry."""
        client, fake_service = client_with_fake_config
        app_name = "test-app"

        request_data = {
            "key": "new_key",
            "value": "new_value",
            "description": "New configuration",
            "is_secret": True,
        }

        response = client.post(f"/api/config/{app_name}/entries", json=request_data)

        assert response.status_code == 201
        data = response.json()
        assert data["success"] is True
        assert data["data"]["entry"]["key"] == "new_key"
        assert data["data"]["entry"]["value"] == "new_value"
        assert data["data"]["entry"]["description"] == "New configuration"
        assert data["data"]["entry"]["is_secret"] is True

    def test_create_config_entry_returns_400_for_duplicate_key(
        self, client_with_fake_config
    ):
        """Test POST /api/config/{app_name}/entries returns 400 for duplicate key."""
        client, fake_service = client_with_fake_config
        app_name = "test-app"
        key = "existing_key"

        # Pre-create config entry
        now = datetime.now(timezone.utc)
        entry = ConfigEntry(
            key=key,
            value="value",
            description="Test description",
            is_secret=False,
            created_at=now,
            updated_at=now,
        )
        config = AppConfig(
            app_name=app_name, config={key: entry}, created_at=now, updated_at=now
        )
        fake_service.configs[app_name] = config

        request_data = {"key": key, "value": "duplicate_value", "is_secret": False}

        response = client.post(f"/api/config/{app_name}/entries", json=request_data)

        assert response.status_code == 400
        assert (
            f"Configuration entry '{key}' already exists"
            in response.json()["error"]["message"]
        )

    def test_create_config_entry_validates_request_data(self, client_with_fake_config):
        """Test POST /api/config/{app_name}/entries validates request data."""
        client, fake_service = client_with_fake_config
        app_name = "test-app"

        # Missing key
        request_data = {"value": "value", "is_secret": False}

        response = client.post(f"/api/config/{app_name}/entries", json=request_data)
        assert response.status_code == 422  # Pydantic validation error

    def test_update_config_entry_updates_existing_entry(self, client_with_fake_config):
        """Test PUT /api/config/{app_name}/entries/{key} updates existing entry."""
        client, fake_service = client_with_fake_config
        app_name = "test-app"
        key = "test_key"

        # Pre-create config entry
        now = datetime.now(timezone.utc)
        entry = ConfigEntry(
            key=key,
            value="original_value",
            description="Original description",
            is_secret=False,
            created_at=now,
            updated_at=now,
        )
        config = AppConfig(
            app_name=app_name, config={key: entry}, created_at=now, updated_at=now
        )
        fake_service.configs[app_name] = config

        request_data = {
            "value": "updated_value",
            "description": "Updated description",
            "is_secret": True,
        }

        response = client.put(
            f"/api/config/{app_name}/entries/{key}", json=request_data
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["entry"]["key"] == key
        assert data["data"]["entry"]["value"] == "updated_value"
        assert data["data"]["entry"]["description"] == "Updated description"
        assert data["data"]["entry"]["is_secret"] is True

    def test_update_config_entry_returns_404_for_missing_entry(
        self, client_with_fake_config
    ):
        """Test PUT /api/config/{app_name}/entries/{key} returns 404 for missing entry."""
        client, fake_service = client_with_fake_config
        app_name = "test-app"
        key = "missing_key"

        request_data = {"value": "value", "is_secret": False}

        response = client.put(
            f"/api/config/{app_name}/entries/{key}", json=request_data
        )

        assert response.status_code == 404
        assert (
            f"Configuration entry '{key}' not found"
            in response.json()["error"]["message"]
        )

    def test_delete_config_entry_removes_entry(self, client_with_fake_config):
        """Test DELETE /api/config/{app_name}/entries/{key} removes entry."""
        client, fake_service = client_with_fake_config
        app_name = "test-app"
        key = "test_key"

        # Pre-create config entry
        now = datetime.now(timezone.utc)
        entry = ConfigEntry(
            key=key,
            value="value",
            description="Test description",
            is_secret=False,
            created_at=now,
            updated_at=now,
        )
        config = AppConfig(
            app_name=app_name, config={key: entry}, created_at=now, updated_at=now
        )
        fake_service.configs[app_name] = config

        response = client.delete(f"/api/config/{app_name}/entries/{key}")

        assert response.status_code == 204
        assert not fake_service.has_config_entry(app_name, key)

    def test_delete_config_entry_returns_404_for_missing_entry(
        self, client_with_fake_config
    ):
        """Test DELETE /api/config/{app_name}/entries/{key} returns 404 for missing entry."""
        client, fake_service = client_with_fake_config
        app_name = "test-app"
        key = "missing_key"

        response = client.delete(f"/api/config/{app_name}/entries/{key}")

        assert response.status_code == 404
        assert (
            f"Configuration entry '{key}' not found"
            in response.json()["error"]["message"]
        )

    def test_delete_app_config_removes_all_config(self, client_with_fake_config):
        """Test DELETE /api/config/{app_name} removes all configuration."""
        client, fake_service = client_with_fake_config
        app_name = "test-app"

        # Pre-create config with multiple entries
        now = datetime.now(timezone.utc)
        entries = {
            "key1": ConfigEntry(
                key="key1",
                value="value1",
                description="Test description",
                is_secret=False,
                created_at=now,
                updated_at=now,
            ),
            "key2": ConfigEntry(
                key="key2",
                value="value2",
                description="Test description",
                is_secret=False,
                created_at=now,
                updated_at=now,
            ),
        }
        config = AppConfig(
            app_name=app_name, config=entries, created_at=now, updated_at=now
        )
        fake_service.configs[app_name] = config

        response = client.delete(f"/api/config/{app_name}")

        assert response.status_code == 204
        assert not fake_service.has_config(app_name)

    def test_config_supports_different_value_types(self, client_with_fake_config):
        """Test that config API supports different value types."""
        client, fake_service = client_with_fake_config
        app_name = "test-app"

        test_cases = [
            ("string_key", "string_value"),
            ("int_key", 42),
            ("float_key", 3.14),
            ("bool_key", True),
            ("list_key", ["item1", "item2"]),
            ("dict_key", {"nested": {"key": "value"}}),
            ("null_key", None),
        ]

        # Create entries with different value types
        for key, value in test_cases:
            request_data = {"key": key, "value": value, "is_secret": False}

            response = client.post(f"/api/config/{app_name}/entries", json=request_data)
            assert response.status_code == 201
            assert response.json()["data"]["entry"]["value"] == value

        # Verify all entries can be retrieved
        response = client.get(f"/api/config/{app_name}/entries")
        assert response.status_code == 200
        assert response.json()["data"]["count"] == len(test_cases)

    def test_api_error_handling_for_invalid_app_names(self, client_with_fake_config):
        """Test API error handling for invalid app names."""
        client, fake_service = client_with_fake_config

        # Test various invalid app names
        invalid_names_404 = [""]
        invalid_names_400 = [" ", "   "]

        for invalid_name in invalid_names_404:
            response = client.get(f"/api/config/{invalid_name}")
            assert response.status_code == 404
            response = client.get(f"/api/config/{invalid_name}/entries")
            assert response.status_code == 404
            request_data = {"key": "test", "value": "test", "is_secret": False}
            response = client.post(
                f"/api/config/{invalid_name}/entries", json=request_data
            )
            assert response.status_code == 404

        for invalid_name in invalid_names_400:
            response = client.get(f"/api/config/{invalid_name}")
            assert response.status_code == 400
            response = client.get(f"/api/config/{invalid_name}/entries")
            assert response.status_code == 400
            request_data = {"key": "test", "value": "test", "is_secret": False}
            response = client.post(
                f"/api/config/{invalid_name}/entries", json=request_data
            )
            assert response.status_code == 400

    def test_api_preserves_config_metadata(self, client_with_fake_config):
        """Test that API preserves configuration metadata."""
        client, fake_service = client_with_fake_config
        app_name = "test-app"
        key = "test_key"

        # Create entry
        request_data = {
            "key": key,
            "value": "original_value",
            "description": "Original description",
            "is_secret": False,
        }

        create_response = client.post(
            f"/api/config/{app_name}/entries", json=request_data
        )
        assert create_response.status_code == 201

        created_at = create_response.json()["data"]["entry"]["created_at"]

        # Update entry
        update_data = {
            "value": "updated_value",
            "description": "Updated description",
            "is_secret": True,
        }

        update_response = client.put(
            f"/api/config/{app_name}/entries/{key}", json=update_data
        )
        assert update_response.status_code == 200

        # Verify metadata is preserved/updated correctly
        entry_data = update_response.json()["data"]["entry"]
        assert entry_data["created_at"] == created_at  # Should be preserved
        assert entry_data["updated_at"] != created_at  # Should be updated
        assert entry_data["description"] == "Updated description"
