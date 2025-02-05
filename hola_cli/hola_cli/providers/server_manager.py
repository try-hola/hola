"""Server manager.

This module provides functionality for managing servers
across different providers from the client side.
"""

import os
import json
import logging
import uuid
from typing import Dict, List, Optional, Any
from datetime import datetime, UTC
import asyncio
from pathlib import Path
from functools import lru_cache

from hola_shared.models.providers import ServerInfo, ServerStatus
from .registry import ServerProviderRegistry
from .providers import get_provider_registry

logger = logging.getLogger(__name__)


class ServerManager:
    """Manages servers across different providers.

    This class provides a persistent store for servers and
    functionality to manage their lifecycle across different providers.

    The manager handles:
    1. Storing server metadata on disk for persistence across CLI invocations
    2. Creating, starting, stopping, and removing servers
    3. Listing servers and retrieving status information
    4. Delegating provider-specific operations to the appropriate provider
    5. Finding available ports and generating unique server names
    """

    def __init__(self, data_dir: Optional[Path] = None):
        """Initialize the server manager.

        Args:
            data_dir: Directory to store server data, defaults to ~/.hola/servers
        """
        if data_dir is None:
            home = Path.home()
            data_dir = home / ".hola" / "servers"

        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.servers: Dict[str, ServerInfo] = {}
        self._load_servers()

        logger.debug(f"Initialized ServerManager with data_dir={data_dir}")

    def _load_servers(self) -> None:
        """Load servers from the data directory."""
        logger.debug("Loading servers from data directory")
        for file_path in self.data_dir.glob("*.json"):
            try:
                with open(file_path, "r") as f:
                    server_data = json.load(f)
                    server = ServerInfo.parse_obj(server_data)
                    self.servers[server.id] = server
                    logger.debug(f"Loaded server {server.id} ({server.name})")
            except Exception as e:
                logger.error(f"Error loading server file {file_path}: {str(e)}")

    def _save_server(self, server: ServerInfo) -> None:
        """Save a server to the data directory.

        Args:
            server: Server to save
        """
        file_path = self.data_dir / f"{server.id}.json"
        try:
            with open(file_path, "w") as f:
                f.write(server.model_dump_json(indent=2))
            logger.debug(f"Saved server {server.id} to {file_path}")
        except Exception as e:
            logger.error(f"Error saving server {server.id}: {str(e)}")

    def get_server(self, server_id: str) -> Optional[ServerInfo]:
        """Get a server by ID.

        Args:
            server_id: ID of the server to get

        Returns:
            Server info or None if not found
        """
        return self.servers.get(server_id)

    def get_servers(self) -> List[ServerInfo]:
        """Get all servers.

        Returns:
            List of all servers
        """
        return list(self.servers.values())

    def get_servers_by_provider(self, provider_type: str) -> List[ServerInfo]:
        """Get servers by provider type.

        Args:
            provider_type: Provider type to filter by

        Returns:
            List of servers for the specified provider
        """
        return [s for s in self.servers.values() if s.provider_type == provider_type]

    async def create_server(
        self, provider_type: str, name: str, options: Dict[str, Any]
    ) -> ServerInfo:
        """Create a new server.

        Args:
            provider_type: Type of provider to use
            name: Name for the server
            options: Provider-specific options

        Returns:
            Information about the created server

        Raises:
            ValueError: If the provider is not found
        """
        registry = get_provider_registry()
        provider = registry.get_provider(provider_type)

        if provider is None:
            raise ValueError(f"Provider '{provider_type}' not found")

        # Generate unique ID if one isn't provided
        server_id = options.get("id", str(uuid.uuid4()))

        # Generate unique name if one isn't provided
        if not name:
            name = f"hola-server-{server_id[:8]}"

        # Get current timestamp
        now = datetime.now(UTC).isoformat()

        # Bootstrap the server on the provider
        logger.info(f"Creating server '{name}' with provider '{provider_type}'")
        context = await provider.bootstrap(name, options)

        # Create the server record
        server = ServerInfo(
            id=server_id,
            name=name,
            provider_type=provider_type,
            status=ServerStatus.CREATED,
            context=context,
            created_at=now,
        )

        # Store the server record
        self.servers[server_id] = server
        self._save_server(server)

        return server

    def _remove_server_file(self, server_id: str) -> None:
        """Remove the server file from disk.

        Args:
            server_id: ID of the server to remove
        """
        file_path = self.data_dir / f"{server_id}.json"
        try:
            if file_path.exists():
                os.remove(file_path)
                logger.debug(f"Removed server file: {file_path}")
        except Exception as e:
            logger.error(f"Error removing server file: {str(e)}")

    def remove_server(self, server_id: str) -> None:
        """Remove a server from the registry.

        Args:
            server_id: ID of the server to remove
        """
        if server_id in self.servers:
            del self.servers[server_id]
            self._remove_server_file(server_id)
            logger.debug(f"Removed server {server_id}")

    async def refresh_server(self, server_id: str) -> Optional[ServerInfo]:
        """Refresh the server information by contacting the provider.

        Args:
            server_id: ID of the server to refresh

        Returns:
            Updated server information or None if not found
        """
        server = self.get_server(server_id)
        if not server:
            logger.warning(f"Server not found: {server_id}")
            return None

        registry = get_provider_registry()
        provider = registry.get_provider(server.provider_type)

        if provider is None:
            logger.error(f"Provider '{server.provider_type}' not found")
            return None

        try:
            # Update server context and status from the provider
            server_context = await provider.get_server_info(server_id, server.context)

            # Update the server record
            server.context.update(server_context)
            server.status = ServerStatus(
                server_context.get("status", ServerStatus.UNKNOWN)
            )

            if "error" in server_context:
                server.error = server_context["error"]

            if server_context.get("ip_address"):
                port = server_context.get("port", 8000)
                server.url = f"http://{server_context['ip_address']}:{port}"

            self._save_server(server)

            return server
        except Exception as e:
            logger.error(f"Error refreshing server {server_id}: {str(e)}")
            server.status = ServerStatus.ERROR
            server.error = str(e)
            self._save_server(server)
            return server

    async def start_server(self, server_id: str) -> Optional[ServerInfo]:
        """Start a server.

        Args:
            server_id: ID of the server to start

        Returns:
            Updated server information or None if not found
        """
        server = self.get_server(server_id)
        if not server:
            logger.warning(f"Server not found: {server_id}")
            return None

        registry = get_provider_registry()
        provider = registry.get_provider(server.provider_type)

        if provider is None:
            logger.error(f"Provider '{server.provider_type}' not found")
            return None

        try:
            # Start the server via the provider
            server_context = await provider.start_server(server_id, server.context)

            # Update the server record
            server.context.update(server_context)
            server.status = ServerStatus(
                server_context.get("status", ServerStatus.UNKNOWN)
            )
            server.started_at = datetime.now(UTC).isoformat()
            server.error = server_context.get("error")

            if server_context.get("ip_address"):
                port = server_context.get("port", 8000)
                server.url = f"http://{server_context['ip_address']}:{port}"

            self._save_server(server)

            return server
        except Exception as e:
            logger.error(f"Error starting server {server_id}: {str(e)}")
            server.status = ServerStatus.ERROR
            server.error = str(e)
            self._save_server(server)
            return server

    async def stop_server(self, server_id: str) -> Optional[ServerInfo]:
        """Stop a server.

        Args:
            server_id: ID of the server to stop

        Returns:
            Updated server information or None if not found
        """
        server = self.get_server(server_id)
        if not server:
            logger.warning(f"Server not found: {server_id}")
            return None

        registry = get_provider_registry()
        provider = registry.get_provider(server.provider_type)

        if provider is None:
            logger.error(f"Provider '{server.provider_type}' not found")
            return None

        try:
            # Stop the server via the provider
            server_context = await provider.stop_server(server_id, server.context)

            # Update the server record
            server.context.update(server_context)
            server.status = ServerStatus(
                server_context.get("status", ServerStatus.UNKNOWN)
            )
            server.error = server_context.get("error")

            self._save_server(server)

            return server
        except Exception as e:
            logger.error(f"Error stopping server {server_id}: {str(e)}")
            server.status = ServerStatus.ERROR
            server.error = str(e)
            self._save_server(server)
            return server

    async def delete_server(self, server_id: str) -> None:
        """Delete a server, removing it from the provider and registry.

        Args:
            server_id: ID of the server to delete
        """
        server = self.get_server(server_id)
        if not server:
            logger.warning(f"Server not found: {server_id}")
            return

        registry = get_provider_registry()
        provider = registry.get_provider(server.provider_type)

        if provider is None:
            logger.error(f"Provider '{server.provider_type}' not found")
            self.remove_server(server_id)
            return

        try:
            # Stop the server if it's running
            if server.status in [ServerStatus.RUNNING, ServerStatus.PAUSED]:
                await self.stop_server(server_id)

            # Delete the server from the provider
            await provider.delete_server(server_id, server.context)

            # Remove the server from the registry
            self.remove_server(server_id)

            logger.info(f"Deleted server {server_id}")
        except Exception as e:
            logger.error(f"Error deleting server {server_id}: {str(e)}")
            server.status = ServerStatus.ERROR
            server.error = str(e)
            self._save_server(server)


@lru_cache()
def get_server_manager() -> ServerManager:
    """Get a singleton instance of the server manager.

    Returns:
        Singleton server manager instance
    """
    logger.debug("Creating server manager instance")
    return ServerManager()
