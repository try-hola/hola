"""Tests for server service."""

import pytest
from datetime import datetime, timezone, timedelta
from typing import Generator

from hola.shared.models import (
    ServerStatus,
    ServerState,
    HealthStatus,
    VersionInfo,
    ResourceUsage,
    HealthCheckStatus,
    HealthCheckResult,
)
from hola.services.server_service import ServerService
from hola.test_utils.fakes import FakeSystemMonitor, FakeServerService
from hola.config.context import ServerContext
from hola.config.settings import Settings


class TestServerService:
    """Test cases for ServerService."""

    @pytest.fixture
    def fake_system_monitor(self) -> Generator[FakeSystemMonitor, None, None]:
        """Create a FakeSystemMonitor instance for testing."""
        monitor = FakeSystemMonitor()
        yield monitor
        monitor.reset()

    @pytest.fixture
    def server_service(
        self, mock_context: ServerContext, fake_system_monitor: FakeSystemMonitor
    ) -> ServerService:
        """Create a ServerService instance with a fake system monitor."""
        return ServerService(context=mock_context, system_monitor=fake_system_monitor)

    @pytest.mark.asyncio
    async def test_get_server_status_overall(
        self,
        server_service: ServerService,
        fake_system_monitor: FakeSystemMonitor,
        mock_context: ServerContext,
    ):
        """Test getting server status, ensuring all components are correctly fetched."""
        fake_system_monitor.set_cpu_percent(10.0)
        fake_system_monitor.set_virtual_memory(
            percent=50.0, available_gb=4.0, total_gb=8.0
        )
        fake_system_monitor.set_disk_usage(percent=50.0, free_gb=50.0, total_gb=100.0)
        fake_boot_time = (datetime.now(timezone.utc) - timedelta(hours=1)).timestamp()
        fake_system_monitor.set_boot_time(fake_boot_time)

        mock_context.settings.APP_VERSION = "test-app-v1"
        mock_context.settings.BUILD_ID = "test-build-789"
        mock_context.settings.GIT_COMMIT = "testcommitabc"
        mock_context.settings.BUILD_DATE = datetime.now(timezone.utc) - timedelta(
            days=1
        )
        # Health check thresholds (ensure they are set on mock_context.settings for the service to use)
        mock_context.settings.HEALTH_CHECK_DISK_MIN_GB = 1.0
        mock_context.settings.HEALTH_CHECK_DISK_MIN_PERCENT = 5.0
        mock_context.settings.HEALTH_CHECK_MEM_MIN_GB = 0.5
        mock_context.settings.HEALTH_CHECK_MEM_MIN_PERCENT = 10.0

        status = await server_service.get_server_status()

        assert isinstance(status, ServerStatus)
        assert status.state == ServerState.RUNNING

        assert isinstance(status.health, HealthStatus)
        assert status.health.status == HealthCheckStatus.HEALTHY

        assert isinstance(status.version, VersionInfo)
        assert status.version.version == "test-app-v1"
        assert status.version.build_id == "test-build-789"
        assert status.version.git_commit == "testcommitabc"
        assert status.version.build_date == mock_context.settings.BUILD_DATE

        assert isinstance(status.resources, ResourceUsage)
        assert status.resources.cpu_percent == 10.0
        assert status.resources.uptime_seconds == pytest.approx(
            (datetime.now(timezone.utc).timestamp() - fake_boot_time), abs=1.5
        )  # Increased tolerance for boot time comparison

        assert isinstance(status.started_at, datetime)
        assert isinstance(status.status_checked_at, datetime)

    @pytest.mark.asyncio
    async def test_get_health_check_healthy(
        self,
        server_service: ServerService,
        fake_system_monitor: FakeSystemMonitor,
        mock_context: ServerContext,
    ):
        """Test getting health check when healthy."""
        mock_context.settings.HEALTH_CHECK_DISK_MIN_GB = 1.0
        mock_context.settings.HEALTH_CHECK_DISK_MIN_PERCENT = 5.0
        mock_context.settings.HEALTH_CHECK_MEM_MIN_GB = 0.5
        mock_context.settings.HEALTH_CHECK_MEM_MIN_PERCENT = 10.0

        fake_system_monitor.set_virtual_memory(
            percent=20.0, available_gb=6.0, total_gb=8.0
        )  # Well above thresholds
        fake_system_monitor.set_disk_usage(
            percent=30.0, free_gb=70.0, total_gb=100.0
        )  # Well above thresholds

        health = await server_service.get_health_check()

        assert health.status == HealthCheckStatus.HEALTHY
        assert health.checks["disk_space"].status == HealthCheckStatus.HEALTHY
        assert "Low disk space" not in (health.checks["disk_space"].message or "")
        assert health.checks["memory"].status == HealthCheckStatus.HEALTHY
        assert "Low memory" not in (health.checks["memory"].message or "")
        assert health.checks["config"].status == HealthCheckStatus.HEALTHY
        assert (
            health.checks["file_storage"].status == HealthCheckStatus.HEALTHY
        )  # Assumes data_dir is writable

    @pytest.mark.asyncio
    async def test_get_health_check_unhealthy_disk_low_gb(
        self,
        server_service: ServerService,
        fake_system_monitor: FakeSystemMonitor,
        mock_context: ServerContext,
    ):
        """Test getting health check with low disk space (GB threshold)."""
        mock_context.settings.HEALTH_CHECK_DISK_MIN_GB = 1.0
        mock_context.settings.HEALTH_CHECK_DISK_MIN_PERCENT = 5.0
        fake_system_monitor.set_disk_usage(
            percent=10.0, free_gb=0.5, total_gb=100.0
        )  # free_gb below 1.0 GB
        fake_system_monitor.set_virtual_memory(
            percent=50.0, available_gb=4.0, total_gb=8.0
        )

        health = await server_service.get_health_check()

        assert health.status == HealthCheckStatus.UNHEALTHY
        assert health.checks["disk_space"].status == HealthCheckStatus.UNHEALTHY
        assert "Low disk space" in (health.checks["disk_space"].message or "")
        assert health.checks["memory"].status == HealthCheckStatus.HEALTHY

    @pytest.mark.asyncio
    async def test_get_health_check_unhealthy_disk_low_percent(
        self,
        server_service: ServerService,
        fake_system_monitor: FakeSystemMonitor,
        mock_context: ServerContext,
    ):
        """Test getting health check with low disk space (percentage threshold)."""
        mock_context.settings.HEALTH_CHECK_DISK_MIN_GB = 1.0
        mock_context.settings.HEALTH_CHECK_DISK_MIN_PERCENT = 5.0  # e.g. 5%
        fake_system_monitor.set_disk_usage(
            percent=96.0, free_gb=4.0, total_gb=100.0
        )  # 4% free, below 5%
        fake_system_monitor.set_virtual_memory(
            percent=50.0, available_gb=4.0, total_gb=8.0
        )

        health = await server_service.get_health_check()

        assert health.status == HealthCheckStatus.UNHEALTHY
        assert health.checks["disk_space"].status == HealthCheckStatus.UNHEALTHY
        assert "Low disk space" in (health.checks["disk_space"].message or "")
        assert health.checks["memory"].status == HealthCheckStatus.HEALTHY

    @pytest.mark.asyncio
    async def test_get_health_check_unhealthy_memory_low_gb(
        self,
        server_service: ServerService,
        fake_system_monitor: FakeSystemMonitor,
        mock_context: ServerContext,
    ):
        """Test getting health check with low memory (GB threshold)."""
        mock_context.settings.HEALTH_CHECK_MEM_MIN_GB = 0.5
        mock_context.settings.HEALTH_CHECK_MEM_MIN_PERCENT = 10.0
        fake_system_monitor.set_virtual_memory(
            percent=50.0, available_gb=0.1, total_gb=8.0
        )  # available_gb below 0.5 GB
        fake_system_monitor.set_disk_usage(percent=50.0, free_gb=50.0, total_gb=100.0)

        health = await server_service.get_health_check()

        assert health.status == HealthCheckStatus.UNHEALTHY
        assert health.checks["memory"].status == HealthCheckStatus.UNHEALTHY
        assert "Low memory" in (health.checks["memory"].message or "")
        assert health.checks["disk_space"].status == HealthCheckStatus.HEALTHY

    @pytest.mark.asyncio
    async def test_get_health_check_unhealthy_memory_low_percent(
        self,
        server_service: ServerService,
        fake_system_monitor: FakeSystemMonitor,
        mock_context: ServerContext,
    ):
        """Test getting health check with low memory (percentage threshold)."""
        mock_context.settings.HEALTH_CHECK_MEM_MIN_GB = 0.5
        mock_context.settings.HEALTH_CHECK_MEM_MIN_PERCENT = 10.0  # e.g. 10%
        fake_system_monitor.set_virtual_memory(
            percent=95.0, available_gb=0.4, total_gb=8.0
        )  # 5% available, below 10%
        fake_system_monitor.set_disk_usage(percent=50.0, free_gb=50.0, total_gb=100.0)

        health = await server_service.get_health_check()

        assert health.status == HealthCheckStatus.UNHEALTHY
        assert health.checks["memory"].status == HealthCheckStatus.UNHEALTHY
        assert "Low memory" in (health.checks["memory"].message or "")
        assert health.checks["disk_space"].status == HealthCheckStatus.HEALTHY

    @pytest.mark.asyncio
    async def test_get_version(
        self, server_service: ServerService, mock_context: ServerContext
    ):
        """Test getting version information."""
        mock_context.settings.APP_VERSION = "0.1.0-test-version"
        mock_context.settings.BUILD_ID = "test-build-456"
        mock_context.settings.GIT_COMMIT = "testcommit456"
        mock_context.settings.BUILD_DATE = datetime(
            2023, 1, 1, 10, 0, 0, tzinfo=timezone.utc
        )

        version = await server_service.get_version()

        assert isinstance(version, VersionInfo)
        assert version.version == "0.1.0-test-version"
        assert version.build_id == "test-build-456"
        assert version.git_commit == "testcommit456"
        assert version.build_date == mock_context.settings.BUILD_DATE
        assert version.python_version is not None

    @pytest.mark.asyncio
    async def test_get_resource_usage(
        self,
        server_service: ServerService,
        fake_system_monitor: FakeSystemMonitor,
        mock_context: ServerContext,
    ):
        """Test getting resource usage."""
        fake_system_monitor.set_cpu_percent(25.5)
        fake_system_monitor.set_virtual_memory(
            percent=45.2, available_gb=4.0, total_gb=8.0
        )
        used_memory_gb = 8.0 - 4.0
        fake_system_monitor.set_disk_usage(percent=65.8, free_gb=100.5, total_gb=300.0)
        used_disk_gb = 300.0 - 100.5

        fake_boot_timestamp = (
            datetime.now(timezone.utc) - timedelta(hours=2, minutes=30)
        ).timestamp()
        fake_system_monitor.set_boot_time(fake_boot_timestamp)

        usage = await server_service.get_resource_usage()

        assert isinstance(usage, ResourceUsage)
        assert usage.cpu_percent == 25.5
        assert usage.memory_used_bytes == int(used_memory_gb * (1024**3))
        assert usage.memory_total_bytes == int(8.0 * (1024**3))
        assert usage.disk_used_bytes == int(used_disk_gb * (1024**3))
        assert usage.disk_total_bytes == int(300.0 * (1024**3))
        assert usage.uptime_seconds == pytest.approx(
            (datetime.now(timezone.utc).timestamp() - fake_boot_timestamp), abs=1.5
        )
        assert isinstance(usage.measured_at, datetime)


class TestFakeServerService:
    """Test cases for FakeServerService."""

    @pytest.fixture
    def fake_service(self) -> Generator[FakeServerService, None, None]:
        """Create a FakeServerService instance."""
        service = FakeServerService(system_monitor=FakeSystemMonitor())
        yield service
        service.reset()

    @pytest.mark.asyncio
    async def test_get_server_status(self, fake_service: FakeServerService):
        """Test fake server status."""
        fake_health = HealthStatus(
            status=HealthCheckStatus.HEALTHY,
            checks={},
            checked_at=datetime.now(timezone.utc),
        )
        fake_version = VersionInfo(
            version="fake",
            build_id="fake",
            build_date=datetime.now(timezone.utc),
            git_commit="fake",
            python_version="3.x",
        )
        fake_resources = ResourceUsage(
            cpu_percent=10,
            memory_used_bytes=100,
            memory_total_bytes=1000,
            disk_used_bytes=100,
            disk_total_bytes=1000,
            uptime_seconds=3600,
            measured_at=datetime.now(timezone.utc),
        )

        fake_service.register_health_check(fake_health)
        fake_service.register_version_info(fake_version)
        fake_service.register_resource_usage(fake_resources)

        status = await fake_service.get_server_status()

        assert isinstance(status, ServerStatus)
        assert status.state == ServerState.RUNNING
        assert len(fake_service.method_calls) == 1
        assert fake_service.method_calls[0]["method"] == "get_server_status"

    @pytest.mark.asyncio
    async def test_get_health_check(self, fake_service: FakeServerService):
        """Test fake health status using get_health_check."""
        health = await fake_service.get_health_check()
        assert health.status == HealthCheckStatus.HEALTHY
        assert all(
            check.status == HealthCheckStatus.HEALTHY
            for check in health.checks.values()
        )
        assert len(fake_service.method_calls) == 1
        assert fake_service.method_calls[0]["method"] == "get_health_check"

    @pytest.mark.asyncio
    async def test_register_health_check_issue(self, fake_service: FakeServerService):
        """Test setting health issues on the fake service via register_health_check."""
        now = datetime.now(timezone.utc)
        unhealthy_disk_check = HealthCheckResult(
            name="disk_space",
            status=HealthCheckStatus.UNHEALTHY,
            message="Disk almost full",
            duration_ms=10.0,
            checked_at=now,
        )
        custom_health = HealthStatus(
            status=HealthCheckStatus.UNHEALTHY,
            checks={"disk_space": unhealthy_disk_check},
            checked_at=now,
        )
        fake_service.register_health_check(custom_health)

        health = await fake_service.get_health_check()
        assert health.status == HealthCheckStatus.UNHEALTHY
        assert health.checks["disk_space"].status == HealthCheckStatus.UNHEALTHY
        assert health.checks["disk_space"].message == "Disk almost full"

    @pytest.mark.asyncio
    async def test_set_server_state(self, fake_service: FakeServerService):
        """Test setting server state on the fake service."""
        fake_service.set_server_state(ServerState.STOPPED)

        fake_health = await fake_service.get_health_check()
        fake_version = await fake_service.get_version()
        fake_resources = await fake_service.get_resource_usage()
        fake_service.method_calls.clear()

        fake_service.register_health_check(fake_health)
        fake_service.register_version_info(fake_version)
        fake_service.register_resource_usage(fake_resources)

        status_response = await fake_service.get_server_status()
        assert status_response.state == ServerState.STOPPED

    @pytest.mark.asyncio
    async def test_reset(self, fake_service: FakeServerService):
        """Test resetting fake service."""
        fake_service.set_server_state(ServerState.STOPPED)

        now = datetime.now(timezone.utc)
        degraded_memory_check = HealthCheckResult(
            name="memory",
            status=HealthCheckStatus.DEGRADED,
            message="Memory usage high",
            duration_ms=5.0,
            checked_at=now,
        )
        custom_health_degraded = HealthStatus(
            status=HealthCheckStatus.DEGRADED,
            checks={"memory": degraded_memory_check},
            checked_at=now,
        )
        fake_service.register_health_check(custom_health_degraded)
        fake_service.method_calls.clear()

        fake_service.reset()

        assert fake_service._server_state == ServerState.RUNNING

        default_health_after_reset = await fake_service.get_health_check()
        assert default_health_after_reset.status == HealthCheckStatus.HEALTHY

        assert len(fake_service.method_calls) == 1
        assert fake_service.method_calls[0]["method"] == "get_health_check"
