"""Directory for fake implementations used in tests."""

# This file makes Python treat the directory fakes as a sub-package.
from .fake_system_monitor import FakeSystemMonitor
from .fake_server_service import FakeServerService

__all__ = ["FakeSystemMonitor", "FakeServerService"]
