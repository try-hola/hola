import pytest
from hola_cli.test_utils.fakes.provider_registry import (
    FakeProviderRegistry,
    FakeProvider,
)


def test_fake_provider_registry_initialization():
    registry = FakeProviderRegistry()
    assert not registry.providers


def test_fake_provider_registry_register_and_get_provider():
    registry = FakeProviderRegistry()
    provider_orb = FakeProvider(provider_type="orbstack", name="fake-orb")
    registry.register_provider("orbstack", provider_orb)

    assert len(registry.providers) == 1
    retrieved_provider = registry.get_provider("orbstack")
    assert retrieved_provider == provider_orb
    assert retrieved_provider.name == "fake-orb"

    # Test case insensitivity for provider type
    assert registry.get_provider("OrbStack") == provider_orb


def test_fake_provider_registry_get_non_existent_provider():
    registry = FakeProviderRegistry()
    assert registry.get_provider("nonexistent") is None


def test_fake_provider_registry_list_providers():
    registry = FakeProviderRegistry()
    registry.register_provider("orbstack", FakeProvider(provider_type="orbstack"))
    registry.register_provider("docker", FakeProvider(provider_type="docker"))

    provider_types = registry.list_providers()
    assert len(provider_types) == 2
    assert "orbstack" in provider_types
    assert "docker" in provider_types


def test_fake_provider_registry_reset():
    registry = FakeProviderRegistry()
    registry.register_provider("orbstack", FakeProvider(provider_type="orbstack"))
    registry.reset()
    assert not registry.providers
    assert not registry.list_providers()


def test_fake_provider_registry_add_fake_provider_helper():
    registry = FakeProviderRegistry()
    provider = registry.add_fake_provider("custom_type", name="my-custom-provider")

    assert isinstance(provider, FakeProvider)
    assert provider.provider_type == "custom_type"
    assert provider.name == "my-custom-provider"

    retrieved = registry.get_provider("custom_type")
    assert retrieved == provider

    # Test default naming
    provider_default_name = registry.add_fake_provider("another_type")
    assert provider_default_name.name == "fake-another_type-provider"


def test_fake_provider_registry_get_available_providers():
    registry = FakeProviderRegistry()

    provider_orb = registry.add_fake_provider("orbstack")
    provider_doc = registry.add_fake_provider("docker")
    provider_unavailable = registry.add_fake_provider("unavailable_test")

    # Mock one provider as unavailable
    provider_unavailable.is_available = lambda: False
    # Ensure the lambda is correctly assigned and callable
    # For FakeProvider, we might need to adjust how is_available is mocked or make it a property
    # For this test, let's assume we can patch its is_available method or instance variable if it were one.
    # If FakeProvider.is_available is a method:
    # from unittest.mock import Mock
    # provider_unavailable.is_available = Mock(return_value=False)
    # For simplicity, let's assume we can directly modify a flag or re-assign the method for the fake.

    # Re-create provider_unavailable with a modified is_available for this test
    class TestUnavailableProvider(FakeProvider):
        def is_available(self) -> bool:
            super().is_available()  # Call parent to track is_available_called
            return False

    registry.providers["unavailable_test"] = TestUnavailableProvider(
        provider_type="unavailable_test"
    )

    available_providers = registry.get_available_providers()

    assert len(available_providers) == 2
    assert provider_orb in available_providers
    assert provider_doc in available_providers
    assert registry.providers["unavailable_test"] not in available_providers

    # Check that is_available was called on all of them
    assert provider_orb.is_available_called
    assert provider_doc.is_available_called
    assert registry.providers["unavailable_test"].is_available_called


# Tests for FakeProvider itself
def test_fake_provider_default_behavior():
    provider = FakeProvider(provider_type="test_type", name="test_provider")
    assert provider.provider_type == "test_type"
    assert provider.name == "test_provider"

    assert provider.is_available() is True
    assert provider.is_available_called is True

    server_config = {"server_name": "my-test-server"}
    created_info = provider.create_server(server_config)
    assert provider.create_called_with == server_config
    assert created_info["name"] == "my-test-server"
    assert created_info["provider_type"] == "test_type"

    provider.delete_server("server-id-123")
    assert provider.delete_called_with == "server-id-123"

    provider.start_server("server-id-123")
    assert provider.start_called_with == "server-id-123"

    provider.stop_server("server-id-123")
    assert provider.stop_called_with == "server-id-123"

    info = provider.get_server_instance_info("server-id-123")
    assert provider.get_instance_info_called_with == "server-id-123"
    assert info["id"] == "server-id-123"

    instances = provider.list_server_instances()
    assert provider.list_instances_called is True
    assert instances == []
