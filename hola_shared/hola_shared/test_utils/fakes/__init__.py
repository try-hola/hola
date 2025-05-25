"""Tests for the fake providers used in testing.

This module defines fake provider implementations for testing.
"""
from typing import Dict, Any


class FakeServerProvider:
    """Fake provider implementation for testing.
    
    This provider implements the ServerProvider protocol and can be
    configured to return specific responses for testing.
    """
    
    def __init__(self, provider_type: str = "fake", display_name: str = "Fake Provider"):
        """Initialize the fake provider with configurable responses."""
        self.type = provider_type
        self.display_name = display_name
        self._available = True
        self._bootstrap_response = {"provider": provider_type, "container_id": "fake-id"}
        self._info_response = {"status": "running"}
        
        # Track method calls
        self.is_available_called = 0
        self.bootstrap_called = 0
        self.get_server_info_called = 0
        self.start_server_called = 0
        self.stop_server_called = 0
    
    async def is_available(self) -> bool:
        """Check if this provider is available."""
        self.is_available_called += 1
        return self._available
    
    async def bootstrap(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """Bootstrap a new server."""
        self.bootstrap_called += 1
        self.last_bootstrap_options = options
        return {**self._bootstrap_response, "options": options}
    
    async def get_server_info(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Get information about a server."""
        self.get_server_info_called += 1
        self.last_context = context
        return {**self._info_response, **context}
    
    async def start_server(self, context: Dict[str, Any]) -> None:
        """Start a server."""
        self.start_server_called += 1
        self.last_start_context = context
    
    async def stop_server(self, context: Dict[str, Any]) -> None:
        """Stop a server."""
        self.stop_server_called += 1
        self.last_stop_context = context
    
    def configure(self, **kwargs):
        """Configure the fake provider behavior.
        
        Args:
            available (bool): Whether the provider should be available
            bootstrap_response (Dict): Response to return from bootstrap
            info_response (Dict): Response to return from get_server_info
        """
        if "available" in kwargs:
            self._available = kwargs["available"]
        if "bootstrap_response" in kwargs:
            self._bootstrap_response = kwargs["bootstrap_response"]
        if "info_response" in kwargs:
            self._info_response = kwargs["info_response"]
        return self


from .logging import FakeLogger, LogMessage
from .environment import FakeEnvironment
