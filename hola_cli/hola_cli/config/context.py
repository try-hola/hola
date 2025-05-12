"""
Server context management for the Hola CLI.
Handles connection configuration and client creation for API requests.
"""
from typing import Dict, Optional
import warnings
from contextlib import contextmanager
from functools import wraps
from hola_client_sdk.client import Client
from hola_shared.errors import ConfigurationException
from .settings import get_settings

class ServerContext:
    """
    Context for server connections, handling client creation and configuration.
    This provides a consistent interface for services to access the API.
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
            verify_ssl=True
        )
        try:
            yield client
        finally:
            # No explicit cleanup needed, handled by the contextmanager
            pass

def get_current_server(server_name: Optional[str] = None) -> ServerContext:
    """
    Get the ServerContext for the specified server or default server.
    
    Args:
        server_name: Optional name of the server to use. If None, uses the default server.
        
    Returns:
        ServerContext for API communication
        
    Raises:
        ConfigurationException: If the requested server doesn't exist or no server is available
    """
    # Load CLI settings
    settings = get_settings()
    
    # No servers configured
    if not settings.servers:
        # Provide a default local development server configuration
        return ServerContext(
            url="http://localhost:8000",
            api_key="dev-api-key",
            name="local-dev"
        )
    
    # If server name provided, look for that specific server
    if server_name:
        if server_name in settings.servers:
            server = settings.servers[server_name]
            return ServerContext(url=server.url, api_key=server.api_key, name=server_name)
        else:
            raise ConfigurationException(
                message=f"Server '{server_name}' not found in configuration",
                details={
                    "server_name": server_name, 
                    "available_servers": list(settings.servers.keys()),
                    "help": "Use 'hola server list' to see available servers"
                }
            )
    
    # Use default server if available
    if settings.default_server and settings.default_server in settings.servers:
        server = settings.servers[settings.default_server]
        return ServerContext(url=server.url, api_key=server.api_key, name=settings.default_server)
    
    # Fall back to first server in list if no default specified
    try:
        first_server_name = next(iter(settings.servers))
        server = settings.servers[first_server_name]
        return ServerContext(url=server.url, api_key=server.api_key, name=first_server_name)
    except StopIteration:
        # This should not happen due to the check at the beginning,
        # but added for defensive programming
        raise ConfigurationException(
            message="No servers configured",
            details={
                "help": "Use 'hola server add' to add a server connection"
            }
        )
