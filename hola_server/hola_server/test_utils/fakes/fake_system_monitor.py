from typing import Any, List, Dict
from hola_server.utils import (
    SystemMetrics,
)  # Adjusted import based on utils/__init__.py
from datetime import datetime, timezone


class FakeSystemMonitor(SystemMetrics):
    """
    FakeSystemMonitor

    Fake implementation of SystemMetrics for testing.

    Attributes:
        cpu_percent_val (float): Default CPU percentage value.
        virtual_memory_val (Any): Default virtual memory statistics.
        disk_usage_val (Any): Default disk usage statistics.
        boot_time_val (float): Default boot time (1 hour ago).
        method_calls (List[Dict[str, Any]]): Tracks method calls for testing.
    """

    def __init__(self):
        self.cpu_percent_val: float = 25.0
        self.virtual_memory_val: Any = self._default_virtual_memory()
        self.disk_usage_val: Any = self._default_disk_usage()
        self.boot_time_val: float = (
            datetime.now(timezone.utc).timestamp() - 3600
        )  # Default to 1 hour ago
        self.method_calls: List[Dict[str, Any]] = []

    def _default_virtual_memory(self) -> Any:
        """
        Provides default virtual memory statistics.

        Returns:
            Any: Mock virtual memory statistics.
        """

        class MockSsvmem:
            percent = 50.0
            available = 4 * 1024**3  # 4GB
            total = 8 * 1024**3  # 8GB
            used = 4 * 1024**3  # 4GB

        return MockSsvmem()

    def _default_disk_usage(self) -> Any:
        """
        Provides default disk usage statistics.

        Returns:
            Any: Mock disk usage statistics.
        """

        class MockSdiskusage:
            percent = 60.0
            free = 40 * 1024**3  # 40GB
            total = 100 * 1024**3  # 100GB
            used = 60 * 1024**3  # 60GB

        return MockSdiskusage()

    def get_cpu_percent(self, interval: float | None = 1.0) -> float:
        """
        Retrieves the CPU percentage.

        Args:
            interval (float | None): Interval for CPU percentage calculation.

        Returns:
            float: CPU percentage value.
        """
        self.method_calls.append({"method": "get_cpu_percent", "interval": interval})
        return self.cpu_percent_val

    def get_virtual_memory(self) -> Any:
        """
        Retrieves virtual memory statistics.

        Returns:
            Any: Virtual memory statistics.
        """
        self.method_calls.append({"method": "get_virtual_memory"})
        return self.virtual_memory_val

    def get_disk_usage(self, path: str) -> Any:
        """
        Retrieves disk usage statistics.

        Args:
            path (str): Path for disk usage calculation.

        Returns:
            Any: Disk usage statistics.
        """
        self.method_calls.append({"method": "get_disk_usage", "path": path})
        return self.disk_usage_val

    def get_boot_time(self) -> float:
        """
        Retrieves the system boot time.

        Returns:
            float: Boot time value.
        """
        self.method_calls.append({"method": "get_boot_time"})
        return self.boot_time_val

    def set_cpu_percent(self, val: float):
        """
        Sets the CPU percentage value.

        Args:
            val (float): CPU percentage value to set.
        """
        self.cpu_percent_val = val

    def set_virtual_memory(self, percent: float, available_gb: float, total_gb: float):
        """
        Sets virtual memory statistics.

        Args:
            percent (float): Percentage of memory used.
            available_gb (float): Available memory in GB.
            total_gb (float): Total memory in GB.
        """

        class MockSsvmem:
            percent: float
            available: float  # Store as bytes
            total: float  # Store as bytes
            used: float  # Store as bytes

        vm = MockSsvmem()
        vm.percent = percent
        vm.available = available_gb * 1024**3
        vm.total = total_gb * 1024**3
        vm.used = vm.total - vm.available
        self.virtual_memory_val = vm

    def set_disk_usage(self, percent: float, free_gb: float, total_gb: float):
        """
        Sets disk usage statistics.

        Args:
            percent (float): Percentage of disk used.
            free_gb (float): Free disk space in GB.
            total_gb (float): Total disk space in GB.
        """

        class MockSdiskusage:
            percent: float
            free: float  # Store as bytes
            total: float  # Store as bytes
            used: float  # Store as bytes

        du = MockSdiskusage()
        du.percent = percent
        du.free = free_gb * 1024**3
        du.total = total_gb * 1024**3
        du.used = du.total - du.free
        self.disk_usage_val = du

    def set_boot_time(self, timestamp: float):
        """
        Sets the system boot time.

        Args:
            timestamp (float): Boot time timestamp to set.
        """
        self.boot_time_val = timestamp

    def reset(self):
        """
        Resets all attributes to their default values.
        """
        self.cpu_percent_val = 25.0
        self.virtual_memory_val = self._default_virtual_memory()
        self.disk_usage_val = self._default_disk_usage()
        self.boot_time_val = (
            datetime.now(timezone.utc).timestamp() - 3600
        )  # Reset to 1 hour ago
        self.method_calls = []
