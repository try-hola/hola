"""Tests for server providers and server management.

This module tests the server provider registry and server manager.
"""

import pytest
import asyncio
import sys
import os
from unittest.mock import MagicMock, AsyncMock, patch
from pathlib import Path
import tempfile
import json

from hola_cli.providers.registry import ServerProviderRegistry
from hola_cli.providers.server_manager import ServerManager
from hola_shared.models.providers import ServerInfo, ServerStatus

# Import the fake provider using a relative import with proper context
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from hola_cli.test_utils.fakes.fake_provider import FakeServerProvider

# Use the FakeServerProvider directly since it now has built-in tracking


@pytest.fixture
def fake_provider():
    """Create a fake provider for testing."""
    return FakeServerProvider()


@pytest.fixture
def registry(fake_provider):
    """Create a provider registry with a fake provider.

    This is different from the fake_provider_registry fixture in conftest.py
    because it doesn't patch get_provider_registry.
    """
    registry = ServerProviderRegistry()
    registry.register_provider(fake_provider)
    return registry


@pytest.fixture
def temp_data_dir():
    """Create a temporary directory for testing."""
    with tempfile.TemporaryDirectory() as temp_dir:
        yield Path(temp_dir)


@pytest.fixture
def server_manager(temp_data_dir, registry):
    """Create a server manager with a temporary data directory."""
    return ServerManager(data_dir=temp_data_dir)


@pytest.mark.asyncio
async def test_create_server(server_manager, fake_provider, monkeypatch):
    """Test creating a server."""
    # Mock the provider registry
    mock_registry = MagicMock()
    mock_registry.get_provider.return_value = fake_provider
    monkeypatch.setattr(
        "hola_cli.providers.server_manager.get_provider_registry", lambda: mock_registry
    )

    # Create the server
    server = await server_manager.create_server("fake", "test-server", {"port": 8000})

    # Verify the server was created
    assert server.name == "test-server"
    assert server.provider_type == "fake"
    assert server.status == ServerStatus.CREATED
    assert server.id is not None
    assert server.created_at is not None

    # Verify the provider was called correctly - now using the same FakeServerProvider
    assert fake_provider._bootstrap_called
    assert fake_provider._bootstrap_options.get("port") == 8000
    assert fake_provider._bootstrap_options.get("name") == "test-server"

    # Verify the server was saved
    servers = server_manager.get_servers()
    assert len(servers) == 1
    assert servers[0].id == server.id


@pytest.mark.asyncio
async def test_start_server(server_manager, fake_provider, monkeypatch):
    """Test starting a server."""
    # Create a server first
    mock_registry = MagicMock()
    mock_registry.get_provider.return_value = fake_provider
    monkeypatch.setattr(
        "hola_cli.providers.server_manager.get_provider_registry", lambda: mock_registry
    )

    server = await server_manager.create_server("fake", "test-server", {"port": 8000})

    # Start the server
    updated_server = await server_manager.start_server(server.id)

    # Verify the provider was called correctly
    assert fake_provider._start_called
    assert fake_provider._start_context.get("container_id") == "fake-id"

    # Verify the server status was updated
    assert updated_server.status == ServerStatus.RUNNING
    assert updated_server.started_at is not None
