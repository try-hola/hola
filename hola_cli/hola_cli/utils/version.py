"""Version utility functions for Hola CLI."""

import importlib.metadata
from functools import lru_cache


@lru_cache()
def get_cli_version() -> str:
    """Return the CLI version from package metadata."""
    try:
        return importlib.metadata.version("hola_cli")
    except importlib.metadata.PackageNotFoundError:
        return "0.1.0-dev"  # Default during development
