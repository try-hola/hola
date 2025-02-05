"""Registry for server providers.

This module implements a registry for server providers, allowing dynamic
registration and discovery of provider implementations in the CLI.
"""

from typing import Dict, List, Optional
import logging
from hola_shared.providers.base import ServerProvider

logger = logging.getLogger(__name__)


class ServerProviderRegistry:
    """Registry for available server providers.

    This class maintains a registry of server providers and provides methods
    to discover, register, and retrieve provider implementations.

    The registry is responsible for:
    1. Maintaining a collection of available providers
    2. Allowing registration of new providers at runtime
    3. Providing access to providers based on type or availability
    """

    def __init__(self):
        """Initialize an empty provider registry."""
        self.providers: Dict[str, ServerProvider] = {}
        logger.debug("Initialized ServerProviderRegistry")

    def register_provider(self, provider: ServerProvider) -> None:
        """
        Register a provider with the registry.

        Args:
            provider: Server provider implementation
        """
        logger.info(f"Registering provider: {provider.type} ({provider.display_name})")
        self.providers[provider.type] = provider

    async def get_available_providers(self) -> List[ServerProvider]:
        """
        Get all providers that are available on the current system.

        Checks each registered provider to determine if it's available
        on the current system by calling its is_available() method.

        Returns:
            List of available provider implementations
        """
        logger.debug("Finding available providers")
        available_providers = []

        for provider in self.providers.values():
            try:
                if await provider.is_available():
                    logger.debug(f"Provider {provider.type} is available")
                    available_providers.append(provider)
                else:
                    logger.debug(f"Provider {provider.type} is not available")
            except Exception as e:
                logger.error(
                    f"Error checking availability of provider {provider.type}: {str(e)}"
                )

        return available_providers

    def get_provider(self, provider_type: str) -> Optional[ServerProvider]:
        """
        Get a specific provider by type.

        Args:
            provider_type: Provider type identifier

        Returns:
            Provider implementation or None if not found
        """
        provider = self.providers.get(provider_type)
        if not provider:
            logger.warning(f"Provider {provider_type} not found in registry")
        return provider

    def list_registered_providers(self) -> List[Dict[str, str]]:
        """
        List all registered providers with their basic information.

        Returns:
            List of dictionaries containing provider type and display name
        """
        return [
            {"type": provider.type, "display_name": provider.display_name}
            for provider in self.providers.values()
        ]
