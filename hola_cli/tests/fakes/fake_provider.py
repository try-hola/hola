"""Fake server provider implementation for testing.

This module implements a simple fake provider that is always available,
making it useful for testing the CLI functionality without requiring
actual provider dependencies like Docker or OrbStack.

The fake provider implements the ServerProvider protocol completely, allowing
it to be used as a drop-in replacement for real providers in tests. It
includes tracking attributes to monitor which methods were called and with
what parameters, making it easy to assert on expected behavior in tests.

Typical usage:
    provider = FakeServerProvider()
    assert await provider.is_available()
    context = await provider.bootstrap({"name": "test-server"})
    await provider.start_server(context)
    assert provider._start_called
    assert context["status"] == "running"
"""
import asyncio
import logging
from typing import Dict, Any, Optional, Protocol
from hola_shared.providers.base import ServerProvider

logger = logging.getLogger(__name__)

class FakeServerProvider(ServerProvider):
    """Fake provider implementation for testing.
    
    This provider is always available and simulates the behavior of a real
    provider without requiring any external dependencies. It's useful for
    testing the CLI functionality in environments without Docker or OrbStack.
    
    This class implements the ServerProvider protocol and includes tracking
    capabilities to record which methods were called, with what arguments,
    and in what order. This makes it particularly useful for unit tests that
    need to verify provider interactions.
    
    The fake provider maintains an internal state that mimics real provider
    behavior, such as transitioning between "created", "running", and "stopped"
    states, and includes simulated delays to better approximate real-world
    behavior.
    
    Attributes:
        type: The provider type identifier, defaults to "fake"
        display_name: Human-readable name for the provider
        _available: Whether the provider should report itself as available
        _bootstrap_called: Whether the bootstrap method has been called
        _start_called: Whether the start_server method has been called
        _stop_called: Whether the stop_server method has been called
        _get_info_called: Whether the get_server_info method has been called
    """
    
    type: str = "fake"
    display_name: str = "Fake Provider (Testing)"
    
    def __init__(self, provider_type: str = "fake", available: bool = True):
        """Initialize the fake provider with optional tracking functionality."""
        self.type = provider_type
        self.display_name = f"{provider_type.capitalize()} Provider"
        self._available = available
        # Tracking attributes
        self._bootstrap_called = False
        self._start_called = False
        self._stop_called = False
        self._get_info_called = False
        self._bootstrap_options = None
        self._start_context = None
        self._stop_context = None
        self._get_info_context = None
    
    async def is_available(self) -> bool:
        """
        Check if this provider is available.
        
        Simulates checking whether the provider is available on the system.
        This method returns the availability value set during initialization,
        making it easy to test both available and unavailable provider scenarios.
        
        Returns:
            bool: True by default, or the value set in constructor
        """
        logger.debug("Fake provider availability check")
        return self._available
    
    async def bootstrap(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """
        Simulate bootstrapping a new server instance.
        
        This method simulates the creation of a new server instance without
        actually starting it. It records that the method was called and stores
        the provided options for later inspection in tests.
        
        The returned context includes standard fields like provider type,
        container ID, name, port, and status, which are used by the instance
        manager and other parts of the system.
        
        Args:
            options: Configuration options for the server, including name and port
            
        Returns:
            Dict[str, Any]: Context data for the fake server, including provider,
                container_id, name, port, and initial status
        """
        logger.info(f"Bootstrapping fake server with options: {options}")
        # Track method call for testing
        self._bootstrap_called = True
        self._bootstrap_options = options
        
        name = options.get("name", "fake-server")
        port = options.get("port", 8000)
        
        # Return simulated context for a fake server
        return {
            "provider": self.type,
            "container_id": "fake-id",  # Use consistent ID for tests
            "name": name,
            "port": port,
            "status": "created",
        }
    
    async def start_server(self, context: Dict[str, Any]) -> None:
        """
        Simulate starting a server instance.
        
        This method simulates the process of starting a server instance by 
        updating the context's status field to "running" and adding a URL field. 
        It also includes a short simulated delay to mimic the time it takes 
        to start a real server.
        
        The method records that it was called and stores the provided context 
        for later inspection in tests.
        
        Args:
            context: Server context data from bootstrap, which will be modified in-place
                    to reflect the running state
        """
        logger.info(f"Starting fake server with context: {context}")
        # Track method call for testing
        self._start_called = True
        self._start_context = context
        
        # Simulate a short delay for starting
        await asyncio.sleep(0.1)
        
        # Update the context in-place with running status
        context["status"] = "running"
        context["url"] = f"http://localhost:{context.get('port', 8000)}"
    
    async def stop_server(self, context: Dict[str, Any]) -> None:
        """
        Simulate stopping a server instance.
        
        This method simulates the process of stopping a running server instance by
        updating the context's status field to "stopped". It also includes a short 
        simulated delay to mimic the time it takes to stop a real server.
        
        The method records that it was called and stores the provided context
        for later inspection in tests. It also resets the _start_called flag
        to maintain accurate state tracking.
        
        Args:
            context: Server context data, which will be modified in-place to
                    reflect the stopped state
        """
        logger.info(f"Stopping fake server with context: {context}")
        # Track method call for testing
        self._stop_called = True
        self._stop_context = context
        self._start_called = False
        
        # Simulate a short delay for stopping
        await asyncio.sleep(0.1)
        
        # Update the context in-place with stopped status
        context["status"] = "stopped"
    
    async def get_server_info(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get information about a server instance.
        
        This method simulates retrieving information about a server instance.
        It mainly returns the context as-is, but adds a started_at timestamp
        if the server is in a running state (indicated by _start_called).
        
        The method records that it was called and stores the provided context
        for later inspection in tests.
        
        Args:
            context: Server context data containing current instance state
            
        Returns:
            Dict[str, Any]: Server instance information, including the original
                context and potentially additional metadata like started_at timestamp
        """
        logger.debug(f"Getting fake server info with context: {context}")
        # Track method call for testing
        self._get_info_called = True
        self._get_info_context = context
        
        # Just return the context as-is, since it contains all the info
        result = context
        
        # Add started_at for compatibility with existing tests
        if self._start_called and "started_at" not in result:
            result["started_at"] = "2023-01-01T00:00:00Z"
            
        return result
