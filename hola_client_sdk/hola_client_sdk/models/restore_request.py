from collections.abc import Mapping
from typing import Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="RestoreRequest")


@_attrs_define
class RestoreRequest:
    """Request to restore from a backup.

    Attributes:
        backup_id (str): ID of backup to restore from
        target_app_name (Union[None, Unset, str]): Target application name (defaults to original)
        restore_config (Union[Unset, bool]): Restore configuration Default: True.
        restore_files (Union[Unset, bool]): Restore application files Default: True.
        restore_data (Union[Unset, bool]): Restore application data Default: True.
    """

    backup_id: str
    target_app_name: Union[None, Unset, str] = UNSET
    restore_config: Union[Unset, bool] = True
    restore_files: Union[Unset, bool] = True
    restore_data: Union[Unset, bool] = True
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        backup_id = self.backup_id

        target_app_name: Union[None, Unset, str]
        if isinstance(self.target_app_name, Unset):
            target_app_name = UNSET
        else:
            target_app_name = self.target_app_name

        restore_config = self.restore_config

        restore_files = self.restore_files

        restore_data = self.restore_data

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "backup_id": backup_id,
            }
        )
        if target_app_name is not UNSET:
            field_dict["target_app_name"] = target_app_name
        if restore_config is not UNSET:
            field_dict["restore_config"] = restore_config
        if restore_files is not UNSET:
            field_dict["restore_files"] = restore_files
        if restore_data is not UNSET:
            field_dict["restore_data"] = restore_data

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        backup_id = d.pop("backup_id")

        def _parse_target_app_name(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        target_app_name = _parse_target_app_name(d.pop("target_app_name", UNSET))

        restore_config = d.pop("restore_config", UNSET)

        restore_files = d.pop("restore_files", UNSET)

        restore_data = d.pop("restore_data", UNSET)

        restore_request = cls(
            backup_id=backup_id,
            target_app_name=target_app_name,
            restore_config=restore_config,
            restore_files=restore_files,
            restore_data=restore_data,
        )

        restore_request.additional_properties = d
        return restore_request

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
