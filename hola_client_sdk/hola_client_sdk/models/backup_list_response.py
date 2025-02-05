from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.backup_info import BackupInfo


T = TypeVar("T", bound="BackupListResponse")


@_attrs_define
class BackupListResponse:
    """Response containing list of backups.

    Attributes:
        backups (list['BackupInfo']): List of backup information
        total_count (int): Total number of backups
        total_size_bytes (int): Total size of all backups in bytes
    """

    backups: list["BackupInfo"]
    total_count: int
    total_size_bytes: int
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        backups = []
        for backups_item_data in self.backups:
            backups_item = backups_item_data.to_dict()
            backups.append(backups_item)

        total_count = self.total_count

        total_size_bytes = self.total_size_bytes

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "backups": backups,
                "total_count": total_count,
                "total_size_bytes": total_size_bytes,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.backup_info import BackupInfo

        d = dict(src_dict)
        backups = []
        _backups = d.pop("backups")
        for backups_item_data in _backups:
            backups_item = BackupInfo.from_dict(backups_item_data)

            backups.append(backups_item)

        total_count = d.pop("total_count")

        total_size_bytes = d.pop("total_size_bytes")

        backup_list_response = cls(
            backups=backups,
            total_count=total_count,
            total_size_bytes=total_size_bytes,
        )

        backup_list_response.additional_properties = d
        return backup_list_response

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
