"""
Test server context functionality with environment variables.
"""

import os
import pytest
from unittest.mock import patch

from hola_cli.config.context import ServerContext, get_current_server
from hola_cli.config.settings import CliSettings
from hola_shared.errors import ConfigurationException


def test_get_current_server_from_environment(mock_environment):
    """Test getting server context from environment variables."""
    # Test with environment variables set by the fixture
    context = get_current_server()

    # When HOLA_SERVER_URL and HOLA_API_KEY are set in environment,
    # they should take precedence over settings file values
    assert context.url == "http://test-url"
    assert context.api_key == "test-env-key"
    assert context.name == "test-server"  # Name should match HOLA_SERVER


def test_get_current_server_environment_override(mock_environment, fake_settings):
    """Test environment variables override settings file values."""
    with patch("hola_cli.config.context.load_settings", return_value=fake_settings):
        # Even though settings has a server called "test", environment variables should take precedence
        context = get_current_server()

        assert context.url == "http://test-url"  # From HOLA_SERVER_URL
        assert context.api_key == "test-env-key"  # From HOLA_API_KEY

        # Now remove environment variable and check if it falls back to settings
        del os.environ["HOLA_SERVER"]
        del os.environ["HOLA_SERVER_URL"]
        del os.environ["HOLA_API_KEY"]

        # Now it should use settings
        context = get_current_server()
        assert context.url == "http://test"  # From settings
        assert context.api_key == "test-key"  # From settings
        assert context.name == "test"  # From settings


def test_get_current_server_explicit_name_override(mock_environment):
    """Test that explicitly provided server name takes precedence over environment."""
    # When server_name is explicitly provided, it should override HOLA_SERVER
    # But still use HOLA_SERVER_URL and HOLA_API_KEY if available

    # Mock settings to include both test-server and explicit-server
    settings = {
        "servers": {
            "test-server": {
                "url": "http://test-server-url",
                "api_key": "test-server-key",
            },
            "explicit-server": {
                "url": "http://explicit-url",
                "api_key": "explicit-key",
            },
        },
        "default_server": "test-server",
    }

    with patch(
        "hola_cli.config.context.load_settings",
        return_value=CliSettings.model_validate(settings),
    ):
        # Provide explicit server name
        context = get_current_server("explicit-server")

        # Should use explicit server name, but URL and API key from environment
        assert context.name == "explicit-server"
        assert context.url == "http://test-url"  # From HOLA_SERVER_URL
        assert context.api_key == "test-env-key"  # From HOLA_API_KEY

        # Remove environment URL and API key
        del os.environ["HOLA_SERVER_URL"]
        del os.environ["HOLA_API_KEY"]

        # Now it should use the explicit server's URL and API key
        context = get_current_server("explicit-server")
        assert context.name == "explicit-server"
        assert context.url == "http://explicit-url"
        assert context.api_key == "explicit-key"
