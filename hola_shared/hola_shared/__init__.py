"""Hola shared package.

This package contains common models and utilities that are shared 
across server and client components, ensuring consistent data structures
and behavior throughout the application.

Package Contents:
    - models: Shared Pydantic data models for API requests/responses
    - errors: Common error handling utilities and exception classes

This package is designed to be used as a dependency in both the
hola_server and hola_cli packages through Poetry workspaces.
"""

__version__ = "0.1.0"