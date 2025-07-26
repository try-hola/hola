"""Error handling utilities for Hola applications.

This module provides a consistent error handling framework for both
the server and client components of the Hola application. It includes
base exception classes and utilities for converting exceptions to
API responses.

Classes:
    HolaException: Base exception class for all Hola-specific errors
    ConfigurationException: Error raised when there's an issue with configuration
    AuthenticationException: Error raised when authentication fails
    NotFoundException: Error raised when a resource isn't found
    ValidationException: Error raised when input validation fails
    ServiceException: Error raised when there's a problem with an external service

Functions:
    format_exception: Converts any exception to a structured ApiError format

Usage:
    from hola.shared.errors import ConfigurationException

    # Raising custom errors
    raise ConfigurationException(
        message="Configuration not found",
        details={"config_name": "app_settings"}
    )
"""

from typing import Dict, Any, Optional, Type, List
from .models.response import ApiError, ApiResponse


class HolaException(Exception):
    """Base exception for Hola applications.

    This exception class serves as the foundation for all application-specific
    exceptions in the Hola ecosystem. It provides a consistent error structure
    with error codes, messages, and optional details.

    Attributes:
        code: A string representing the error code
        message: A human-readable error message
        details: Additional contextual information about the error
        status_code: The HTTP status code to use when this error occurs in an API context
    """

    def __init__(
        self,
        code: str,
        message: str,
        details: Optional[Dict[str, Any]] = None,
        status_code: int = 400,
    ):
        """
        Initialize a Hola exception.

        Args:
            code: Error code for programmatic identification
            message: Human-readable error message
            details: Additional contextual information about the error
            status_code: HTTP status code to use when converting to an API response
        """
        self.code = code
        self.message = message
        self.details = details or {}
        self.status_code = status_code
        super().__init__(message)

    def to_api_error(self) -> ApiError:
        """Convert to an API error object.

        Returns:
            An ApiError instance populated with this exception's properties
        """
        return ApiError(code=self.code, message=self.message, details=self.details)

    def to_response(self) -> ApiResponse:
        """Convert to an API response object.

        Creates a complete API response with success=False and this exception's
        information as the error property.

        Returns:
            An ApiResponse instance representing a failed operation
        """
        return ApiResponse(success=False, error=self.to_api_error())


class ConfigurationException(HolaException):
    """Exception raised when there's a problem with configuration."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        """Initialize a configuration exception.

        Args:
            message: Human-readable error message
            details: Additional error details
        """
        super().__init__(
            code="CONFIGURATION_ERROR",
            message=message,
            details=details,
            status_code=500,
        )


class AuthenticationException(HolaException):
    """Exception raised when authentication fails."""

    def __init__(
        self,
        message: str = "Authentication failed",
        details: Optional[Dict[str, Any]] = None,
    ):
        """Initialize an authentication exception.

        Args:
            message: Human-readable error message
            details: Additional error details
        """
        super().__init__(
            code="AUTHENTICATION_ERROR",
            message=message,
            details=details,
            status_code=401,
        )


class NotFoundException(HolaException):
    """Exception raised when a requested resource is not found."""

    def __init__(
        self,
        resource_type: str,
        resource_id: str,
        details: Optional[Dict[str, Any]] = None,
    ):
        """Initialize a not found exception.

        Args:
            resource_type: Type of resource that wasn't found (e.g., "app", "server")
            resource_id: Identifier of the resource
            details: Additional error details
        """
        message = f"{resource_type.capitalize()} '{resource_id}' not found"
        merged_details = {"resource_type": resource_type, "resource_id": resource_id}
        if details:
            merged_details.update(details)

        super().__init__(
            code="RESOURCE_NOT_FOUND",
            message=message,
            details=merged_details,
            status_code=404,
        )


class ValidationException(HolaException):
    """Exception raised when input validation fails."""

    def __init__(
        self,
        message: str,
        field_errors: Optional[Dict[str, List[str]]] = None,
        details: Optional[Dict[str, Any]] = None,
    ):
        """Initialize a validation exception.

        Args:
            message: Human-readable error message
            field_errors: Dictionary mapping field names to lists of error messages
            details: Additional error details
        """
        merged_details = {}
        if field_errors:
            merged_details["field_errors"] = field_errors
        if details:
            merged_details.update(details)

        super().__init__(
            code="VALIDATION_ERROR",
            message=message,
            details=merged_details,
            status_code=422,
        )


class ServiceException(HolaException):
    """Exception raised when there's a problem with an external service."""

    def __init__(
        self, message: str, service_name: str, details: Optional[Dict[str, Any]] = None
    ):
        """Initialize a service exception.

        Args:
            message: Human-readable error message
            service_name: Name of the service that experienced the issue
            details: Additional error details
        """
        merged_details = {"service_name": service_name}
        if details:
            merged_details.update(details)

        super().__init__(
            code="SERVICE_ERROR",
            message=message,
            details=merged_details,
            status_code=503,
        )


def format_exception(exception: Exception) -> ApiError:
    """Convert any exception to a structured API error.

    This utility function helps maintain consistent error handling by
    converting standard Python exceptions to the ApiError format.

    Args:
        exception: Any Python exception

    Returns:
        An ApiError with appropriate code and message

    Examples:
        try:
            # Some operation that might fail
            result = perform_operation()
        except Exception as e:
            error = format_exception(e)
            return ApiResponse(success=False, error=error)
    """
    if isinstance(exception, HolaException):
        return exception.to_api_error()

    return ApiError(
        code="UNEXPECTED_ERROR",
        message=str(exception),
        details={"type": type(exception).__name__},
    )
