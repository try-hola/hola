from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.app_create_request_environment import AppCreateRequestEnvironment


T = TypeVar("T", bound="AppCreateRequest")


@_attrs_define
class AppCreateRequest:
    """Request model for creating applications (without deployment).

    Attributes:
        name (str): Unique application name
        description (Union[None, Unset, str]): Application description
        image (Union[None, Unset, str]): Container image for future deployment
        port (Union[None, Unset, int]): Port to expose for the application
        environment (Union[Unset, AppCreateRequestEnvironment]): Environment variables
        version (Union[None, Unset, str]): Application version tag
    """

    name: str
    description: Union[None, Unset, str] = UNSET
    image: Union[None, Unset, str] = UNSET
    port: Union[None, Unset, int] = UNSET
    environment: Union[Unset, "AppCreateRequestEnvironment"] = UNSET
    version: Union[None, Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        description: Union[None, Unset, str]
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        image: Union[None, Unset, str]
        if isinstance(self.image, Unset):
            image = UNSET
        else:
            image = self.image

        port: Union[None, Unset, int]
        if isinstance(self.port, Unset):
            port = UNSET
        else:
            port = self.port

        environment: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.environment, Unset):
            environment = self.environment.to_dict()

        version: Union[None, Unset, str]
        if isinstance(self.version, Unset):
            version = UNSET
        else:
            version = self.version

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if image is not UNSET:
            field_dict["image"] = image
        if port is not UNSET:
            field_dict["port"] = port
        if environment is not UNSET:
            field_dict["environment"] = environment
        if version is not UNSET:
            field_dict["version"] = version

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.app_create_request_environment import AppCreateRequestEnvironment

        d = dict(src_dict)
        name = d.pop("name")

        def _parse_description(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        description = _parse_description(d.pop("description", UNSET))

        def _parse_image(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        image = _parse_image(d.pop("image", UNSET))

        def _parse_port(data: object) -> Union[None, Unset, int]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, int], data)

        port = _parse_port(d.pop("port", UNSET))

        _environment = d.pop("environment", UNSET)
        environment: Union[Unset, AppCreateRequestEnvironment]
        if isinstance(_environment, Unset):
            environment = UNSET
        else:
            environment = AppCreateRequestEnvironment.from_dict(_environment)

        def _parse_version(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        version = _parse_version(d.pop("version", UNSET))

        app_create_request = cls(
            name=name,
            description=description,
            image=image,
            port=port,
            environment=environment,
            version=version,
        )

        app_create_request.additional_properties = d
        return app_create_request

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
