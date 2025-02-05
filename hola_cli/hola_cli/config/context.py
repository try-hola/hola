"""
Server context management for the Hola CLI.

This module provides functionality for managing server connections in the CLI,
including client creation, configuration, and context management. It serves as
the primary interface for establishing and maintaining server connections throughout
the CLI's operation.

The module offers both function-based and class-based approaches to context management,
with the ServerContext class handling the details of client creation and configuration,
while helper functions like get_current_server provide convenient access to the current
server context.
"""

from typing import Dict, Optional
import warnings
from contextlib import contextmanager
from functools import wraps
from hola_client_sdk.client import Client
from hola_shared.errors import ConfigurationException
from hola_shared.environment import Environment
from .settings import load_settings


class ServerContext:
    """
    Context for server connections, handling client creation and configuration.

    This class provides a consistent interface for services to access the API,
    encapsulating the details of client creation, configuration, and authentication.
    It maintains connection details like URL and API key, and provides methods to
    create pre-configured API clients for different services.

    The class is designed to be used as a dependency in service classes, allowing
    them to focus on business logic while delegating connection management to
    this context object.

    Attributes:
        name: Name of the server connection, used for identification
        url: Base URL of the server API
        api_key: Authentication API key for the server
        environment: Optional environment indicator (production, development, etc.)
    """

    def __init__(self, url: str, api_key: str, name: str = "default"):
        """
        Initialize a new server context.

        Args:
            url: The base URL of the API server
            api_key: The API key for authentication
            name: Server name for reference (default: "default")
        """
        self.url = url
        self.api_key = api_key
        self.name = name
        self._client: Optional[Client] = None

    @contextmanager
    def create_client(self):
        """
        Create and yield an API client for this server as a context manager.

        This is the recommended way to get a client for making API requests.
        The context manager ensures proper resource management.

        Example:
            with server_context.create_client() as client:
                response = client.some_api_call()

        Returns:
            A configured API client for making requests
        """
        client = Client(
            base_url=self.url,
            headers={"X-API-Key": self.api_key},
            timeout=30.0,
            verify_ssl=True,
        )
        try:
            yield client
        finally:
            # No explicit cleanup needed, handled by the contextmanager
            pass


def get_current_server(server_name: Optional[str] = None) -> ServerContext:
    """
    Get a server context for the specified or default server.

    This function is the primary entry point for obtaining a server context
    throughout the CLI application. It handles the resolution of which server
    to connect to based on a cascading preference order, ensuring that the
    application always has a valid server connection when possible.

    Resolves server in the following order:
    1. Explicitly provided server_name parameter
    2. HOLA_SERVER environment variable
    3. Default server from settings
    4. First server in settings if no default

    If no server can be resolved through any of these methods, a
    ConfigurationException is raised with clear instructions on how to
    configure a server connection.

    Args:
        server_name: Optional name of the server to use

    Returns:
        ServerContext for API communication

    Raises:
        ConfigurationException: If server cannot be found or configured
    """
    settings = load_settings()

    # Use specified server, environment variable, or default
    name = server_name or Environment.get("SERVER") or settings.default_server

    # Override URL and API key from environment if specified
    env_url = Environment.get("SERVER_URL")
    env_api_key = Environment.get("API_KEY")

    # If server was explicitly requested but not found, raise an exception
    if server_name and (not name or name not in settings.servers):
        raise ConfigurationException(
            message=f"Server '{server_name}' not found",
            details={"help": "Use 'hola server add' to add a server connection"},
        )

    if name and name in settings.servers:
        # Use server from settings
        server = settings.servers[name]
        # Override with env vars if provided
        url = env_url or server.url
        api_key = env_api_key or server.api_key
        return ServerContext(url=url, api_key=api_key, name=name)
    elif env_url and env_api_key:
        # Create server context from environment variables
        # Use the HOLA_SERVER value for the name if available, otherwise fallback to "env"
        server_name = Environment.get("SERVER") or "env"
        return ServerContext(url=env_url, api_key=env_api_key, name=server_name)
    elif len(settings.servers) > 0:
        # Fall back to first server in list
        first_server_name = next(iter(settings.servers))
        server = settings.servers[first_server_name]
        url = env_url or server.url
        api_key = env_api_key or server.api_key
        return ServerContext(url=url, api_key=api_key, name=first_server_name)
    else:
        # No server configured
        raise ConfigurationException(
            message="No servers configured",
            details={"help": "Use 'hola server add' to add a server connection"},
        )
