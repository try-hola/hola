"""
Tests for the hello service.

This module tests the HelloService which acts as an intermediary between
CLI commands and the API client. The tests demonstrate:

1. Using fake responses to simulate the API client behavior
2. Testing different parameter combinations and their effects
3. Verifying correct error handling and response processing
4. Maintaining isolation from external dependencies

The testing approach here follows the project's overall strategy of creating
focused tests with clear boundaries, using fakes rather than mocks
for external dependencies.
"""

import pytest
from dataclasses import dataclass
from typing import Any
from unittest.mock import patch

from hola_cli.services.hello_service import HelloService
from hola_shared.models.response import ApiResponse, ApiError
from hola_cli.test_utils.fakes.api import FakeServerContext


@dataclass
class FakeSDKResponse:
    """
    Fake response that mimics the SDK's Response object structure.

    This class simulates the structure of responses returned by the
    client SDK's sync_detailed methods. It provides the minimum structure
    needed for the service to process responses, including:

    - status_code: The HTTP status code returned by the server
    - parsed: The parsed response body (typically an ApiResponse)

    This fake specifically mimics the Response object returned by the client SDK's
    sync_detailed methods, which follows a consistent pattern of including both
    a status_code and a parsed response body.
    """

    status_code: int
    parsed: Any = None


class TestHelloService:
    """
    Tests for the HelloService.

    This test class verifies the behavior of the HelloService, which is responsible for:
    1. Making API calls to the hello endpoints through the client SDK
    2. Processing responses and handling errors
    3. Converting raw API responses into domain-specific representations

    The tests use selective mocking at the HTTP client boundary to isolate the service
    from external dependencies while focusing on its core logic. This approach allows
    testing different response scenarios, including success and error cases, without
    making actual network calls.
    """

    @patch("hola_cli.services.hello_service.hello_hello_get.sync_detailed")
    def test_hello_service_default_name(self, mock_sync_detailed):
        """
        Test that the hello service works with the default name.

        This test verifies that:
        1. The service passes the default name parameter ("World") to the API client
        2. The service correctly uses the server context's contextmanager to get the API client
        3. The service returns the parsed response directly when successful

        The test patches the underlying HTTP method to avoid making real network calls,
        focusing on the service's logic for calling the API and processing responses.
        """
        # Create a fake server context
        context = FakeServerContext()  # type: ignore

        # Create expected response
        expected_response = ApiResponse(success=True, data="Hello, World!")
        mock_sync_detailed.return_value = FakeSDKResponse(
            status_code=200, parsed=expected_response
        )

        # Create the service and call it
        service = HelloService(context)  # type: ignore
        result = service.hello()

        # Verify the mock was called correctly with the right parameter
        mock_sync_detailed.assert_called_once()
        # Verify name parameter was passed correctly
        args, kwargs = mock_sync_detailed.call_args
        assert kwargs.get("name") == "World"

        # Verify the result
        assert result == expected_response

    @patch("hola_cli.services.hello_service.hello_hello_get.sync_detailed")
    def test_hello_service_custom_name(self, mock_sync_detailed):
        """
        Test that the hello service works with a custom name.

        This test verifies that:
        1. The service passes a custom name parameter correctly to the API client
        2. The parameter value flows through to the underlying HTTP request
        3. The service correctly processes the successful response

        This test complements the default name test by verifying that the service
        correctly handles parametrized requests with custom values.
        """
        # Create a fake server context
        context = FakeServerContext()  # type: ignore

        # Create expected response
        expected_response = ApiResponse(success=True, data="Hello, Test!")
        mock_sync_detailed.return_value = FakeSDKResponse(
            status_code=200, parsed=expected_response
        )

        # Create the service and call it
        service = HelloService(context)  # type: ignore
        result = service.hello("Test")

        # Verify the mock was called correctly with the right parameter
        mock_sync_detailed.assert_called_once()
        # Verify name parameter was passed correctly
        args, kwargs = mock_sync_detailed.call_args
        assert kwargs.get("name") == "Test"

        # Verify the result
        assert result == expected_response

    @patch("hola_cli.services.hello_service.hello_hello_get.sync_detailed")
    def test_hello_service_error_handling(self, mock_sync_detailed):
        """
        Test that the hello service handles errors correctly.

        This test verifies that:
        1. The service correctly processes error responses from the API
        2. Error information is preserved and passed through to the caller
        3. The service maintains the error structure defined in the shared models
        4. The service doesn't attempt to transform or hide error details

        Error handling at the service layer is critical because it determines how
        API errors are presented to the command layer and ultimately to the user.
        This test ensures that error information flows correctly through the service
        layer, preserving details that will help users understand and resolve issues.
        """
        # Create a fake server context
        context = FakeServerContext()  # type: ignore

        # Create an error response
        error = ApiError(code="TEST_ERROR", message="Test error")
        expected_response = ApiResponse(success=False, error=error)
        mock_sync_detailed.return_value = FakeSDKResponse(
            status_code=400, parsed=expected_response
        )

        # Create the service and call it
        service = HelloService(context)  # type: ignore
        result = service.hello()

        # Verify the mock was called correctly with default parameters
        mock_sync_detailed.assert_called_once()
        # Verify name parameter was passed correctly
        args, kwargs = mock_sync_detailed.call_args
        assert kwargs.get("name") == "World"

        # Verify the error is passed through
        assert result == expected_response
        assert result.success is False
        assert result.error is not None
        assert result.error.code == "TEST_ERROR"
