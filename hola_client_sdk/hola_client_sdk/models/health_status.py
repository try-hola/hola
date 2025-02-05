import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.health_check_status import HealthCheckStatus
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.health_status_checks import HealthStatusChecks


T = TypeVar("T", bound="HealthStatus")


@_attrs_define
class HealthStatus:
    """Overall server health status.

    Attributes:
        status (HealthCheckStatus): Health check status enumeration.
        checked_at (datetime.datetime): When the health status was checked
        checks (Union[Unset, HealthStatusChecks]): Individual health check results
    """

    status: HealthCheckStatus
    checked_at: datetime.datetime
    checks: Union[Unset, "HealthStatusChecks"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        status = self.status.value

        checked_at = self.checked_at.isoformat()

        checks: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.checks, Unset):
            checks = self.checks.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "status": status,
                "checked_at": checked_at,
            }
        )
        if checks is not UNSET:
            field_dict["checks"] = checks

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.health_status_checks import HealthStatusChecks

        d = dict(src_dict)
        status = HealthCheckStatus(d.pop("status"))

        checked_at = isoparse(d.pop("checked_at"))

        _checks = d.pop("checks", UNSET)
        checks: Union[Unset, HealthStatusChecks]
        if isinstance(_checks, Unset):
            checks = UNSET
        else:
            checks = HealthStatusChecks.from_dict(_checks)

        health_status = cls(
            status=status,
            checked_at=checked_at,
            checks=checks,
        )

        health_status.additional_properties = d
        return health_status

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
