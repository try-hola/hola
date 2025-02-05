from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.app import App


T = TypeVar("T", bound="AppDeployResponse")


@_attrs_define
class AppDeployResponse:
    """Response model for application deployment.

    Attributes:
        app (App): Application model shared between server and CLI.

            Represents a deployed application with its configuration, status, and metadata.
        deployment_id (str): Unique deployment identifier
        estimated_duration (Union[None, Unset, int]): Estimated deployment time in seconds
    """

    app: "App"
    deployment_id: str
    estimated_duration: Union[None, Unset, int] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        app = self.app.to_dict()

        deployment_id = self.deployment_id

        estimated_duration: Union[None, Unset, int]
        if isinstance(self.estimated_duration, Unset):
            estimated_duration = UNSET
        else:
            estimated_duration = self.estimated_duration

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "app": app,
                "deployment_id": deployment_id,
            }
        )
        if estimated_duration is not UNSET:
            field_dict["estimated_duration"] = estimated_duration

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.app import App

        d = dict(src_dict)
        app = App.from_dict(d.pop("app"))

        deployment_id = d.pop("deployment_id")

        def _parse_estimated_duration(data: object) -> Union[None, Unset, int]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, int], data)

        estimated_duration = _parse_estimated_duration(d.pop("estimated_duration", UNSET))

        app_deploy_response = cls(
            app=app,
            deployment_id=deployment_id,
            estimated_duration=estimated_duration,
        )

        app_deploy_response.additional_properties = d
        return app_deploy_response

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
