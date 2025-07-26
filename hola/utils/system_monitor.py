"""
System monitoring utilities for Hola Server.

This module provides an interface for retrieving system metrics such as CPU usage,
memory statistics, disk usage, and system boot time. It uses the `psutil` library
for implementation and defines a protocol for extensibility.

Attributes:
    SystemMetrics (Protocol): Protocol defining methods for system metrics providers.
    PsutilSystemMonitor (SystemMetrics): Concrete implementation of SystemMetrics using psutil.
"""

from typing import Protocol, Any
import psutil
from datetime import datetime, timezone


class SystemMetrics(Protocol):
    """
    Protocol for system metrics providers.

    Defines the methods that any system metrics provider must implement.

    Methods:
        get_cpu_percent(interval: float | None = 1.0) -> float:
            Retrieve the CPU usage percentage over a given interval.

        get_virtual_memory() -> Any:
            Retrieve virtual memory statistics.

        get_disk_usage(path: str) -> Any:
            Retrieve disk usage statistics for a given path.

        get_boot_time() -> float:
            Retrieve the system boot time as a timestamp.
    """

    def get_cpu_percent(self, interval: float | None = 1.0) -> float:
        """
        Retrieve the CPU usage percentage over a given interval.

        Args:
            interval (float | None): Interval in seconds to calculate CPU usage. Defaults to 1.0.

        Returns:
            float: CPU usage percentage.
        """
        ...

    def get_virtual_memory(self) -> Any:
        """
        Retrieve virtual memory statistics.

        Returns:
            Any: Virtual memory statistics as a named tuple.
        """
        ...

    def get_disk_usage(self, path: str) -> Any:
        """
        Retrieve disk usage statistics for a given path.

        Args:
            path (str): Path to check disk usage.

        Returns:
            Any: Disk usage statistics as a named tuple.
        """
        ...

    def get_boot_time(self) -> float:
        """
        Retrieve the system boot time as a timestamp.

        Returns:
            float: System boot time as a Unix timestamp.
        """
        ...


class PsutilSystemMonitor(SystemMetrics):
    """
    Concrete implementation of SystemMetrics using the psutil library.

    Provides methods to retrieve system metrics such as CPU usage, memory statistics,
    disk usage, and system boot time.
    """

    def get_cpu_percent(self, interval: float | None = 1.0) -> float:
        """
        Retrieve the CPU usage percentage over a given interval.

        Args:
            interval (float | None): Interval in seconds to calculate CPU usage. Defaults to 1.0.

        Returns:
            float: CPU usage percentage.
        """
        return psutil.cpu_percent(interval=interval)

    def get_virtual_memory(self) -> Any:
        """
        Retrieve virtual memory statistics.

        Returns:
            Any: Virtual memory statistics as a named tuple.
        """
        return psutil.virtual_memory()

    def get_disk_usage(self, path: str) -> Any:
        """
        Retrieve disk usage statistics for a given path.

        Args:
            path (str): Path to check disk usage.

        Returns:
            Any: Disk usage statistics as a named tuple.
        """
        return psutil.disk_usage(path)

    def get_boot_time(self) -> float:
        """
        Retrieve the system boot time as a timestamp.

        Returns:
            float: System boot time as a Unix timestamp.
        """
        return psutil.boot_time()
