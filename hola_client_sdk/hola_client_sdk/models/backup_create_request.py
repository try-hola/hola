from collections.abc import Mapping
from typing import Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="BackupCreateRequest")


@_attrs_define
class BackupCreateRequest:
    """Request to create a new backup.

    Attributes:
        description (Union[None, Unset, str]): Optional backup description
        include_config (Union[Unset, bool]): Include configuration in backup Default: True.
        include_files (Union[Unset, bool]): Include application files in backup Default: True.
        include_data (Union[Unset, bool]): Include application data in backup Default: True.
    """

    description: Union[None, Unset, str] = UNSET
    include_config: Union[Unset, bool] = True
    include_files: Union[Unset, bool] = True
    include_data: Union[Unset, bool] = True
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        description: Union[None, Unset, str]
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        include_config = self.include_config

        include_files = self.include_files

        include_data = self.include_data

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if description is not UNSET:
            field_dict["description"] = description
        if include_config is not UNSET:
            field_dict["include_config"] = include_config
        if include_files is not UNSET:
            field_dict["include_files"] = include_files
        if include_data is not UNSET:
            field_dict["include_data"] = include_data

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_description(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        description = _parse_description(d.pop("description", UNSET))

        include_config = d.pop("include_config", UNSET)

        include_files = d.pop("include_files", UNSET)

        include_data = d.pop("include_data", UNSET)

        backup_create_request = cls(
            description=description,
            include_config=include_config,
            include_files=include_files,
            include_data=include_data,
        )

        backup_create_request.additional_properties = d
        return backup_create_request

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
