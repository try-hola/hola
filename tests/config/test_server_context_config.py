"""
Tests for the server context functionality.
"""

import pytest
from hola.config.context import ServerContext, get_context
from hola.config.settings import Settings


def test_server_context_initialization():
    """Test basic ServerContext initialization."""
    # Create context with default settings
    context = ServerContext()
    assert context.settings is not None

    # Create context with custom settings
    custom_settings = Settings(host="custom-host", port=1234)
    context = ServerContext(settings=custom_settings)
    assert context.settings.host == "custom-host"
    assert context.settings.port == 1234


def test_get_context_cached():
    """Test that get_context returns a cached instance."""
    # Multiple calls should return the same instance
    context1 = get_context()
    context2 = get_context()
    assert context1 is context2

    # Clear cache to get a fresh instance
    from functools import lru_cache

    get_context.cache_clear()

    context3 = get_context()
    assert context1 is not context3
