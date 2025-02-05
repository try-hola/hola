import datetime
from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

T = TypeVar("T", bound="ResourceUsage")


@_attrs_define
class ResourceUsage:
    """Server resource usage information.

    Attributes:
        cpu_percent (float): CPU usage percentage
        memory_used_bytes (int): Memory used in bytes
        memory_total_bytes (int): Total memory in bytes
        disk_used_bytes (int): Disk space used in bytes
        disk_total_bytes (int): Total disk space in bytes
        uptime_seconds (float): Server uptime in seconds
        measured_at (datetime.datetime): When the metrics were measured
    """

    cpu_percent: float
    memory_used_bytes: int
    memory_total_bytes: int
    disk_used_bytes: int
    disk_total_bytes: int
    uptime_seconds: float
    measured_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        cpu_percent = self.cpu_percent

        memory_used_bytes = self.memory_used_bytes

        memory_total_bytes = self.memory_total_bytes

        disk_used_bytes = self.disk_used_bytes

        disk_total_bytes = self.disk_total_bytes

        uptime_seconds = self.uptime_seconds

        measured_at = self.measured_at.isoformat()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "cpu_percent": cpu_percent,
                "memory_used_bytes": memory_used_bytes,
                "memory_total_bytes": memory_total_bytes,
                "disk_used_bytes": disk_used_bytes,
                "disk_total_bytes": disk_total_bytes,
                "uptime_seconds": uptime_seconds,
                "measured_at": measured_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        cpu_percent = d.pop("cpu_percent")

        memory_used_bytes = d.pop("memory_used_bytes")

        memory_total_bytes = d.pop("memory_total_bytes")

        disk_used_bytes = d.pop("disk_used_bytes")

        disk_total_bytes = d.pop("disk_total_bytes")

        uptime_seconds = d.pop("uptime_seconds")

        measured_at = isoparse(d.pop("measured_at"))

        resource_usage = cls(
            cpu_percent=cpu_percent,
            memory_used_bytes=memory_used_bytes,
            memory_total_bytes=memory_total_bytes,
            disk_used_bytes=disk_used_bytes,
            disk_total_bytes=disk_total_bytes,
            uptime_seconds=uptime_seconds,
            measured_at=measured_at,
        )

        resource_usage.additional_properties = d
        return resource_usage

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
