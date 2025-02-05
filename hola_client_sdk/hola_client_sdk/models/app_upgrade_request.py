from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.app_upgrade_request_environment_type_0 import AppUpgradeRequestEnvironmentType0


T = TypeVar("T", bound="AppUpgradeRequest")


@_attrs_define
class AppUpgradeRequest:
    """Request model for upgrading applications.

    Attributes:
        image (Union[None, Unset, str]): New container image to upgrade to
        environment (Union['AppUpgradeRequestEnvironmentType0', None, Unset]): Environment variables to update
        version (Union[None, Unset, str]): New application version tag
        backup_before_upgrade (Union[Unset, bool]): Create backup before upgrading Default: True.
    """

    image: Union[None, Unset, str] = UNSET
    environment: Union["AppUpgradeRequestEnvironmentType0", None, Unset] = UNSET
    version: Union[None, Unset, str] = UNSET
    backup_before_upgrade: Union[Unset, bool] = True
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.app_upgrade_request_environment_type_0 import AppUpgradeRequestEnvironmentType0

        image: Union[None, Unset, str]
        if isinstance(self.image, Unset):
            image = UNSET
        else:
            image = self.image

        environment: Union[None, Unset, dict[str, Any]]
        if isinstance(self.environment, Unset):
            environment = UNSET
        elif isinstance(self.environment, AppUpgradeRequestEnvironmentType0):
            environment = self.environment.to_dict()
        else:
            environment = self.environment

        version: Union[None, Unset, str]
        if isinstance(self.version, Unset):
            version = UNSET
        else:
            version = self.version

        backup_before_upgrade = self.backup_before_upgrade

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if image is not UNSET:
            field_dict["image"] = image
        if environment is not UNSET:
            field_dict["environment"] = environment
        if version is not UNSET:
            field_dict["version"] = version
        if backup_before_upgrade is not UNSET:
            field_dict["backup_before_upgrade"] = backup_before_upgrade

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.app_upgrade_request_environment_type_0 import AppUpgradeRequestEnvironmentType0

        d = dict(src_dict)

        def _parse_image(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        image = _parse_image(d.pop("image", UNSET))

        def _parse_environment(data: object) -> Union["AppUpgradeRequestEnvironmentType0", None, Unset]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                environment_type_0 = AppUpgradeRequestEnvironmentType0.from_dict(data)

                return environment_type_0
            except:  # noqa: E722
                pass
            return cast(Union["AppUpgradeRequestEnvironmentType0", None, Unset], data)

        environment = _parse_environment(d.pop("environment", UNSET))

        def _parse_version(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        version = _parse_version(d.pop("version", UNSET))

        backup_before_upgrade = d.pop("backup_before_upgrade", UNSET)

        app_upgrade_request = cls(
            image=image,
            environment=environment,
            version=version,
            backup_before_upgrade=backup_before_upgrade,
        )

        app_upgrade_request.additional_properties = d
        return app_upgrade_request

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
