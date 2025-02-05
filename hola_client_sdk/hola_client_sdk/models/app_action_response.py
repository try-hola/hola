from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.app_status import AppStatus

T = TypeVar("T", bound="AppActionResponse")


@_attrs_define
class AppActionResponse:
    """Response model for application actions (start, stop, restart).

    Attributes:
        success (bool): Whether the action was successful
        message (str): Human-readable message about the action
        previous_status (AppStatus): Application status enumeration.
        new_status (AppStatus): Application status enumeration.
    """

    success: bool
    message: str
    previous_status: AppStatus
    new_status: AppStatus
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        success = self.success

        message = self.message

        previous_status = self.previous_status.value

        new_status = self.new_status.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "success": success,
                "message": message,
                "previous_status": previous_status,
                "new_status": new_status,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        success = d.pop("success")

        message = d.pop("message")

        previous_status = AppStatus(d.pop("previous_status"))

        new_status = AppStatus(d.pop("new_status"))

        app_action_response = cls(
            success=success,
            message=message,
            previous_status=previous_status,
            new_status=new_status,
        )

        app_action_response.additional_properties = d
        return app_action_response

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
