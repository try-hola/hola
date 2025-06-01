"""
Fakes package for the Hola server.

This package contains fake implementations used in tests to simulate real services and components.

Fakes in this package follow these principles:
1. Each fake implements the same interface as the real service or component.
2. Fakes provide in-memory behavior for testing purposes.
3. Fakes include state tracking and reset capabilities.
4. Fakes are isolated and stateless except for test-specific state.

Fakes:
    FakeSystemMonitor: Simulates system monitoring metrics.
    FakeServerService: Simulates server service operations.
"""

from .fake_system_monitor import FakeSystemMonitor
from .fake_server_service import FakeServerService

__all__ = [
    "FakeSystemMonitor",
    "FakeServerService",
]
