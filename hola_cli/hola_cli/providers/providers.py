"""Provider initialization and management.

This module provides functions for initializing and accessing the server
provider registry and available providers.
"""

import logging
from functools import lru_cache
from .registry import ServerProviderRegistry
from .orbstack_updated import OrbStackProvider
from .docker_desktop_updated import DockerDesktopProvider

logger = logging.getLogger(__name__)


@lru_cache()
def get_provider_registry() -> ServerProviderRegistry:
    """
    Get the server provider registry, initializing it if necessary.

    This function serves as the primary access point for obtaining the provider
    registry throughout the CLI application. It is decorated with @lru_cache to
    ensure that only a single registry instance is created and shared across
    the application, preventing duplicate initialization.

    The function automatically registers all built-in providers (OrbStack and
    Docker Desktop) with the registry. Additional providers can be registered
    after obtaining the registry instance if needed.

    Returns:
        ServerProviderRegistry: The initialized server provider registry with
            all built-in providers registered
    """
    logger.debug("Initializing server provider registry")
    registry = ServerProviderRegistry()

    # Register built-in providers
    registry.register_provider(OrbStackProvider())
    registry.register_provider(DockerDesktopProvider())

    return registry


async def get_available_provider_types() -> list[str]:
    """
    Get a list of available provider types.

    This function checks which providers are available on the current system.

    Returns:
        List of provider types available on the current system
    """
    registry = get_provider_registry()
    available_providers = await registry.get_available_providers()
    return [provider.type for provider in available_providers]
