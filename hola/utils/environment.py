"""Environment variable support for Hola components.

This module provides utilities for accessing and validating environment
variables across the Hola application, with consistent handling of prefixes,
defaults, and type conversions.

It includes:
    - Loading environment variables from .env files
    - Validating required environment variables
    - Environment class for typed access to environment variables

By default, all environment variables are expected to have the 'HOLA_' prefix,
which is automatically added when accessing variables through the Environment class.

Examples:
    # Access a string environment variable with default
    api_key = Environment.get("API_KEY", "default-key")

    # Access a boolean environment variable
    debug_mode = Environment.get_bool("DEBUG", False)

    # Access a list of values from a comma-separated environment variable
    allowed_origins = Environment.get_list("ALLOWED_ORIGINS")
"""

import os
from pathlib import Path
from typing import Optional, Dict, Any, TypeVar, List, Type, cast, Union
from functools import lru_cache

T = TypeVar("T")


def load_env_file(path: Optional[str] = None) -> Dict[str, str]:
    """Load environment variables from a .env file.

    Parses a .env file and returns the key-value pairs as a dictionary.
    Lines starting with # are treated as comments and ignored.
    Empty lines are ignored.

    Args:
        path: Optional path to a .env file. If not provided,
              looks in the current directory for a .env file.

    Returns:
        Dictionary of environment variables loaded from the file.
        Returns an empty dictionary if the file doesn't exist.
    """
    env_path = Path(path) if path else Path(".env")

    if not env_path.exists():
        return {}

    result = {}
    with open(env_path, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue

            key, value = line.split("=", 1)
            result[key.strip()] = value.strip()

    return result


def validate_required_env(required_vars: list[str]) -> Dict[str, str]:
    """Validate that required environment variables are set.

    Checks that all specified environment variables are set and returns
    their values as a dictionary. The function automatically adds the 'HOLA_'
    prefix when checking the variables.

    Args:
        required_vars: List of required environment variable names without the HOLA_ prefix

    Returns:
        Dictionary mapping variable names (without prefix) to their values

    Raises:
        ValueError: If any required environment variable is missing, with a
                   message listing all missing variables
    """
    missing = []
    variables = {}

    for var in required_vars:
        value = Environment.get(var)
        if value is None:
            missing.append(f"HOLA_{var}")
        else:
            variables[var] = value

    if missing:
        raise ValueError(
            f"Missing required environment variables: {', '.join(missing)}"
        )

    return variables


class Environment:
    """Helper class for accessing environment variables with defaults.

    This class provides a set of static methods for accessing environment
    variables with proper typing, prefixing, and default values. All methods
    automatically prefix the variable name with 'HOLA_' and handle any necessary
    type conversions.
    """

    @staticmethod
    def get(key: str, default: Optional[str] = None) -> Optional[str]:
        """Get environment variable with optional default.

        Args:
            key: The environment variable name (without 'HOLA_' prefix)
            default: Value to return if the environment variable is not set

        Returns:
            The environment variable value, or the default if not set
        """
        return os.environ.get(f"HOLA_{key.upper()}", default)

    @staticmethod
    def get_bool(key: str, default: bool = False) -> bool:
        """Get boolean environment variable.

        Converts the environment variable value to a boolean using common
        string representations of true/false values.

        Args:
            key: The environment variable name (without 'HOLA_' prefix)
            default: Value to return if the environment variable is not set

        Returns:
            True if the value is one of "true", "1", "yes", "y", "t" (case insensitive),
            False otherwise or if not set and default is False
        """
        value = Environment.get(key)
        if value is None:
            return default
        return value.lower() in ("true", "1", "yes", "y", "t")

    @staticmethod
    def get_int(key: str, default: Optional[int] = None) -> Optional[int]:
        """Get integer environment variable.

        Converts the environment variable value to an integer.

        Args:
            key: The environment variable name (without 'HOLA_' prefix)
            default: Value to return if the environment variable is not set or not a valid integer

        Returns:
            The environment variable as an integer, or the default if not set or not a valid integer
        """
        value = Environment.get(key)
        if value is None:
            return default
        try:
            return int(value)
        except ValueError:
            return default

    @staticmethod
    def get_list(
        key: str, default: Optional[List[str]] = None, delimiter: str = ","
    ) -> List[str]:
        """Get a list from a delimited environment variable.

        Splits the environment variable value using the specified delimiter
        and returns the result as a list of strings.

        Args:
            key: The environment variable name (without 'HOLA_' prefix)
            default: Value to return if the environment variable is not set
            delimiter: The delimiter to split the value (defaults to comma)

        Returns:
            A list of trimmed non-empty strings from the split environment variable,
            or the default list if the variable is not set
        """
        value = Environment.get(key)
        if value is None:
            return default or []
        return [item.strip() for item in value.split(delimiter) if item.strip()]


@lru_cache()
def get_environment() -> Environment:
    """Return cached environment instance."""
    return Environment()
