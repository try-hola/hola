from typing import Protocol, Any
import psutil
from datetime import datetime, timezone

class SystemMetrics(Protocol):
    """Protocol for system metrics providers."""
    def get_cpu_percent(self, interval: float | None = 1.0) -> float: ...
    def get_virtual_memory(self) -> Any: ... # psutil returns a named tuple e.g. ssvmem
    def get_disk_usage(self, path: str) -> Any: ... # psutil returns a named tuple e.g. sdiskusage
    def get_boot_time(self) -> float: ... # Returns timestamp

class PsutilSystemMonitor(SystemMetrics):
    """Concrete implementation of SystemMetrics using the psutil library."""
    def get_cpu_percent(self, interval: float | None = 1.0) -> float:
        return psutil.cpu_percent(interval=interval)

    def get_virtual_memory(self) -> Any:
        return psutil.virtual_memory()

    def get_disk_usage(self, path: str) -> Any:
        return psutil.disk_usage(path)

    def get_boot_time(self) -> float:
        return psutil.boot_time()
