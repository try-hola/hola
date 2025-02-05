"""Server status and health management service.

This module provides business logic for server status monitoring, health checks,
and resource usage tracking.
"""

import platform
import sys
import psutil
from pathlib import Path
from typing import Dict, Any
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
from hola_shared.errors import ServiceException
from hola_shared.logger import get_logger
from ..config.context import ServerContext
from ..utils.system_monitor import SystemMetrics, PsutilSystemMonitor

logger = get_logger(__name__)


class ServerService:
    """Service for managing server status and health.

    Provides business logic for server status monitoring, health checks,
    and resource usage tracking.
    """

    def __init__(
        self, context: ServerContext, system_monitor: SystemMetrics | None = None
    ):
        """Initialize the server service.

        Args:
            context: Server context containing settings and dependencies
            system_monitor: Optional system metrics provider for dependency injection
        """
        self.context = context
        self.settings = context.settings
        self.system_monitor = system_monitor or PsutilSystemMonitor()
        self._start_time = datetime.now(timezone.utc)

        logger.debug("ServerService initialized")

    async def get_server_status(self) -> ServerStatus:
        """Get complete server status information.

        Returns:
            ServerStatus with health, version, and resource information
        """
        try:
            logger.debug("Getting server status")

            health = await self.get_health_check()
            version = await self.get_version()
            resources = await self.get_resource_usage()

            status = ServerStatus(
                state=ServerState.RUNNING,
                health=health,
                version=version,
                resources=resources,
                started_at=self._start_time,
                status_checked_at=datetime.now(timezone.utc),
            )

            logger.debug("Server status retrieved successfully")
            return status

        except Exception as e:
            logger.error(f"Failed to get server status: {str(e)}")
            raise ServiceException(
                message=f"Failed to get server status: {str(e)}",
                service_name="server_service",
            )

    async def get_health_check(self) -> HealthStatus:
        """Run health checks on server components.

        Returns:
            HealthStatus with individual component health results
        """
        try:
            logger.debug("Running server health checks")

            check_time = datetime.now(timezone.utc)
            checks = {}
            overall_status = HealthCheckStatus.HEALTHY

            # Check disk space
            disk_check = await self._check_disk_space()
            checks["disk_space"] = disk_check
            if disk_check.status != HealthCheckStatus.HEALTHY:
                overall_status = HealthCheckStatus.UNHEALTHY

            # Check memory usage
            memory_check = await self._check_memory_usage()
            checks["memory"] = memory_check
            if memory_check.status != HealthCheckStatus.HEALTHY:
                overall_status = HealthCheckStatus.UNHEALTHY

            # Check configuration service
            config_check = await self._check_config_service()
            checks["config"] = config_check
            if config_check.status != HealthCheckStatus.HEALTHY:
                overall_status = HealthCheckStatus.UNHEALTHY

            # Check file storage service
            file_storage_check = await self._check_file_storage()
            checks["file_storage"] = file_storage_check
            if file_storage_check.status != HealthCheckStatus.HEALTHY:
                overall_status = HealthCheckStatus.UNHEALTHY

            health_status = HealthStatus(
                status=overall_status, checks=checks, checked_at=check_time
            )

            logger.debug(f"Health check completed with status: {overall_status}")
            return health_status

        except Exception as e:
            logger.error(f"Health check failed: {str(e)}")
            # Return unhealthy status if health check itself fails
            return HealthStatus(
                status=HealthCheckStatus.UNHEALTHY,
                checks={
                    "health_check": HealthCheckResult(
                        name="health_check",
                        status=HealthCheckStatus.UNHEALTHY,
                        message=f"Health check failed: {str(e)}",
                        checked_at=datetime.now(timezone.utc),
                    )
                },
                checked_at=datetime.now(timezone.utc),
            )

    async def get_version(self) -> VersionInfo:
        """Get server version information.

        Returns:
            VersionInfo with version details
        """
        try:
            logger.debug("Getting server version information")

            # Get version info from package or default values
            version = getattr(self.settings, "APP_VERSION", "1.0.0")
            build_id = getattr(self.settings, "BUILD_ID", None)
            build_date = getattr(self.settings, "BUILD_DATE", None)
            git_commit = getattr(self.settings, "GIT_COMMIT", None)

            version_info = VersionInfo(
                version=version,
                build_id=build_id,
                build_date=build_date,
                git_commit=git_commit,
                python_version=f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            )

            logger.debug(f"Version information retrieved: {version}")
            return version_info

        except Exception as e:
            logger.error(f"Failed to get version information: {str(e)}")
            raise ServiceException(
                message=f"Failed to get version information: {str(e)}",
                service_name="server_service",
            )

    async def get_resource_usage(self) -> ResourceUsage:
        """Get server resource usage metrics.

        Returns:
            ResourceUsage with current resource metrics
        """
        try:
            logger.debug("Getting server resource usage")

            # Get CPU usage
            cpu_percent = self.system_monitor.get_cpu_percent(interval=1)

            # Get memory usage
            memory = self.system_monitor.get_virtual_memory()

            # Get disk usage for the data directory
            data_path = self.settings.data_dir
            disk = self.system_monitor.get_disk_usage(data_path)

            # Calculate uptime using boot time from system monitor
            boot_time = self.system_monitor.get_boot_time()
            uptime = (
                datetime.now(timezone.utc)
                - datetime.fromtimestamp(boot_time, tz=timezone.utc)
            ).total_seconds()

            resource_usage = ResourceUsage(
                cpu_percent=cpu_percent,
                memory_used_bytes=memory.used,
                memory_total_bytes=memory.total,
                disk_used_bytes=disk.used,
                disk_total_bytes=disk.total,
                uptime_seconds=max(0.0, uptime),  # Ensure uptime is not negative
                measured_at=datetime.now(timezone.utc),
            )

            logger.debug(
                f"Resource usage retrieved - CPU: {cpu_percent}%, Memory: {memory.percent}%"
            )
            return resource_usage

        except Exception as e:
            logger.error(f"Failed to get resource usage: {str(e)}")
            raise ServiceException(
                message=f"Failed to get resource usage: {str(e)}",
                service_name="server_service",
            )

    async def _check_disk_space(self) -> HealthCheckResult:
        """Check disk space availability."""
        try:
            start_time = datetime.now(timezone.utc)

            data_path = self.settings.data_dir
            disk = self.system_monitor.get_disk_usage(data_path)

            # Calculate disk usage percentage
            usage_percent = (disk.used / disk.total) * 100
            free_gb = disk.free / (1024**3)

            # Use configurable thresholds from settings
            min_free_gb = self.settings.HEALTH_CHECK_DISK_MIN_GB
            min_free_percent = self.settings.HEALTH_CHECK_DISK_MIN_PERCENT
            free_percent = (disk.free / disk.total) * 100

            # Determine health status based on thresholds
            if free_gb < min_free_gb or free_percent < min_free_percent:
                status = HealthCheckStatus.UNHEALTHY
                message = (
                    f"Low disk space: {free_gb:.2f}GB free ({usage_percent:.1f}% used)"
                )
            else:
                status = HealthCheckStatus.HEALTHY
                message = f"Disk space normal: {free_gb:.2f}GB free ({usage_percent:.1f}% used)"

            duration = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000

            return HealthCheckResult(
                name="disk_space",
                status=status,
                message=message,
                duration_ms=duration,
                checked_at=start_time,
            )

        except Exception as e:
            return HealthCheckResult(
                name="disk_space",
                status=HealthCheckStatus.UNHEALTHY,
                message=f"Disk check failed: {str(e)}",
                checked_at=datetime.now(timezone.utc),
            )

    async def _check_memory_usage(self) -> HealthCheckResult:
        """Check memory usage."""
        try:
            start_time = datetime.now(timezone.utc)

            memory = self.system_monitor.get_virtual_memory()
            usage_percent = memory.percent
            available_gb = memory.available / (1024**3)

            # Use configurable thresholds from settings
            min_available_gb = self.settings.HEALTH_CHECK_MEM_MIN_GB
            min_available_percent = self.settings.HEALTH_CHECK_MEM_MIN_PERCENT
            available_percent = (memory.available / memory.total) * 100

            # Determine health status based on thresholds
            if (
                available_gb < min_available_gb
                or available_percent < min_available_percent
            ):
                status = HealthCheckStatus.UNHEALTHY
                message = f"Low memory: {available_gb:.2f}GB available ({usage_percent:.1f}% used)"
            else:
                status = HealthCheckStatus.HEALTHY
                message = f"Memory usage normal: {available_gb:.2f}GB available ({usage_percent:.1f}% used)"

            duration = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000

            return HealthCheckResult(
                name="memory",
                status=status,
                message=message,
                duration_ms=duration,
                checked_at=start_time,
            )

        except Exception as e:
            return HealthCheckResult(
                name="memory",
                status=HealthCheckStatus.UNHEALTHY,
                message=f"Memory check failed: {str(e)}",
                checked_at=datetime.now(timezone.utc),
            )

    async def _check_config_service(self) -> HealthCheckResult:
        """Check configuration service health."""
        try:
            start_time = datetime.now(timezone.utc)

            # Try to access the config service
            config_service = self.context.get_config_service()

            # Perform a simple operation to verify it's working
            await config_service.get_app_config("_health_check")

            duration = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000

            return HealthCheckResult(
                name="config_service",
                status=HealthCheckStatus.HEALTHY,
                message="Configuration service is responsive",
                duration_ms=duration,
                checked_at=start_time,
            )

        except Exception as e:
            return HealthCheckResult(
                name="config_service",
                status=HealthCheckStatus.UNHEALTHY,
                message=f"Configuration service failed: {str(e)}",
                checked_at=datetime.now(timezone.utc),
            )

    async def _check_file_storage(self) -> HealthCheckResult:
        """Check file storage service health."""
        try:
            start_time = datetime.now(timezone.utc)

            # Try to access the file storage service
            file_storage = self.context.get_file_storage()

            # Verify the storage directory exists and is writable
            storage_path = Path(file_storage.base_path)
            if not storage_path.exists():
                raise Exception("Storage directory does not exist")

            if not storage_path.is_dir():
                raise Exception("Storage path is not a directory")

            # Try to write a test file
            test_file = storage_path / ".health_check"
            test_file.write_text("health_check")
            test_file.unlink()  # Clean up

            duration = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000

            return HealthCheckResult(
                name="file_storage",
                status=HealthCheckStatus.HEALTHY,
                message="File storage is accessible and writable",
                duration_ms=duration,
                checked_at=start_time,
            )

        except Exception as e:
            return HealthCheckResult(
                name="file_storage",
                status=HealthCheckStatus.UNHEALTHY,
                message=f"File storage failed: {str(e)}",
                duration_ms=0.0,
                checked_at=datetime.now(timezone.utc),
            )
