from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.app import App


T = TypeVar("T", bound="AppCreateResponse")


@_attrs_define
class AppCreateResponse:
    """Response model for application creation.

    Attributes:
        app (App): Application model shared between server and CLI.

            Represents a deployed application with its configuration, status, and metadata.
        message (str): Human-readable creation confirmation
    """

    app: "App"
    message: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        app = self.app.to_dict()

        message = self.message

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "app": app,
                "message": message,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.app import App

        d = dict(src_dict)
        app = App.from_dict(d.pop("app"))

        message = d.pop("message")

        app_create_response = cls(
            app=app,
            message=message,
        )

        app_create_response.additional_properties = d
        return app_create_response

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
