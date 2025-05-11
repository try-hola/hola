"""
Hello service for the Hola CLI.

This module provides service classes for interacting with the hello endpoints
of the Hola API, demonstrating basic connectivity and functionality.
"""
from hola_client_sdk.api.hello import hello_hello_get
from hola_client_sdk.errors import UnexpectedStatus
from hola_shared.models.response import ApiResponse
from hola_shared.errors import ServiceException, AuthenticationException
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
        
    def hello(self, name: str = "World") -> ApiResponse:
        """
        Call the hello endpoint on the server with the provided name.
        
        Args:
            name: The name to greet. Defaults to "World".
            
        Returns:
            ApiResponse with the greeting message
            
        Raises:
            ServiceException: If there's an error communicating with the server
            AuthenticationException: If authentication with the server fails (future implementation)
        """
        # Use the generated client SDK to call the API
        try:
            response = hello_hello_get.sync_detailed(
                name=name,
                client=self.server_context.get_client()
            )
            
            # Convert to ApiResponse format
            if response.parsed:
                # We have a valid response, successful or error
                return response.parsed
            elif response.status_code == 401:
                # Authentication error - will be relevant in future implementation
                raise ServiceException(
                    message=f"API request failed with status code: {response.status_code}",
                    service_name="Hola API Server",
                    details={
                        "endpoint": "hello",
                        "status_code": response.status_code,
                        "server_url": self.server_context.url,
                        "note": "Authentication will be implemented in a future phase"
                    }
                )
            else:
                # Other API errors without parsed response
                raise ServiceException(
                    message=f"API request failed with status code: {response.status_code}",
                    service_name="Hola API Server",
                    details={
                        "endpoint": "hello",
                        "status_code": response.status_code,
                        "server_url": self.server_context.url
                    }
                )
        except UnexpectedStatus as e:
            # Handle unexpected status codes from the API
            raise ServiceException(
                message=f"Unexpected API response: {e.status_code}",
                service_name="Hola API Server",
                details={
                    "status_code": e.status_code,
                    "response_content": e.content.decode('utf-8', errors='replace')
                }
            )
        except Exception as e:
            # Handle other errors like network issues
            raise ServiceException(
                message=f"Error communicating with API: {str(e)}",
                service_name="Hola API Server",
                details={
                    "error_type": type(e).__name__,
                    "server_url": self.server_context.url
                }
            )