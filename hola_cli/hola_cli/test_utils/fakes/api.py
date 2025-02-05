"""
Fake implementations of external dependencies for CLI testing.

This module provides fake implementations of the API client and server context
that can be used in tests to simulate server interactions without making real
network requests. The fake implementations follow the same interface as the real
components but operate entirely in memory.

Benefits of using these fakes over mocks:
1. They provide realistic behavior that mimics the actual components
2. They can be configured to return specific responses for test scenarios
3. They track requests made during testing for verification
4. Tests remain stable even if implementation details change

The primary components in this module are:
- FakeApiClient: Simulates the HTTP client that communicates with the server
- FakeServerContext: Provides a test double for the server connection context
"""

from typing import Dict, Any, Optional, List, Generic, TypeVar, Type
from contextlib import contextmanager

from hola_shared.models.response import ApiResponse, ApiError


T = TypeVar("T")


class FakeApiClient:
    """
    A fake API client for testing CLI commands without making real network calls.

    This implementation follows the project's testing strategy of preferring fakes over
    mocks. It provides a deterministic, in-memory substitute for the API client that:

    1. Allows pre-registering responses for specific endpoints and parameters
    2. Records all requests made during tests for later verification
    3. Provides predictable responses without external dependencies
    4. Maintains the same interface as the real API client

    Example usage:
        # Set up the fake client
        client = FakeApiClient()

        # Register responses for specific endpoints
        client.register_response("/hello", {"name": "World"},
                                ApiResponse(success=True, data="Hello, World!"))

        # Use the client in tests
        response = client.get("/hello", {"name": "World"})

        # Verify requests were made as expected
        assert len(client.requests) == 1
        assert client.requests[0]["endpoint"] == "/hello"
    """

    def __init__(self):
        """
        Initialize with empty response registry.

        The fake client maintains two key data structures:
        - responses: A registry of pre-configured responses keyed by endpoint and parameters
        - requests: A record of all requests made through the client during testing
        """
        self.responses: Dict[str, Dict[str, Any]] = {}
        self.requests: List[Dict[str, Any]] = []

    def register_response(self, endpoint: str, params: Dict[str, Any], response: Any):
        """
        Register a response for a specific endpoint and parameters.

        This method allows test setup to configure the fake client to return
        specific responses for matching endpoint+parameter combinations. When the
        client receives a request matching these criteria, it will return the
        pre-registered response instead of making a real network call.

        Args:
            endpoint: The API endpoint path (e.g., "/hello")
            params: The parameters that should trigger this response
            response: The response object to return (typically an ApiResponse)
        """
        if endpoint not in self.responses:
            self.responses[endpoint] = {}

        # Convert parameters to a hashable string representation
        param_key = str(sorted(params.items()))
        self.responses[endpoint][param_key] = response

    def get(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> Any:
        """
        Simulate a GET request and return the registered response.

        This method mimics the behavior of a real API client's GET request without
        making network calls. It:
        1. Records the request details for later verification
        2. Looks up a pre-registered response for the endpoint and parameters
        3. Returns a default error response if no matching response is found

        Args:
            endpoint: The API endpoint path (e.g., "/hello")
            params: Optional query parameters for the request

        Returns:
            The pre-registered response for the matching endpoint+parameters,
            or a default error response if no match is found
        """
        params = params or {}
        self.requests.append({"method": "GET", "endpoint": endpoint, "params": params})

        if endpoint not in self.responses:
            # Default error response if endpoint not registered
            return ApiResponse(
                success=False,
                error=ApiError(code="FAKE_NOT_FOUND", details={"endpoint": endpoint}),
            )

        param_key = str(sorted(params.items()))
        if param_key not in self.responses[endpoint]:
            # Use a default response for the endpoint if param match not found
            param_key = str(sorted({}))
            if param_key not in self.responses[endpoint]:
                return ApiResponse(
                    success=False,
                    error=ApiError(
                        code="FAKE_PARAMS_MISMATCH", details={"params": params}
                    ),
                )

        return self.responses[endpoint][param_key]

    def post(self, endpoint: str, data: Dict[str, Any]) -> Any:
        """Simulate a POST request and return the registered response."""
        self.requests.append({"method": "POST", "endpoint": endpoint, "data": data})

        if endpoint not in self.responses:
            # Default error response if endpoint not registered
            return ApiResponse(
                success=False,
                error=ApiError(code="FAKE_NOT_FOUND", details={"endpoint": endpoint}),
            )

        # In real implementation, match on body content too
        param_key = str(sorted({}))
        if param_key not in self.responses[endpoint]:
            return ApiResponse(
                success=False,
                error=ApiError(code="FAKE_BODY_MISMATCH", details={"data": data}),
            )

        return self.responses[endpoint][param_key]


class FakeServerContext:
    """
    Fake server context for testing CLI commands.

    This class provides a test double for the server connection context used in the CLI.
    It implements the same interface as the real ServerContext but operates entirely in memory
    without making real network requests. The fake context:

    1. Simulates a connection to a server with configurable URL and API key
    2. Provides access to a FakeApiClient for simulating API responses
    3. Maintains the same methods and properties as the real context
    4. Allows tests to verify correct usage of the server connection

    Testing strategy benefits:

    This fake implementation embodies the project's preference for fakes over mocks.
    Unlike a mock that simply verifies method calls, this fake:

    1. Maintains a consistent interface with the real component, ensuring tests
       remain valid even if implementation details change
    2. Provides realistic behavior that mimics the actual server context
    3. Can be pre-configured with specific responses for different test scenarios
    4. Records interactions that can be verified in test assertions
    5. Creates clearer separation between the system under test and external dependencies

    This approach is especially valuable at system boundaries like the API client interface,
    where the CLI interacts with external systems. Using this fake context allows tests to:

    - Verify that commands correctly use the server context
    - Test handling of various server responses, including errors
    - Ensure that authentication information flows correctly
    - Validate the integration between CLI components and the API client

    Example usage:
        # Set up a fake server context
        context = FakeServerContext()

        # Configure responses for specific endpoints
        context.client.register_response("/hello", {}, ApiResponse(success=True, data="Hello"))

        # Pass to a command or service for testing
        service = HelloService(context)
        result = service.hello()

        # Verify interactions with the API client
        assert len(context.client.requests) == 1
        assert context.client.requests[0]["endpoint"] == "/hello"
    """

    def __init__(
        self,
        url: str = "http://fake-server",
        api_key: str = "fake-key",
        name: str = "fake",
    ):
        """
        Initialize with a fake server configuration.

        This constructor sets up a fake server context with configurable connection
        details that mimic what would be used for a real server connection. It creates
        a FakeApiClient instance that will be used for simulated API calls.

        Args:
            url: The simulated server URL (defaults to "http://fake-server")
            api_key: The simulated API key (defaults to "fake-key")
            name: An identifier for this server connection (defaults to "fake")
        """
        self.url = url
        self.api_key = api_key
        self.name = name
        self.client = FakeApiClient()

    @contextmanager
    def create_client(self):
        """
        Return the fake API client as a context manager.

        This method implements the context manager protocol used by the real ServerContext,
        allowing test code to use the fake context in the same way as the real one:

        ```python
        with context.create_client() as client:
            response = client.get("/endpoint")
        ```

        The context manager simply yields the fake API client without performing any
        actual connection setup or teardown, since everything is simulated in memory.

        Yields:
            The fake API client instance
        """
        yield self.client

    def get_client(self):
        """
        Get the fake API client for testing.

        This method provides direct access to the fake API client for cases where
        the context manager pattern isn't needed. It's useful for setting up
        pre-configured responses or inspecting recorded requests after test execution.

        Returns:
            The fake API client instance associated with this context
        """
        return self.client
