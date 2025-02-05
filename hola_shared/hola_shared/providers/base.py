"""Base provider protocol definitions for server providers.

This module defines the Protocol interfaces for server providers,
enabling a consistent interface across different provider implementations
while leveraging Python's structural typing through Protocols.
"""

from typing import Protocol, Dict, Any, List, Optional, AsyncIterator


class ServerProvider(Protocol):
    """Protocol defining the interface for server providers.

    ServerProvider abstracts the underlying platform or technology used
    to host and manage servers. It enables the system to interact
    with different server environments (like Docker, cloud providers, etc.)
    through a consistent interface.

    Implementations of this protocol should handle all the platform-specific
    details while exposing the same interface to the rest of the system.
    """

    type: str  # Provider type identifier
    display_name: str  # User-friendly display name

    async def is_available(self) -> bool:
        """
        Check if this provider is available on the current system.

        This method verifies that the necessary tools or dependencies
        for this provider are installed and accessible on the current system.

        Returns:
            True if provider is available, False otherwise
        """
        ...

    async def bootstrap(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """
        Bootstrap a new server.

        Creates and initializes a new server environment using this provider.
        The specific bootstrap process depends on the provider implementation.

        Args:
            options: Provider-specific options for bootstrapping

        Returns:
            Provider-specific context data for the new server
        """
        ...

    async def get_server_info(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get information about a server.

        Retrieves current status and metadata about a server
        managed by this provider.

        Args:
            context: Provider-specific context for the server

        Returns:
            Server information including status
        """
        ...

    async def start_server(self, context: Dict[str, Any]) -> None:
        """
        Start a server.

        Starts a stopped or pause a server managed by this provider.

        Args:
            context: Provider-specific context for the server
        """
        ...

    async def stop_server(self, context: Dict[str, Any]) -> None:
        """
        Stop a server.

        Stops a running server managed by this provider.

        Args:
            context: Provider-specific context for the server
        """
        ...
