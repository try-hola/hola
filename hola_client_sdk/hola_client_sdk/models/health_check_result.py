import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.health_check_status import HealthCheckStatus
from ..types import UNSET, Unset

T = TypeVar("T", bound="HealthCheckResult")


@_attrs_define
class HealthCheckResult:
    """Individual health check result.

    Attributes:
        name (str): Name of the health check
        status (HealthCheckStatus): Health check status enumeration.
        checked_at (datetime.datetime): When the health check was performed
        message (Union[None, Unset, str]): Optional status message
        duration_ms (Union[None, Unset, float]): Health check duration in milliseconds
    """

    name: str
    status: HealthCheckStatus
    checked_at: datetime.datetime
    message: Union[None, Unset, str] = UNSET
    duration_ms: Union[None, Unset, float] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        status = self.status.value

        checked_at = self.checked_at.isoformat()

        message: Union[None, Unset, str]
        if isinstance(self.message, Unset):
            message = UNSET
        else:
            message = self.message

        duration_ms: Union[None, Unset, float]
        if isinstance(self.duration_ms, Unset):
            duration_ms = UNSET
        else:
            duration_ms = self.duration_ms

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "status": status,
                "checked_at": checked_at,
            }
        )
        if message is not UNSET:
            field_dict["message"] = message
        if duration_ms is not UNSET:
            field_dict["duration_ms"] = duration_ms

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        status = HealthCheckStatus(d.pop("status"))

        checked_at = isoparse(d.pop("checked_at"))

        def _parse_message(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        message = _parse_message(d.pop("message", UNSET))

        def _parse_duration_ms(data: object) -> Union[None, Unset, float]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, float], data)

        duration_ms = _parse_duration_ms(d.pop("duration_ms", UNSET))

        health_check_result = cls(
            name=name,
            status=status,
            checked_at=checked_at,
            message=message,
            duration_ms=duration_ms,
        )

        health_check_result.additional_properties = d
        return health_check_result

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
