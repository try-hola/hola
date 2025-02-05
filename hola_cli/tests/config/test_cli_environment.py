"""
Tests for CLI-specific environment variable handling.
"""

import pytest
import os
from hola_shared.environment import Environment


def test_cli_specific_environment_variables(mock_environment):
    """Test that CLI-specific environment variables are properly handled."""
    # The mock_environment fixture sets up common test variables

    # Test CLI-specific environment variables
    assert Environment.get("OUTPUT_FORMAT") == "json"
    assert Environment.get("LOG_LEVEL") == "DEBUG"

    # Test environment variable overrides
    os.environ["HOLA_OUTPUT_FORMAT"] = "table"
    assert Environment.get("OUTPUT_FORMAT") == "table"
