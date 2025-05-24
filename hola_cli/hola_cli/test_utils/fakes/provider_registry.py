
from typing import Dict, Any, List, Optional

# Assuming FakeProvider is defined elsewhere or we define a base here
# For now, let's assume Any for provider type for flexibility
# from hola_cli.providers.providers import Provider  # Example if you have a base Provider interface

class FakeProvider:
    """A generic fake provider for testing purposes."""
    def __init__(self, provider_type: str, name: str = "fake-provider"):
        self.provider_type = provider_type
        self.name = name
        self.is_available_called = False
        self.create_called_with: Optional[Dict[str, Any]] = None
        self.delete_called_with: Optional[str] = None
        self.start_called_with: Optional[str] = None
        self.stop_called_with: Optional[str] = None
        self.get_instance_info_called_with: Optional[str] = None
        self.list_instances_called = False

    def is_available(self) -> bool:
        self.is_available_called = True
        return True # Default to available

    def create_server(self, config: Dict[str, Any]) -> Dict[str, Any]:
        self.create_called_with = config
        # Return a mock server instance info
        return {"id": f"{self.provider_type}-server-123", "name": config.get("server_name", "test-server"), "status": "running", "provider_type": self.provider_type}

    def delete_server(self, server_id: str) -> None:
        self.delete_called_with = server_id
        return

    def start_server(self, server_id: str) -> None:
        self.start_called_with = server_id
        return

    def stop_server(self, server_id: str) -> None:
        self.stop_called_with = server_id
        return

    def get_server_instance_info(self, server_id: str) -> Optional[Dict[str, Any]]:
        self.get_instance_info_called_with = server_id
        # Return a mock server instance info if needed for tests
        return {"id": server_id, "name": "test-server", "status": "running", "provider_type": self.provider_type}

    def list_server_instances(self) -> List[Dict[str, Any]]:
        self.list_instances_called = True
        return [] # Default to no instances

class FakeProviderRegistry:
    """A fake provider registry for managing fake providers in tests."""
    def __init__(self):
        self.providers: Dict[str, FakeProvider] = {}

    def register_provider(self, provider_type: str, provider: FakeProvider) -> None:
        """Register a provider for a specific type."""
        self.providers[provider_type.lower()] = provider

    def get_provider(self, provider_type: str) -> Optional[FakeProvider]:
        """Get a provider by type. Returns None if not found."""
        return self.providers.get(provider_type.lower())

    def list_providers(self) -> List[str]:
        """List all registered provider types."""
        return list(self.providers.keys())
    
    def get_available_providers(self) -> List[FakeProvider]:
        """Simulates returning a list of available providers."""
        # In a real scenario, this would check provider.is_available()
        return [p for p in self.providers.values() if p.is_available()]

    def reset(self) -> None:
        """Clear all registered providers."""
        self.providers = {}

    # Helper to quickly add a generic FakeProvider
    def add_fake_provider(self, provider_type: str, name: Optional[str] = None) -> FakeProvider:
        provider = FakeProvider(provider_type=provider_type, name=name or f"fake-{provider_type}-provider")
        self.register_provider(provider_type, provider)
        return provider
