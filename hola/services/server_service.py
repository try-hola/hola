"""Server status and health management service.

This module provides business logic for server status monitoring, health checks,
and resource usage tracking. It performs system health assessments including disk space,
memory usage, configuration service availability, and file storage accessibility.

The service provides comprehensive information about server state, version details,
and real-time resource utilization metrics that can be used for monitoring and alerting.

Attributes:
    context (ServerContext): Server context containing settings and dependencies.
    settings (Settings): Application settings.
    system_monitor (SystemMetrics): System metrics provider for monitoring.
    _start_time (datetime): Server start time recorded at service initialization.
"""

import platform
import sys
import psutil
from pathlib import Path
from typing import Dict, Any
from datetime import datetime, timezone
from hola.shared.models.server import (
    ServerStatus,
    ServerState,
    HealthStatus,
    HealthCheckStatus,
    HealthCheckResult,
    VersionInfo,
    ResourceUsage,
)
from hola.shared.errors import ServiceException
from hola.shared.logger import get_logger
from ..config.context import ServerContext
from ..utils.system_monitor import SystemMetrics, PsutilSystemMonitor

logger = get_logger(__name__)


class ServerService:
    """Service for managing server status and health.

    Provides business logic for server status monitoring, health checks,
    and resource usage tracking. This service coordinates multiple health checks
    including disk space, memory usage, configuration service, and file storage.
    It also provides aggregated server status information including version details,
    system resources, and server uptime.

    This service is used by the API layer to expose server health endpoints and
    by administrative tools for monitoring server health.
    """

    def __init__(
        self, context: ServerContext, system_monitor: SystemMetrics | None = None
    ):
        """Initialize the server service.

        Args:
            context (ServerContext): Server context containing settings and dependencies.
            system_monitor (SystemMetrics | None, optional): Optional system metrics provider for dependency injection. Defaults to None.
        """
        self.context = context
        self.settings = context.settings
        self.system_monitor = system_monitor or PsutilSystemMonitor()
        self._start_time = datetime.now(timezone.utc)

        logger.debug("ServerService initialized")

    async def get_server_status(self) -> ServerStatus:
        """Get complete server status information.

        Collects health check results, version information, and resource usage metrics
        to create a comprehensive server status report. This method is the main entry
        point for server monitoring and diagnostics.

        Returns:
            ServerStatus: Comprehensive status object containing health check results,
                version details, resource utilization metrics, server state, and timestamps.

        Raises:
            ServiceException: If any error occurs during status collection.
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

        Performs a series of health checks on critical system components including
        disk space, memory usage, configuration service, and file storage. Each check
        produces a detailed health result, and an aggregate health status is determined
        based on individual check results.

        Returns:
            HealthStatus: Object containing overall status and individual component
                health results with details on each system component.

        Note:
            If an exception occurs during the health check process, an "UNHEALTHY" status
            will be returned rather than allowing the exception to propagate.
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
                        duration_ms=0.0,
                        checked_at=datetime.now(timezone.utc),
                    )
                },
                checked_at=datetime.now(timezone.utc),
            )

    async def get_version(self) -> VersionInfo:
        """Get server version information.

        Retrieves version information from application settings including version number,
        build ID, build date, git commit hash, and Python version. This information
        is useful for debugging, support, and auditing purposes.

        Returns:
            VersionInfo: Version details including application version, build information,
                git commit hash, and Python runtime version.

        Raises:
            ServiceException: If version information cannot be retrieved.
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

        Collects real-time system resource metrics including CPU usage, memory usage,
        disk space utilization, and system uptime. This information provides insight
        into the current operational state of the server and can be used for
        performance monitoring and capacity planning.

        Returns:
            ResourceUsage: Current resource metrics including CPU, memory, disk usage
                percentages, absolute byte values, and system uptime.

        Raises:
            ServiceException: If resource metrics cannot be retrieved.
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
        """Check disk space availability.

        Evaluates available disk space against configurable thresholds to determine
        if the system has sufficient storage capacity. Uses settings-defined minimum
        free space requirements in both percentage and absolute terms.

        Returns:
            HealthCheckResult: Disk space health check result containing status,
                diagnostic message, check duration, and timestamp.

        Note:
            Returns UNHEALTHY status if free space is below configured thresholds
            or if an exception occurs during the check.
        """
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
                duration_ms=0.0,
                checked_at=datetime.now(timezone.utc),
            )

    async def _check_memory_usage(self) -> HealthCheckResult:
        """Check memory usage.

        Evaluates available system memory against configurable thresholds to determine
        if sufficient memory is available for proper operation. Uses settings-defined
        minimum memory thresholds in both percentage and absolute terms.

        Returns:
            HealthCheckResult: Memory usage health check result containing status,
                diagnostic message, check duration, and timestamp.

        Note:
            Returns UNHEALTHY status if available memory is below configured thresholds
            or if an exception occurs during the check.
        """
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
                duration_ms=0.0,
                checked_at=datetime.now(timezone.utc),
            )

    async def _check_config_service(self) -> HealthCheckResult:
        """Check configuration service health.

        Verifies that the configuration service is responsive and functioning
        correctly by attempting to retrieve configuration data. This check
        ensures that the application can access configuration settings required
        for proper operation.

        Returns:
            HealthCheckResult: Configuration service health check result containing
                status, diagnostic message, check duration, and timestamp.

        Note:
            Returns UNHEALTHY status if the configuration service is unreachable
            or returns an error.
        """
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
                duration_ms=0.0,
                checked_at=datetime.now(timezone.utc),
            )

    async def _check_file_storage(self) -> HealthCheckResult:
        """Check file storage service health.

        Verifies that the file storage system is accessible and writable by
        creating a test file. This check ensures that the application can
        store and retrieve files, which is essential for many operations.

        Returns:
            HealthCheckResult: File storage service health check result containing
                status, diagnostic message, check duration, and timestamp.

        Note:
            Returns UNHEALTHY status if the storage directory is not accessible
            or if file writing operations fail.
        """
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
