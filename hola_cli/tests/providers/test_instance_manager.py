"""Tests for server providers and instance management.

This module tests the server provider registry and instance manager.
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
from hola_cli.providers.instance_manager import ServerInstanceManager
from hola_shared.models.providers import ServerInstanceInfo, ServerStatus

# Import the fake provider using a relative import with proper context
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from fakes.fake_provider import FakeServerProvider

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
def instance_manager(temp_data_dir, registry):
    """Create an instance manager with a temporary data directory."""
    return ServerInstanceManager(data_dir=temp_data_dir)


@pytest.mark.asyncio
async def test_create_instance(instance_manager, fake_provider, monkeypatch):
    """Test creating a server instance."""
    # Mock the provider registry
    mock_registry = MagicMock()
    mock_registry.get_provider.return_value = fake_provider
    monkeypatch.setattr(
        "hola_cli.providers.instance_manager.get_provider_registry",
        lambda: mock_registry
    )
    
    # Create the instance
    instance = await instance_manager.create_instance(
        "fake", "test-server", {"port": 8000}
    )
    
    # Verify the instance was created
    assert instance.name == "test-server"
    assert instance.provider_type == "fake"
    assert instance.status == ServerStatus.CREATED
    assert instance.id is not None
    assert instance.created_at is not None
    
    # Verify the provider was called correctly - now using the same FakeServerProvider
    assert fake_provider._bootstrap_called
    assert fake_provider._bootstrap_options.get("port") == 8000
    assert fake_provider._bootstrap_options.get("name") == "test-server"
    
    # Verify the instance was saved
    instances = instance_manager.get_instances()
    assert len(instances) == 1
    assert instances[0].id == instance.id


@pytest.mark.asyncio
async def test_start_instance(instance_manager, fake_provider, monkeypatch):
    """Test starting a server instance."""
    # Create an instance first
    mock_registry = MagicMock()
    mock_registry.get_provider.return_value = fake_provider
    monkeypatch.setattr(
        "hola_cli.providers.instance_manager.get_provider_registry",
        lambda: mock_registry
    )
    
    instance = await instance_manager.create_instance(
        "fake", "test-server", {"port": 8000}
    )
    
    # Start the instance
    updated_instance = await instance_manager.start_instance(instance.id)
    
    # Verify the provider was called correctly
    assert fake_provider._start_called
    assert fake_provider._start_context.get("container_id") == "fake-id"
    
    # Verify the instance status was updated
    assert updated_instance.status == ServerStatus.RUNNING
    assert updated_instance.started_at is not None
