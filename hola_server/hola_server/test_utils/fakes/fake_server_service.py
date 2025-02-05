"""Fake server service implementation for testing."""

from typing import Dict, List, Optional, Any
from datetime import datetime, timezone

from hola_shared.models.server import (
    ServerStatus,
    ServerState,
    HealthStatus,
    HealthCheckStatus,
    HealthCheckResult,
    VersionInfo,
    ResourceUsage,
)
from hola_server.utils.system_monitor import SystemMetrics


class FakeServerService:
    """Fake implementation of server service for testing.

    Provides predefined responses for server status, health checks, and resource usage.
    """

    def __init__(self, system_monitor: Optional[SystemMetrics] = None):
        """Initialize the fake server service."""
        self.method_calls: List[Dict[str, Any]] = []
        self._failure_modes: Dict[str, bool] = {}
        self.system_monitor = (
            system_monitor  # Store it, though not actively used by fake logic
        )

        # Default values
        self._server_state = ServerState.RUNNING
        self._server_start_time = datetime.now(timezone.utc)

        # Predefined responses
        self._server_status = None
        self._health_check = None
        self._version_info = None
        self._resource_usage = None

    def set_failure_mode(self, method_name: str, should_fail: bool = True):
        """Configure a method to fail when called.

        Args:
            method_name: Name of the method that should fail
            should_fail: Whether the method should fail (default: True)
        """
        self._failure_modes[method_name] = should_fail

    def set_server_state(self, state: ServerState):
        """Set the server state for responses.

        Args:
            state: Server state to return
        """
        self._server_state = state

    def set_start_time(self, start_time: datetime):
        """Set the server start time for responses.

        Args:
            start_time: Server start time
        """
        self._server_start_time = start_time

    def register_server_status(self, status: ServerStatus):
        """Register a predefined server status response.

        Args:
            status: Server status to return
        """
        self._server_status = status

    def register_health_check(self, health: HealthStatus):
        """Register a predefined health check response.

        Args:
            health: Health status to return
        """
        self._health_check = health

    def register_version_info(self, version: VersionInfo):
        """Register a predefined version info response.

        Args:
            version: Version info to return
        """
        self._version_info = version

    def register_resource_usage(self, resources: ResourceUsage):
        """Register a predefined resource usage response.

        Args:
            resources: Resource usage to return
        """
        self._resource_usage = resources

    def reset(self):
        """Reset the fake service state."""
        self.method_calls = []
        self._failure_modes = {}
        self._server_state = ServerState.RUNNING
        self._server_start_time = datetime.now(timezone.utc)
        self._server_status = None
        self._health_check = None
        self._version_info = None
        self._resource_usage = None

    async def get_server_status(self) -> ServerStatus:
        """Get server status information."""
        self.method_calls.append(
            {"method": "get_server_status", "timestamp": datetime.now(timezone.utc)}
        )

        if self._failure_modes.get("get_server_status", False):
            raise Exception("Simulated failure in get_server_status")

        if self._server_status:
            return self._server_status

        # Generate default health check if not provided
        if not self._health_check:
            health = await self.get_health_check()
        else:
            health = self._health_check

        # Generate default version info if not provided
        if not self._version_info:
            version = await self.get_version()
        else:
            version = self._version_info

        # Generate default resource usage if not provided
        if not self._resource_usage:
            resources = await self.get_resource_usage()
        else:
            resources = self._resource_usage

        now = datetime.now(timezone.utc)
        return ServerStatus(
            state=self._server_state,
            health=health,
            version=version,
            resources=resources,
            started_at=self._server_start_time,
            status_checked_at=now,
        )

    async def get_health_check(self) -> HealthStatus:
        """Run health checks on system components."""
        self.method_calls.append(
            {"method": "get_health_check", "timestamp": datetime.now(timezone.utc)}
        )

        if self._failure_modes.get("get_health_check", False):
            raise Exception("Simulated failure in get_health_check")

        if self._health_check:
            return self._health_check

        now = datetime.now(timezone.utc)
        healthy_check = HealthCheckResult(
            name="system",
            status=HealthCheckStatus.HEALTHY,
            message="System is healthy",
            duration_ms=10.5,
            checked_at=now,
        )

        database_check = HealthCheckResult(
            name="database",
            status=HealthCheckStatus.HEALTHY,
            message="Database connection established",
            duration_ms=25.2,
            checked_at=now,
        )

        fs_check = HealthCheckResult(
            name="filesystem",
            status=HealthCheckStatus.HEALTHY,
            message="File system is writable",
            duration_ms=15.7,
            checked_at=now,
        )

        return HealthStatus(
            status=HealthCheckStatus.HEALTHY,
            checks={
                "system": healthy_check,
                "database": database_check,
                "filesystem": fs_check,
            },
            checked_at=now,
        )

    async def get_version(self) -> VersionInfo:
        """Get server version information."""
        self.method_calls.append(
            {"method": "get_version", "timestamp": datetime.now(timezone.utc)}
        )

        if self._failure_modes.get("get_version", False):
            raise Exception("Simulated failure in get_version")

        if self._version_info:
            return self._version_info

        return VersionInfo(
            version="1.0.0",
            build_id="test-build-123",
            build_date=datetime.now(timezone.utc),
            git_commit="abcdef123456",
            python_version="3.11.0",
        )

    async def get_resource_usage(self) -> ResourceUsage:
        """Get server resource usage metrics."""
        self.method_calls.append(
            {"method": "get_resource_usage", "timestamp": datetime.now(timezone.utc)}
        )

        if self._failure_modes.get("get_resource_usage", False):
            raise Exception("Simulated failure in get_resource_usage")

        if self._resource_usage:
            return self._resource_usage

        now = datetime.now(timezone.utc)
        uptime = (now - self._server_start_time).total_seconds()

        return ResourceUsage(
            cpu_percent=25.5,
            memory_used_bytes=1024 * 1024 * 512,  # 512 MB
            memory_total_bytes=1024 * 1024 * 1024 * 8,  # 8 GB
            disk_used_bytes=1024 * 1024 * 1024 * 10,  # 10 GB
            disk_total_bytes=1024 * 1024 * 1024 * 100,  # 100 GB
            uptime_seconds=uptime,
            measured_at=now,
        )
