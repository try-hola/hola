"""Error models and exceptions for Hola.

This module contains error handling models and exception classes used
throughout the Hola application.
"""

from typing import Optional, Any, Dict
from .response import ApiError, ApiResponse

class HolaException(Exception):
    """Base exception for Hola applications."""
    
    def __init__(
        self,
        code: str,
        message: str,
        details: Optional[Dict[str, Any]] = None,
        status_code: int = 500
    ):
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

class ValidationException(HolaException):
    """Exception raised when input validation fails."""
    
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(
            code="VALIDATION_ERROR",
            message=message,
            details=details,
            status_code=400
        )

class NotFoundException(HolaException):
    """Exception raised when a resource is not found."""
    
    def __init__(self, resource_type: str, resource_id: str):
        super().__init__(
            code="NOT_FOUND",
            message=f"{resource_type} '{resource_id}' not found",
            details={"resource_type": resource_type, "resource_id": resource_id},
            status_code=404
        )

class ServiceException(HolaException):
    """Exception raised when there's a problem with an external service."""
    
    def __init__(self, service: str, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(
            code="SERVICE_ERROR",
            message=f"{service}: {message}",
            details=details or {"service": service},
            status_code=500
        )

class AuthenticationException(HolaException):
    """Exception raised when authentication fails."""
    
    def __init__(self, message: str = "Authentication failed"):
        super().__init__(
            code="AUTHENTICATION_ERROR",
            message=message,
            status_code=401
        )

class ConfigurationException(HolaException):
    """Exception raised when there's an issue with configuration."""
    
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(
            code="CONFIGURATION_ERROR", 
            message=message,
            details=details,
            status_code=500
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
