"""Hola Server package - FastAPI-based backend server for the Hola application management system.

The Hola Server provides a REST API for managing application instances across
different container providers like Docker Desktop and OrbStack. It handles
authentication, API request processing, and communicates with container
runtime environments.

Package Structure:
- api: API route modules for different feature areas
- auth: Authentication and authorization functionality
- config: Server configuration and context management
- providers: Provider implementations for container platforms
- utils: Server-specific utility functions and helpers

The server follows a modular architecture with clear separation of concerns
between API endpoints, business logic, and provider implementations. It uses
FastAPI for efficient, type-safe API development with automatic OpenAPI documentation.
"""
