"""
Hello service for the Hola CLI.

This module provides service classes for interacting with the hello endpoints
of the Hola API, demonstrating basic connectivity and functionality.
"""
from hola_client_sdk.api.hello import hello_hello_get
from hola_shared.models.response import ApiResponse
from ..config.context import ServerContext

class HelloService:
    """
    Service for interacting with the hello endpoints of the Hola API.
    
    This service handles communication with the server's hello endpoints,
    providing a clean interface for the CLI commands to use.
    """
    def __init__(self, server_context: ServerContext):
        """
        Initialize a new HelloService instance.
        
        Args:
            server_context: The server context for API communication
        """
        self.server_context = server_context
        
    def hello(self, name: str) -> ApiResponse:
        """
        Call the hello endpoint on the server with the provided name.
        
        Args:
            name: The name to greet
            
        Returns:
            ApiResponse with the greeting message
            
        Raises:
            Exception: If the API call fails
        """
        # Use the generated client SDK to call the API
        response = hello_hello_get.sync_detailed(
            name=name,
            client=self.server_context.get_client()
        )
        
        # Convert to ApiResponse format
        if response.status_code == 200 and response.parsed:
            return response.parsed
        else:
            raise Exception(f"Error calling hello API: {response.status_code}")