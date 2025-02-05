"""Tests for server manager lifecycle operations.

This module tests the complete lifecycle of servers using the fake provider.
It focuses on the integration between ServerManager and provider implementations.
"""

import pytest
import asyncio
import sys
import os
from pathlib import Path
import tempfile
from unittest.mock import MagicMock, patch

from hola_cli.providers.server_manager import ServerManager
from hola_shared.models.providers import ServerStatus

# Import the fake provider using a relative import with proper context
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from hola_cli.test_utils.fakes.fake_provider import FakeServerProvider


@pytest.fixture
def temp_data_dir():
    """Create a temporary directory for server data."""
    with tempfile.TemporaryDirectory() as temp_dir:
        yield Path(temp_dir)


@pytest.fixture
def fake_provider():
    """Create a fake provider for testing."""
    return FakeServerProvider()


@pytest.fixture
def server_manager_with_fake_provider(temp_data_dir, fake_provider):
    """Create a server manager with the fake provider registered.

    This fixture sets up a server manager with a temporary data directory
    and patches the provider registry to return the fake provider.
    """
    # Create server manager with the temporary directory
    manager = ServerManager(data_dir=temp_data_dir)

    # Create and register a fake provider
    with patch(
        "hola_cli.providers.server_manager.get_provider_registry"
    ) as mock_get_registry:
        mock_registry = MagicMock()
        mock_registry.get_provider.return_value = fake_provider
        mock_get_registry.return_value = mock_registry

        yield manager


@pytest.mark.asyncio
async def test_create_server(server_manager_with_fake_provider):
    """Test creating a server."""
    manager = server_manager_with_fake_provider

    # Create a new server with the fake provider
    server = await manager.create_server(
        provider_type="fake", name="test-server", options={"port": 9002}
    )

    # Verify server properties
    assert server.id is not None
    assert server.name == "test-server"
    assert server.provider_type == "fake"
    assert server.status == ServerStatus.CREATED
    assert server.created_at is not None
    assert "container_id" in server.context

    # Check that the server was saved
    saved_server = manager.get_server(server.id)
    assert saved_server is not None
    assert saved_server.id == server.id


@pytest.mark.asyncio
async def test_server_lifecycle_operations(server_manager_with_fake_provider):
    """Test the complete server lifecycle operations."""
    manager = server_manager_with_fake_provider

    # Create server
    server = await manager.create_server(
        provider_type="fake", name="lifecycle-test", options={}
    )

    # Start the server
    started_server = await manager.start_server(server.id)
    assert started_server is not None
    assert started_server.status == ServerStatus.RUNNING

    # Refresh info
    refreshed_server = await manager.refresh_server(server.id)
    assert refreshed_server is not None
    assert refreshed_server.status == ServerStatus.RUNNING

    # Stop the server
    stopped_server = await manager.stop_server(server.id)
    assert stopped_server is not None
    assert stopped_server.status == ServerStatus.STOPPED

    # Delete the server
    await manager.delete_server(server.id)
    assert manager.get_server(server.id) is None
