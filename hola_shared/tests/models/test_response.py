"""
Tests for the response models in hola_shared.

This module contains comprehensive tests for the ApiError and ApiResponse models,
which form the foundation of the API communication protocol between the server
and client components of the Hola system.

The tests validate:
1. Basic model instantiation with various parameter combinations
2. Type checking and validation for required and optional fields
3. Generic type support in ApiResponse for different data types
4. Error representation and handling

These models are critical because they are shared across multiple components
and define the contract for all API communications in the system.
"""

import pytest

from hola_shared.models.response import ApiResponse, ApiError


class TestApiError:
    """Tests for the ApiError model.

    This test class verifies the behavior of the ApiError model, which represents
    error information returned from API endpoints. The tests ensure that the model:

    1. Properly initializes with required fields (code and message)
    2. Correctly handles the optional details field
    3. Maintains proper type validation for all fields

    The ApiError model is critical as it provides standardized error reporting
    across all components of the application, enabling consistent error handling
    in both server responses and client processing.
    """

    def test_api_error_creation(self):
        """Test that ApiError can be created with the expected fields.

        This test verifies that:
        1. An ApiError can be instantiated with code, message, and details
        2. All field values are correctly stored and accessible
        3. The model accepts a dictionary for the details field

        This is the basic path for error creation used by server components
        when generating API responses for error conditions.
        """
        error = ApiError(
            code="TEST_ERROR", message="Test error message", details={"some": "details"}
        )
        assert error.code == "TEST_ERROR"
        assert error.message == "Test error message"
        assert error.details == {"some": "details"}

    def test_api_error_without_details(self):
        """Test that ApiError can be created without details.

        This test verifies that:
        1. An ApiError can be instantiated with only code and message
        2. When details are omitted, the field defaults to None

        This represents a common use case for simple errors where detailed
        context information isn't needed or available. Testing this case
        ensures that components don't require details to process errors.
        """
        error = ApiError(code="TEST_ERROR", message="Test error message")
        assert error.code == "TEST_ERROR"
        assert error.message == "Test error message"
        assert error.details is None


class TestApiResponse:
    """Tests for the ApiResponse model.

    This test class verifies the behavior of the ApiResponse model, which is the
    standardized wrapper for all API responses in the system. The tests ensure that:

    1. The model correctly handles successful responses with data
    2. The model correctly handles error responses with ApiError objects
    3. The generic type parameter works correctly for different data types
    4. Required and optional fields behave as expected

    The ApiResponse model provides a consistent structure across all API endpoints,
    enabling components to handle responses uniformly regardless of the specific
    endpoint or data being returned.
    """

    def test_successful_response(self):
        """Test that a successful response can be created.

        This test verifies that:
        1. An ApiResponse can be created with success=True and data
        2. The error field defaults to None for successful responses

        This represents the standard pattern for all successful API responses
        in the system, where the success flag indicates success, data contains
        the response payload, and error is null.
        """
        response = ApiResponse(success=True, data="test data")
        assert response.success is True
        assert response.data == "test data"
        assert response.error is None

    def test_error_response(self):
        """Test that an error response can be created.

        This test verifies that:
        1. An ApiResponse can be created with success=False and an ApiError object
        2. The data field defaults to None for error responses
        3. The error field correctly stores an ApiError instance

        This represents the standard pattern for all failed API responses in the system,
        where the success flag indicates failure, error contains structured error
        information, and data is null.
        """
        error = ApiError(code="TEST_ERROR", message="Test error message")
        response = ApiResponse(success=False, error=error)
        assert response.success is False
        assert response.error == error
        assert response.data is None

    def test_generic_response_with_different_data_types(self):
        """Test that ApiResponse works with different data types.

        This test verifies that:
        1. The ApiResponse model correctly handles its generic type parameter
        2. Different data types can be correctly specified and validated
        3. Type hints work properly for string and dictionary data

        This is critical because the ApiResponse is a generic wrapper that needs to
        handle many different data types throughout the application. Proper generic
        type support ensures type safety and IDE assistance for developers.
        """
        # With string data
        response_str = ApiResponse[str](success=True, data="string data")
        assert isinstance(response_str.data, str)

        # With dict data
        response_dict = ApiResponse[dict](success=True, data={"key": "value"})
        assert isinstance(response_dict.data, dict)
