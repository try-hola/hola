"""
Tests for shared environment loading utilities.
"""

import pytest
import os
from pathlib import Path
from unittest.mock import patch, mock_open
from hola_shared.environment import (
    load_env_file,
    validate_required_env,
    Environment,
    get_environment,
)


def test_load_env_file():
    """Test loading environment variables from a .env file."""
    # Mock file content
    mock_env_content = """
# This is a comment
HOLA_API_KEY=test-key
HOLA_HOST=0.0.0.0
HOLA_PORT=8000

# Another comment
HOLA_DEBUG=true
    """

    # Mock open to return our test content
    with patch("builtins.open", mock_open(read_data=mock_env_content)):
        with patch("pathlib.Path.exists", return_value=True):
            env_vars = load_env_file()

            # Check parsed variables
            assert env_vars["HOLA_API_KEY"] == "test-key"
            assert env_vars["HOLA_HOST"] == "0.0.0.0"
            assert env_vars["HOLA_PORT"] == "8000"
            assert env_vars["HOLA_DEBUG"] == "true"


def test_load_env_file_missing():
    """Test loading environment from a non-existent file."""
    with patch("pathlib.Path.exists", return_value=False):
        env_vars = load_env_file()
        assert env_vars == {}


def test_validate_required_env():
    """Test validation of required environment variables."""
    # Set up test environment
    with patch.dict(os.environ, {"HOLA_API_KEY": "test-key", "HOLA_PORT": "8000"}):
        # Should succeed when all required vars are present
        result = validate_required_env(["API_KEY", "PORT"])

        assert result == {"API_KEY": "test-key", "PORT": "8000"}

        # Should raise error when required var is missing
        with pytest.raises(ValueError) as excinfo:
            validate_required_env(["API_KEY", "PORT", "MISSING_VAR"])

        assert "HOLA_MISSING_VAR" in str(excinfo.value)


def test_get_environment():
    """Test that get_environment returns a cached Environment instance."""
    env1 = get_environment()
    env2 = get_environment()
    assert env1 is env2  # Should be the same instance due to @lru_cache


def test_environment_get_default():
    """Test getting environment variables with defaults."""
    # Set up test environment
    with patch.dict(os.environ, {"HOLA_SERVER": "test-server"}):
        # Test getting existing variable
        assert Environment.get("SERVER") == "test-server"

        # Test getting non-existent variable with default
        assert Environment.get("NON_EXISTENT", "default-value") == "default-value"

        # Test getting non-existent variable without default
        assert Environment.get("NON_EXISTENT") is None


def test_environment_get_bool():
    """Test getting boolean environment variables."""
    # Set various boolean formats to test
    with patch.dict(
        os.environ,
        {
            "HOLA_TRUE_1": "true",
            "HOLA_TRUE_2": "1",
            "HOLA_TRUE_3": "yes",
            "HOLA_TRUE_4": "y",
            "HOLA_TRUE_5": "t",
            "HOLA_FALSE_1": "false",
            "HOLA_FALSE_2": "0",
            "HOLA_FALSE_3": "no",
        },
    ):
        # Test true values
        assert Environment.get_bool("TRUE_1") is True
        assert Environment.get_bool("TRUE_2") is True
        assert Environment.get_bool("TRUE_3") is True
        assert Environment.get_bool("TRUE_4") is True
        assert Environment.get_bool("TRUE_5") is True

        # Test false values
        assert Environment.get_bool("FALSE_1") is False
        assert Environment.get_bool("FALSE_2") is False
        assert Environment.get_bool("FALSE_3") is False

        # Test default when variable doesn't exist
        assert Environment.get_bool("NON_EXISTENT", True) is True
        assert Environment.get_bool("NON_EXISTENT", False) is False


def test_environment_get_int():
    """Test getting integer environment variables."""
    # Set test integer variables
    with patch.dict(
        os.environ,
        {
            "HOLA_INT_POSITIVE": "42",
            "HOLA_INT_NEGATIVE": "-10",
            "HOLA_INT_ZERO": "0",
            "HOLA_INT_INVALID": "not-an-int",
        },
    ):
        # Test valid integers
        assert Environment.get_int("INT_POSITIVE") == 42
        assert Environment.get_int("INT_NEGATIVE") == -10
        assert Environment.get_int("INT_ZERO") == 0

        # Test invalid integer
        assert Environment.get_int("INT_INVALID", 999) == 999

        # Test default when variable doesn't exist
        assert Environment.get_int("NON_EXISTENT", 123) == 123
        assert Environment.get_int("NON_EXISTENT") is None
