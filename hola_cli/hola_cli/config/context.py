"""
Server context management for the Hola CLI.
Handles connection configuration and client creation for API requests.
"""
from typing import Dict, Optional
from hola_client_sdk.client import Client
from hola_shared.errors import ConfigurationException
from .settings import get_settings

class ServerContext:
    """
    Context for server connections, handling client creation and configuration.
    This provides a consistent interface for services to access the API.
    """
    def __init__(self, url: str, api_key: str):
        """
        Initialize a new server context.
        
        Args:
            url: The base URL of the API server
            api_key: The API key for authentication
        """
        self.url = url
        self.api_key = api_key
        self._client: Optional[Client] = None
        
    def get_client(self) -> Client:
        """
        Get an API client configured for this server context.
        
        Returns:
            Configured API client for making requests
        """
        if not self._client:
            # Create a new client with the server context configuration
            self._client = Client(
                base_url=self.url,
                headers={"X-API-Key": self.api_key},
                timeout=30.0,
                verify_ssl=True
            )
        return self._client

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
            api_key="dev-api-key"
        )
    
    # If server name provided, look for that specific server
    if server_name:
        if server_name in settings.servers:
            server = settings.servers[server_name]
            return ServerContext(url=server.url, api_key=server.api_key)
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
        return ServerContext(url=server.url, api_key=server.api_key)
    
    # Fall back to first server in list if no default specified
    try:
        first_server_name = next(iter(settings.servers))
        server = settings.servers[first_server_name]
        return ServerContext(url=server.url, api_key=server.api_key)
    except StopIteration:
        # This should not happen due to the check at the beginning,
        # but added for defensive programming
        raise ConfigurationException(
            message="No servers configured",
            details={
                "help": "Use 'hola server add' to add a server connection"
            }
        )
