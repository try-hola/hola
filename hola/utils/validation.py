"""Validation utilities for Hola.

This module provides input validation functions and utilities
for both API and web interface inputs.
"""

import re
from typing import Optional, List, Dict, Any
from hola.models.errors import ValidationException

def validate_app_name(name: str) -> str:
    """Validate application name.
    
    Args:
        name: Application name to validate
        
    Returns:
        Validated name
        
    Raises:
        ValidationException: If name is invalid
    """
    if not name:
        raise ValidationException("Application name is required")
    
    if len(name) < 1 or len(name) > 100:
        raise ValidationException("Application name must be between 1 and 100 characters")
    
    # Allow alphanumeric, hyphens, underscores
    if not re.match(r'^[a-zA-Z0-9_-]+$', name):
        raise ValidationException(
            "Application name can only contain letters, numbers, hyphens, and underscores"
        )
    
    return name.lower()

def validate_package_ref(package_ref: str) -> str:
    """Validate ORAS package reference.
    
    Args:
        package_ref: Package reference to validate
        
    Returns:
        Validated package reference
        
    Raises:
        ValidationException: If package reference is invalid
    """
    if not package_ref:
        raise ValidationException("Package reference is required")
    
    # Basic validation for OCI reference format
    # Format: registry/namespace/name:tag
    if not re.match(r'^[a-zA-Z0-9._-]+(/[a-zA-Z0-9._-]+)*:[a-zA-Z0-9._-]+$', package_ref):
        raise ValidationException(
            "Invalid package reference format. Expected format: registry/namespace/name:tag"
        )
    
    return package_ref

def validate_environment_variables(env_vars: Dict[str, str]) -> Dict[str, str]:
    """Validate environment variables.
    
    Args:
        env_vars: Dictionary of environment variables
        
    Returns:
        Validated environment variables
        
    Raises:
        ValidationException: If any environment variable is invalid
    """
    validated = {}
    
    for key, value in env_vars.items():
        # Validate key
        if not key:
            raise ValidationException("Environment variable key cannot be empty")
        
        if not re.match(r'^[A-Z][A-Z0-9_]*$', key):
            raise ValidationException(
                f"Invalid environment variable key '{key}'. "
                "Keys must start with a letter and contain only uppercase letters, numbers, and underscores"
            )
        
        # Validate value (allow any string value)
        if not isinstance(value, str):
            raise ValidationException(f"Environment variable value for '{key}' must be a string")
        
        validated[key] = value
    
    return validated

def validate_port(port: Optional[int]) -> Optional[int]:
    """Validate port number.
    
    Args:
        port: Port number to validate
        
    Returns:
        Validated port number
        
    Raises:
        ValidationException: If port is invalid
    """
    if port is None:
        return None
    
    if not isinstance(port, int) or port < 1 or port > 65535:
        raise ValidationException("Port must be an integer between 1 and 65535")
    
    return port

def sanitize_filename(filename: str) -> str:
    """Sanitize filename for safe file system operations.
    
    Args:
        filename: Filename to sanitize
        
    Returns:
        Sanitized filename
    """
    # Remove or replace dangerous characters
    sanitized = re.sub(r'[^\w\-_\.]', '_', filename)
    
    # Remove leading/trailing dots and spaces
    sanitized = sanitized.strip('. ')
    
    # Ensure it's not empty
    if not sanitized:
        sanitized = "unnamed_file"
    
    return sanitized
