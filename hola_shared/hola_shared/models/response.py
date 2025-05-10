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
    human-readable message, and optional detailed information.
    
    Attributes:
        code: A string error code that identifies the error type.
        message: A human-readable error message describing the issue.
        details: Optional additional context information about the error.
    """
    code: str
    message: str
    details: Optional[Dict[str, Any]] = None

class ApiResponse(BaseModel, Generic[T]):
    """Generic API response wrapper.
    
    A standardized response structure for all API endpoints that includes
    success status, response data, and error information when applicable.
    
    Attributes:
        success: Boolean indicating if the request was successful.
        data: Optional response data of generic type T when success is True.
        error: Optional error information when success is False.
    """
    success: bool
    data: Optional[T] = None
    error: Optional[ApiError] = None