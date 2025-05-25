"""Tests for the base provider protocol.

This module tests the ServerProvider protocol definition.
"""
import pytest
from typing import Dict, Any, Protocol
from hola_shared.providers.base import ServerProvider


class FakeServerProvider:
    """Fake implementation of the ServerProvider protocol for testing."""
    
    type = "fake"
    display_name = "Fake Provider"
    
    async def is_available(self) -> bool:
        """Check if this provider is available."""
        return True
    
    async def bootstrap(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """Bootstrap a new server."""
        return {"provider": self.type, "container_id": "fake-id", "status": "created"}
    
    async def get_server_info(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Get information about a server."""
        return {"status": "running", **context}
    
    async def start_server(self, context: Dict[str, Any]) -> None:
        """Start a server."""
        pass
    
    async def stop_server(self, context: Dict[str, Any]) -> None:
        """Stop a server."""
        pass


def test_server_provider_protocol():
    """Test that our fake correctly implements the ServerProvider protocol."""
    provider = FakeServerProvider()
    
    # Type checking should pass if the protocol is properly implemented
    # This is a static check, but we can verify the required attributes exist
    assert hasattr(provider, "type")
    assert hasattr(provider, "display_name")
    assert hasattr(provider, "is_available")
    assert hasattr(provider, "bootstrap")
    assert hasattr(provider, "get_server_info")
    assert hasattr(provider, "start_server")
    assert hasattr(provider, "stop_server")
