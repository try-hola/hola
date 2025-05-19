"""Tests for server instance manager lifecycle operations.

This module tests the complete lifecycle of server instances using the fake provider.
It focuses on the integration between ServerInstanceManager and provider implementations.
"""
import pytest
import asyncio
import sys
import os
from pathlib import Path
import tempfile
from unittest.mock import MagicMock, patch

from hola_cli.providers.instance_manager import ServerInstanceManager
from hola_shared.models.providers import ServerStatus

# Import the fake provider using a relative import with proper context
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from fakes.fake_provider import FakeServerProvider


@pytest.fixture
def temp_data_dir():
    """Create a temporary directory for instance data."""
    with tempfile.TemporaryDirectory() as temp_dir:
        yield Path(temp_dir)


@pytest.fixture
def fake_provider():
    """Create a fake provider for testing."""
    return FakeServerProvider()


@pytest.fixture
def instance_manager_with_fake_provider(temp_data_dir, fake_provider):
    """Create an instance manager with the fake provider registered.
    
    This fixture sets up an instance manager with a temporary data directory
    and patches the provider registry to return the fake provider.
    """
    # Create instance manager with the temporary directory
    manager = ServerInstanceManager(data_dir=temp_data_dir)
    
    # Create and register a fake provider
    with patch('hola_cli.providers.instance_manager.get_provider_registry') as mock_get_registry:
        mock_registry = MagicMock()
        mock_registry.get_provider.return_value = fake_provider
        mock_get_registry.return_value = mock_registry
        
        yield manager


@pytest.mark.asyncio
async def test_create_server_instance(instance_manager_with_fake_provider):
    """Test creating a server instance."""
    manager = instance_manager_with_fake_provider
    
    # Create a new instance with the fake provider
    instance = await manager.create_instance(
        provider_type="fake",
        name="test-instance",
        options={"port": 9002}
    )
    
    # Verify instance properties
    assert instance.id is not None
    assert instance.name == "test-instance"
    assert instance.provider_type == "fake"
    assert instance.status == ServerStatus.CREATED
    assert instance.created_at is not None
    assert "container_id" in instance.context
    
    # Check that the instance was saved
    saved_instance = manager.get_instance(instance.id)
    assert saved_instance is not None
    assert saved_instance.id == instance.id


@pytest.mark.asyncio
async def test_server_lifecycle_operations(instance_manager_with_fake_provider):
    """Test the complete server lifecycle operations."""
    manager = instance_manager_with_fake_provider
    
    # Create instance
    instance = await manager.create_instance(
        provider_type="fake",
        name="lifecycle-test",
        options={}
    )
    
    # Start the instance
    started_instance = await manager.start_instance(instance.id)
    assert started_instance is not None
    assert started_instance.status == ServerStatus.RUNNING
    
    # Refresh info
    refreshed_instance = await manager.refresh_instance(instance.id)
    assert refreshed_instance is not None
    assert refreshed_instance.status == ServerStatus.RUNNING
    
    # Stop the instance
    stopped_instance = await manager.stop_instance(instance.id)
    assert stopped_instance is not None
    assert stopped_instance.status == ServerStatus.STOPPED
    
    # Delete the instance
    deleted = manager.delete_instance(instance.id)
    assert deleted is True
    assert manager.get_instance(instance.id) is None
