import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.server_state import ServerState

if TYPE_CHECKING:
    from ..models.health_status import HealthStatus
    from ..models.resource_usage import ResourceUsage
    from ..models.version_info import VersionInfo


T = TypeVar("T", bound="ServerStatus")


@_attrs_define
class ServerStatus:
    """Complete server status information.

    Attributes:
        state (ServerState): Server state enumeration.
        health (HealthStatus): Overall server health status.
        version (VersionInfo): Server version information.
        resources (ResourceUsage): Server resource usage information.
        started_at (datetime.datetime): When the server was started
        status_checked_at (datetime.datetime): When this status was generated
    """

    state: ServerState
    health: "HealthStatus"
    version: "VersionInfo"
    resources: "ResourceUsage"
    started_at: datetime.datetime
    status_checked_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        state = self.state.value

        health = self.health.to_dict()

        version = self.version.to_dict()

        resources = self.resources.to_dict()

        started_at = self.started_at.isoformat()

        status_checked_at = self.status_checked_at.isoformat()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "state": state,
                "health": health,
                "version": version,
                "resources": resources,
                "started_at": started_at,
                "status_checked_at": status_checked_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.health_status import HealthStatus
        from ..models.resource_usage import ResourceUsage
        from ..models.version_info import VersionInfo

        d = dict(src_dict)
        state = ServerState(d.pop("state"))

        health = HealthStatus.from_dict(d.pop("health"))

        version = VersionInfo.from_dict(d.pop("version"))

        resources = ResourceUsage.from_dict(d.pop("resources"))

        started_at = isoparse(d.pop("started_at"))

        status_checked_at = isoparse(d.pop("status_checked_at"))

        server_status = cls(
            state=state,
            health=health,
            version=version,
            resources=resources,
            started_at=started_at,
            status_checked_at=status_checked_at,
        )

        server_status.additional_properties = d
        return server_status

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
