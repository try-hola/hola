"""
Shared test fixtures and configuration for hola_shared tests.

This module defines pytest fixtures that are used across the hola_shared test suite.
It provides factories and pre-configured objects that make it easier to create
standardized test data for API response models.

The fixtures in this file follow these testing principles:
- Using ModelFactory (from polyfactory) for creating test objects with default values
- Providing both factories and pre-configured instances for flexibility in tests
- Creating consistent test data structures that match production usage patterns
- Enabling test isolation by providing fresh instances for each test

These fixtures are automatically available to all tests in the hola_shared package
through pytest's fixture discovery mechanism.
"""
import pytest
from polyfactory.factories.pydantic_factory import ModelFactory

from hola_shared.models.response import ApiResponse, ApiError


class ApiErrorFactory(ModelFactory[ApiError]):
    """Factory for creating ApiError models for testing.
    
    This factory uses polyfactory to generate ApiError instances with sensible defaults,
    allowing tests to override only the specific fields they need to test. This approach
    reduces test code duplication and makes tests more maintainable by centralizing
    the creation of test data.
    """
    __model__ = ApiError
    
    @classmethod
    def build_default(cls, **kwargs):
        defaults = {"code": "TEST_ERROR", "message": "Test error message"}
        defaults.update(kwargs)
        return super().build_default(**defaults)


class ApiResponseFactory(ModelFactory[ApiResponse]):
    """Factory for creating ApiResponse models for testing.
    
    This factory generates ApiResponse instances with random data by default.
    The factory supports the generic type parameter of ApiResponse, allowing
    tests to create properly typed response objects for different data types.
    """
    __model__ = ApiResponse


@pytest.fixture
def api_error_factory() -> ApiErrorFactory:
    """Return a factory for creating ApiError instances.
    
    This fixture provides access to the ApiErrorFactory, allowing tests to create
    customized ApiError instances with specific field values while using defaults
    for fields that aren't relevant to the specific test case.
    
    Returns:
        ApiErrorFactory: A factory for creating ApiError instances.
    """
    return ApiErrorFactory


@pytest.fixture
def api_response_factory() -> ApiResponseFactory:
    """Return a factory for creating ApiResponse instances.
    
    This fixture provides access to the ApiResponseFactory, allowing tests to
    create customized ApiResponse instances with specific success status, data,
    and error values. It supports the generic type parameter of ApiResponse
    for type-safe testing.
    
    Returns:
        ApiResponseFactory: A factory for creating ApiResponse instances.
    """
    return ApiResponseFactory


@pytest.fixture
def successful_response() -> ApiResponse:
    """Return a successful API response.
    
    This fixture provides a pre-configured successful API response object with
    test data. Using this fixture keeps tests consistent and reduces duplication
    when testing logic that needs to handle successful API responses.
    
    Returns:
        ApiResponse: A successful API response with test data.
    """
    return ApiResponse(success=True, data="Test data", error=None)


@pytest.fixture
def error_response() -> ApiResponse:
    """Return an error API response.
    
    This fixture provides a pre-configured error API response with standard error details.
    Using this fixture keeps tests consistent and reduces duplication when testing
    error handling logic throughout the application.
    
    Returns:
        ApiResponse: An API response with error details.
    """
    return ApiResponse(
        success=False,
        data=None,
        error=ApiError(code="TEST_ERROR", message="Test error message", details={"test": "error"})
    )
