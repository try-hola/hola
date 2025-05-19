"""API response models.

This module defines the standard API response structures used throughout
the application for consistent error handling and response formatting.
"""

from pydantic import BaseModel
from typing import Optional, Generic, TypeVar, Dict, Any

T = TypeVar('T')

class ApiError(BaseModel):
    """API error representation.
    
    A standardized error model for API responses containing error code, 
    human-readable message, and optional detailed information. This model
    is used consistently throughout the application to ensure uniform
    error reporting and handling.
    
    Error codes are typically uppercase strings like "NOT_FOUND" or 
    "VALIDATION_ERROR" that identify the category of error. These can
    be used by client applications for programmatic error handling.
    
    Attributes:
        code: A string error code that identifies the error type.
        message: A human-readable error message describing the issue.
        details: Optional additional context information about the error,
                such as specific fields that failed validation or
                additional error context.
    
    Example:
        # Create an API error for failed validation
        validation_error = ApiError(
            code="VALIDATION_ERROR",
            message="Invalid input data",
            details={"fields": {"username": ["Must be at least 3 characters"]}}
        )
    """
    code: str
    message: str
    details: Optional[Dict[str, Any]] = None

class ApiResponse(BaseModel, Generic[T]):
    """Generic API response wrapper.
    
    A standardized response structure for all API endpoints that includes
    success status, response data, and error information when applicable.
    This model is used consistently across all API endpoints to provide
    a uniform interface for success and error handling.
    
    The generic type parameter T allows for strong typing of the response data
    based on the specific endpoint's return type.
    
    Attributes:
        success: Boolean indicating if the request was successful.
        data: Optional response data of generic type T when success is True.
        error: Optional error information when success is False.
        
    Example:
        # Success response with string data
        success_response = ApiResponse(success=True, data="Operation completed")
        
        # Error response
        error_response = ApiResponse(
            success=False,
            error=ApiError(code="NOT_FOUND", message="Resource not found")
        )
    """
    success: bool
    data: Optional[T] = None
    error: Optional[ApiError] = None