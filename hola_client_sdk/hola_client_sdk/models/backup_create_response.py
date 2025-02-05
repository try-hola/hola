from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.backup_info import BackupInfo


T = TypeVar("T", bound="BackupCreateResponse")


@_attrs_define
class BackupCreateResponse:
    """Response from backup creation request.

    Attributes:
        backup (BackupInfo): Backup information and metadata.
        message (str): Success message
    """

    backup: "BackupInfo"
    message: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        backup = self.backup.to_dict()

        message = self.message

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "backup": backup,
                "message": message,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.backup_info import BackupInfo

        d = dict(src_dict)
        backup = BackupInfo.from_dict(d.pop("backup"))

        message = d.pop("message")

        backup_create_response = cls(
            backup=backup,
            message=message,
        )

        backup_create_response.additional_properties = d
        return backup_create_response

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
