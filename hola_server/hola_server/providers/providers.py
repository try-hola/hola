"""Provider management module.

This module provides functions and classes for managing provider implementations
in the Hola Server. It serves as the main entry point for accessing provider
functionality throughout the application.

The module includes:
- Provider registry management
- Provider type discovery
- Provider instance resolution
- Provider capability interrogation
"""

from typing import Dict, List, Optional
from functools import lru_cache

# Placeholder function implementations
@lru_cache()
def get_provider_registry():
    """
    Get the provider registry instance.
    
    Returns:
        A cached instance of the provider registry
    """
    # Will be implemented in future phase
    return {}


def get_available_provider_types() -> List[str]:
    """
    Get a list of available provider type identifiers.
    
    Returns:
        List of provider type strings (e.g., "docker-desktop", "orbstack")
    """
    # Will be implemented in future phase
    return ["docker-desktop", "orbstack"]