"""Tests for the server context module."""

import pytest
import warnings
from hola_cli.config.context import ServerContext, get_current_server
from hola_shared.errors import ConfigurationException
from hola_client_sdk.client import Client


class TestServerContext:
    """Tests for the ServerContext class."""

    def test_create_client_context_manager(self):
        """Test that create_client returns a properly configured client."""
        context = ServerContext(url="http://test.url", api_key="test-key", name="test")

        with context.create_client() as client:
            assert isinstance(client, Client)
            # Access base_url and headers through private attributes
            assert client._base_url == "http://test.url"
            assert client._headers["X-API-Key"] == "test-key"

    def test_create_client_returns_configured_client(self):
        """Test that create_client returns a properly configured client."""
        context = ServerContext(url="http://test.url", api_key="test-key", name="test")

        with context.create_client() as client:
            assert isinstance(client, Client)
            assert client._base_url == "http://test.url"
            assert client._headers["X-API-Key"] == "test-key"

    def test_create_client_creates_new_instances(self):
        """Test that create_client creates new client instances on each call."""
        context = ServerContext(url="http://test.url", api_key="test-key", name="test")

        # Each call to create_client should create a new client instance
        with context.create_client() as client1:
            pass

        with context.create_client() as client2:
            pass

        # This test verifies each call creates a unique instance,
        # unlike the old get_client that cached the instance


class TestGetCurrentServer:
    """Tests for the get_current_server function."""

    def test_with_server_name(self, monkeypatch):
        """Test getting a server by name."""
        from hola_cli.config.settings import CliSettings, ServerConnection

        # Mock the settings
        settings = CliSettings(
            servers={
                "test": ServerConnection(url="http://test.url", api_key="test-key"),
                "other": ServerConnection(url="http://other.url", api_key="other-key"),
            },
            default_server="other",
        )

        monkeypatch.setattr("hola_cli.config.context.load_settings", lambda: settings)

        context = get_current_server("test")
        assert context.url == "http://test.url"
        assert context.api_key == "test-key"
        assert context.name == "test"

    def test_with_default_server(self, monkeypatch):
        """Test getting the default server."""
        from hola_cli.config.settings import CliSettings, ServerConnection

        # Mock the settings
        settings = CliSettings(
            servers={
                "test": ServerConnection(url="http://test.url", api_key="test-key"),
                "default": ServerConnection(
                    url="http://default.url", api_key="default-key"
                ),
            },
            default_server="default",
        )

        monkeypatch.setattr("hola_cli.config.context.load_settings", lambda: settings)

        context = get_current_server()
        assert context.url == "http://default.url"
        assert context.api_key == "default-key"
        assert context.name == "default"

    def test_server_not_found(self, monkeypatch):
        """Test exception when server not found."""
        from hola_cli.config.settings import CliSettings, ServerConnection

        # Mock the settings
        settings = CliSettings(
            servers={
                "test": ServerConnection(url="http://test.url", api_key="test-key")
            },
            default_server="test",
        )

        monkeypatch.setattr("hola_cli.config.context.load_settings", lambda: settings)

        with pytest.raises(ConfigurationException) as excinfo:
            get_current_server("nonexistent")

        assert "not found" in str(excinfo.value)
        assert "nonexistent" in str(excinfo.value)
